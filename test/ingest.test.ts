// Pipeline behavior with stubbed site + AI. The real-data run is `npm run ingest`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalysisResult } from '../src/analyze.ts';
import { getNoticeDetail } from '../src/api/notices.ts';
import { counts, hasCurrentAnalysis, openDb } from '../src/db.ts';
import { AiApiError, InvalidAiJsonError, NetworkError } from '../src/errors.ts';
import { ingest, type IngestDeps } from '../src/ingest.ts';
import { parseListHtml, parseNoticeHtml, type ListedNotice } from '../src/sources/inhaMainNotice.ts';
import type { RawNotice } from '../src/types.ts';

const urlOf = (id: string) => `https://www.inha.ac.kr/bbs/kr/8/${id}/artclView.do`;
const listed = (...ids: string[]): ListedNotice[] =>
  ids.map((id) => ({ sourceNoticeId: id, url: urlOf(id), title: `t${id}`, listedDate: null, pinned: false }));

/** A fake site whose pages can be edited between runs. */
function fakeSite(pages: Record<string, string>) {
  return {
    pages,
    fetchNotice: async (url: string): Promise<RawNotice> => {
      const id = url.match(/\/(\d+)\/artclView/)![1];
      const body = pages[id];
      if (body === undefined) throw new NetworkError(`fetch failed for ${id}`);
      return parseNoticeHtml(
        `<div class="artclViewHead"><dl><dt>작성일</dt><dd>2026.09.22.</dd></dl></div>` +
          `<h2 class="artclViewTitle">제목 ${id}</h2><div class="artclView"><p>${body}</p></div>`,
        { sourceNoticeId: id, canonicalUrl: urlOf(id) },
      );
    },
  };
}

const okAnalysis = (): AnalysisResult => ({
  analysis: {
    category: '장학금', applicationStart: null, applicationEnd: '2026-10-16', deadline: '2026-10-16', eventDate: null,
    target: '학부생', summary: ['요약'], easyExplanation: '설명', uncertain: [],
    en: { title: 'Title', summary: ['Summary'], easyExplanation: 'Explanation', target: 'Undergraduates', eventInfo: null },
    evidence: { applicationStart: null, applicationEnd: '2026.10.16', deadline: '2026.10.16', eventDate: null },
  },
  rawResponse: '{}', validationWarnings: [], provider: 'fake', model: 'fake-1',
});

function run(db: ReturnType<typeof openDb>, site: ReturnType<typeof fakeSite>, ids: string[], analyze: IngestDeps['analyze']) {
  const lines: string[] = [];
  return ingest({
    db, listNotices: async () => listed(...ids), fetchNotice: site.fetchNotice, analyze,
    log: (l) => lines.push(l), crawlDelayMs: 0, today: TODAY,
  }).then((stats) => ({ stats, lines }));
}

// Fixed "today" for the incremental re-check rules. The fake pages' 작성일 (2026-09-22) is then
// within RECENT_DAYS, so re-runs re-fetch them (edit detection); see the incremental tests below.
const TODAY = '2026-09-25';

const TEXT = (s: string) => `신청기간 2026.10.16까지 접수합니다. 학부생 대상 안내문 ${s}`;

test('first run inserts + analyzes; second run is idempotent (no duplicates, no AI calls)', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '2': TEXT('b'), '3': TEXT('c') });
  let aiCalls = 0;
  const analyze = async () => (aiCalls++, okAnalysis());

  const first = await run(db, site, ['1', '2', '3'], analyze);
  assert.deepEqual([first.stats.new, first.stats.analyzed, aiCalls], [3, 3, 3]);
  assert.deepEqual(counts(db), { notices: 3, analyses: 3, analyzed_current: 3, pending_analysis: 0 });
  assert.ok(first.lines.includes('[CRAWL] Found 3 notices'));
  assert.ok(first.lines.some((l) => l.startsWith('[NEW] Notice 1')));
  assert.ok(first.lines.includes('[AI] Analyzing 1'));

  const before = db.prepare('SELECT * FROM notice_analysis ORDER BY id').all();
  const second = await run(db, site, ['1', '2', '3'], analyze);
  assert.deepEqual([second.stats.new, second.stats.unchanged, second.stats.analyzed, aiCalls], [0, 3, 0, 3]);
  assert.deepEqual(counts(db), { notices: 3, analyses: 3, analyzed_current: 3, pending_analysis: 0 });
  assert.deepEqual(db.prepare('SELECT * FROM notice_analysis ORDER BY id').all(), before, 'existing analyses untouched');
  assert.ok(second.lines.includes('[SKIP] Unchanged notice 2 (existing analysis is current; no AI request)'));
});

test('ingestion stores the English block from the same analysis call; API serves it', async () => {
  const db = openDb(':memory:');
  let aiCalls = 0;
  await run(db, fakeSite({ '1': TEXT('a') }), ['1'], async () => (aiCalls++, okAnalysis()));
  assert.equal(aiCalls, 1, 'one AI call per notice: no separate translation request');
  const d = getNoticeDetail(db, 1)!;
  assert.deepEqual(d.analysis!.en, okAnalysis().analysis.en);
  assert.equal(d.analysis!.summary[0], '요약', 'Korean kept as the source of truth');
});

test('title-only edit: row updated, existing analysis still valid, no AI call', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a') });
  let aiCalls = 0;
  const analyze = async () => (aiCalls++, okAnalysis());
  await run(db, site, ['1'], analyze);
  db.prepare("UPDATE notices SET title = 'old title' WHERE source_notice_id = '1'").run();
  const { stats, lines } = await run(db, site, ['1'], analyze);
  assert.deepEqual([stats.updated, stats.analyzed, aiCalls], [1, 0, 1]);
  assert.ok(lines.some((l) => l.startsWith('[SKIP] Existing analysis for 1 still valid (title change only')));
});

test('--upgrade-prompt re-analyzes only notices whose analysis came from an older prompt', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '2': TEXT('b') });
  let aiCalls = 0;
  const analyze = async () => (aiCalls++, okAnalysis());
  await run(db, site, ['1', '2'], analyze);
  db.prepare("UPDATE notice_analysis SET prompt_version = 'v1' WHERE notice_id = 1").run(); // notice 1 analyzed by an old prompt

  const normal = await run(db, site, ['1', '2'], analyze);
  assert.equal(normal.stats.analyzed, 0, 'without the flag an old-prompt analysis still counts as current');

  const lines: string[] = [];
  const upgraded = await ingest({
    db, listNotices: async () => listed('1', '2'), fetchNotice: site.fetchNotice, analyze,
    log: (l) => lines.push(l), crawlDelayMs: 0, today: TODAY, upgradePrompt: true,
  });
  assert.deepEqual([upgraded.analyzed, upgraded.analysisSkipped, aiCalls], [1, 1, 3]);
  assert.ok(lines.some((l) => l.startsWith('[UPGRADE] Notice 1')));
});

test('changed notice: row updated in place, old analysis becomes stale, AI runs once for it only', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '2': TEXT('b') });
  const analyzed: string[] = [];
  const analyze = async (n: RawNotice) => (analyzed.push(n.sourceNoticeId), okAnalysis());
  await run(db, site, ['1', '2'], analyze);

  site.pages['2'] = TEXT('b — 마감일 연장');
  const { stats, lines } = await run(db, site, ['1', '2'], analyze);
  assert.deepEqual([stats.updated, stats.unchanged, stats.analyzed], [1, 1, 1]);
  assert.deepEqual(analyzed, ['1', '2', '2']);
  assert.ok(lines.includes('[UPDATE] Notice 2 changed (content)'));

  const row = db.prepare("SELECT id, original_content, content_updated_at FROM notices WHERE source_notice_id = '2'").get() as any;
  assert.match(row.original_content, /마감일 연장/, 'stored notice reflects the new official text');
  assert.ok(row.content_updated_at);
  const rows = db.prepare('SELECT a.content_hash = n.content_hash AS current FROM notice_analysis a JOIN notices n ON n.id = a.notice_id WHERE n.id = ? ORDER BY a.id').all(row.id) as any[];
  assert.deepEqual(rows.map((r) => r.current), [0, 1], 'old analysis kept but stale; new one current');
  assert.equal(counts(db).notices, 2, 'no duplicate row for the updated notice');
});

test('failed AI analysis keeps the notice, continues, and is retried on the next run', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '2': TEXT('b'), '3': TEXT('c') });
  let fail = true;
  const analyze = async (n: RawNotice) => {
    if (fail && n.sourceNoticeId === '2') throw new InvalidAiJsonError('bad JSON', '{"category":');
    return okAnalysis();
  };
  const first = await run(db, site, ['1', '2', '3'], analyze);
  assert.deepEqual([first.stats.analyzed, first.stats.analysisFailed], [2, 1]);
  assert.ok(first.lines.some((l) => l.startsWith('[ERROR] Notice 2 analysis failed (original notice kept)')));
  assert.equal(counts(db).notices, 3, 'notice 2 stored despite AI failure');
  assert.equal(counts(db).pending_analysis, 1);

  fail = false;
  const second = await run(db, site, ['1', '2', '3'], analyze);
  assert.deepEqual([second.stats.analyzed, second.stats.analysisSkipped], [1, 2]);
  assert.ok(second.lines.some((l) => l.startsWith('[PENDING] Notice 2')));
  assert.equal(counts(db).pending_analysis, 0);
});

test('one notice failing to crawl does not stop the others', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '3': TEXT('c'), '4': '<img src="/poster.png">' }); // 2 unreachable, 4 image-only
  const { stats, lines } = await run(db, site, ['1', '2', '3', '4'], async () => okAnalysis());
  assert.deepEqual([stats.new, stats.crawlFailed, stats.analyzed], [2, 2, 2]);
  assert.ok(lines.some((l) => l.startsWith('[ERROR] Notice 2 crawl failed: NetworkError')));
  assert.ok(lines.some((l) => l.startsWith('[ERROR] Notice 4 crawl failed: EmptyContentError')));
});

test('site listing unavailable -> run fails loudly, database untouched', async () => {
  const db = openDb(':memory:');
  await assert.rejects(
    ingest({ db, listNotices: async () => { throw new NetworkError('ECONNREFUSED'); }, fetchNotice: async () => { throw new Error(); }, analyze: null, log: () => {} }),
    NetworkError,
  );
  assert.equal(counts(db).notices, 0);
});

test('AI quota (429) stops further AI calls; remaining notices are stored and deferred', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '2': TEXT('b'), '3': TEXT('c') });
  let calls = 0;
  const analyze = async () => {
    calls++;
    throw new AiApiError('Gemini API error 429 quota', { status: 429 });
  };
  const { stats, lines } = await run(db, site, ['1', '2', '3'], analyze);
  assert.deepEqual([calls, stats.analysisFailed, stats.analysisDeferred, stats.new], [1, 1, 2, 3]);
  assert.ok(lines.some((l) => l.startsWith('[AI] Stopping AI calls for this run: AI rate/quota limit')));
});

test('all models benched (no request sent) -> deferred, not counted as failed', async () => {
  const db = openDb(':memory:');
  let calls = 0;
  const analyze = async () => {
    calls++;
    throw new AiApiError('All Gemini models are benched', { status: 429, noRequestSent: true });
  };
  const { stats } = await run(db, fakeSite({ '1': TEXT('a'), '2': TEXT('b') }), ['1', '2'], analyze);
  assert.deepEqual([calls, stats.analysisFailed, stats.analysisDeferred, stats.new], [1, 0, 2, 2]);
});

test('repeated 503 overloads stop AI after 3 consecutive failures', async () => {
  const db = openDb(':memory:');
  const site = fakeSite({ '1': TEXT('a'), '2': TEXT('b'), '3': TEXT('c'), '4': TEXT('d') });
  let calls = 0;
  const analyze = async () => {
    calls++;
    throw new AiApiError('Gemini API error 503 high demand', { status: 503 });
  };
  const { stats } = await run(db, site, ['1', '2', '3', '4'], analyze);
  assert.deepEqual([calls, stats.analysisFailed, stats.analysisDeferred], [3, 3, 1]);
});

test('AI disabled (no key): notices still ingested, analysis deferred', async () => {
  const db = openDb(':memory:');
  const { stats } = await run(db, fakeSite({ '1': TEXT('a') }), ['1'], null);
  assert.deepEqual([stats.new, stats.analysisDeferred], [1, 1]);
  assert.equal(hasCurrentAnalysis(db, 1), false);
});

test('list page parser: pinned rows flagged, IDs and dates extracted', () => {
  const row = (cls: string, id: string, date: string) =>
    `<tr class="${cls}"><td class="_artclTdTitle"><a href="/bbs/kr/8/${id}/artclView.do" class="artclLinkView"><!--[일반공지]--> 제목 ${id} </a></td><td class="_artclTdRdate">${date}</td></tr>`;
  const html = `<table class="artclTable"><tbody>${row('headline ', '100', '2026.07.01.')}${row('', '200', '2026.09.23.')}</tbody></table>`;
  assert.deepEqual(parseListHtml(html), [
    { sourceNoticeId: '100', url: urlOf('100'), title: '제목 100', listedDate: '2026-07-01', pinned: true },
    { sourceNoticeId: '200', url: urlOf('200'), title: '제목 200', listedDate: '2026-09-23', pinned: false },
  ]);
});

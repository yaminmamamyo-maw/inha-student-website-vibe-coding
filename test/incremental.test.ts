// Incremental ingest ("fetch new posts only"): which listed posts get an article request, how
// pinned rows relate to --limit, --full, and the per-board HTTP count. Stubbed site + AI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalysisResult } from '../src/analyze.ts';
import { openDb, storedNoticeState } from '../src/db.ts';
import { fetchReason, ingest, RECENT_DAYS, selectListed, type IngestDeps } from '../src/ingest.ts';
import { parseNoticeHtml, type ListedNotice } from '../src/sources/inhaMainNotice.ts';
import type { RawNotice } from '../src/types.ts';

const TODAY = '2026-09-25';
const urlOf = (id: string) => `https://www.inha.ac.kr/bbs/kr/8/${id}/artclView.do`;
const row = (id: string, pinned = false, listedDate: string | null = null): ListedNotice => ({
  sourceNoticeId: id, url: urlOf(id), title: `t${id}`, listedDate, pinned,
});

type Post = { date: string; body: string; deadline?: string | null; pinned?: boolean };

/** A fake board: editable posts, counted list/article requests (like BoardSource.requests). */
function fakeBoard(posts: Record<string, Post>) {
  const requests = { list: 0, article: 0 };
  const fetched: string[] = [];
  return {
    posts, requests, fetched,
    listNotices: async () => (requests.list++, Object.keys(posts).map((id) => row(id, posts[id].pinned, posts[id].date))),
    fetchNotice: async (url: string): Promise<RawNotice> => {
      requests.article++;
      const id = url.match(/\/(\d+)\/artclView/)![1];
      fetched.push(id);
      const p = posts[id];
      return parseNoticeHtml(
        `<div class="artclViewHead"><dl><dt>작성일</dt><dd>${p.date.replaceAll('-', '.')}.</dd></dl></div>` +
          `<h2 class="artclViewTitle">제목 ${id}</h2><div class="artclView"><p>${p.body}</p></div>`,
        { sourceNoticeId: id, canonicalUrl: urlOf(id) },
      );
    },
  };
}

/** The AI "extracts" the deadline configured on the post. */
const analysisFor = (deadline: string | null): AnalysisResult => ({
  analysis: {
    category: '학사', applicationStart: null, applicationEnd: deadline, deadline, eventDate: null,
    target: '학부생', summary: ['요약'], easyExplanation: '설명', uncertain: [],
    en: { title: 'T', summary: ['S'], easyExplanation: 'E', target: 'U', eventInfo: null },
    evidence: { applicationStart: null, applicationEnd: deadline, deadline, eventDate: null },
  },
  rawResponse: '{}', validationWarnings: [], provider: 'fake', model: 'fake-1',
});

function runner(db: ReturnType<typeof openDb>, board: ReturnType<typeof fakeBoard>) {
  const analyzed: string[] = [];
  const analyze = async (n: RawNotice) => (analyzed.push(n.sourceNoticeId), analysisFor(board.posts[n.sourceNoticeId].deadline ?? null));
  const run = async (opts: Partial<IngestDeps> = {}) => {
    const lines: string[] = [];
    board.fetched.length = 0;
    const stats = await ingest({
      db, listNotices: board.listNotices, fetchNotice: board.fetchNotice, analyze, log: (l) => lines.push(l),
      crawlDelayMs: 0, today: TODAY, httpRequests: () => board.requests, ...opts,
    });
    return { stats, lines, fetched: [...board.fetched] };
  };
  return { run, analyzed };
}

const BODY = (s: string) => `학부생 대상 안내문입니다. 자세한 내용은 아래와 같습니다. ${s}`;

test('selectListed: --limit counts regular rows only; every pinned row is kept on top of it', () => {
  const pinned = [row('p1', true), row('p2', true)];
  const regular = Array.from({ length: 12 }, (_, i) => row(String(100 - i)));
  const out = selectListed([...pinned, ...regular], 10);
  assert.equal(out.length, 12);
  assert.deepEqual(out.filter((n) => n.pinned).map((n) => n.sourceNoticeId), ['p1', 'p2']);
  assert.deepEqual(out.filter((n) => !n.pinned).map((n) => n.sourceNoticeId), regular.slice(0, 10).map((n) => n.sourceNoticeId), 'the 10 newest regular posts, not pushed out by pinned ones');
  assert.equal(selectListed([...pinned, ...regular]).length, 14, 'no limit = whole list');
  assert.equal(selectListed([row('1'), row('p', true), row('2')], 1).map((n) => n.sourceNoticeId).join(), '1,p', 'pinned rows kept wherever they appear');
});

test('fetchReason: new, --full, posted within 7 days, deadline/event not passed yet; otherwise no request', () => {
  const old = { publishedAt: '2026-09-01', dates: [] as string[] };
  assert.equal(fetchReason(row('1'), null, TODAY), 'new');
  assert.equal(fetchReason(row('1'), old, TODAY, true), 'full');
  assert.equal(fetchReason(row('1'), old, TODAY), null);
  assert.equal(RECENT_DAYS, 7);
  assert.equal(fetchReason(row('1'), { publishedAt: '2026-09-18', dates: [] }, TODAY), 'recent', 'exactly 7 days');
  assert.equal(fetchReason(row('1'), { publishedAt: '2026-09-17', dates: [] }, TODAY), null, '8 days');
  assert.equal(fetchReason(row('1', false, '2026-09-24'), { publishedAt: null, dates: [] }, TODAY), 'recent', 'falls back to the list 작성일');
  assert.equal(fetchReason(row('1'), { ...old, dates: ['2026-09-25'] }, TODAY), 'upcoming', 'deadline today is not passed');
  assert.equal(fetchReason(row('1'), { ...old, dates: ['2026-11-06T14:00'] }, TODAY), 'upcoming', 'event with a time');
  assert.equal(fetchReason(row('1'), { ...old, dates: ['2026-09-24', '2026-09-10'] }, TODAY), null, 'all dates passed');
});

test('re-run: only new, recent and upcoming posts are fetched; old finished posts cost no request', async () => {
  const db = openDb(':memory:');
  const board = fakeBoard({
    '1': { date: '2026-08-01', body: BODY('a'), deadline: '2026-08-20' }, // old, deadline passed
    '2': { date: '2026-08-01', body: BODY('b'), deadline: '2026-10-16' }, // old, deadline ahead
    '3': { date: '2026-09-23', body: BODY('c'), deadline: null }, // recent
  });
  const { run, analyzed } = runner(db, board);

  const first = await run();
  assert.deepEqual([first.stats.new, first.stats.fetched, first.stats.known, analyzed.length], [3, 3, 0, 3]);
  assert.deepEqual(first.stats.http, { list: 1, article: 3 });

  board.posts['4'] = { date: '2026-09-25', body: BODY('d') };
  const second = await run({ aiName: 'gemini' });
  assert.deepEqual(second.fetched, ['2', '3', '4'], 'notice 1 is not requested again');
  assert.deepEqual([second.stats.new, second.stats.unchanged, second.stats.known, second.stats.fetched], [1, 2, 1, 3]);
  assert.deepEqual(second.stats.http, { list: 1, article: 3 }, 'delta for this run only');
  assert.deepEqual(analyzed, ['1', '2', '3', '4'], 'only the new post reaches the AI');
  assert.ok(second.lines.some((l) => l.startsWith('[KNOWN] Notice 1 already stored and analyzed; not re-fetched') && l.endsWith('no gemini request')));
  assert.ok(second.lines.includes('[RECHECK] Notice 2 has a deadline/event date not passed yet; re-fetching to catch edits'));
  assert.ok(second.lines.includes('[RECHECK] Notice 3 posted within 7 days; re-fetching to catch edits'));
  assert.ok(second.lines.includes('[SKIP] Unchanged notice 3 (existing analysis is current; no gemini request)'));
});

test('edits are caught on re-checked posts; an old finished post is only re-checked with --full', async () => {
  const db = openDb(':memory:');
  const board = fakeBoard({
    '1': { date: '2026-08-01', body: BODY('a'), deadline: '2026-08-20' },
    '2': { date: '2026-08-01', body: BODY('b'), deadline: '2026-10-16' },
  });
  const { run, analyzed } = runner(db, board);
  await run();

  board.posts['1'].body = BODY('a — 수정');
  board.posts['2'].body = BODY('b — 마감 연장');
  const incremental = await run();
  assert.deepEqual([incremental.stats.updated, incremental.stats.known], [1, 1]);
  assert.ok(incremental.lines.includes('[UPDATE] Notice 2 changed (content)'));
  assert.deepEqual(analyzed, ['1', '2', '2']);

  const full = await run({ full: true });
  assert.deepEqual(full.fetched, ['1', '2']);
  assert.deepEqual([full.stats.updated, full.stats.unchanged, full.stats.known], [1, 1, 0]);
  assert.deepEqual(analyzed, ['1', '2', '2', '1']);
});

test('a stored post still waiting for analysis is analyzed from the DB copy, without re-fetching it', async () => {
  const db = openDb(':memory:');
  const board = fakeBoard({ '1': { date: '2026-08-01', body: BODY('a'), deadline: '2026-08-20' } });
  const { run, analyzed } = runner(db, board);
  const off = await run({ analyze: null });
  assert.deepEqual([off.stats.new, off.stats.analysisDeferred], [1, 1]);

  const again = await run();
  assert.deepEqual([again.stats.fetched, again.stats.known, again.stats.analyzed], [0, 1, 1]);
  assert.deepEqual(again.stats.http, { list: 1, article: 0 });
  assert.deepEqual(analyzed, ['1']);
  assert.ok(again.lines.some((l) => l.startsWith('[PENDING] Notice 1 stored (not re-fetched)')));
  assert.deepEqual(storedNoticeState(db, urlOf('1'))!.dates, ['2026-08-20', '2026-08-20']);

  const third = await run();
  assert.deepEqual([third.stats.fetched, third.stats.analyzed, analyzed.length], [0, 0, 1]);
});

test('pinned rows: a new pinned post is fetched; a known old pinned post follows the re-check rules', async () => {
  const db = openDb(':memory:');
  const board = fakeBoard({
    '900': { date: '2026-03-02', body: BODY('pinned old'), deadline: null, pinned: true },
    '10': { date: '2026-09-24', body: BODY('r10') },
    '11': { date: '2026-09-24', body: BODY('r11') },
    '12': { date: '2026-09-24', body: BODY('r12') },
  });
  const { run } = runner(db, board);

  const first = await run({ limit: 2 });
  assert.deepEqual([first.stats.found, first.stats.pinned, first.stats.new], [3, 1, 3], 'limit 2 → 2 regular posts + the pinned one');
  assert.deepEqual(first.fetched, ['10', '11', '900'], 'integer keys: the fake list is in ascending id order');
  assert.ok(first.lines.includes('[CRAWL] Found 3 notices (1 pinned, not counted in the limit)'));

  const second = await run({ limit: 2 });
  assert.deepEqual(second.fetched, ['10', '11'], 'known pinned post: old, no date ahead → not requested');
  assert.equal(second.stats.known, 1);
});

test('stored dates come from the newest analysis of any copy in the group', async () => {
  const db = openDb(':memory:');
  const board = fakeBoard({ '1': { date: '2026-08-01', body: BODY('a'), deadline: '2026-10-01' } });
  const { run } = runner(db, board);
  await run();
  assert.deepEqual(storedNoticeState(db, urlOf('1')), { id: 1, publishedAt: '2026-08-01', dates: ['2026-10-01', '2026-10-01'] });
  assert.equal(storedNoticeState(db, urlOf('2')), null);
});

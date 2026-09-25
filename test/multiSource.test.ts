// Several boards in one run (ingestAll) + cross-source duplicates: one list entry with every
// source, one AI analysis, and one board failing never stops the others.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalysisResult } from '../src/analyze.ts';
import { getNoticeDetail, listNotices } from '../src/api/notices.ts';
import { openDb } from '../src/db.ts';
import { AiApiError, NetworkError } from '../src/errors.ts';
import { ingestAll, type IngestSource } from '../src/ingest.ts';
import type { BoardSource } from '../src/sources/k2web.ts';
import * as aicc from '../src/sources/inhaAiccNotice.ts';
import * as cse from '../src/sources/inhaCseNotice.ts';
import * as main from '../src/sources/inhaMainNotice.ts';

const okAnalysis = (): AnalysisResult => ({
  analysis: {
    category: '학사', applicationStart: '2026-09-28', applicationEnd: '2026-09-30', deadline: '2026-09-30', eventDate: null,
    target: '학부 재학생', summary: ['요약'], easyExplanation: '설명', uncertain: [],
    en: { title: 'Title', summary: ['Summary'], easyExplanation: 'Explanation', target: 'Undergraduates', eventInfo: null },
    evidence: { applicationStart: '9. 28.', applicationEnd: '30.', deadline: '30.', eventDate: null },
  },
  rawResponse: '{}', validationWarnings: [], provider: 'fake', model: 'fake-1',
});

type Post = { title: string; date: string; body: string };

// Fixed "today" for the incremental re-check rules: posts from 09-18..09-22 are recent, and the
// 09-15 post has a deadline (09-30) not passed yet, so every known post is re-fetched on re-runs.
const TODAY = '2026-09-25';

/** A fake board built on the real parser of `board`, serving `posts` by article id. */
function fakeBoard(board: BoardSource, posts: Record<string, Post>, opts: { listFails?: boolean } = {}): IngestSource {
  const { origin, site, board: no } = board.config;
  const url = (id: string) => `${origin}/bbs/${site}/${no}/${id}/artclView.do`;
  return {
    id: board.config.source,
    listNotices: async () => {
      if (opts.listFails) throw new NetworkError(`${board.config.source} is down`);
      return Object.keys(posts).map((id) => ({ sourceNoticeId: id, url: url(id), title: posts[id].title, listedDate: null, pinned: false }));
    },
    fetchNotice: async (u) => {
      const ids = board.parseNoticeUrl(u);
      const p = posts[ids.sourceNoticeId];
      return board.parseNoticeHtml(
        `<div class="artclViewHead"><dl><dt>작성일</dt><dd>${p.date.replaceAll('-', '.')}</dd></dl></div>` +
          `<h2 class="artclViewTitle">${p.title}</h2><div class="artclView"><p>${p.body}</p></div>`,
        ids,
      );
    },
  };
}

const DROP = '교무처 학사관리팀에서 2026학년도 2학기 수강신청 포기 일정을 안내드립니다. 신청기간: 2026. 9. 28.(월) ~ 30.(수)';

function boards(opts: { aiccDown?: boolean } = {}) {
  return [
    fakeBoard(main.board, { '45574': { title: '2026학년도 2학기 수강신청 포기 안내', date: '2026-09-21', body: DROP } }),
    fakeBoard(aicc.board, { '191359': { title: '2026-2학기 전담지도교수 상담 안내', date: '2026-09-15', body: '전담지도교수 상담을 아래와 같이 안내합니다. 기간 9월 15일부터 10월 2일까지' } }, { listFails: opts.aiccDown }),
    fakeBoard(cse.board, {
      '191991': { title: '[학부]2026학년도 2학기 수강신청 포기 안내', date: '2026-09-22', body: `${DROP} (컴퓨터공학과 재공지)` },
      '191774': { title: '[학부] 2026-2학기 지도교수 상담 신청 안내', date: '2026-09-18', body: '컴퓨터공학과 학부생 지도교수 상담 신청을 받습니다. 신청기간 9월 18일부터 9월 30일까지' },
    }),
  ];
}

test('a notice cross-posted on the main and department boards is analyzed once and listed once with both sources', async () => {
  const db = openDb(':memory:');
  let aiCalls = 0;
  const lines: string[] = [];
  const runs = await ingestAll(boards(), { db, analyze: async () => (aiCalls++, okAnalysis()), log: (l) => lines.push(l), crawlDelayMs: 0, today: TODAY });

  assert.deepEqual(runs.map((r) => [r.source, r.stats?.new, r.stats?.analyzed, r.stats?.duplicates]), [
    ['inha-main-notice', 1, 1, 0],
    ['inha-aicc-notice', 1, 1, 0],
    ['inha-cse-notice', 2, 1, 1],
  ]);
  assert.equal(aiCalls, 3, '4 stored posts, 3 distinct notices, 3 AI requests');
  assert.ok(lines.some((l) => /^\[DUP\] Notice 191991 is the same notice as #1 \(inha-main-notice 45574\)/.test(l)));

  const list = listNotices(db);
  assert.equal(list.length, 3);
  const drop = list.find((n) => n.sources.length > 1)!;
  assert.equal(drop.title, '2026학년도 2학기 수강신청 포기 안내', 'canonical = main-board copy (ingested first)');
  assert.deepEqual(drop.sources.map((s) => [s.kind, s.url]), [
    ['main', 'https://www.inha.ac.kr/bbs/kr/8/45574/artclView.do'],
    ['department', 'https://cse.inha.ac.kr/bbs/cse/242/191991/artclView.do'],
  ]);
  assert.equal(drop.analysisStatus, 'ready');

  // the department copy's id opens the same (canonical) notice, so its links keep working
  const dupId = (db.prepare("SELECT id FROM notices WHERE source_notice_id = '191991'").get() as { id: number }).id;
  const detail = getNoticeDetail(db, dupId)!;
  assert.equal(detail.id, drop.id);
  assert.equal(detail.sources.length, 2);

  // second run: nothing new, zero AI requests
  const again = await ingestAll(boards(), { db, analyze: async () => (aiCalls++, okAnalysis()), log: () => {}, crawlDelayMs: 0, today: TODAY });
  assert.equal(aiCalls, 3);
  assert.deepEqual(again.map((r) => r.stats?.unchanged), [1, 1, 2]);
});

test('if the canonical copy has no analysis yet, the duplicate is analyzed instead, and the list uses it', async () => {
  const db = openDb(':memory:');
  let aiCalls = 0;
  await ingestAll(boards().slice(0, 1), { db, analyze: null, log: () => {}, crawlDelayMs: 0, today: TODAY }); // main stored, AI off
  await ingestAll(boards().slice(2), { db, analyze: async () => (aiCalls++, okAnalysis()), log: () => {}, crawlDelayMs: 0, today: TODAY });
  assert.equal(aiCalls, 2, 'the CSE copy is analyzed (group had none); the other CSE notice too');
  const drop = listNotices(db).find((n) => n.sources.length > 1)!;
  assert.equal(drop.analysisStatus, 'ready');
  // and the main copy is not analyzed again later
  await ingestAll(boards().slice(0, 1), { db, analyze: async () => (aiCalls++, okAnalysis()), log: () => {}, crawlDelayMs: 0, today: TODAY });
  assert.equal(aiCalls, 2);
});

test('one board failing to list does not stop the other boards', async () => {
  const db = openDb(':memory:');
  const lines: string[] = [];
  const runs = await ingestAll(boards({ aiccDown: true }), { db, analyze: async () => okAnalysis(), log: (l) => lines.push(l), crawlDelayMs: 0, today: TODAY });
  assert.deepEqual(runs.map((r) => [r.source, r.listFailed !== null]), [
    ['inha-main-notice', false],
    ['inha-aicc-notice', true],
    ['inha-cse-notice', false],
  ]);
  assert.equal(runs[2].stats!.new, 2);
  assert.ok(lines.some((l) => l.startsWith('[ERROR] Source inha-aicc-notice listing failed')));
});

test('an AI stop (quota) carries over to later boards: they defer instead of calling again', async () => {
  const db = openDb(':memory:');
  let aiCalls = 0;
  const runs = await ingestAll(boards(), {
    db, log: () => {}, crawlDelayMs: 0, today: TODAY,
    analyze: async () => {
      aiCalls++;
      throw new AiApiError('quota', { status: 429 });
    },
  });
  assert.equal(aiCalls, 1);
  assert.equal(runs[1].stats!.analysisDeferred, 1);
  assert.equal(runs[2].stats!.analysisDeferred + runs[2].stats!.duplicates, 2);
});

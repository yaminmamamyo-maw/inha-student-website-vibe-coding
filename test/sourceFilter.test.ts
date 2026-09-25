// Notice-list source filter (web/src/lib/sourceFilter.ts): per-board buttons from NOTICE_SOURCES,
// "내 학과"/"내 단과대" shortcuts, honest "not collected" state, and old ?source=kind links.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NoticeListItem } from '../src/api/types.ts';
import type { Profile } from '../src/profile.ts';
import { NOTICE_SOURCES, sourceMeta } from '../src/sourceMeta.ts';
import { matchesSearch } from '../web/src/lib/search.ts';
import {
  canonicalSourceParam, matchesSource, MY_COLLEGE, MY_MAJOR, myBoards, resolveSource, sourceOptions,
} from '../web/src/lib/sourceFilter.ts';

const MAIN = 'inha-main-notice';
const AICC = 'inha-aicc-notice';
const CSE = 'inha-cse-notice';
const DOAI = 'inha-doai-notice';
const DS = 'inha-datascience-notice';
const DT = 'inha-designtech-notice';
const SME = 'inha-sme-notice';

const cse: Profile = { college: 'AI융합대학', major: '컴퓨터공학과', year: 2, entranceYear: 2025, interests: [] };
const ds: Profile = { ...cse, major: '데이터사이언스학과' }; // same college, own department board (no notices in these fixtures)
const mech: Profile = { ...cse, college: '공과대학', major: '기계공학과' }; // neither board collected

function notice(id: number, sources: string[], title = `공지 ${id}`): NoticeListItem {
  return {
    id, sourceNoticeId: String(id), title, sourceUrl: '', publishedAt: null, boardCategory: null, crawledAt: '', contentUpdatedAt: null,
    sources: sources.map((source) => ({ source, kind: sourceMeta(source).kind, url: '', sourceNoticeId: String(id), publishedAt: null })),
    analysisStatus: 'pending', analysis: null,
  };
}

const notices = [
  notice(1, [MAIN], '수강신청 포기 안내'),
  notice(2, [MAIN, CSE], '수강 정정 안내'), // cross-posted
  notice(3, [AICC], '전담지도교수 상담'),
  notice(4, [CSE], '캡스톤 설명회'),
];
const pick = (value: string | null, profile: Profile | null) => notices.filter((n) => matchesSource(n, resolveSource(value, profile))).map((n) => n.id);

test('one button per board in NOTICE_SOURCES (not per kind), with counts; cross-posts count on each board', () => {
  const opts = sourceOptions(notices, null);
  // 인공지능공학과, 데이터사이언스학과, 디자인테크놀로지학과, 스마트모빌리티공학과 were added by registering them in
  // NOTICE_SOURCES only: their buttons appear (0 notices here)
  assert.deepEqual(opts.map((o) => [o.value, o.count]), [['all', 4], [MAIN, 2], [AICC, 1], [CSE, 2], [DOAI, 0], [DS, 0], [DT, 0], [SME, 0]]);
  assert.equal(opts.length, 1 + NOTICE_SOURCES.length, 'new boards appear without code changes');
  assert.deepEqual(pick(CSE, null), [2, 4]);
  assert.deepEqual(pick(MAIN, null), [1, 2]);
  assert.deepEqual(pick(null, null), [1, 2, 3, 4]);
});

test('shortcuts: "내 학과" only when that department board is collected; "내 단과대" whenever a profile exists', () => {
  assert.deepEqual(sourceOptions(notices, cse).slice(0, 3).map((o) => [o.value, o.count]), [['all', 4], [MY_MAJOR, 2], [MY_COLLEGE, 1]]);
  assert.deepEqual(pick(MY_MAJOR, cse), [2, 4]);
  assert.deepEqual(pick(MY_COLLEGE, cse), [3]);
  assert.ok(!sourceOptions(notices, mech).some((o) => o.value === MY_MAJOR), 'no 내 학과 for a department without a board');
  assert.deepEqual(myBoards(mech), { major: null, college: null });
  // 데이터사이언스학과 has its own board now: "내 학과" is offered and points at it
  assert.ok(sourceOptions(notices, ds).some((o) => o.value === MY_MAJOR));
  assert.deepEqual(myBoards(ds), { major: sourceMeta(DS), college: sourceMeta(AICC) });
  // 인공지능공학과 now has a board: "내 학과" points at it, and never at CSE
  const ai: Profile = { ...cse, major: '인공지능공학과' };
  assert.deepEqual(myBoards(ai).major, sourceMeta(DOAI));
  assert.deepEqual(resolveSource(MY_MAJOR, ai), { type: 'boards', ids: [DOAI] });
  assert.deepEqual(pick(MY_MAJOR, ai), []);
});

test('a profile whose board is not collected sees an honest "not collected" state, never another department\'s notices', () => {
  assert.deepEqual(resolveSource(MY_MAJOR, mech), { type: 'uncollected', scope: 'major', unit: '기계공학과' });
  assert.deepEqual(resolveSource(MY_COLLEGE, mech), { type: 'uncollected', scope: 'college', unit: '공과대학' });
  assert.deepEqual(pick(MY_COLLEGE, mech), []);
  assert.deepEqual(pick(MY_MAJOR, ds), [], 'data science student: CSE notices are not shown as "my department"');
  assert.equal(sourceOptions(notices, mech).find((o) => o.value === MY_COLLEGE)?.count, 0);
  // a shared "my" link opened without a profile falls back to everything
  assert.deepEqual(resolveSource(MY_MAJOR, null), { type: 'all' });
});

test('old ?source=main|college|department links still work (rewritten to the board id when a kind has one board)', () => {
  // several department boards now: the old link keeps filtering to all of them
  assert.deepEqual(resolveSource('department', null), { type: 'boards', ids: [CSE, DOAI, DS, DT, SME] });
  assert.deepEqual(pick('department', null), [2, 4]);
  assert.equal(canonicalSourceParam('department'), null, 'several boards: the kind value is kept, not guessed');
  assert.deepEqual(pick('college', null), [3]);
  assert.equal(canonicalSourceParam('college'), AICC);
  assert.equal(canonicalSourceParam('main'), MAIN);
  assert.equal(canonicalSourceParam('removed-board'), 'all', 'unknown value → all sources');
  for (const ok of [null, 'all', CSE, MY_MAJOR, MY_COLLEGE]) assert.equal(canonicalSourceParam(ok), null);
});

test('combines with keyword search (and so with category/sort, which are applied the same way)', () => {
  const visible = notices.filter((n) => matchesSource(n, resolveSource(MY_MAJOR, cse)) && matchesSearch(n, '수강', 'ko'));
  assert.deepEqual(visible.map((n) => n.id), [2]);
});

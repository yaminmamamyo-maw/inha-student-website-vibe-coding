// Profile personalization: deterministic matching (src/match.ts) + Home builder (web/src/lib/personalize.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNoticeDetail } from '../src/api/notices.ts';
import type { NoticeListItem } from '../src/api/types.ts';
import type { AnalysisResult } from '../src/analyze.ts';
import { openDb } from '../src/db.ts';
import { ingest } from '../src/ingest.ts';
import { completedSemesters, matchNotice, notificationCandidates } from '../src/match.ts';
import { parseProfile, type Profile } from '../src/profile.ts';
import { sourceMeta } from '../src/sourceMeta.ts';
import { parseNoticeHtml } from '../src/sources/inhaMainNotice.ts';
import { buildHome } from '../web/src/lib/personalize.ts';

const TODAY = '2026-09-24'; // fall semester: a 1st-year has completed 1 semester
const cse1: Profile = { college: 'AI융합대학', major: '컴퓨터공학과', year: 1, entranceYear: 2026, interests: [] };

let nextId = 1;
function notice(target: string | null, opts: { title?: string; category?: string; deadline?: string | null; sources?: string[] } = {}): NoticeListItem {
  const id = nextId++;
  const sources = (opts.sources ?? ['inha-main-notice']).map((source) => ({
    source, kind: sourceMeta(source).kind, url: '', sourceNoticeId: String(id), publishedAt: '2026-09-20',
  }));
  return {
    id, sourceNoticeId: String(id), title: opts.title ?? `공지 ${id}`, sourceUrl: '', sources, publishedAt: '2026-09-20',
    boardCategory: null, crawledAt: '', contentUpdatedAt: null, analysisStatus: target === null ? 'pending' : 'ready',
    analysis: target === null ? null : ({
      category: opts.category ?? '기타', target, deadline: opts.deadline ?? null, applicationEnd: null, applicationStart: null, eventDate: null,
      summary: [], easyExplanation: '', evidence: {}, uncertain: [], en: null,
    } as any),
  };
}

test('A: CSE-specific notice → high relevance for a CSE student', () => {
  const r = matchNotice(cse1, notice('컴퓨터공학과 재학생'), TODAY);
  assert.equal(r.matchLevel, 'high');
  assert.deepEqual(r.matchReasons, ['컴퓨터공학과 대상']);
  // the posting unit in the title also counts (e.g. "[컴퓨터공학과] …")
  assert.equal(matchNotice(cse1, notice('참가 희망 학생', { title: '[컴퓨터공학과] 캡스톤 설명회' }), TODAY).matchLevel, 'medium');
});

test('B: all-undergraduate notice → reasonable relevance, and it stays in All Notices', () => {
  const n = notice('인하대학교 2026학년도 재학생(학부생) 전체');
  const r = matchNotice(cse1, n, TODAY);
  assert.equal(r.matchLevel, 'medium');
  assert.deepEqual(r.matchReasons, ['학부생 전체 대상']);
  assert.ok(buildHome([n], cse1, TODAY).all.includes(n));
});

test('C: notice for another department → none, but still in All Notices', () => {
  const other = notice('기계공학과 3학년 재학생');
  const r = matchNotice(cse1, other, TODAY);
  assert.equal(r.matchLevel, 'none');
  assert.match(r.excludedBecause!, /다른 학과 대상 \(기계공학과\)/);
  const otherCollege = notice('공과대학 재학생');
  assert.match(matchNotice(cse1, otherCollege, TODAY).excludedBecause!, /다른 단과대학 대상/);
  const home = buildHome([other, otherCollege], cse1, TODAY);
  assert.equal(home.forYou.length, 0);
  assert.deepEqual(home.all, [other, otherCollege], 'All Notices is never filtered by profile');
});

test('C2: graduate-only, wrong year, semester requirement and "N학년 불가" are explicit exclusions', () => {
  assert.equal(matchNotice(cse1, notice('일반대학원 석사과정 대학원생'), TODAY).excludedBecause, '대학원생 대상');
  assert.equal(matchNotice(cse1, notice('학부생, 대학원생'), TODAY).matchLevel === 'none', false, 'mixed audience is not grad-only');
  assert.equal(matchNotice(cse1, notice('3학년 2학기 또는 4학년 1학기 재학생'), TODAY).excludedBecause, '3학년·4학년 대상');
  assert.equal(matchNotice(cse1, notice('4학기 이상 이수한 학부 재학생'), TODAY).excludedBecause, '4학기 이상 이수 조건');
  assert.equal(matchNotice(cse1, notice('학부 재학생 (1학년 불가)'), TODAY).excludedBecause, '1학년 제외');
  assert.equal(completedSemesters(1, '2026-09-24'), 1);
  assert.equal(completedSemesters(3, '2026-04-01'), 4);
});

test('D: scholarship interest adds relevance to scholarship notices', () => {
  const s = notice('인하대학교 학부 재학생 전체', { category: '장학금' });
  const without = matchNotice(cse1, s, TODAY);
  const withInterest = matchNotice({ ...cse1, interests: ['scholarship'] }, s, TODAY);
  assert.equal(withInterest.relevanceScore - without.relevanceScore, 30);
  assert.equal(withInterest.matchLevel, 'high');
  assert.ok(withInterest.matchReasons.includes('관심 분야: 장학금'));
  // un-analyzed notice: title keyword counts a little, and is flagged as title-only
  const pending = matchNotice({ ...cse1, interests: ['scholarship'] }, notice(null, { title: '[학부-교외장학] 봄내장학생 선발 안내' }), TODAY);
  assert.deepEqual([pending.relevanceScore, pending.basedOnTitleOnly], [20, true]);
});

test('E: changing year 1 → 2 updates personalized results', () => {
  const n = notice('2학년 재학생', { deadline: '2026-10-10' });
  assert.equal(matchNotice(cse1, n, TODAY).matchLevel, 'none');
  const y2 = { ...cse1, year: 2 as const };
  assert.equal(matchNotice(y2, n, TODAY).matchLevel, 'medium');
  assert.equal(buildHome([n], cse1, TODAY).forYou.length, 0);
  assert.equal(buildHome([n], y2, TODAY).forYou[0].notice, n);
});

test('F: changing major updates personalized results', () => {
  const cse = notice('컴퓨터공학과 학생', { deadline: '2026-10-10' });
  const mech = notice('기계공학과 학생', { deadline: '2026-10-10' });
  const me: Profile = { ...cse1, college: '공과대학', major: '기계공학과' };
  assert.deepEqual(buildHome([cse, mech], cse1, TODAY).forYou.map((r) => r.notice), [cse]);
  assert.deepEqual(buildHome([cse, mech], me, TODAY).forYou.map((r) => r.notice), [mech]);
  assert.equal(matchNotice(me, cse, TODAY).matchLevel, 'none');
});

test('G: a newly ingested notice is evaluated by the matching function (notification foundation)', async () => {
  const db = openDb(':memory:');
  const html = `<h2 class="artclViewTitle">[컴퓨터공학과] 해커톤 참가자 모집</h2><div class="artclView"><p>컴퓨터공학과 재학생 대상 해커톤 참가자를 10월 10일까지 모집합니다.</p></div>`;
  const analysis: AnalysisResult = {
    analysis: {
      category: '모집/선발', applicationStart: null, applicationEnd: '2026-10-10', deadline: '2026-10-10', eventDate: null,
      target: '컴퓨터공학과 재학생', summary: ['a', 'b', 'c'], easyExplanation: '', uncertain: [],
      evidence: { applicationStart: null, applicationEnd: '10월 10일', deadline: '10월 10일', eventDate: null },
      en: { title: 'Hackathon', summary: ['a', 'b', 'c'], easyExplanation: '', target: 'CSE students', eventInfo: null },
    },
    rawResponse: '{}', validationWarnings: [], provider: 'fake', model: 'fake',
  };
  const matched: string[] = [];
  const profiles = [
    { id: 'cse-1', profile: cse1 },
    { id: 'mech-3', profile: { ...cse1, college: '공과대학', major: '기계공학과', year: 3 as const } },
  ];
  await ingest({
    db, crawlDelayMs: 0, log: () => {},
    listNotices: async () => [{ sourceNoticeId: '1', url: 'https://www.inha.ac.kr/bbs/kr/8/1/artclView.do', title: '', listedDate: null, pinned: false }],
    fetchNotice: async (url) => parseNoticeHtml(html, { sourceNoticeId: '1', canonicalUrl: url }),
    analyze: async () => analysis,
    onAnalyzed: (noticeId) => {
      for (const c of notificationCandidates(getNoticeDetail(db, noticeId)!, profiles, TODAY)) matched.push(c.profileId);
    },
  });
  assert.deepEqual(matched, ['cse-1'], 'only the CSE profile is a high match → notification candidate');
});

test('H: no profile → no recommendations, general upcoming dates, all notices shown', () => {
  const a = notice('컴퓨터공학과', { deadline: '2026-10-01' });
  const b = notice(null);
  const home = buildHome([a, b], null, TODAY);
  assert.deepEqual(home.forYou, []);
  assert.deepEqual(home.all, [a, b]);
  assert.deepEqual(home.upcoming.map((e) => e.notice), [a]);
});

test('I: a notice from the student\'s own department/college board ranks higher (no AI, reason shown)', () => {
  const me: Profile = { ...cse1, interests: [] };
  const mech: Profile = { ...cse1, college: '공과대학', major: '기계공학과' };
  const ds: Profile = { ...cse1, major: '데이터사이언스학과' }; // same college (AI융합대학), other department

  const dept = notice('참가 희망 학생', { sources: ['inha-cse-notice'] });
  const r = matchNotice(me, dept, TODAY);
  assert.equal(r.relevanceScore, 35);
  assert.equal(r.matchLevel, 'medium');
  assert.deepEqual(r.matchReasons, ['컴퓨터공학과 게시판 공지']);
  assert.deepEqual(r.matchReasonsEn, ['Posted on the 컴퓨터공학과 board']);
  assert.equal(matchNotice(mech, dept, TODAY).relevanceScore, 0, 'another college gets no board bonus');
  assert.deepEqual(matchNotice(ds, dept, TODAY).matchReasons, ['AI융합대학 게시판 공지'], 'dept board counts as own college for a sibling major');

  const college = notice('참가 희망 학생', { sources: ['inha-aicc-notice'] });
  assert.deepEqual(matchNotice(me, college, TODAY).matchReasons, ['AI융합대학 게시판 공지']);
  assert.equal(matchNotice(me, college, TODAY).relevanceScore, 20);

  // cross-posted: the department board counts once, the title naming it adds nothing more
  const both = notice('참가 희망 학생', { title: '[컴퓨터공학과] 설명회', sources: ['inha-main-notice', 'inha-aicc-notice', 'inha-cse-notice'] });
  assert.deepEqual(matchNotice(me, both, TODAY).matchReasons, ['컴퓨터공학과 게시판 공지']);

  // exclusions still win over the board bonus
  assert.equal(matchNotice(me, notice('일반대학원 석사과정 대학원생', { sources: ['inha-cse-notice'] }), TODAY).matchLevel, 'none');
  // the old college name in a notice still means this college
  assert.deepEqual(matchNotice(me, notice('소프트웨어융합대학 재학생'), TODAY).matchReasons, ['AI융합대학 대상']);
});

test('profile from storage is validated; bad data is ignored', () => {
  assert.equal(parseProfile(null), null);
  assert.equal(parseProfile({ major: '컴퓨터공학과', college: '소프트웨어융합대학', year: 7, entranceYear: 2026 }), null);
  assert.deepEqual(parseProfile({ major: ' 컴퓨터공학과 ', college: '소프트웨어융합대학', year: '1', entranceYear: 2026, interests: ['scholarship', 'bogus', 'scholarship'] }), {
    college: 'AI융합대학', major: '컴퓨터공학과', year: 1, entranceYear: 2026, interests: ['scholarship'],
  });
});

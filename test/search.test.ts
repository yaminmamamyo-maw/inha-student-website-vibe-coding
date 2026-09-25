// Keyword search over the notice list (web/src/lib/search.ts). Pure, no AI, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NoticeListItem } from '../src/api/types.ts';
import { bestSearchMatch, excerptAroundMatch, highlightTerms, matchesSearch, searchTerms } from '../web/src/lib/search.ts';

function notice(
  id: number,
  a: Partial<{ category: string; target: string; summary: string[]; en: { title: string; target: string; summary: string[] } | null }> | null,
  title = `공지 ${id}`,
): NoticeListItem {
  return {
    id,
    sourceNoticeId: String(id),
    title,
    sourceUrl: '',
    publishedAt: null,
    boardCategory: null,
    crawledAt: '',
    contentUpdatedAt: null,
    analysisStatus: a ? 'ready' : 'pending',
    analysis: a && ({ category: '기타', target: '', summary: [], en: null, ...a } as any),
  };
}

test('empty query matches every notice', () => {
  assert.ok(matchesSearch(notice(1, null), '', 'ko'));
  assert.ok(matchesSearch(notice(1, null), '   ', 'ko'));
});

test('whitespace and case are ignored', () => {
  const n = notice(1, { en: { title: 'Winter Scholarship', target: 'All students', summary: [] } }, '겨울 장학금 안내');
  assert.ok(matchesSearch(n, 'winter SCHOLARSHIP', 'en'));
  assert.ok(matchesSearch(n, '  winter   scholarship  ', 'en'));
});

test('substring match: "장학" matches "장학금"', () => {
  const n = notice(1, { target: '장학금 신청 대상' });
  assert.ok(matchesSearch(n, '장학', 'ko'));
});

test('multiple words are AND\'d', () => {
  const n = notice(1, { target: '국제학생 대상', summary: ['장학금 지원'] });
  assert.ok(matchesSearch(n, '장학 국제', 'ko'));
  assert.ok(!matchesSearch(n, '장학 등록금', 'ko'));
});

test('matches on title, summary, target and category name independently', () => {
  assert.ok(matchesSearch(notice(1, null, '학사 일정 안내'), '학사 일정', 'ko'));
  assert.ok(matchesSearch(notice(2, { summary: ['서류 제출은 온라인으로'] }), '서류 제출', 'ko'));
  assert.ok(matchesSearch(notice(3, { target: '전체 재학생' }), '재학생', 'ko'));
  assert.ok(matchesSearch(notice(4, { category: '국제교류' }), '국제교류', 'ko'));
});

test('language switch: matches the currently displayed language only, falling back to Korean when English analysis is missing', () => {
  const withEn = notice(1, { target: '한국어 대상', en: { title: 'EN title', target: 'international students', summary: [] } });
  assert.ok(matchesSearch(withEn, 'international', 'en'));
  assert.ok(!matchesSearch(withEn, 'international', 'ko'));

  const withoutEn = notice(2, { target: '한국어 대상', en: null });
  assert.ok(matchesSearch(withoutEn, '한국어', 'en')); // no English analysis: falls back to Korean text
  assert.ok(!matchesSearch(withoutEn, 'korean', 'en'));
});

test('a term never matches by spanning the boundary between two fields', () => {
  // title ends with "장", target starts with "학" — concatenated with a separator that then got
  // stripped by a whole-string normalize, they used to read "...장학..." even though neither
  // field contains it alone. Regression test for that cross-field false match.
  const n = notice(1, { target: '학생 전체 대상' }, '공지 장');
  assert.ok(!matchesSearch(n, '장학', 'ko'));
});

test('a pending notice (no analysis) is only searchable by title', () => {
  const n = notice(1, null, '방학 중 도서관 운영 안내');
  assert.ok(matchesSearch(n, '도서관', 'ko'));
  assert.ok(!matchesSearch(n, '장학금', 'ko'));
});

test('highlightTerms: splits into plain/matched parts, preserving original case', () => {
  assert.deepEqual(highlightTerms('장학금 안내', searchTerms('장학')), [
    { text: '장학', match: true },
    { text: '금 안내', match: false },
  ]);
  const parts = highlightTerms('Winter Scholarship', searchTerms('winter scholarship'));
  assert.deepEqual(parts, [
    { text: 'Winter', match: true },
    { text: ' ', match: false },
    { text: 'Scholarship', match: true },
  ]);
});

test('highlightTerms: no match returns the whole text as a single unmatched part', () => {
  assert.deepEqual(highlightTerms('장학금 안내', searchTerms('등록금')), [{ text: '장학금 안내', match: false }]);
});

test('highlightTerms: a term spanning internal whitespace highlights the whole phrase, space included', () => {
  const parts = highlightTerms('국제 교류 협력', searchTerms('국제교류'));
  assert.deepEqual(parts, [
    { text: '국제 교류', match: true },
    { text: ' 협력', match: false },
  ]);
});

test('excerptAroundMatch: short text is returned unchanged; long text is trimmed around the match with ellipses', () => {
  assert.equal(excerptAroundMatch('장학금 신청 대상', searchTerms('장학'), 24), '장학금 신청 대상');
  const long = '수강포기 시 신입학장학금, 성적장학금 등 장학금 수혜 대상 및 다음 학기 학점 초과 대상에서 제외됩니다.';
  const excerpt = excerptAroundMatch(long, searchTerms('장학'), 6);
  assert.ok(excerpt.startsWith('…'), `expected a leading ellipsis, got: ${excerpt}`);
  assert.ok(excerpt.includes('장학'));
});

test('bestSearchMatch: prefers the title, then a matching summary bullet, then target; null when only the category matched', () => {
  const inTitle = notice(1, { summary: ['장학금 관련 문의'] }, '2026 장학금 신청 안내');
  assert.deepEqual(bestSearchMatch(inTitle, '장학', 'ko'), { field: 'title', text: '2026 장학금 신청 안내' });

  const inSummary = notice(2, { summary: ['수강포기 시 장학금 수혜 대상에서 제외됩니다.'] }, '수강신청 포기 안내');
  const summaryMatch = bestSearchMatch(inSummary, '장학', 'ko');
  assert.equal(summaryMatch?.field, 'summary');
  assert.ok(summaryMatch?.text.includes('장학'));

  const inTarget = notice(3, { target: '장학금 수혜 이력이 있는 학생' }, '등록금 납부 안내');
  const targetMatch = bestSearchMatch(inTarget, '장학', 'ko');
  assert.equal(targetMatch?.field, 'target');

  const onlyCategory = notice(4, { category: '장학금' }, '등록금 납부 안내');
  assert.equal(bestSearchMatch(onlyCategory, '장학', 'ko'), null);

  assert.equal(bestSearchMatch(inTitle, '', 'ko'), null);
});

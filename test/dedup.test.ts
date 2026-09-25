// Cross-source duplicate rule (src/dedup.ts), with real cross-posts seen on 2026-09-25.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysApart, isSameNotice, normalizeTitle } from '../src/dedup.ts';

const n = (source: string, title: string, publishedAt: string | null) => ({ source, title, publishedAt });

test('real cross-posts are the same notice (board prefix and a 1-day date gap ignored)', () => {
  // main 45540 (09-16) / AI융합대학 191359 (09-15)
  assert.ok(isSameNotice(n('inha-main-notice', '2026-2학기 전담지도교수 상담 안내', '2026-09-16'), n('inha-aicc-notice', '2026-2학기 전담지도교수 상담 안내', '2026-09-15')));
  // main 45574 (09-21) / 컴퓨터공학과 191991 (09-22)
  assert.ok(isSameNotice(n('inha-main-notice', '2026학년도 2학기 수강신청 포기 안내', '2026-09-21'), n('inha-cse-notice', '[학부]2026학년도 2학기 수강신청 포기 안내', '2026-09-22')));
});

test('normalizeTitle: leading tags, spacing, punctuation and ★ are ignored', () => {
  const key = normalizeTitle('2026학년도 2학기 수강신청 포기 안내');
  assert.equal(normalizeTitle('[학부] 2026학년도 2학기 수강신청 포기 안내'), key);
  assert.equal(normalizeTitle('(학부)2026학년도 2학기 수강신청·포기 안내!'), key);
  assert.equal(normalizeTitle('★[인재개발팀] 2026학년도 2학기  수강신청 포기 안내★'), key);
  assert.equal(normalizeTitle('ＩＣＰＣ 2026 안내'), normalizeTitle('icpc 2026 안내'), 'full-width and case folded');
});

test('graduate-school tag is kept: "[대학원] X" never merges with "[학부] X"', () => {
  assert.notEqual(normalizeTitle('[대학원] 2026학년도 2학기 추가 복학 신청 안내'), normalizeTitle('[학부] 2026학년도 2학기 추가 복학 신청 안내'));
  assert.equal(normalizeTitle('[학부/대학원] AI활용 윤리 가이드라인'), normalizeTitle('AI활용 윤리 가이드라인'), 'mixed audience = general');
});

test('not the same: > 3 days apart, same board, missing date, differently worded, too short', () => {
  const t = '2026-2학기 전담지도교수 상담 안내';
  assert.ok(isSameNotice(n('a', t, '2026-09-12'), n('b', t, '2026-09-15')), '3 days = still same');
  assert.ok(!isSameNotice(n('a', t, '2026-09-11'), n('b', t, '2026-09-15')), '4 days apart');
  assert.ok(!isSameNotice(n('a', t, '2026-09-15'), n('a', t, '2026-09-15')), 'same board: two separate posts');
  assert.ok(!isSameNotice(n('a', t, null), n('b', t, '2026-09-15')));
  // same event, different wording on each board → left separate (no fuzzy matching)
  assert.ok(!isSameNotice(n('a', '[인재개발팀] 2026 하반기 인하대학교 직무박람회 개최 안내!', '2026-09-17'), n('b', '2026년 하반기 인하대학교 직무박람회', '2026-09-21')));
  assert.equal(normalizeTitle('[공지] 안내'), null);
  assert.ok(!isSameNotice(n('a', '[학부] 공지', '2026-09-15'), n('b', '공지', '2026-09-15')));
  assert.equal(daysApart('2026-09-30', '2026-10-02'), 2);
});

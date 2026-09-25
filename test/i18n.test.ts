// Global language: matching is language-independent; notification messages carry both languages;
// UI dictionaries have the same shape; dates are formatted per locale from the same structured value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NoticeListItem } from '../src/api/types.ts';
import { matchNotice } from '../src/match.ts';
import { buildNotification, localizeNotification } from '../src/notifications.ts';
import type { Profile } from '../src/profile.ts';
import { dday, fullDate, shortDate } from '../web/src/lib/dates.ts';
import { noticeSummaryLine, noticeTitle, translations } from '../web/src/lib/i18n.ts';
import { buildHome, buildNotifications } from '../web/src/lib/personalize.ts';

const TODAY = '2026-09-24';
const cse1: Profile = { college: 'AI융합대학', major: '컴퓨터공학과', year: 1, entranceYear: 2026, interests: ['scholarship', 'career'] };

function notice(id: number, target: string, opts: { category?: string; en?: boolean; publishedAt?: string; deadline?: string } = {}): NoticeListItem {
  return {
    id, sourceNoticeId: String(id), title: `공지 ${id}`, sourceUrl: `https://www.inha.ac.kr/bbs/kr/8/${id}/artclView.do`, sources: [],
    publishedAt: opts.publishedAt ?? '2026-09-20', boardCategory: null, crawledAt: '', contentUpdatedAt: null, analysisStatus: 'ready',
    analysis: {
      category: opts.category ?? '기타', target, deadline: opts.deadline ?? null, applicationEnd: null, applicationStart: null, eventDate: null,
      summary: ['한국어 요약'], easyExplanation: '쉬운 설명', evidence: {}, uncertain: [],
      en: opts.en === false ? null : { title: `Notice ${id}`, summary: ['English summary'], easyExplanation: 'Plain', target: 'Students', eventInfo: null },
    } as any,
  };
}

const samples = [
  notice(1, '컴퓨터공학과 재학생'),
  notice(2, '인하대학교 학부 재학생 전체', { category: '장학금' }),
  notice(3, '기계공학과 3학년 재학생'),
  notice(4, '3학년 2학기 또는 4학년 1학기 재학생'),
  notice(5, '26학번 신입생', { category: '취업/진로' }),
  notice(6, '일반대학원 석사과정 대학원생'),
];

test('matching is language-independent: English reasons align 1:1 with Korean, scores unchanged', () => {
  for (const n of samples) {
    const r = matchNotice(cse1, n, TODAY);
    assert.equal(r.matchReasonsEn.length, r.matchReasons.length, `notice ${n.id}`);
    assert.equal(r.excludedBecauseEn === null, r.excludedBecause === null);
    for (const s of r.matchReasonsEn) assert.doesNotMatch(s, /대상|관심|학년|제외|이수|공지/, `English reason looks Korean: ${s}`);
  }
  assert.deepEqual(matchNotice(cse1, samples[0], TODAY).matchReasonsEn, ['For 컴퓨터공학과']); // major name is data, kept as is
  assert.deepEqual(matchNotice(cse1, samples[1], TODAY).matchReasonsEn, ['Open to all undergraduates', 'Interest: Scholarships']);
  assert.equal(matchNotice(cse1, samples[5], TODAY).excludedBecauseEn, 'For graduate students');
  // Home is built with no language input at all → identical in ko and en
  const home = buildHome(samples, cse1, TODAY);
  const ids = home.forYou.map((r) => r.notice.id);
  assert.ok(ids.includes(1) && ids.includes(2) && !ids.includes(3) && !ids.includes(6));
  assert.equal(home.all.length, samples.length);
});

test('notification messages carry both languages and are selected by language', () => {
  const m = buildNotification(samples[0], matchNotice(cse1, samples[0], TODAY));
  assert.equal(m.kind, 'relevant');
  assert.deepEqual(localizeNotification(m, 'ko'), { title: '나에게 맞는 공지', body: '공지 1 (컴퓨터공학과 대상)' });
  assert.deepEqual(localizeNotification(m, 'en'), { title: 'Relevant to you', body: 'Notice 1 (For 컴퓨터공학과)' });
  const plain = buildNotification(notice(9, '', { en: false }), null);
  assert.equal(plain.kind, 'new');
  assert.equal(plain.bodyEn, '공지 9', 'no English analysis → Korean title, never machine-translated');
  // in-app list: last 14 days only, newest first
  const list = buildNotifications([notice(20, '', { publishedAt: '2026-09-01' }), notice(21, '', { publishedAt: '2026-09-23' }), notice(22, '', { publishedAt: '2026-09-15' })], null, TODAY);
  assert.deepEqual(list.map((x) => x.noticeId), [21, 22]);
});

test('notice content per language comes from stored fields, with Korean fallback', () => {
  const n = samples[0];
  assert.equal(noticeTitle(n, 'ko'), '공지 1');
  assert.equal(noticeTitle(n, 'en'), 'Notice 1');
  assert.equal(noticeSummaryLine(n, 'en'), 'English summary');
  assert.equal(noticeSummaryLine(n, 'ko'), '한국어 요약');
  const noEn = notice(7, '', { en: false });
  assert.equal(noticeTitle(noEn, 'en'), '공지 7');
  assert.equal(noticeSummaryLine(noEn, 'en'), '한국어 요약');
});

test('dates: one structured value, formatted per locale; D-day is language-independent', () => {
  assert.equal(fullDate('2026-09-30', 'ko'), '2026년 9월 30일');
  assert.equal(fullDate('2026-09-30T14:00', 'en'), 'September 30, 2026');
  assert.equal(shortDate('2026-09-30', 'ko'), '09.30(수)');
  assert.equal(shortDate('2026-09-30', 'en'), 'Sep 30 (Wed)');
  assert.equal(dday('2026-09-30', TODAY, 'ko').label, 'D-6');
  assert.equal(dday('2026-09-30', TODAY, 'en').label, 'D-6');
});

test('ko and en dictionaries have exactly the same keys', () => {
  const shape = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? shape(v, `${p}${k}.`) : [`${p}${k}:${typeof v}`]));
  assert.deepEqual(shape(translations.en).sort(), shape(translations.ko).sort());
  assert.equal(translations.en.calendar.weekdays.length, 7);
  assert.equal(translations.en.calendar.monthName(9), 'September');
  assert.equal(translations.ko.calendar.monthName(9), '9월');
});

// Calendar logic used by the web Calendar page (web/src/lib/calendar.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NoticeListItem } from '../src/api/types.ts';
import { calendarDayFor, calendarHref, eventsByDay, monthCells, nextEventAfter, shiftMonth } from '../web/src/lib/calendar.ts';
import { noticeEvents } from '../web/src/lib/events.ts';

function notice(id: number, a: Partial<{ deadline: string | null; applicationEnd: string | null; eventDate: string | null }> | null): NoticeListItem {
  return {
    id, sourceNoticeId: String(id), title: `공지 ${id}`, sourceUrl: '', sources: [], publishedAt: null, boardCategory: null,
    crawledAt: '', contentUpdatedAt: null, analysisStatus: a ? 'ready' : 'pending',
    analysis: a && ({ deadline: null, applicationEnd: null, eventDate: null, ...a } as any),
  };
}

test('month grid: Sunday-first, whole weeks, adjacent-month days flagged', () => {
  const sep = monthCells(2026, 9); // 2026-09-01 is a Tuesday
  assert.equal(sep.length, 35);
  assert.deepEqual(sep[0], { date: '2026-08-30', day: 30, inMonth: false });
  assert.deepEqual(sep[2], { date: '2026-09-01', day: 1, inMonth: true });
  assert.equal(sep.filter((c) => c.inMonth).length, 30);
  assert.equal(monthCells(2026, 2).length, 28); // Feb 2026 starts on Sunday and has 28 days: exactly 4 weeks
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('events: deadline falls back to applicationEnd; event from eventDate; pending notices have none', () => {
  assert.deepEqual(noticeEvents(notice(1, { applicationEnd: '2026-10-16' })).map((e) => [e.kind, e.date]), [['deadline', '2026-10-16']]);
  assert.deepEqual(
    noticeEvents(notice(2, { deadline: '2026-10-13', eventDate: '2026-09-30T14:00' })).map((e) => [e.kind, e.date]),
    [['deadline', '2026-10-13'], ['event', '2026-09-30T14:00']],
  );
  assert.deepEqual(noticeEvents(notice(3, null)), []);
});

test('eventsByDay groups by KST day; deadlines listed before events on the same day', () => {
  const map = eventsByDay([notice(1, { eventDate: '2026-09-30T14:00' }), notice(2, { deadline: '2026-09-30' })]);
  assert.deepEqual(map.get('2026-09-30')!.map((e) => `${e.kind}:${e.notice.id}`), ['deadline:2', 'event:1']);
});

test('notice → calendar: opens on the upcoming deadline, else upcoming event, else the last past date', () => {
  const today = '2026-09-23';
  assert.equal(calendarDayFor(notice(1, { deadline: '2026-10-16', eventDate: '2026-11-06' }), today), '2026-10-16');
  assert.equal(calendarDayFor(notice(2, { deadline: '2026-09-01', eventDate: '2026-09-30T14:00' }), today), '2026-09-30');
  assert.equal(calendarDayFor(notice(3, { deadline: '2026-09-01' }), today), '2026-09-01');
  assert.equal(calendarDayFor(notice(4, null), today), null);
  assert.equal(calendarHref(notice(5, { deadline: '2026-10-16' }), today), '/calendar?month=2026-10&date=2026-10-16&notice=5');
  assert.equal(calendarHref(notice(6, null), today), null);
});

test('nextEventAfter finds the first date on/after a day (for empty months)', () => {
  const ns = [notice(1, { deadline: '2026-10-16' }), notice(2, { deadline: '2026-09-29' }), notice(3, { deadline: '2026-08-01' })];
  assert.equal(nextEventAfter(ns, '2026-09-24')?.notice.id, 2);
  assert.equal(nextEventAfter(ns, '2026-10-17'), null);
});

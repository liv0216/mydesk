import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleCalendar } from '../lib/google-calendar-feed.ts';
const range = [{ start: '2026-09-01', end: '2026-10-01' }];
const wrap = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:Asia/Seoul', ...events.flatMap(event => ['BEGIN:VEVENT', ...event, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('all-day exclusive end and overlapping query ranges do not duplicate', () => {
  const rows = parseGoogleCalendar(wrap(['UID:days', 'DTSTART;VALUE=DATE:20260903', 'DTEND;VALUE=DATE:20260905', 'SUMMARY:School']), [...range, {start:'2026-09-02',end:'2026-09-08'}]);
  assert.deepEqual(rows.map(row => [row.date, row.time]), [['2026-09-03',null],['2026-09-04',null]]);
});
test('UTC crossing into Seoul and midnight exclusive end', () => {
  const rows = parseGoogleCalendar(wrap(['UID:utc', 'DTSTART:20260903T143000Z', 'DTEND:20260903T150000Z']), range);
  assert.deepEqual(rows.map(row => [row.date,row.time]), [['2026-09-03','23:30']]);
});
test('weekly repeats, excluded date, moved instance and cancellation without DTSTART', () => {
  const rows = parseGoogleCalendar(wrap(
    ['UID:repeat','DTSTART:20260901T000000Z','DTEND:20260901T010000Z','RRULE:FREQ=WEEKLY;COUNT=5','EXDATE:20260915T000000Z','SUMMARY:Original'],
    ['UID:repeat','RECURRENCE-ID:20260908T000000Z','DTSTART:20260909T020000Z','DTEND:20260909T030000Z','SUMMARY:Moved'],
    ['UID:repeat','RECURRENCE-ID:20260922T000000Z','STATUS:CANCELLED']), range);
  assert.deepEqual(rows.map(row => [row.date,row.title]), [['2026-09-01','Original'],['2026-09-09','Moved'],['2026-09-29','Original']]);
});
test('cancelled series cannot resurrect an edited instance', () => {
  const rows = parseGoogleCalendar(wrap(
    ['UID:cancel','DTSTART:20260901T000000Z','RRULE:FREQ=WEEKLY;COUNT=5','STATUS:CANCELLED'],
    ['UID:cancel','RECURRENCE-ID:20260908T000000Z','DTSTART:20260908T010000Z','SUMMARY:Edited']), range);
  assert.equal(rows.length,0);
});
test('IANA TZID without VTIMEZONE resolves daylight saving correctly', () => {
  const rows = parseGoogleCalendar(wrap(['UID:ny','DTSTART;TZID=America/New_York:20260903T090000','DTEND;TZID=America/New_York:20260903T100000']), range);
  assert.equal(rows[0].time,'22:00');
});
test('exceptions only change their own UID and RDATE is included', () => {
  const rows = parseGoogleCalendar(wrap(
    ['UID:one','DTSTART:20260901T000000Z','RRULE:FREQ=DAILY;COUNT=2','SUMMARY:One'],
    ['UID:two','DTSTART:20260901T000000Z','RDATE:20260904T000000Z','SUMMARY:Two'],
    ['UID:one','RECURRENCE-ID:20260901T000000Z','DTSTART:20260903T000000Z','SUMMARY:Edit']),range);
  assert.deepEqual(rows.map(row => [row.date,row.title]), [['2026-09-01','Two'],['2026-09-02','One'],['2026-09-03','Edit'],['2026-09-04','Two']]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGoogleCalendarEvents, GoogleCalendarApiError } from '../lib/google-calendar-api.ts';

const token = 'mock-access-token-not-a-real-credential';
const month = { start: '2026-09-01', end: '2026-10-01' };
const dayEvent = (id, start = '2026-09-03', end = '2026-09-04', extra = {}) => ({ id, start: { date: start }, end: { date: end }, ...extra });
const timedEvent = (id, start, end, extra = {}) => ({ id, start: { dateTime: start }, end: { dateTime: end }, ...extra });
const response = body => Response.json(body);
const assertSafeError = (status, code) => error => {
  assert.ok(error instanceof GoogleCalendarApiError);
  assert.equal(error.status, status);
  if (code) assert.equal(error.code, code);
  assert.ok(!String(error).includes(token));
  assert.equal(error.cause, undefined);
  return true;
};
function mockCalendar(events, calendar = { id: 'primary@example.com', primary: true }) {
  return async input => new URL(input).pathname.endsWith('/calendarList') ? response({ items: [calendar] }) : response({ items: events });
}

test('reads every calendar and event page, including empty pages; filters and deduplicates calendars', async () => {
  const calls = [];
  const calendarId = 'team/a+b@example.com';
  const mock = async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.ok(!input.includes(token));
    if (url.pathname.endsWith('/calendarList')) {
      if (!url.searchParams.has('pageToken')) return response({ items: [{ id: 'hidden', primary: true, hidden: true }, { id: 'unused' }, { id: 'deleted', selected: true, deleted: true }], nextPageToken: 'cal-2' });
      if (url.searchParams.get('pageToken') === 'cal-2') return response({ items: [], nextPageToken: 'cal-3' });
      return response({ items: [{ id: calendarId, selected: true }, { id: calendarId, primary: true }, { id: 'other', primary: true }] });
    }
    if (url.pathname.includes(encodeURIComponent(calendarId))) {
      if (!url.searchParams.has('pageToken')) return response({ items: [dayEvent('one')], nextPageToken: 'event-2' });
      return response({ items: [dayEvent('two')] });
    }
    assert.ok(url.pathname.endsWith('/calendars/other/events'));
    return response({ items: [dayEvent('one')] });
  };
  const rows = await fetchGoogleCalendarEvents(token, [month], mock);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  assert.equal(calls.length, 6);
  const eventCalls = calls.filter(url => url.pathname.endsWith('/events'));
  for (const url of eventCalls) {
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('timeZone'), 'Asia/Seoul');
    assert.equal(url.searchParams.get('timeMin'), '2026-09-01T00:00:00+09:00');
    assert.equal(url.searchParams.get('timeMax'), '2026-10-01T00:00:00+09:00');
  }
});

test('overlapping windows merge into one query and all-day end is exclusive', async () => {
  const calls = [];
  const events = [dayEvent('days', '2026-09-03', '2026-09-05')];
  const mock = async input => { calls.push(new URL(input)); return mockCalendar(events)(input); };
  const rows = await fetchGoogleCalendarEvents(token, [month, { start: '2026-09-02', end: '2026-11-01' }], mock);
  assert.deepEqual(rows.map(row => [row.date, row.time]), [['2026-09-03', null], ['2026-09-04', null]]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('timeMax'), '2026-11-01T00:00:00+09:00');
});

test('separated windows stay separate and the same spanning event is not duplicated', async () => {
  const calls = [];
  const mock = async input => { calls.push(new URL(input)); return mockCalendar([dayEvent('span', '2026-09-01', '2026-12-01')])(input); };
  const rows = await fetchGoogleCalendarEvents(token, [{ start: '2026-09-01', end: '2026-09-03' }, { start: '2026-11-01', end: '2026-11-03' }], mock);
  assert.equal(calls.length, 3);
  assert.deepEqual(rows.map(row => row.date), ['2026-09-01', '2026-09-02', '2026-11-01', '2026-11-02']);
});

test('Seoul midnight is exclusive; UTC boundaries, continuations and zero-duration events display correctly', async () => {
  const rows = await fetchGoogleCalendarEvents(token, [month], mockCalendar([
    timedEvent('midnight', '2026-09-03T14:30:00Z', '2026-09-03T15:00:00Z'),
    timedEvent('span', '2026-08-31T14:30:00Z', '2026-09-02T15:00:00Z'),
    timedEvent('zero', '2026-09-04T15:00:00Z', '2026-09-04T15:00:00Z'),
  ]));
  assert.deepEqual(rows.map(row => [row.date, row.time]), [['2026-09-01', '계속'], ['2026-09-02', '계속'], ['2026-09-03', '23:30'], ['2026-09-05', '00:00']]);
});

test('explicit IANA wall times use the correct daylight-saving offset', async () => {
  const event = { id: 'new-york', start: { dateTime: '2026-09-03T09:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-09-03T10:00:00', timeZone: 'America/New_York' } };
  const rows = await fetchGoogleCalendarEvents(token, [month], mockCalendar([event]));
  assert.equal(rows[0].time, '22:00');
});

test('server-expanded recurring instances and edited occurrences stay distinct; cancelled tombstones are skipped', async () => {
  const rows = await fetchGoogleCalendarEvents(token, [month], mockCalendar([
    dayEvent('series_20260901', '2026-09-01', '2026-09-02'),
    dayEvent('series_20260908', '2026-09-09', '2026-09-10', { summary: 'Moved' }),
    { id: 'series_20260915', status: 'cancelled' },
    dayEvent('series_20260901', '2026-09-01', '2026-09-02'),
  ]));
  assert.deepEqual(rows.map(row => row.date), ['2026-09-01', '2026-09-09']);
});

test('calendar and event IDs cannot collide through delimiter characters', async () => {
  const mock = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/calendarList')) return response({ items: [{ id: 'a:b', selected: true }, { id: 'a', selected: true }] });
    return response({ items: [dayEvent(url.pathname.includes('a%3Ab') ? 'c' : 'b:c')] });
  };
  const rows = await fetchGoogleCalendarEvents(token, [month], mock);
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
});

test('only credential-free HTTPS calendar.google.com links are retained', async () => {
  const links = ['https://calendar.google.com/calendar/event?eid=safe', 'http://calendar.google.com/event', 'https://calendar.google.com.evil.example/event', 'javascript:alert(1)', 'https://user:pass@calendar.google.com/event', 'https://calendar.google.com:444/event', '/calendar/event'];
  const rows = await fetchGoogleCalendarEvents(token, [month], mockCalendar(links.map((htmlLink, index) => dayEvent(String(index), undefined, undefined, { htmlLink }))));
  assert.equal(rows[0].htmlUrl, links[0]);
  for (const row of rows.slice(1)) assert.equal(row.htmlUrl, 'https://calendar.google.com/calendar/u/0/r/day/2026/09/03');
});

for (const status of [401, 403, 429, 503]) test(`HTTP ${status} remains explicit without exposing an upstream body`, async () => {
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], async () => new Response(`sensitive ${token}`, { status })), assertSafeError(status));
});

test('later-page failures reject the entire result, never a partial calendar', async () => {
  let eventCalls = 0;
  const mock = async input => {
    if (new URL(input).pathname.endsWith('/calendarList')) return response({ items: [{ id: 'one', primary: true }] });
    return ++eventCalls === 1 ? response({ items: [dayEvent('one')], nextPageToken: 'next' }) : new Response(token, { status: 403 });
  };
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], mock), assertSafeError(403));
});

test('network and JSON parser errors are sanitized', async () => {
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], async () => { throw new Error(token); }), assertSafeError(502));
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], async () => new Response(token)), assertSafeError(502, 'invalid_response'));
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], async () => response({ items: {} })), assertSafeError(502, 'invalid_response'));
});

for (const endpoint of ['calendarList', 'events']) test(`repeated ${endpoint} page tokens fail explicitly`, async () => {
  const mock = async input => {
    if (endpoint === 'events' && new URL(input).pathname.endsWith('/calendarList')) return response({ items: [{ id: 'one', primary: true }] });
    return response({ items: [], nextPageToken: 'same' });
  };
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], mock), assertSafeError(502, 'pagination_repeated'));
});

test('endless distinct empty pages fail at the page bound', async () => {
  let calls = 0;
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], async () => response({ items: [], nextPageToken: String(++calls) })), assertSafeError(413, 'limit_exceeded'));
  assert.equal(calls, 100);
});

test('more than 50,000 upstream items fail instead of silently truncating', async () => {
  let page = 0;
  const mock = async input => {
    if (new URL(input).pathname.endsWith('/calendarList')) return response({ items: [{ id: 'one', primary: true }] });
    return response({ items: Array.from({ length: 2500 }, () => ({ status: 'cancelled' })), nextPageToken: String(++page) });
  };
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], mock), assertSafeError(413, 'limit_exceeded'));
});

test('more than 50,000 expanded daily rows fail without truncation', async () => {
  const events = Array.from({ length: 1700 }, (_, index) => dayEvent(String(index), '2026-09-01', '2026-10-01'));
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], mockCalendar(events)), assertSafeError(413, 'limit_exceeded'));
});

test('invalid dates and missing event time information fail rather than disappearing', async () => {
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], mockCalendar([dayEvent('invalid', '2026-02-30', '2026-03-03')])), assertSafeError(502, 'invalid_response'));
  await assert.rejects(fetchGoogleCalendarEvents(token, [month], mockCalendar([{ id: 'missing', start: {}, end: {} }])), assertSafeError(502, 'invalid_response'));
});

test('invalid credentials and ranges make no request; empty ranges return an empty result', async () => {
  const never = async () => { assert.fail('Unexpected external request'); };
  await assert.rejects(fetchGoogleCalendarEvents('', [month], never), assertSafeError(401));
  await assert.rejects(fetchGoogleCalendarEvents(token, [month, month, month], never), assertSafeError(400, 'invalid_range'));
  await assert.rejects(fetchGoogleCalendarEvents(token, [{ start: '2026-02-30', end: '2026-03-03' }], never), assertSafeError(400, 'invalid_range'));
  await assert.rejects(fetchGoogleCalendarEvents(token, [{ start: '2026-01-01', end: '2027-01-01' }], never), assertSafeError(400, 'invalid_range'));
  assert.deepEqual(await fetchGoogleCalendarEvents(token, [], never), []);
});

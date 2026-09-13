import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyDesk, importDesk, InputError, mutateDesk } from '../lib/desk-state.ts';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function existingDesk() {
  const state = emptyDesk();
  state.tasks.push({ id: 7, text: 'Prepare lesson', tag: 'Work', done: false });
  state.schedules.push({ id: 12, date: '2026-09-01', title: 'Existing event', source: 'manual' });
  state.timetable.push({ id: 4, day: 0, period: 1, subject: 'Math', location: 'Room A' });
  state.imports.push({ id: 2, fileName: 'previous.pdf', kind: 'calendar', detectedCount: 1 });
  state.classStatus.total = 25;
  return state;
}

test('new desks have independent arrays and nested class status', () => {
  const first = emptyDesk();
  const second = emptyDesk();
  first.tasks.push({ id: 1, text: 'Only the first account' });
  first.timetable.push({ id: 1, day: 0, period: 1, subject: 'Math' });
  first.classStatus.total = 30;
  assert.deepEqual(second, emptyDesk());
});

test('editing and deleting a task preserves the original state and another account with the same ID', () => {
  const original = existingDesk();
  const snapshot = structuredClone(original);
  const otherAccount = existingDesk();
  otherAccount.tasks[0].text = 'Another account task';
  const otherSnapshot = structuredClone(otherAccount);
  freeze(original);
  freeze(otherAccount);

  const edited = mutateDesk(original, 'PATCH', { resource: 'task', id: 7, done: true });
  const deleted = mutateDesk(edited, 'DELETE', { resource: 'task', id: 7 });
  assert.equal(edited.tasks[0].done, true);
  assert.deepEqual(deleted.tasks, []);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(otherAccount, otherSnapshot);

  edited.schedules[0].title = 'Changed only in the returned copy';
  edited.classStatus.total = 99;
  assert.deepEqual(original, snapshot);
  assert.deepEqual(otherAccount, otherSnapshot);
});

test('a successful calendar import preserves earlier data and does not share objects with its input', () => {
  const original = existingDesk();
  const snapshot = structuredClone(original);
  const body = freeze({
    kind: 'calendar', fileName: 'semester.pdf',
    events: [{ date: '2026-09-15', title: 'New event' }],
  });
  freeze(original);

  const result = importDesk(original, body);
  assert.equal(result.schedules.length, 2);
  assert.deepEqual(result.schedules[0], snapshot.schedules[0]);
  assert.equal(result.schedules[1].title, 'New event');
  assert.notEqual(result.schedules[1].id, result.schedules[0].id);
  assert.equal(result.schedules[1].sourceImportId, result.imports[0].id);
  assert.equal(result.imports[0].detectedCount, 1);
  assert.deepEqual(result.timetable, snapshot.timetable);
  assert.deepEqual(original, snapshot);

  result.timetable[0].subject = 'Changed in the result';
  result.schedules[1].title = 'Changed in the result';
  assert.deepEqual(original, snapshot);
  assert.equal(body.events[0].title, 'New event');
});

test('a calendar import with a later invalid date cannot append earlier valid rows or import history', () => {
  const original = existingDesk();
  const snapshot = structuredClone(original);
  freeze(original);
  assert.throws(() => importDesk(original, {
    kind: 'calendar', fileName: 'invalid.pdf', events: [
      { date: '2026-09-15', title: 'Valid first row' },
      { date: '2026-02-30', title: 'Impossible date' },
    ],
  }), InputError);
  assert.deepEqual(original, snapshot);
});

test('a timetable import with a later invalid slot preserves the existing timetable and import history', () => {
  const original = existingDesk();
  const snapshot = structuredClone(original);
  freeze(original);
  assert.throws(() => importDesk(original, {
    kind: 'timetable', fileName: 'invalid.pdf', entries: [
      { day: 1, period: 2, subject: 'Valid replacement' },
      { day: 5, period: 1, subject: 'Outside school week' },
    ],
  }), InputError);
  assert.deepEqual(original, snapshot);
});

test('exceeding the calendar storage limit leaves the prior desk intact', () => {
  const original = existingDesk();
  original.schedules = Array.from({ length: 5000 }, (_, index) => ({
    id: index + 1, date: '2026-09-01', title: `Event ${index + 1}`, source: 'manual',
  }));
  const snapshot = structuredClone(original);
  freeze(original);
  assert.throws(() => importDesk(original, {
    kind: 'calendar', fileName: 'too-many.pdf',
    events: [{ date: '2026-09-15', title: 'One beyond the limit' }],
  }), InputError);
  assert.deepEqual(original, snapshot);
});

test('reimporting a PDF replaces only that file while preserving manual events and other PDFs', () => {
  const sharedEvent = { date: '2026-09-15', title: 'Same date and title from two PDFs' };
  let original = existingDesk();
  original = importDesk(original, { kind: 'calendar', fileName: 'semester.pdf', events: [sharedEvent] });
  original = importDesk(original, { kind: 'calendar', fileName: 'other.pdf', events: [sharedEvent] });
  const snapshot = structuredClone(original);
  const manual = snapshot.schedules.filter(row => row.source === 'manual');
  const otherPdf = snapshot.schedules.filter(row => row.sourceFileName === 'other.pdf');
  freeze(original);

  const updatedEvents = [
    { date: '2026-09-16', title: 'Corrected date' },
    { date: '2026-09-17', title: 'New activity' },
  ];
  const result = importDesk(original, { kind: 'calendar', fileName: 'semester.pdf', events: updatedEvents });
  assert.deepEqual(result.schedules.filter(row => row.source === 'manual'), manual);
  assert.deepEqual(result.schedules.filter(row => row.sourceFileName === 'other.pdf'), otherPdf);
  assert.deepEqual(
    result.schedules.filter(row => row.sourceFileName === 'semester.pdf').map(({ date, title }) => ({ date, title })),
    updatedEvents,
  );
  assert.equal(result.schedules.length, manual.length + otherPdf.length + updatedEvents.length);
  assert.equal(new Set(result.schedules.map(row => row.id)).size, result.schedules.length);
  assert.equal(result.imports[0].detectedCount, updatedEvents.length);
  assert.deepEqual(original, snapshot);
});

test('a PDF can still be replaced after its import history has been evicted', () => {
  let original = importDesk(existingDesk(), {
    kind: 'calendar', fileName: 'old-semester.pdf',
    events: [{ date: '2026-09-01', title: 'Outdated semester activity' }],
  });
  for (let i = 0; i < 100; i++) {
    original = importDesk(original, {
      kind: 'calendar', fileName: `other-${i}.pdf`,
      events: [{ date: '2026-10-01', title: `Other PDF ${i}` }],
    });
  }
  assert.equal(original.imports.length, 100);
  assert.equal(original.imports.some(row => row.fileName === 'old-semester.pdf'), false);
  const snapshot = structuredClone(original);
  const unaffected = snapshot.schedules.filter(row => row.sourceFileName !== 'old-semester.pdf');
  freeze(original);

  const result = importDesk(original, {
    kind: 'calendar', fileName: 'old-semester.pdf',
    events: [{ date: '2026-09-02', title: 'Updated semester activity' }],
  });
  assert.deepEqual(result.schedules.filter(row => row.sourceFileName !== 'old-semester.pdf'), unaffected);
  assert.deepEqual(
    result.schedules.filter(row => row.sourceFileName === 'old-semester.pdf').map(({ date, title }) => ({ date, title })),
    [{ date: '2026-09-02', title: 'Updated semester activity' }],
  );
  assert.deepEqual(original, snapshot);
});

test('older PDF rows without a stored filename are replaced through their import record', () => {
  const original = existingDesk();
  original.schedules.push({
    id: 20, date: '2026-09-03', title: 'Older saved PDF activity', source: 'pdf', sourceImportId: 2,
  });
  const snapshot = structuredClone(original);
  freeze(original);

  const result = importDesk(original, {
    kind: 'calendar', fileName: 'previous.pdf',
    events: [{ date: '2026-09-04', title: 'Replacement PDF activity' }],
  });
  assert.deepEqual(result.schedules.filter(row => row.source === 'manual'), snapshot.schedules.filter(row => row.source === 'manual'));
  assert.deepEqual(
    result.schedules.filter(row => row.source === 'pdf').map(({ date, title }) => ({ date, title })),
    [{ date: '2026-09-04', title: 'Replacement PDF activity' }],
  );
  assert.deepEqual(original, snapshot);
});

test('a failed replacement keeps the previous PDF rows and history even after a valid new row', () => {
  const original = importDesk(existingDesk(), {
    kind: 'calendar', fileName: 'semester.pdf',
    events: [{ date: '2026-09-15', title: 'Keep this previous PDF activity' }],
  });
  const snapshot = structuredClone(original);
  freeze(original);
  const invalidRows = [
    { date: '2026-02-30', title: 'Impossible date' },
    { date: '2026-09-17', title: 'x'.repeat(1001) },
    null,
  ];
  for (const invalidRow of invalidRows) {
    assert.throws(() => importDesk(original, {
      kind: 'calendar', fileName: 'semester.pdf',
      events: [{ date: '2026-09-16', title: 'Valid new row before failure' }, invalidRow],
    }), InputError);
    assert.deepEqual(original, snapshot);
  }
});

test('an entire academic year with more than 250 long titles is saved without truncation', () => {
  const original = existingDesk();
  const snapshot = structuredClone(original);
  freeze(original);
  const longTitle = '상세 학사 활동과 안내 사항 '.repeat(30).trim();
  assert.ok(longTitle.length > 120 && longTitle.length < 1000);
  const events = Array.from({ length: 365 }, (_, index) => ({
    date: new Date(Date.UTC(2030, 2, 1) + index * 86400000).toISOString().slice(0, 10),
    title: index === 0 ? '가'.repeat(1000) : `${longTitle} ${index + 1}`,
  }));
  const result = importDesk(original, { kind: 'calendar', fileName: 'full-year.pdf', events });
  const importedRows = result.schedules.filter(row => row.sourceFileName === 'full-year.pdf');
  assert.equal(result.imports[0].detectedCount, 365);
  assert.equal(importedRows.length, 365);
  assert.deepEqual(importedRows.map(({ date, title }) => ({ date, title })), events);
  assert.equal(importedRows.at(-1).date, '2031-02-28');
  assert.deepEqual(result.schedules.filter(row => row.source === 'manual'), snapshot.schedules);
  assert.deepEqual(original, snapshot);
});

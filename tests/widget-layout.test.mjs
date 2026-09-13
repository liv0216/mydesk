import assert from 'node:assert/strict';
import test from 'node:test';
import { WIDGET_IDS, getColumnCount, createDefaultLayout, normalizeLayout, resolveLayout, migrateLegacyLayout } from '../lib/widget-layout.ts';

function assertLayout(layout, columns) {
  assert.deepEqual(Object.keys(layout), [...WIDGET_IDS]);
  for (const [id, item] of Object.entries(layout)) {
    for (const value of Object.values(item)) assert.ok(Number.isSafeInteger(value));
    assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.w <= columns);
    assert.ok(item.h >= 9 && item.h <= 63);
    assert.ok(item.w >= (columns === 4 ? 4 : ['calendar', 'timetable'].includes(id) ? 3 : 2));
    if (columns === 4) assert.deepEqual([item.x, item.w], [0, 4]);
  }
  const entries = Object.entries(layout);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [aId, a] = entries[i], [bId, b] = entries[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${aId} overlaps ${bId}`);
  }
}

test('breakpoints match the desktop, tablet and single-column mobile grid', () => {
  for (const [width, columns] of [[1440, 12], [1051, 12], [1050, 8], [761, 8], [760, 4], [390, 4], [0, 4], [NaN, 4], [Infinity, 4]]) assert.equal(getColumnCount(width), columns);
});

test('default layouts use the agreed columns and fixed content-independent heights', () => {
  for (const columns of [12, 8, 4]) assertLayout(createDefaultLayout(columns), columns);
  const desktop = createDefaultLayout(12);
  assert.deepEqual(desktop.calendar, { x: 3, y: 0, w: 5, h: 44 });
  assert.deepEqual(desktop.timetable, { x: 3, y: 44, w: 5, h: 28 });
  assert.deepEqual(desktop.tasks, { x: 8, y: 20, w: 4, h: 20 });
  assert.deepEqual(createDefaultLayout(8).schedule, { x: 0, y: 72, w: 4, h: 20 });
  assert.deepEqual(createDefaultLayout(8).tasks, { x: 4, y: 72, w: 4, h: 20 });
  const separate = createDefaultLayout(12);
  separate.calendar.h = 9;
  assert.equal(desktop.calendar.h, 44);
});

test('normalization tolerates corrupt saved values, inherited properties and throwing accessors', () => {
  for (const input of [null, [], 'invalid', 42, false]) assert.deepEqual(normalizeLayout(input, 12), createDefaultLayout(12));
  const input = Object.create({ clock: { x: 9, y: 9, w: 9, h: 9 } });
  Object.defineProperty(input, 'calendar', { get() { throw new Error('untrusted accessor'); } });
  input.weather = { x: NaN, y: Infinity, w: '12', h: -50 };
  input.shortcuts = { x: 99.8, y: -99, w: 1.3, h: 9999 };
  const result = normalizeLayout(input, 12);
  assertLayout(result, 12);
  assert.deepEqual(result.clock, createDefaultLayout(12).clock);
  assert.equal(result.weather.h, 9);
  assert.deepEqual([result.shortcuts.x, result.shortcuts.w, result.shortcuts.h], [10, 2, 63]);
});

test('overlapping saved cards are all packed, including rows beyond the saved-coordinate limit', () => {
  const corrupt = Object.fromEntries(WIDGET_IDS.map(id => [id, { x: 100, y: 1e100, w: 100, h: 100 }]));
  const result = normalizeLayout(corrupt, 4);
  assertLayout(result, 4);
  assert.equal(result.clock.y, 500);
  assert.equal(result.tasks.y, 500 + 7 * 63);
});

test('moving a card gives it priority and only pushes colliding cards downward', () => {
  const original = createDefaultLayout(12);
  const before = structuredClone(original);
  const result = resolveLayout(original, 12, 'clock', { x: 3, y: 0 });
  assertLayout(result, 12);
  assert.deepEqual(result.clock, { x: 3, y: 0, w: 3, h: 11 });
  assert.equal(result.calendar.y, 11);
  assert.equal(result.timetable.y, 55);
  assert.deepEqual(result.weather, original.weather);
  assert.deepEqual(result.schedule, original.schedule);
  assert.deepEqual(original, before);
});

test('resizing across columns resolves every overlap while preserving the requested card', () => {
  const result = resolveLayout(createDefaultLayout(12), 12, 'calendar', { x: 10, y: 0, w: 9, h: 63 });
  assertLayout(result, 12);
  assert.deepEqual(result.calendar, { x: 3, y: 0, w: 9, h: 63 });
  assert.ok(result.schedule.y >= 63);
  assert.ok(result.tasks.y >= result.schedule.y + result.schedule.h);
  assert.ok(result.timetable.y >= 63);
});

test('mobile ignores horizontal dragging and resizing, and ordinary packing is stable', () => {
  const result = resolveLayout(createDefaultLayout(4), 4, 'tasks', { x: 3, y: -10, w: 2, h: 9 });
  assertLayout(result, 4);
  assert.deepEqual(result.tasks, { x: 0, y: 0, w: 4, h: 9 });
  assert.deepEqual(normalizeLayout(result, 4), result);
  assert.deepEqual(resolveLayout(result, 4), result);
});

test('repeated moves and resizes remain finite, bounded and collision-free at every breakpoint', () => {
  let seed = 179;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (const columns of [12, 8, 4]) {
    let layout = createDefaultLayout(columns);
    for (let iteration = 0; iteration < 160; iteration++) {
      const previous = layout;
      const old = structuredClone(layout);
      const id = WIDGET_IDS[random(WIDGET_IDS.length)];
      layout = resolveLayout(layout, columns, id, { x: random(25) - 5, y: random(80) - 5, w: random(18), h: random(90) });
      assertLayout(layout, columns);
      assert.deepEqual(previous, old);
      assert.notEqual(layout[id], previous[id]);
    }
  }
});

test('legacy pixel offsets and explicit manual dimensions migrate without mutating the source', () => {
  const legacy = { clock: { x: 100, y: 64, width: 184, height: 184, manualSize: true }, calendar: { x: 0, y: 0, height: 500, manualSize: false } };
  const before = structuredClone(legacy);
  const result = migrateLegacyLayout(legacy, 12, 1184);
  assertLayout(result, 12);
  assert.deepEqual(result.clock, { x: 1, y: 4, w: 2, h: 12 });
  assert.equal(result.calendar.h, 44);
  assert.deepEqual(legacy, before);
});

test('legacy migration rejects invalid dimensions and resolves extreme overlap on mobile', () => {
  for (const width of [0, -1, Infinity, NaN, '1200']) assert.deepEqual(migrateLegacyLayout({ clock: { x: 100 } }, 8, width), createDefaultLayout(8));
  const legacy = Object.fromEntries(WIDGET_IDS.map(id => [id, { x: -9999, y: -9999, width: Infinity, height: 99999, manualSize: true }]));
  const result = migrateLegacyLayout(legacy, 4, 390);
  assertLayout(result, 4);
  assert.equal(result.clock.y, 0);
  assert.equal(result.tasks.y, 7 * 63);
  assert.deepEqual(migrateLegacyLayout(null, 12, 1184), createDefaultLayout(12));
});

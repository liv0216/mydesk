import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAcademicCalendar } from '../lib/academic-calendar.ts';

// Entirely synthetic text and geometry; no source PDF or school data is used.
const item = (text, x = 40, y = 700, width = 100) => ({ text, x, y, width, height: 9 });
const heading = () => item('2030학년도 연간 계획', 30, 780, 160);
const parse = (pages) => parseAcademicCalendar(pages, 'sample-academic-calendar.pdf', 2099);
const datesFor = (events, title) => events.filter(event => event.title === title).map(event => event.date);

function calendarGrid({ february = false } = {}) {
  const left = [98, 198, 298, 388, 498];
  const page = [heading(), item('1월', 30, 480, 20)];
  ['월', '화', '수', '목', '금'].forEach((day, column) => {
    page.push(item(`${day}(6교시)`, 120 + column * 100, 550, 40));
  });
  [[30, 31, 1, 2, 3], [6, 7, 8, 9, 10]].forEach((days, row) => {
    days.forEach((day, column) => page.push(item(String(day), left[column], 500 - row * 50, 6)));
  });
  page.push(item('연말 전시회', left[1], 488, 60));
  page.push(item('공동 프로젝트 안내', left[2], 438, 75));
  // This left edge is slightly before the header-derived column boundary.
  page.push(item('교내 발표회', left[3], 438, 65));
  page.push(item('오전 독서 모임', left[4], 438, 65));
  page.push(item('오후 정리 시간', left[4], 380, 65));
  if (february) {
    page.push(item('2월', 30, 340, 20));
    page.push(item('작품 검토(2.11.), 발표 준비(2031.2.12.), 공동 제작(2031.2.15.~2.17.)', 98, 340, 440));
  }
  return page;
}

test('all twelve academic months use the document year, including next January and February', () => {
  const months = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
  const page = [heading(), ...months.map((month, i) => item(`${month}.15. 월별 활동 ${month}`, 40, 740 - i * 20, 150))];
  const events = parse([page]);
  assert.deepEqual(events.map(event => event.date), months.map(month => `${month <= 2 ? 2031 : 2030}-${String(month).padStart(2, '0')}-15`));
  assert.equal(new Set(events.map(event => event.date.slice(0, 7))).size, 12);
});

test('a January grid keeps December spillover and shifted weekday columns separate', () => {
  const events = parse([calendarGrid()]);
  assert.deepEqual(datesFor(events, '연말 전시회'), ['2030-12-31']);
  assert.deepEqual(datesFor(events, '공동 프로젝트 안내'), ['2031-01-08']);
  assert.deepEqual(datesFor(events, '교내 발표회'), ['2031-01-09']);
  assert.equal(events.filter(event => /공동 프로젝트 안내|교내 발표회/.test(event.title)).length, 2);
});

test('the final text baseline remains in the final calendar cell', () => {
  const events = parse([calendarGrid()]);
  assert.deepEqual(datesFor(events, '오전 독서 모임\n오후 정리 시간'), ['2031-01-10']);
});

test('a merged February cell supports title-before-date and abbreviated ranges', () => {
  const events = parse([calendarGrid({ february: true })]);
  assert.deepEqual(events.filter(event => event.date.startsWith('2031-02')), [
    { date: '2031-02-11', title: '작품 검토' },
    { date: '2031-02-12', title: '발표 준비' },
    { date: '2031-02-15', title: '공동 제작' },
    { date: '2031-02-16', title: '공동 제작' },
    { date: '2031-02-17', title: '공동 제작' },
  ]);
});

test('parenthesized weekdays and full or abbreviated ranges preserve their titles', () => {
  const events = parse([[heading(),
    item('3.5.(화)~7.(목) 봄 독서 주간', 40, 720, 200),
    item('2030.12.30.(월)~2031.1.2.(목) 연말 공동 활동', 40, 700, 300),
    item('여름 발표(6.10.~6.12.)', 40, 680, 180),
  ]]);
  assert.deepEqual(datesFor(events, '봄 독서 주간'), ['2030-03-05', '2030-03-06', '2030-03-07']);
  assert.deepEqual(datesFor(events, '여름 발표'), ['2030-06-10', '2030-06-11', '2030-06-12']);
  assert.deepEqual(datesFor(events, '연말 공동 활동'), ['2030-12-30', '2030-12-31', '2031-01-01', '2031-01-02']);
});

test('imports exceeding 250 events retain late-year entries across pages', () => {
  const pages = [[heading()]];
  const start = Date.UTC(2030, 2, 1);
  for (let i = 0; i < 365; i++) {
    const pageIndex = Math.floor(i / 50);
    pages[pageIndex] ??= [];
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    pages[pageIndex].push(item(`${date} 매일 기록 ${i + 1}`, 40, 740 - (i % 50) * 12, 220));
  }
  const events = parse(pages);
  assert.equal(events.length, 365);
  assert.deepEqual(events[0], { date: '2030-03-01', title: '매일 기록 1' });
  assert.deepEqual(events.at(-1), { date: '2031-02-28', title: '매일 기록 365' });
});

function monthPage({ year = 2030, month, x = 40, y = 740, cellWidth = 90, rowGap = 80, explicitYear = true, entries = {} }) {
  const page = [item(`${explicitYear ? `${year}년 ` : ''}${month}월`, x, y, 160)];
  [...'일월화수목금토'].forEach((day, column) => page.push(item(day, x + column * cellWidth + cellWidth / 2 - 6, y - 30, 12)));
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= last; day++) {
    const slot = offset + day - 1;
    const cellX = x + (slot % 7) * cellWidth + 4;
    const cellY = y - 50 - Math.floor(slot / 7) * rowGap;
    page.push({ ...item(String(day), cellX, cellY, 8), height: 11 });
    (entries[day] ?? []).forEach((text, line) => page.push(item(text, cellX, cellY - 14 - line * 11, cellWidth - 12)));
  }
  return page;
}

test('month headings above weekday grids import every academic month and leave blank cells empty', () => {
  const months = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
  const pages = [[heading()], ...months.map(month => monthPage({
    year: month <= 2 ? 2031 : 2030, month, entries: { 15: [`월별 모임 ${month}`] },
  }))];
  const events = parse(pages);
  assert.equal(events.length, 12);
  for (const month of months) {
    assert.deepEqual(datesFor(events, `월별 모임 ${month}`), [`${month <= 2 ? 2031 : 2030}-${String(month).padStart(2, '0')}-15`]);
  }
});

test('a period beneath its title stays in its own cell rather than taking an adjacent event title', () => {
  const page = monthPage({ month: 9, entries: {
    9: ['공동 연구 주간', '(9.9.~9.13.)'],
    10: ['자료 발표', '교실 정리'],
    12: ['보호자 공개 수업'],
  } });
  const events = parse([page]);
  assert.deepEqual(datesFor(events, '공동 연구 주간'), ['2030-09-09', '2030-09-10', '2030-09-11', '2030-09-12', '2030-09-13']);
  assert.deepEqual(datesFor(events, '보호자 공개 수업'), ['2030-09-12']);
  assert.deepEqual(datesFor(events, '자료 발표\n교실 정리'), ['2030-09-10']);
  assert.equal(events.length, 7);
});

test('multiple vertically and horizontally arranged month grids remain independent', () => {
  const page = [
    ...monthPage({ month: 3, x: 40, y: 1050, rowGap: 65, entries: { 31: ['상단 왼쪽'] } }),
    ...monthPage({ month: 4, x: 760, y: 1050, rowGap: 65, entries: { 1: ['상단 오른쪽'] } }),
    ...monthPage({ month: 5, x: 40, y: 520, rowGap: 65, entries: { 31: ['하단 왼쪽'] } }),
    ...monthPage({ month: 6, x: 760, y: 520, rowGap: 65, entries: { 1: ['하단 오른쪽'] } }),
  ];
  assert.deepEqual(parse([page]), [
    { date: '2030-03-31', title: '상단 왼쪽' },
    { date: '2030-04-01', title: '상단 오른쪽' },
    { date: '2030-05-31', title: '하단 왼쪽' },
    { date: '2030-06-01', title: '하단 오른쪽' },
  ]);
});

test('explicit monthly years and range endpoints cross the calendar year correctly', () => {
  const events = parse([[heading()],
    monthPage({ month: 12, entries: { 30: ['연말 연계 활동', '(12.30.~1.2.)'] } }),
    monthPage({ year: 2031, month: 1, entries: { 3: ['새해 준비'] } }),
    monthPage({ year: 2031, month: 2, explicitYear: false, entries: { 20: ['학년 마무리'] } }),
  ]);
  assert.deepEqual(datesFor(events, '연말 연계 활동'), ['2030-12-30', '2030-12-31', '2031-01-01', '2031-01-02']);
  assert.deepEqual(datesFor(events, '새해 준비'), ['2031-01-03']);
  assert.deepEqual(datesFor(events, '학년 마무리'), ['2031-02-20']);
});

test('text-row fallback keeps short dates, ranges and explicit year headings alongside both grid layouts', () => {
  const events = parse([calendarGrid(), monthPage({ month: 9, entries: { 6: ['달력 행사'] } }), [
    item('2030년 12월', 40, 740),
    item('28일(토)~30일(월) 공동 마무리', 40, 700, 220),
    item('2031년 1월', 40, 660),
    item('2일(목) 새해 회의', 40, 620, 180),
    item('3 교시 안내', 40, 600, 180),
    item('20 명 참석', 40, 580, 180),
  ]]);
  assert.deepEqual(datesFor(events, '공동 마무리'), ['2030-12-28', '2030-12-29', '2030-12-30']);
  assert.deepEqual(datesFor(events, '새해 회의'), ['2031-01-02']);
  assert.deepEqual(datesFor(events, '달력 행사'), ['2030-09-06']);
  assert.deepEqual(datesFor(events, '교내 발표회'), ['2031-01-09']);
  assert.equal(events.some(event => /교시 안내|명 참석/.test(event.title)), false);
});

test('a monthly grid does not manufacture holidays or interpret body counts as day anchors', () => {
  const page = monthPage({ month: 9, entries: { 3: ['자료 정리'] } });
  page.push(item('수업일수 20일', 510, 740, 150));
  page.push({ ...item('22', 229, 600, 8), height: 6 });
  assert.deepEqual(parse([page]), [{ date: '2030-09-03', title: '자료 정리' }]);
});

export const WIDGET_IDS = ["clock", "weather", "shortcuts", "stats", "calendar", "timetable", "schedule", "tasks"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export type ColumnCount = 12 | 8 | 4;
export type GridItem = { x: number; y: number; w: number; h: number };
export type WidgetLayouts = Record<WidgetId, GridItem>;

const HEIGHTS: Record<WidgetId, number> = { clock: 11, weather: 15, shortcuts: 11, stats: 20, calendar: 44, timetable: 28, schedule: 20, tasks: 20 };
const MAX_SAVED_ROW = 500;
const MAX_HEIGHT = 63;
const MAX_PACKED_ROW = MAX_SAVED_ROW + WIDGET_IDS.length * MAX_HEIGHT;

function validColumns(columns: ColumnCount): ColumnCount {
  return columns === 12 || columns === 8 ? columns : 4;
}

export function getColumnCount(width: number): ColumnCount {
  if (!Number.isFinite(width)) return 4;
  return width > 1050 ? 12 : width > 760 ? 8 : 4;
}

/** Rows and columns are zero-based. CSS supplies the gaps between grid tracks. */
export function createDefaultLayout(columns: ColumnCount): WidgetLayouts {
  columns = validColumns(columns);
  const result = {} as WidgetLayouts;
  function stack(ids: readonly WidgetId[], x: number, w: number, firstRow = 0) {
    let y = firstRow;
    for (const id of ids) {
      result[id] = { x, y, w, h: HEIGHTS[id] };
      y += HEIGHTS[id];
    }
    return y;
  }
  if (columns === 4) {
    stack(WIDGET_IDS, 0, 4);
  } else {
    const leftEnd = stack(["clock", "weather", "shortcuts", "stats"], 0, 3);
    const centerEnd = stack(["calendar", "timetable"], 3, 5);
    if (columns === 12) stack(["schedule", "tasks"], 8, 4);
    else {
      const bottom = Math.max(leftEnd, centerEnd);
      stack(["schedule"], 0, 4, bottom);
      stack(["tasks"], 4, 4, bottom);
    }
  }
  return result;
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try { return Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(finite(value) ? value : fallback)));
}

function readItem(value: unknown, fallback: GridItem, id: WidgetId, columns: ColumnCount, maxRow: number): GridItem {
  const minWidth = id === "calendar" || id === "timetable" ? 3 : 2;
  const w = columns === 4 ? 4 : integer(field(value, "w"), fallback.w, minWidth, columns);
  return {
    x: columns === 4 ? 0 : integer(field(value, "x"), fallback.x, 0, columns - w),
    y: integer(field(value, "y"), fallback.y, 0, maxRow),
    w,
    h: integer(field(value, "h"), fallback.h, 9, MAX_HEIGHT),
  };
}

function readLayout(input: unknown, columns: ColumnCount, maxRow: number): WidgetLayouts {
  const defaults = createDefaultLayout(columns);
  return Object.fromEntries(WIDGET_IDS.map(id => [id, readItem(field(input, id), defaults[id], id, columns, maxRow)])) as WidgetLayouts;
}

function intersects(a: GridItem, b: GridItem) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pack(layout: WidgetLayouts, changedId?: WidgetId): WidgetLayouts {
  const result = {} as WidgetLayouts;
  const placed: GridItem[] = [];
  const order = WIDGET_IDS.filter(id => id !== changedId).sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x || WIDGET_IDS.indexOf(a) - WIDGET_IDS.indexOf(b));
  if (changedId) order.unshift(changedId);
  for (const id of order) {
    const item = { ...layout[id] };
    // Each step moves below at least one placed rectangle; horizontal position stays fixed.
    let blockers = placed.filter(other => intersects(item, other));
    while (blockers.length) {
      item.y = Math.max(...blockers.map(other => other.y + other.h));
      blockers = placed.filter(other => intersects(item, other));
    }
    result[id] = item;
    placed.push(item);
  }
  return Object.fromEntries(WIDGET_IDS.map(id => [id, result[id]])) as WidgetLayouts;
}

export function normalizeLayout(input: unknown, columns: ColumnCount): WidgetLayouts {
  columns = validColumns(columns);
  return pack(readLayout(input, columns, MAX_SAVED_ROW));
}

export function resolveLayout(layout: WidgetLayouts, columns: ColumnCount, changedId?: WidgetId, patch?: Partial<GridItem>): WidgetLayouts {
  columns = validColumns(columns);
  const current = readLayout(layout, columns, MAX_PACKED_ROW);
  if (!changedId || !WIDGET_IDS.includes(changedId)) return pack(current);
  const changed = readItem(patch, current[changedId], changedId, columns, MAX_PACKED_ROW);
  const requestedY = field(patch, "y");
  if (finite(requestedY)) changed.y = integer(requestedY, changed.y, 0, MAX_SAVED_ROW);
  current[changedId] = changed;
  return pack(current, changedId);
}

/** Convert v2 pixel offsets/sizes to grid units without reading browser state. */
export function migrateLegacyLayout(input: unknown, columns: ColumnCount, gridWidth: number): WidgetLayouts {
  columns = validColumns(columns);
  const defaults = createDefaultLayout(columns);
  if (!finite(gridWidth) || gridWidth <= 0) return defaults;
  const cellWidth = (gridWidth + 16) / columns;
  const migrated = {} as WidgetLayouts;
  for (const id of WIDGET_IDS) {
    const legacy = field(input, id);
    const x = field(legacy, "x");
    const y = field(legacy, "y");
    const width = field(legacy, "width");
    const height = field(legacy, "height");
    migrated[id] = {
      x: defaults[id].x + (finite(x) ? Math.round(x / cellWidth) : 0),
      y: defaults[id].y + (finite(y) ? Math.round(y / 16) : 0),
      w: finite(width) && width > 0 ? Math.round((width + 16) / cellWidth) : defaults[id].w,
      h: field(legacy, "manualSize") === true && finite(height) && height > 0 ? Math.ceil((height + 8) / 16) : defaults[id].h,
    };
  }
  return normalizeLayout(migrated, columns);
}

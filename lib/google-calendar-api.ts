import type { DateRange, GoogleSchedule } from "./google-calendar-feed";

const apiRoot = "https://www.googleapis.com/calendar/v3/";
const dayMs = 86_400_000;
const maxItems = 50_000;
const maxPages = 100;
const maxRequests = 1_000;
const displayZone = "Asia/Seoul";
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: displayZone, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: displayZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type ErrorCode = "request_failed" | "invalid_response" | "invalid_range" | "limit_exceeded" | "pagination_repeated";

/** Safe to inspect without exposing response bodies, URLs, or access tokens. */
export class GoogleCalendarApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode = "request_failed") {
    super(`Google Calendar ${code} (${status}).`);
    this.name = "GoogleCalendarApiError";
    this.status = status;
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GoogleCalendarApiError(502, "invalid_response");
  return value as JsonObject;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function nextDay(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + dayMs).toISOString().slice(0, 10);
}

function unionRanges(ranges: DateRange[]): DateRange[] {
  if (!Array.isArray(ranges) || ranges.length > 2) throw new GoogleCalendarApiError(400, "invalid_range");
  const sorted = ranges.map(range => {
    if (!range || !isDate(range.start) || !isDate(range.end) || range.end <= range.start) throw new GoogleCalendarApiError(400, "invalid_range");
    // The caller supplies a visible month and an upcoming 90-day window.
    if ((Date.parse(range.end) - Date.parse(range.start)) / dayMs > 90) throw new GoogleCalendarApiError(400, "invalid_range");
    return { start: range.start, end: range.end };
  }).sort((a, b) => a.start.localeCompare(b.start));
  const result: DateRange[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = previous.end > range.end ? previous.end : range.end;
    else result.push(range);
  }
  const days = result.reduce((count, range) => count + (Date.parse(range.end) - Date.parse(range.start)) / dayMs, 0);
  if (days > 121) throw new GoogleCalendarApiError(400, "invalid_range");
  return result;
}

function seoulDate(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

function dateTime(value: JsonObject): number {
  if (typeof value.dateTime !== "string") throw new GoogleCalendarApiError(502, "invalid_response");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(value.dateTime);
  if (!match || !isDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) throw new GoogleCalendarApiError(502, "invalid_response");
  if (match[6]) {
    if (match[6] !== "Z" && (+match[6].slice(1, 3) > 23 || +match[6].slice(4) > 59)) throw new GoogleCalendarApiError(502, "invalid_response");
    const timestamp = Date.parse(value.dateTime);
    if (!Number.isFinite(timestamp)) throw new GoogleCalendarApiError(502, "invalid_response");
    return timestamp;
  }
  // The API also permits a wall time accompanied by an explicit IANA zone.
  if (typeof value.timeZone !== "string" || !value.timeZone) throw new GoogleCalendarApiError(502, "invalid_response");
  try {
    const wall = Date.parse(`${value.dateTime}Z`);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: value.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    let result = wall;
    for (let iteration = 0; iteration < 4; iteration++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(result)).map(part => [part.type, part.value]));
      const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${match[5] || ""}Z`);
      const correction = wall - rendered;
      if (correction === 0) return result;
      result += correction;
    }
  } catch { /* An invalid zone is an invalid upstream response. */ }
  throw new GoogleCalendarApiError(502, "invalid_response");
}

function eventUrl(value: unknown, date: string): string {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (url.origin === "https://calendar.google.com" && !url.username && !url.password) return url.href;
    } catch { /* Use the date view for absent or unsafe links. */ }
  }
  return `https://calendar.google.com/calendar/u/0/r/day/${date.replaceAll("-", "/")}`;
}

function addEvent(rows: Map<string, GoogleSchedule>, calendarId: string, event: JsonObject, ranges: DateRange[]) {
  if (event.status === "cancelled") return;
  if (typeof event.id !== "string" || !event.id) throw new GoogleCalendarApiError(502, "invalid_response");
  const start = object(event.start);
  const end = object(event.end);
  const allDay = start.date !== undefined;
  let first: string;
  let exclusiveEnd: string;
  let startTime = 0;
  if (allDay) {
    if (!isDate(start.date) || !isDate(end.date) || end.date <= start.date) throw new GoogleCalendarApiError(502, "invalid_response");
    first = start.date;
    exclusiveEnd = end.date;
  } else {
    startTime = dateTime(start);
    const endTime = dateTime(end);
    if (endTime < startTime) throw new GoogleCalendarApiError(502, "invalid_response");
    first = seoulDate(startTime);
    // End is exclusive; a zero-duration event still belongs to its start day.
    exclusiveEnd = nextDay(seoulDate(Math.max(startTime, endTime - 1)));
  }
  for (const range of ranges) {
    const clippedStart = first > range.start ? first : range.start;
    const clippedEnd = exclusiveEnd < range.end ? exclusiveEnd : range.end;
    for (let date = clippedStart; date < clippedEnd; date = nextDay(date)) {
      const id = `google:${encodeURIComponent(calendarId)}:${encodeURIComponent(event.id)}:${date}`;
      rows.set(id, {
        id, date,
        title: typeof event.summary === "string" && event.summary.trim() ? event.summary : "제목 없는 일정",
        time: allDay ? null : date === first ? timeFormatter.format(new Date(startTime)) : "계속",
        location: typeof event.location === "string" && event.location ? event.location : null,
        source: "google",
        htmlUrl: eventUrl(event.htmlLink, date),
      });
      if (rows.size > maxItems) throw new GoogleCalendarApiError(413, "limit_exceeded");
    }
  }
}

/** Server use only. Tokens stay in the Authorization header and are never returned. */
export async function fetchGoogleCalendarEvents(accessToken: string, ranges: DateRange[], fetchImpl: typeof fetch = fetch): Promise<GoogleSchedule[]> {
  if (typeof accessToken !== "string" || !accessToken || /\s/.test(accessToken) || accessToken.length > 16_384) throw new GoogleCalendarApiError(401);
  const windows = unionRanges(ranges);
  if (!windows.length) return [];
  let requests = 0;
  let itemCount = 0;

  async function pages(path: string, params: Record<string, string>, receive: (item: JsonObject) => void) {
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= maxPages || ++requests > maxRequests) throw new GoogleCalendarApiError(413, "limit_exceeded");
      const url = new URL(path, apiRoot);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      let response: Response;
      try {
        response = await fetchImpl(url.href, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
      } catch {
        throw new GoogleCalendarApiError(502);
      }
      if (!response.ok) throw new GoogleCalendarApiError(response.status);
      let data: JsonObject;
      try { data = object(await response.json()); }
      catch { throw new GoogleCalendarApiError(502, "invalid_response"); }
      const items = data.items ?? [];
      if (!Array.isArray(items)) throw new GoogleCalendarApiError(502, "invalid_response");
      itemCount += items.length;
      if (itemCount > maxItems) throw new GoogleCalendarApiError(413, "limit_exceeded");
      for (const item of items) receive(object(item));
      if (data.nextPageToken === undefined || data.nextPageToken === "") return;
      if (typeof data.nextPageToken !== "string") throw new GoogleCalendarApiError(502, "invalid_response");
      if (seenTokens.has(data.nextPageToken)) throw new GoogleCalendarApiError(502, "pagination_repeated");
      seenTokens.add(data.nextPageToken);
      pageToken = data.nextPageToken;
    }
  }

  const calendarIds = new Set<string>();
  await pages("users/me/calendarList", {
    maxResults: "250", showHidden: "false", showDeleted: "false",
    fields: "nextPageToken,items(id,selected,primary,hidden,deleted)",
  }, calendar => {
    if (calendar.hidden === true || calendar.deleted === true || (calendar.selected !== true && calendar.primary !== true)) return;
    if (typeof calendar.id !== "string" || !calendar.id) throw new GoogleCalendarApiError(502, "invalid_response");
    calendarIds.add(calendar.id);
  });

  const rows = new Map<string, GoogleSchedule>();
  for (const calendarId of calendarIds) for (const range of windows) {
    await pages(`calendars/${encodeURIComponent(calendarId)}/events`, {
      maxResults: "2500", singleEvents: "true", showDeleted: "false", orderBy: "startTime", timeZone: displayZone,
      timeMin: `${range.start}T00:00:00+09:00`, timeMax: `${range.end}T00:00:00+09:00`,
      fields: "nextPageToken,items(id,status,summary,start,end,location,htmlLink)",
    }, event => addEvent(rows, calendarId, event, windows));
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

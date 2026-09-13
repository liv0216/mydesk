import ICAL from "ical.js";

export type GoogleSchedule = { id: string; date: string; title: string; time: string | null; location: string | null; source: "google"; htmlUrl: string };
export type DateRange = { start: string; end: string };
const dayMs = 86400000;
const displayZone = "Asia/Seoul";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: displayZone, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: displayZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function seoulDate(value: Date) { return formatter.format(value); }
function nextDay(value: string) { return new Date(Date.parse(value + "T00:00:00Z") + dayMs).toISOString().slice(0, 10); }

function timestamp(value: ICAL.Time, floatingZone: string) {
  if (value.zone.tzid !== "floating" && value.zone.tzid !== "local") return value.toJSDate().getTime();
  return wallTimestamp(value, floatingZone);
}

function wallTimestamp(value: ICAL.Time, zone: string) {
  const wall = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let result = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(result)).map(part => [part.type, part.value]));
    result += wall - Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  }
  return result;
}

export function parseGoogleCalendar(text: string, ranges: DateRange[]): GoogleSchedule[] {
  if (!text.trimStart().startsWith("BEGIN:VCALENDAR")) throw new Error("Invalid calendar feed");
  const calendar = new ICAL.Component(ICAL.parse(text));
  for (const zone of calendar.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(zone);
  const floatingZone = String(calendar.getFirstPropertyValue("x-wr-timezone") || displayZone);
  const components = calendar.getAllSubcomponents("vevent");
  // Some exports omit VTIMEZONE for standard IANA names. Supply Intl offsets
  // before ICAL hydrates their date properties, including recurrence dates.
  for (const component of components) for (const property of component.getAllProperties()) {
    const tzid = property.getParameter("tzid");
    if (typeof tzid !== "string" || ICAL.TimezoneService.has(tzid)) continue;
    new Intl.DateTimeFormat("en-US", { timeZone: tzid });
    const zone = new ICAL.Timezone({ tzid });
    zone.utcOffset = value => (Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second) - wallTimestamp(value, tzid)) / 1000;
    ICAL.TimezoneService.register(zone);
  }
  const lastDay = ranges.map(range => range.end).sort().at(-1)!;
  const rows = new Map<string, GoogleSchedule>();
  let iterations = 0;
  function add(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrence: string) {
    if (String(event.component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") return;
    const isDate = start.isDate;
    const startTime = isDate ? 0 : timestamp(start, floatingZone);
    const endTime = isDate ? 0 : timestamp(end, floatingZone);
    const first = isDate ? start.toString().slice(0, 10) : seoulDate(new Date(startTime));
    // DTEND is exclusive, including all-day events and events ending at midnight.
    const rawEnd = isDate ? end.toString().slice(0, 10) : nextDay(seoulDate(new Date(Math.max(startTime, endTime - 1))));
    const exclusiveEnd = rawEnd <= first ? nextDay(first) : rawEnd;
    for (const range of ranges) {
      const clippedStart = first > range.start ? first : range.start;
      const clippedEnd = exclusiveEnd < range.end ? exclusiveEnd : range.end;
      for (let date = clippedStart; date < clippedEnd; date = nextDay(date)) {
        const id = `google:${event.uid}:${recurrence}:${date}`;
        rows.set(id, { id, date, title: String(event.summary || "제목 없는 일정"), time: isDate ? null : date === first ? timeFormatter.format(new Date(startTime)) : "계속", location: event.location ? String(event.location) : null, source: "google", htmlUrl: `https://calendar.google.com/calendar/u/0/r/day/${date.replaceAll("-", "/")}?authuser=liv0216%40gmail.com` });
        if (rows.size > 10000) throw new Error("Calendar range too large");
      }
    }
  }
  const exceptions = components.filter(item => item.hasProperty("recurrence-id"));
  const cancelledUids = new Set(components.filter(item => !item.hasProperty("recurrence-id") && String(item.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED").map(item => item.getFirstPropertyValue("uid")));
  for (const component of components) {
    if (!component.hasProperty("dtstart") || component.hasProperty("recurrence-id")) continue;
    const uid = component.getFirstPropertyValue("uid");
    const event = new ICAL.Event(component, { exceptions: exceptions.filter(item => item.getFirstPropertyValue("uid") === uid), strictExceptions: true });
    if (!event.isRecurring()) { add(event, event.startDate, event.endDate, event.startDate.toString()); continue; }
    if (String(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") continue;
    const iterator = event.iterator();
    const cancelledOccurrences = new Set(exceptions.filter(item => item.getFirstPropertyValue("uid") === uid && String(item.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED").map(item => String(item.getFirstPropertyValue("recurrence-id"))));
    const excludedDates = component.getAllProperties("exdate").flatMap(property => property.getValues()).map(String);
    if (!cancelledOccurrences.has(event.startDate.toString()) && !excludedDates.includes(event.startDate.toString())) {
      const first = event.getOccurrenceDetails(event.startDate);
      add(first.item, first.startDate, first.endDate, event.startDate.toString());
    }
    let count = 0;
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      if (++count > 25000 || ++iterations > 100000) throw new Error("Recurrence expansion limit reached");
      if (occurrence.toString().slice(0, 10) > nextDay(lastDay)) break;
      if (cancelledOccurrences.has(occurrence.toString())) continue;
      const details = event.getOccurrenceDetails(occurrence);
      add(details.item, details.startDate, details.endDate, occurrence.toString());
    }
  }
  // Include edited occurrences moved into this window from outside it.
  for (const component of exceptions) {
    if (!component.hasProperty("dtstart") || cancelledUids.has(component.getFirstPropertyValue("uid"))) continue;
    const event = new ICAL.Event(component, { exceptions: [] });
    add(event, event.startDate, event.endDate, event.recurrenceId.toString());
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.title.localeCompare(b.title));
}

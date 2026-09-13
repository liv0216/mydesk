import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { parseGoogleCalendar, seoulDate } from "@/lib/google-calendar-feed";

export const dynamic = "force-dynamic";
let cache: { url: string; text: string; updatedAt: string } | null = null;
const responseHeaders = { "Cache-Control": "private, no-store" };
async function readFeed(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "calendar.google.com" || !parsed.pathname.startsWith("/calendar/ical/") || !parsed.pathname.endsWith(".ics")) throw new Error("Invalid feed configuration");
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "manual" });
  if (!response.ok || !response.body) throw new Error("Calendar unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error("Calendar feed too large");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  const url = new URL(request.url);
  const localPreview = import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!localPreview && user?.email.toLowerCase() !== "liv0216@gmail.com") return Response.json({ error: "대시보드 소유자로 로그인해 주세요." }, { status: 401, headers: responseHeaders });
  const month = url.searchParams.get("month") || seoulDate(new Date()).slice(0, 7);
  if (!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ error: "올바른 월을 선택해 주세요." }, { status: 400, headers: responseHeaders });
  const calendarUrl = (env as unknown as { GOOGLE_CALENDAR_ICAL_URL?: string }).GOOGLE_CALENDAR_ICAL_URL;
  if (!calendarUrl) return Response.json({ error: "Google 캘린더 연결을 확인해 주세요." }, { status: 503, headers: responseHeaders });
  const [year, monthNumber] = month.split("-").map(Number);
  const start = month + "-01", end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const today = seoulDate(new Date());
  const upcomingEnd = new Date(Date.parse(today + "T00:00:00Z") + 90 * 86400000).toISOString().slice(0, 10);
  const ranges = [{ start, end }, { start: today, end: upcomingEnd }];
  let stale = false;
  try {
    if (!cache || cache.url !== calendarUrl || Date.now() - Date.parse(cache.updatedAt) > 120000 || url.searchParams.get("refresh") === "1") {
      try {
        const text = await readFeed(calendarUrl);
        parseGoogleCalendar(text, ranges);
        cache = { url: calendarUrl, text, updatedAt: new Date().toISOString() };
      } catch {
        if (!cache || cache.url !== calendarUrl) throw new Error("Calendar unavailable");
        stale = true;
      }
    }
    const events = parseGoogleCalendar(cache!.text, ranges);
    return Response.json({ events: events.filter(item => item.date >= start && item.date < end), upcoming: events.filter(item => item.date >= today && item.date < upcomingEnd), updatedAt: cache!.updatedAt, stale }, { headers: responseHeaders });
  } catch {
    // Never log or return the secret feed address or raw calendar contents.
    return Response.json({ error: "Google 일정을 불러오지 못했어요. 잠시 후 새로고침해 주세요." }, { status: 502, headers: responseHeaders });
  }
}

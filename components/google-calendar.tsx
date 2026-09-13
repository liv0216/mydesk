"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { GoogleSchedule } from "@/lib/google-calendar-feed";

type CalendarData = { events: GoogleSchedule[]; upcoming: GoogleSchedule[]; updatedAt: string | null; stale: boolean };
const empty: CalendarData = { events: [], upcoming: [], updatedAt: null, stale: false };
export const googleCalendarUrl = "https://calendar.google.com/calendar/r?authuser=liv0216%40gmail.com";

export function useGoogleCalendar(month: string) {
  const [data, setData] = useState<CalendarData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { setData(current => ({ ...current, events: [] })); }, [month]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/google-calendar?month=${month}${revision ? "&refresh=1" : ""}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Google 일정을 불러오지 못했어요.");
        if (!controller.signal.aborted) { setData(payload); setError(""); }
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Google 연결을 확인해 주세요."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, revision]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRevision(value => value + 1); };
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return { ...data, loading, error, refresh: () => setRevision(value => value + 1) };
}

export function GoogleCalendarStatus({ calendar }: { calendar: ReturnType<typeof useGoogleCalendar> }) {
  return <div className="calendar-connection">
    <div className="calendar-legend" aria-label="일정 출처">
      <span><i className="dot green-dot" />Google</span><span><i className="dot violet-dot" />학사 PDF</span><span><i className="dot blue-dot" />직접 지정</span>
    </div>
    <div className="calendar-sync-row">
      <span role="status">{calendar.loading ? "Google 일정 업데이트 중…" : calendar.error ? "Google 연결 확인 필요" : calendar.stale ? "이전 Google 일정 표시 중" : `Google 연결됨 · ${calendar.updatedAt ? new Date(calendar.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }) : ""}`}</span>
      <button className="icon-button" type="button" disabled={calendar.loading} aria-label="Google 일정 새로고침" title="Google 일정 새로고침" onClick={calendar.refresh}><RefreshCw size={14} className={calendar.loading ? "spin" : ""} /></button>
      <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">Google에서 관리 <ExternalLink size={13} /></a>
    </div>
    {(calendar.error || calendar.stale) && <p className="calendar-sync-error">{calendar.error || "Google 연결이 지연되고 있어요. 잠시 후 새로고침해 주세요."} 저장된 일정은 계속 볼 수 있어요.</p>}
  </div>;
}

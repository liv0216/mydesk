"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Plus, RefreshCw } from "lucide-react";

// The primary calendar ID was verified against the owner's connected Google account.
// Google handles access to private events in its own frame; no event data or tokens
// are copied into this app. Calendar IDs are identifiers, not secret iCal addresses.
const calendarId = "liv0216@gmail.com";
const googleCalendarUrl = `https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(calendarId)}`;
const createEventUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&authuser=${encodeURIComponent(calendarId)}`;

export function GoogleCalendar() {
  const [mode, setMode] = useState<"MONTH" | "AGENDA">("MONTH");
  const [revision, setRevision] = useState(0);
  const [frameState, setFrameState] = useState<"loading" | "loaded" | "slow">("loading");

  useEffect(() => {
    if (frameState !== "loading") return;
    const timer = window.setTimeout(() => setFrameState("slow"), 12000);
    return () => window.clearTimeout(timer);
  }, [frameState, mode, revision]);

  const params = new URLSearchParams({
    src: calendarId, ctz: "Asia/Seoul", hl: "ko", mode,
    showTitle: "0", showPrint: "0", showCalendars: "0", showTz: "0",
    showTabs: "0", showNav: "1", showDate: "1", wkst: "1", bgcolor: "#ffffff",
  });

  return (
    <div className="google-calendar">
      <div className="google-calendar-toolbar">
        <div className="calendar-view-options" role="group" aria-label="Google 캘린더 보기">
          {([ ["MONTH", "월간"], ["AGENDA", "일정 목록"] ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => {
              if (mode !== value) { setFrameState("loading"); setMode(value); }
            }}>{label}</button>
          ))}
        </div>
        <div className="google-calendar-actions">
          <button className="icon-button" type="button" aria-label="Google 캘린더 새로고침" title="Google 캘린더 새로고침" onClick={() => { setFrameState("loading"); setRevision((value) => value + 1); }}><RefreshCw size={16} /></button>
          <a href={createEventUrl} target="_blank" rel="noopener noreferrer" className="google-event-add"><Plus size={15} /> 일정 추가</a>
        </div>
      </div>
      <div className="google-calendar-frame">
        {frameState === "loading" && <div className="google-calendar-loading" role="status"><LoaderCircle size={18} className="spin" /> Google 캘린더를 불러오는 중…</div>}
        <iframe
          key={`${mode}-${revision}`}
          title="내 Google 캘린더"
          src={`https://calendar.google.com/calendar/embed?${params}`}
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setFrameState("loaded")}
          onError={() => setFrameState("slow")}
        />
      </div>
      {frameState === "slow" && <p className="google-calendar-notice" role="status">캘린더를 불러오는 데 시간이 걸리고 있어요. 새로고침하거나 Google에서 열어 주세요.</p>}
      <div className="google-calendar-help">
        <p><strong>{calendarId}</strong> 계정으로 Google에 로그인하면 비공개 일정도 볼 수 있어요. 일정이 보이지 않으면 Google에서 열어 로그인한 뒤 새로고침해 주세요.</p>
        <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">Google에서 열기 <ExternalLink size={14} /></a>
      </div>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { GoogleSchedule } from "@/lib/google-calendar-feed";

type CalendarData = { connected: boolean; events: GoogleSchedule[]; upcoming: GoogleSchedule[]; updatedAt: string | null; stale: boolean };
const empty: CalendarData = { connected: false, events: [], upcoming: [], updatedAt: null, stale: false };
export const googleCalendarUrl = "https://calendar.google.com/calendar/r";

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
  const [open,setOpen]=useState(false);const [url,setUrl]=useState("");const [saving,setSaving]=useState(false);const [message,setMessage]=useState("");
  async function save(event: FormEvent) {event.preventDefault();setSaving(true);setMessage("");try {const response=await fetch('/api/google-calendar',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});const result=await response.json();if(!response.ok)throw new Error(result.error);setUrl("");setOpen(false);calendar.refresh();}catch(error){setMessage(error instanceof Error?error.message:"연결하지 못했어요.");}finally{setSaving(false);}}
  async function disconnect(){setSaving(true);setMessage("");try{const response=await fetch('/api/google-calendar',{method:'DELETE'});if(!response.ok)throw new Error("연결을 해제하지 못했어요.");setOpen(false);calendar.refresh();}catch(error){setMessage(error instanceof Error?error.message:"다시 시도해 주세요.");}finally{setSaving(false);}}
  return <div className="calendar-connection">
    <div className="calendar-legend" aria-label="일정 출처">
      <span><i className="dot green-dot" />Google</span><span><i className="dot violet-dot" />학사 PDF</span><span><i className="dot blue-dot" />직접 지정</span>
    </div>
    <div className="calendar-sync-row">
      <span role="status">{calendar.loading ? "Google 일정 업데이트 중…" : calendar.error ? "Google 연결 확인 필요" : !calendar.connected ? "내 Google 캘린더를 연결해 보세요" : calendar.stale ? "이전 Google 일정 표시 중" : `Google 연결됨 · ${calendar.updatedAt ? new Date(calendar.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }) : ""}`}</span>
      <button className="icon-button" type="button" disabled={calendar.loading} aria-label="Google 일정 새로고침" title="Google 일정 새로고침" onClick={calendar.refresh}><RefreshCw size={14} className={calendar.loading ? "spin" : ""} /></button>
      <button className="calendar-connect-button" onClick={()=>{setUrl("");setMessage("");setOpen(true);}}>{calendar.connected ? "연결 설정" : "Google 연결"}</button>
      <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">Google에서 관리 <ExternalLink size={13} /></a>
    </div>
    {(calendar.error || calendar.stale) && <p className="calendar-sync-error">{calendar.error || "Google 연결이 지연되고 있어요. 잠시 후 새로고침해 주세요."} 저장된 일정은 계속 볼 수 있어요.</p>}
    <Dialog open={open} onOpenChange={value=>{setOpen(value);if(!value)setUrl("");}}><DialogContent className="manager-dialog"><DialogHeader><DialogTitle>내 Google 캘린더 연결</DialogTitle><DialogDescription>Google 캘린더의 설정 → 내 캘린더 선택 → 캘린더 통합에서 iCal 형식의 비공개 주소를 복사해 주세요.</DialogDescription></DialogHeader><form className="manager-form" onSubmit={save}><label>iCal 비공개 주소<input type="password" autoComplete="off" required value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://calendar.google.com/calendar/ical/…" /></label><p className="connection-privacy">주소는 암호화해 저장하며 내 계정에서만 일정을 표시합니다. Google 일정 편집은 Google 캘린더에서 할 수 있어요.</p>{message && <p role="alert" className="auth-error">{message}</p>}<button className="save-button" disabled={saving}>연결하기</button>{calendar.connected && <button className="auth-back" type="button" onClick={()=>void disconnect()} disabled={saving}>Google 연결 해제</button>}</form></DialogContent></Dialog>
  </div>;
}

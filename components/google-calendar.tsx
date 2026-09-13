"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { GoogleSchedule } from "@/lib/google-calendar-feed";

type CalendarData = {
  connected: boolean; connectionType: "oauth" | "ical" | null; accountEmail: string | null;
  oauthAvailable: boolean; needsReconnect: boolean; events: GoogleSchedule[]; upcoming: GoogleSchedule[];
  updatedAt: string | null; stale: boolean;
};
const empty: CalendarData = { connected: false, connectionType: null, accountEmail: null, oauthAvailable: false, needsReconnect: false, events: [], upcoming: [], updatedAt: null, stale: false };
export const googleCalendarUrl = "https://calendar.google.com/calendar/r";

function safeMessage(value: unknown, fallback: string) {
  return typeof value === "string" && value.length <= 300 && /[가-힣]/.test(value) && !/https?:\/\/|Bearer\s|access_token|refresh_token|private-[a-z0-9]{16}/i.test(value) ? value : fallback;
}
async function readReply(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function useGoogleCalendar(month: string) {
  const [data, setData] = useState<CalendarData>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { setData(current => ({ ...current, events: [] })); }, [month]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(`/api/google-calendar?month=${encodeURIComponent(month)}${revision ? "&refresh=1" : ""}`, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const payload = await readReply(response);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401) setData(empty);
          throw new Error(safeMessage(payload.error, "Google 일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
        }
        if (!Array.isArray(payload.events) || !Array.isArray(payload.upcoming)) throw new Error("Google 일정 응답을 확인하지 못했어요. 다시 새로고침해 주세요.");
        setData({
          connected: payload.connected === true,
          connectionType: payload.connectionType === "oauth" || payload.connectionType === "ical" ? payload.connectionType : null,
          accountEmail: typeof payload.accountEmail === "string" ? payload.accountEmail : null,
          oauthAvailable: payload.oauthAvailable === true, needsReconnect: payload.needsReconnect === true,
          events: payload.events as GoogleSchedule[], upcoming: payload.upcoming as GoogleSchedule[],
          updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null, stale: payload.stale === true,
        });
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        // Clear Google rows on failure, including rows from a previously viewed month.
        setData(current => ({ ...current, events: [], upcoming: [], stale: false }));
        setError(safeMessage(reason instanceof Error ? reason.message : null, "Google 연결을 확인해 주세요."));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, revision]);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(refreshVisible, 5 * 60 * 1000);
    window.addEventListener("focus", refreshVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); };
  }, [refresh]);
  return { ...data, loading, error, refresh };
}

type Notice = { text: string; error: boolean };
const callbackNotices: Record<string, Notice> = {
  connected: { text: "Google 계정을 연결했어요. 이제 일정이 자동으로 표시돼요.", error: false },
  cancelled: { text: "Google 계정 연결을 취소했어요. 원할 때 다시 연결할 수 있어요.", error: false },
  permissions: { text: "Google 캘린더 읽기 권한이 필요해요. 다시 연결한 뒤 요청된 캘린더 권한을 허용해 주세요.", error: true },
  expired: { text: "Google 연결 시간이 만료되었어요. 연결 버튼을 눌러 다시 시작해 주세요.", error: true },
  error: { text: "Google 계정을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", error: true },
};

export function GoogleCalendarStatus({ calendar }: { calendar: ReturnType<typeof useGoogleCalendar> }) {
  const [open, setOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [busy, setBusy] = useState<"connect" | "save" | "disconnect" | null>(null);
  const actionInProgress = useRef(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [welcome, setWelcome] = useState(false);
  const { refresh } = calendar;
  useEffect(() => {
    const current = new URL(window.location.href);
    const result = current.searchParams.get("google");
    if (result && Object.hasOwn(callbackNotices, result)) {
      setNotice(callbackNotices[result]);
      if (result === "connected") refresh();
    }
    if (current.searchParams.get("welcome") === "1") setWelcome(true);
    if (current.searchParams.has("google") || current.searchParams.has("welcome")) {
      current.searchParams.delete("google"); current.searchParams.delete("welcome");
      window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
    }
  }, [refresh]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      actionInProgress.current = false;
      setBusy(null);
      refresh();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [refresh]);
  function startAction(action: NonNullable<typeof busy>) {
    if (actionInProgress.current) return false;
    actionInProgress.current = true;
    setBusy(action); setMessage(""); setNotice(null);
    return true;
  }
  function finishAction() { actionInProgress.current = false; setBusy(null); }
  async function connect() {
    if (calendar.loading || actionInProgress.current) return;
    if (!calendar.oauthAvailable) { setMessage("Google 계정 연결을 준비 중이에요. 설정이 완료되면 연결할 수 있어요."); return; }
    if (!startAction("connect")) return;
    let redirecting = false;
    try {
      const response = await fetch("/api/google-calendar/connect", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const result = await readReply(response);
      if (!response.ok) throw new Error(safeMessage(result.error, "Google 연결을 시작하지 못했어요. 잠시 후 다시 시도해 주세요."));
      if (typeof result.url !== "string") throw new Error("Google 연결 화면을 열지 못했어요. 다시 시도해 주세요.");
      const destination = new URL(result.url);
      if (destination.origin !== "https://accounts.google.com" || destination.pathname !== "/o/oauth2/v2/auth" || destination.username || destination.password) throw new Error("Google 연결 주소를 확인하지 못했어요. 다시 시도해 주세요.");
      window.location.assign(destination.href);
      redirecting = true;
    } catch (reason) {
      setMessage(safeMessage(reason instanceof Error ? reason.message : null, "Google 연결을 시작하지 못했어요. 다시 시도해 주세요."));
    } finally { if (!redirecting) finishAction(); }
  }
  async function saveFeed(event: FormEvent) {
    event.preventDefault();
    if (calendar.connectionType === "oauth" || !startAction("save")) return;
    try {
      const response = await fetch("/api/google-calendar", { method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: feedUrl.trim() }) });
      const result = await readReply(response);
      if (!response.ok || result.connected !== true) throw new Error(safeMessage(result.error, "iCal 주소로 연결하지 못했어요. 주소를 확인해 주세요."));
      setFeedUrl(""); setOpen(false);
      setNotice({ text: "iCal 주소를 연결했어요. 일정을 불러오고 있어요.", error: false });
      refresh();
    } catch (reason) { setMessage(safeMessage(reason instanceof Error ? reason.message : null, "iCal 주소로 연결하지 못했어요. 다시 시도해 주세요.")); }
    finally { finishAction(); }
  }
  async function disconnect() {
    if (!startAction("disconnect")) return;
    try {
      const response = await fetch("/api/google-calendar", { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      const result = await readReply(response);
      if (!response.ok || result.connected !== false) throw new Error(safeMessage(result.error, "연결 상태를 확인한 뒤 다시 시도해 주세요."));
      setFeedUrl(""); setOpen(false);
      setNotice({ text: "Google 연결을 해제했어요.", error: false });
      refresh();
    } catch (reason) {
      setMessage(`Google 연결을 해제하지 못했어요. ${safeMessage(reason instanceof Error ? reason.message : null, "잠시 후 다시 시도해 주세요.")}`);
      refresh();
    } finally { finishAction(); }
  }
  function showSettings() { setFeedUrl(""); setMessage(""); setOpen(true); }
  const unavailable = !calendar.loading && !calendar.error && !calendar.oauthAvailable;
  const connectDisabled = Boolean(busy) || calendar.loading || !calendar.oauthAvailable;
  const updateTime = calendar.updatedAt && Number.isFinite(Date.parse(calendar.updatedAt)) ? new Date(calendar.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }) : "";
  const connectionLabel = calendar.loading ? "Google 일정 업데이트 중…"
    : calendar.needsReconnect ? "Google 계정을 다시 연결해 주세요"
    : calendar.error ? "Google 연결 확인 필요"
    : !calendar.connected ? "내 Google 캘린더를 연결해 보세요"
    : calendar.stale ? "이전 Google 일정 표시 중"
    : `${calendar.accountEmail || (calendar.connectionType === "ical" ? "iCal 연결됨" : "Google 연결됨")} · 자동 동기화${updateTime ? ` · ${updateTime}` : ""}`;
  return <div className="calendar-connection">
    <div className="calendar-legend" aria-label="일정 출처">
      <span><i className="dot green-dot" />Google</span><span><i className="dot violet-dot" />학사 PDF</span><span><i className="dot blue-dot" />직접 지정</span>
    </div>
    {welcome && !calendar.loading && !calendar.connected && <p className="connection-privacy calendar-welcome">Google 계정을 한 번 연결하면 다음 로그인부터 일정이 자동으로 표시돼요. 원할 때 연결할 수 있어요.</p>}
    <div className="calendar-sync-row">
      <span role="status">{connectionLabel}</span>
      {(calendar.connected || calendar.error) && <button className="icon-button" type="button" disabled={calendar.loading || Boolean(busy)} aria-label="Google 일정 새로고침" title="Google 일정 새로고침" onClick={refresh}><RefreshCw size={14} className={calendar.loading ? "spin" : ""} /></button>}
      {(!calendar.connected || calendar.needsReconnect) && <button className="calendar-connect-button" type="button" onClick={() => void connect()} disabled={connectDisabled}>{busy === "connect" ? "Google로 이동 중…" : calendar.needsReconnect ? "Google 계정 다시 연결" : "Google 계정 연결"}</button>}
      <button className="calendar-connect-button" type="button" onClick={showSettings} disabled={Boolean(busy)}>{calendar.connected ? "연결 설정" : "고급 설정"}</button>
      <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">Google에서 관리 <ExternalLink size={13} /></a>
    </div>
    {unavailable && <p className="connection-privacy">Google 계정 연결을 준비 중이에요. 설정이 완료되면 연결할 수 있어요.</p>}
    {notice && <p role={notice.error ? "alert" : "status"} className={notice.error ? "calendar-sync-error" : "connection-privacy calendar-notice"}>{notice.text}</p>}
    {!open && message && <p role="alert" className="calendar-sync-error">{message}</p>}
    {(calendar.error || calendar.stale) && <p role="alert" className="calendar-sync-error">{calendar.error || "Google 연결이 지연되고 있어요. 잠시 후 새로고침해 주세요."} 저장된 학사 일정과 직접 지정한 일정은 계속 볼 수 있어요.</p>}
    <Dialog open={open} onOpenChange={value => { if (!actionInProgress.current) { setOpen(value); setMessage(""); if (!value) setFeedUrl(""); } }}>
      <DialogContent className="manager-dialog">
        <DialogHeader><DialogTitle>{calendar.connected ? "Google 캘린더 연결 설정" : "캘린더 연결 설정"}</DialogTitle><DialogDescription>Google 계정을 연결하면 일정을 자동으로 가져옵니다. 일정 편집은 Google 캘린더에서 할 수 있어요.</DialogDescription></DialogHeader>
        <div className="manager-form">
          {calendar.connected && <p className="connection-privacy"><strong>{calendar.accountEmail || "내 Google 캘린더"}</strong><br />{calendar.connectionType === "ical" ? "iCal 비공개 주소로 연결되어 있어요." : "로그인할 때 자동으로 동기화하며, 화면을 켜 두면 5분마다 업데이트해요."}</p>}
          {calendar.needsReconnect && <p className="calendar-sync-error">연결 권한이 만료되었어요. 사용하던 Google 계정을 다시 선택해 주세요.</p>}
          {unavailable && <p className="connection-privacy">Google 계정 연결을 준비 중이에요. 설정이 완료되면 연결할 수 있어요.</p>}
          <button className="save-button" type="button" onClick={() => void connect()} disabled={connectDisabled}>{busy === "connect" ? "Google로 이동 중…" : calendar.connectionType === "oauth" || calendar.needsReconnect ? "Google 계정 다시 연결" : "Google 계정 연결"}</button>
          {calendar.connectionType === "oauth" && <button className="auth-back" type="button" onClick={() => void connect()} disabled={connectDisabled}>Google 계정 변경</button>}
          {calendar.connected && <button className="auth-back" type="button" onClick={() => void disconnect()} disabled={Boolean(busy)}>{busy === "disconnect" ? "연결 해제 중…" : "Google 연결 해제"}</button>}
          <details className="calendar-advanced-settings">
            <summary>고급 설정 · iCal 주소로 연결</summary>
            <form className="manager-form" onSubmit={saveFeed}>
              <p className="connection-privacy">Google 캘린더 설정 → 내 캘린더 선택 → 캘린더 통합에서 iCal 형식의 비공개 주소를 복사해 주세요.</p>
              {calendar.connectionType === "oauth" && <p className="connection-privacy">iCal 주소를 사용하려면 먼저 위에서 Google 계정 연결을 해제해 주세요.</p>}
              <label>iCal 비공개 주소<input type="password" name="google-calendar-ical" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={2000} value={feedUrl} onChange={event => setFeedUrl(event.target.value)} disabled={Boolean(busy) || calendar.connectionType === "oauth"} placeholder="https://calendar.google.com/calendar/ical/…" /></label>
              <p className="connection-privacy">주소는 암호화해 저장하며 내 계정에서만 일정을 표시합니다.</p>
              <button className="save-button" type="submit" disabled={Boolean(busy) || calendar.connectionType === "oauth"}>{busy === "save" ? "주소 확인 중…" : "iCal 주소로 연결"}</button>
            </form>
          </details>
          {message && <p role="alert" className="auth-error">{message}</p>}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}

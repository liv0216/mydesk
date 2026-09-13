"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  ExternalLink,
  FileUp,
  GraduationCap,
  LayoutGrid,
  Link2,
  ListChecks,
  LoaderCircle,
  Maximize2,
  Move,
  Plus,
  RotateCcw,
  Settings2,
  TimerReset,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { GoogleCalendarStatus, useGoogleCalendar } from "@/components/google-calendar";
import { extractAcademicEvents, extractTimetableEntries } from "@/lib/pdf-import";

type Task = { id: number; text: string; tag: string; done: number | boolean };
type Shortcut = { id: number; label: string; url: string; color: string };
type Schedule = { id: number | string; date: string; title: string; time: string | null; location: string | null; source: string; htmlUrl?: string };
type TimetableEntry = { id: number; day: number; period: number; subject: string; location: string | null };
type AcademicImport = { id: number; fileName: string; kind: "calendar" | "timetable"; detectedCount: number; createdAt: number };
type ClassStatus = { total: number; attendance: number; absence: number; earlyDismissal: number; tardy: number };
type DashboardData = { tasks: Task[]; shortcuts: Shortcut[]; schedules: Schedule[]; timetable: TimetableEntry[]; imports: AcademicImport[]; classStatus: ClassStatus };
type AddMode = "schedule" | "timetable" | "shortcut" | null;

const emptyClassStatus: ClassStatus = { total: 0, attendance: 0, absence: 0, earlyDismissal: 0, tardy: 0 };
const emptyData: DashboardData = { tasks: [], shortcuts: [], schedules: [], timetable: [], imports: [], classStatus: emptyClassStatus };
const week = ["일", "월", "화", "수", "목", "금", "토"];
const schoolDays = ["월", "화", "수", "목", "금"];
const colorOptions = ["blue", "green", "red", "violet", "orange", "ink"];
const layoutStorageKey = "my-desk-widget-layout-v2";
const legacyLayoutStorageKey = "my-desk-widget-offsets-v1";

type WidgetLayout = { x: number; y: number; width?: number; height?: number; manualSize?: boolean };
type LayoutContextValue = {
  editing: boolean;
  layouts: Record<string, WidgetLayout>;
  draggingId: string | null;
  updateWidget: (id: string, patch: Partial<WidgetLayout>) => void;
  setDraggingId: (id: string | null) => void;
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

const widgetNames = [
  ["clock", "디지털 시계"], ["weather", "날씨"], ["shortcuts", "바로가기"],
  ["calendar", "통합 캘린더"], ["stats", "학급 현황"], ["timetable", "시간표"],
  ["tasks", "할 일"], ["schedule", "다음 일정"],
] as const;

function Widget({ id, title, icon, hidden, className = "", action, children }: {
  id: string;
  title: string;
  icon: ReactNode;
  hidden: Record<string, boolean>;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const layout = useContext(LayoutContext);
  const sectionRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number; left: number; width: number } | null>(null);
  const resizeStart = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const itemLayout = layout?.layouts[id] ?? { x: 0, y: 0 };
  const positioned = itemLayout.x !== 0 || itemLayout.y !== 0;

  const startDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layout?.editing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = sectionRef.current?.getBoundingClientRect();
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, offsetX: itemLayout.x, offsetY: itemLayout.y, left: rect?.left ?? 0, width: rect?.width ?? 0 };
    layout.setDraggingId(id);
  };

  const moveDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layout?.editing || !dragStart.current) return;
    const rawDeltaX = event.clientX - dragStart.current.pointerX;
    const minDeltaX = 14 - dragStart.current.left;
    const maxDeltaX = window.innerWidth - 14 - dragStart.current.width - dragStart.current.left;
    const deltaX = Math.max(minDeltaX, Math.min(maxDeltaX, rawDeltaX));
    layout.updateWidget(id, {
      x: Math.round(dragStart.current.offsetX + deltaX),
      y: Math.round(Math.max(-700, Math.min(700, dragStart.current.offsetY + event.clientY - dragStart.current.pointerY))),
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (layout && !itemLayout.manualSize && sectionRef.current) {
      const rect = sectionRef.current.getBoundingClientRect();
      const columns = Array.from(document.querySelectorAll<HTMLElement>(".dashboard-grid > .column"));
      const target = columns.reduce<HTMLElement | null>((closest, column) => {
        if (!closest) return column;
        const center = rect.left + rect.width / 2;
        const distance = Math.abs(column.getBoundingClientRect().left + column.getBoundingClientRect().width / 2 - center);
        const closestDistance = Math.abs(closest.getBoundingClientRect().left + closest.getBoundingClientRect().width / 2 - center);
        return distance < closestDistance ? column : closest;
      }, null);
      if (target) {
        const targetRect = target.getBoundingClientRect();
        layout.updateWidget(id, { x: Math.round(itemLayout.x + targetRect.left - rect.left), width: Math.round(targetRect.width) });
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    layout?.setDraggingId(null);
  };

  const nudgeWidget = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!layout?.editing || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 12;
    layout.updateWidget(id, {
      x: itemLayout.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
      y: itemLayout.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
    });
  };

  const startResizing = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layout?.editing || !sectionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = sectionRef.current.getBoundingClientRect();
    resizeStart.current = { pointerX: event.clientX, pointerY: event.clientY, width: rect.width, height: rect.height };
    layout.setDraggingId(id);
  };

  const moveResizing = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!layout?.editing || !resizeStart.current) return;
    const minimumWidth = Math.min(id === "calendar" || id === "timetable" ? 360 : 210, window.innerWidth - 28);
    layout.updateWidget(id, {
      width: Math.round(Math.max(minimumWidth, Math.min(window.innerWidth - 28, resizeStart.current.width + event.clientX - resizeStart.current.pointerX))),
      height: Math.round(Math.max(140, Math.min(1000, resizeStart.current.height + event.clientY - resizeStart.current.pointerY))),
      manualSize: true,
    });
  };

  const stopResizing = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    layout?.setDraggingId(null);
  };

  const restoreAutomaticSize = () => layout?.updateWidget(id, { width: undefined, height: undefined, manualSize: false });

  if (hidden[id]) return null;
  return (
    <section
      ref={sectionRef}
      className={`widget ${className} ${layout?.editing ? "layout-editing" : ""} ${layout?.draggingId === id ? "dragging" : ""} ${positioned ? "positioned" : ""} ${itemLayout.manualSize ? "manually-sized" : ""}`}
      aria-labelledby={`${id}-title`}
      style={{ transform: `translate3d(${itemLayout.x}px, ${itemLayout.y}px, 0)`, width: itemLayout.width, height: itemLayout.height, zIndex: layout?.draggingId === id ? 30 : undefined }}
    >
      <header className="widget-header">
        <div className="widget-title"><span className="widget-icon">{icon}</span><h2 id={`${id}-title`}>{title}</h2></div>
        <div className="widget-controls">
          {action}
          <button
            className="icon-button drag-handle"
            aria-label={`${title} 위치 이동`}
            title={layout?.editing ? "드래그하거나 방향키로 이동" : "위치 조정 모드에서 이동할 수 있어요"}
            disabled={!layout?.editing}
            onPointerDown={startDragging}
            onPointerMove={moveDragging}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onKeyDown={nudgeWidget}
          ><Move size={16} /></button>
        </div>
      </header>
      <div className="widget-body">{children}</div>
      <button
        className="resize-handle"
        aria-label={`${title} 크기 조정`}
        title="드래그로 크기 조정 · 내용이 넘치면 내부 스크롤 · 두 번 누르면 자동 크기"
        tabIndex={layout?.editing ? 0 : -1}
        onPointerDown={startResizing}
        onPointerMove={moveResizing}
        onPointerUp={stopResizing}
        onPointerCancel={stopResizing}
        onDoubleClick={restoreAutomaticSize}
      ><Maximize2 size={13} /></button>
    </section>
  );
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "요청을 처리하지 못했어요.");
  return payload;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [calendarView, setCalendarView] = useState<"month" | "list">("month");
  const googleCalendar = useGoogleCalendar(dateKey(viewDate).slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [presetCell, setPresetCell] = useState<{ day: number; period: number } | null>(null);
  const [newTask, setNewTask] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [statusDraft, setStatusDraft] = useState<ClassStatus>(emptyClassStatus);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [widgetLayouts, setWidgetLayouts] = useState<Record<string, WidgetLayout>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const calendarFileInput = useRef<HTMLInputElement>(null);
  const timetableFileInput = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      const payload = await requestJson("/api/dashboard");
      setData(payload);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "데이터를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 1000);
    void loadData();
    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    setStatusDraft(data.classStatus);
  }, [data.classStatus]);

  useEffect(() => {
    let restored: Record<string, WidgetLayout> = {};
    try {
      const stored = window.localStorage.getItem(layoutStorageKey) ?? window.localStorage.getItem(legacyLayoutStorageKey);
      if (stored) restored = JSON.parse(stored);
    } catch {
      // A blocked local store should not prevent dashboard use.
    }
    const restoreTimer = window.setTimeout(() => {
      setWidgetLayouts(restored);
      setLayoutReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!layoutReady) return;
    try {
      window.localStorage.setItem(layoutStorageKey, JSON.stringify(widgetLayouts));
    } catch {
      // Keep the in-memory layout when local storage is unavailable.
    }
  }, [layoutReady, widgetLayouts]);

  const updateWidget = useCallback((id: string, patch: Partial<WidgetLayout>) => {
    setWidgetLayouts((current) => ({ ...current, [id]: { x: current[id]?.x ?? 0, y: current[id]?.y ?? 0, ...current[id], ...patch } }));
  }, []);

  const restoreAutomaticSizes = () => setWidgetLayouts((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => [id, { x: item.x, y: item.y }])));

  const finishLayoutEditing = () => {
    setDraggingId(null);
    setLayoutEditing(false);
  };

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    return {
      year,
      month,
      days: [...Array(new Date(year, month, 1).getDay()).fill(null), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1)],
    };
  }, [viewDate]);

  const sortSchedules = (a: Schedule, b: Schedule) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "") || a.title.localeCompare(b.title);
  const combinedSchedules: Schedule[] = [...data.schedules, ...googleCalendar.events].sort(sortSchedules);
  const selectedEvents = combinedSchedules.filter((event) => event.date === selectedDate);
  const monthEvents = combinedSchedules.filter((event) => event.date.startsWith(dateKey(viewDate).slice(0, 7)));
  const upcoming: Schedule[] = [...data.schedules.filter((event) => event.date >= dateKey(new Date())), ...googleCalendar.upcoming].sort(sortSchedules).slice(0, 4);
  const sourceColor = (item: Schedule) => item.source === "google" ? "green" : item.source === "pdf" ? "violet" : "blue";
  const sourceLabel = (item: Schedule) => item.source === "google" ? "Google" : item.source === "pdf" ? "학사 PDF" : "직접 지정";

  const mutate = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      await requestJson(url, init);
      await loadData();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const postResource = (payload: Record<string, unknown>) => mutate("/api/dashboard", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });

  const deleteResource = (resource: string, id: number | string) => mutate(`/api/dashboard?resource=${resource}&id=${id}`, { method: "DELETE" });

  const scheduleAction = (item: Schedule) => item.source === "google"
    ? <a className="schedule-open" href={item.htmlUrl} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} Google에서 관리`}><ExternalLink size={14} /></a>
    : <button className="inline-delete" onClick={() => void deleteResource("schedule", item.id)} aria-label={`${item.title} 삭제`}><Trash2 size={13} /></button>;

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!newTask.trim()) return;
    if (await postResource({ resource: "task", text: newTask, tag: "할 일" })) setNewTask("");
  };

  const toggleTask = async (task: Task) => {
    await mutate("/api/dashboard", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "task", id: task.id, done: !Boolean(task.done) }),
    });
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let payload: Record<string, unknown>;
    if (addMode === "schedule") {
      payload = { resource: "schedule", date: form.get("date"), title: form.get("title"), time: form.get("time"), location: form.get("location") };
    } else if (addMode === "timetable") {
      payload = { resource: "timetable", day: Number(form.get("day")), period: Number(form.get("period")), subject: form.get("subject"), location: form.get("location") };
    } else if (addMode === "shortcut") {
      payload = { resource: "shortcut", label: form.get("label"), url: form.get("url"), color: form.get("color") };
    } else return;
    if (await postResource(payload)) {
      setAddMode(null);
      setPresetCell(null);
    }
  };

  const importPdf = async (event: React.ChangeEvent<HTMLInputElement>, kind: "calendar" | "timetable") => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setImportStatus(kind === "calendar" ? "PDF 전체 페이지에서 한 해의 일정을 읽는 중…" : "PDF 시간표의 요일과 교시를 읽는 중…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      if (kind === "calendar") {
        const events = await extractAcademicEvents(file);
        if (!events.length) throw new Error("일정을 찾지 못했어요. 스캔 이미지 PDF는 OCR 후 다시 시도하거나 일정을 직접 추가해 주세요.");
        setImportStatus(`${events.length}개 일정을 캘린더에 저장하는 중…`);
        form.append("events", JSON.stringify(events));
        const first = new Date(`${events[0].date}T00:00:00`);
        setViewDate(first);
        setSelectedDate(events[0].date);
      } else {
        const entries = await extractTimetableEntries(file);
        if (!entries.length) throw new Error("시간표 표를 찾지 못했어요. 요일과 교시가 텍스트로 포함된 PDF인지 확인해 주세요.");
        setImportStatus(`${entries.length}개 수업을 시간표에 반영하는 중…`);
        form.append("entries", JSON.stringify(entries));
      }
      const result = await requestJson("/api/import", { method: "POST", body: form });
      await loadData();
      setImportStatus(kind === "calendar" ? `${result.startDate} ~ ${result.endDate} · 학사 일정 ${result.imported}개를 가져왔어요.` : `${file.name}에서 ${result.imported}개 수업을 가져왔어요.`);
    } catch (reason) {
      setImportStatus("");
      setError(reason instanceof Error ? reason.message : "PDF를 가져오지 못했어요.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const saveClassStatus = async (event: FormEvent) => {
    event.preventDefault();
    if (await postResource({ resource: "class_status", ...statusDraft })) {
      setImportStatus("학급 현황을 저장했어요.");
    }
  };

  const openTimetable = (day?: number, period?: number) => {
    setPresetCell(day !== undefined && period !== undefined ? { day, period } : null);
    setAddMode("timetable");
  };

  const timeText = now ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now) : "--:--";
  const secondText = now ? String(now.getSeconds()).padStart(2, "0") : "--";
  const dateText = now ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(now) : "오늘";

  return (
    <LayoutContext.Provider value={{ editing: layoutEditing, layouts: widgetLayouts, draggingId, updateWidget, setDraggingId }}>
    <main className="dashboard-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <nav className="topbar" aria-label="대시보드 도구">
        <div className="brand-lockup"><span className="brand-mark"><LayoutGrid size={17} /></span><span className="brand-name">MY DESK</span><span className="today-label"><b>TODAY</b>{dateText}</span></div>
        <div className="nav-actions">
          <button className={`settings-button ${layoutEditing ? "active" : ""}`} onClick={() => layoutEditing ? finishLayoutEditing() : setLayoutEditing(true)} aria-pressed={layoutEditing}><Move size={17} /> {layoutEditing ? "배치 완료" : "배치 조정"}</button>
          <button className={`settings-button ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}><Settings2 size={17} /> 위젯 설정</button>
        </div>
      </nav>

      {error && <div className="status-banner error"><X size={16} /><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}
      {importStatus && <div className="status-banner success"><FileUp size={16} /><span>{importStatus}</span><button onClick={() => setImportStatus("")}>닫기</button></div>}
      {layoutEditing && <div className="layout-toolbar"><div><Move size={17} /><span><strong>위젯 배치 조정 중</strong> 오른쪽 아래 핸들로 크기를 정하세요. 내용이 위젯보다 많아지면 카드 안에서 스크롤할 수 있습니다.</span></div><div className="layout-toolbar-actions"><button onClick={restoreAutomaticSizes}><Maximize2 size={14} /> 크기 자동</button><button onClick={() => setWidgetLayouts({})}><RotateCcw size={14} /> 기본 위치</button><button className="done" onClick={finishLayoutEditing}><Check size={14} /> 완료</button></div></div>}

      {settingsOpen && (
        <aside className="settings-panel" aria-label="위젯 표시 설정">
          <div><p className="eyebrow">WIDGET DISPLAY</p><h2>필요한 카드만 꺼내두세요</h2></div>
          <div className="settings-grid">{widgetNames.map(([id, label]) => <label key={id} className="setting-item"><span><i className={!hidden[id] ? "on" : ""} />{label}</span><Switch checked={!hidden[id]} onCheckedChange={(checked) => setHidden((current) => ({ ...current, [id]: !checked }))} aria-label={`${label} 표시`} /></label>)}</div>
        </aside>
      )}

      <div className="dashboard-grid">
        <div className="column left-column">
          <Widget id="clock" title="디지털 시계" icon={<TimerReset size={16} />} hidden={hidden} className="clock-widget">
            <div className="clock-face"><span>{timeText}</span><small>{secondText}</small></div><div className="clock-meta"><span>서울</span><span>MY DESK</span></div>
          </Widget>

          <Widget id="weather" title="오늘의 날씨" icon={<CloudSun size={16} />} hidden={hidden}>
            <div className="weather-main"><div className="sun-symbol">☀</div><div><strong>28°</strong><span>맑음 · 서울</span></div></div>
            <div className="weather-details"><span><small>최고 / 최저</small>30° / 22°</span><span><small>미세먼지</small><b className="good">좋음</b></span><span><small>강수</small>10%</span></div>
          </Widget>

          <Widget id="shortcuts" title="바로가기" icon={<Link2 size={16} />} hidden={hidden} action={<button className="widget-add" onClick={() => setAddMode("shortcut")}><Plus size={14} /> 추가</button>}>
            {loading ? <div className="mini-loading"><LoaderCircle size={16} /> 불러오는 중</div> : data.shortcuts.length ? (
              <div className="shortcut-grid managed-shortcuts">{data.shortcuts.map((item) => <div className="shortcut-wrap" key={item.id}><a href={item.url} target="_blank" rel="noreferrer" className="shortcut"><span className={`shortcut-icon ${item.color}`}>{item.label.slice(0, 1).toUpperCase()}</span><small>{item.label}</small></a><button className="delete-float" onClick={() => void deleteResource("shortcut", item.id)} aria-label={`${item.label} 삭제`}><X size={11} /></button></div>)}</div>
            ) : <button className="empty-card" onClick={() => setAddMode("shortcut")}><Plus size={18} /><span>첫 바로가기를 추가하세요</span></button>}
          </Widget>

          <Widget id="stats" title="학급 현황" icon={<GraduationCap size={16} />} hidden={hidden}>
            <form className="attendance-form" onSubmit={saveClassStatus}>
              {([
                ["total", "전체"], ["attendance", "출석"], ["absence", "결석"],
                ["earlyDismissal", "조퇴"], ["tardy", "지각"],
              ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="999" value={statusDraft[key]} onChange={(event) => setStatusDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
              <button type="submit" disabled={busy}><Check size={13} /> 저장</button>
            </form>
            <div className="attendance-summary"><span>출석률</span><strong>{statusDraft.total ? Math.round(statusDraft.attendance / statusDraft.total * 100) : 0}%</strong><i><b style={{ width: `${statusDraft.total ? Math.min(100, statusDraft.attendance / statusDraft.total * 100) : 0}%` }} /></i></div>
          </Widget>
        </div>

        <div className="column center-column">
          <Widget id="calendar" title="통합 캘린더" icon={<CalendarDays size={16} />} hidden={hidden} className="calendar-widget unified-calendar-widget">
            <GoogleCalendarStatus calendar={googleCalendar} />
            <div className="unified-calendar-actions">
              <div className="calendar-view-options" role="group" aria-label="캘린더 보기">
                <button type="button" aria-pressed={calendarView === "month"} onClick={() => setCalendarView("month")}>월간</button>
                <button type="button" aria-pressed={calendarView === "list"} onClick={() => setCalendarView("list")}>일정 목록</button>
              </div>
              <div className="header-actions"><input ref={calendarFileInput} className="sr-only" type="file" accept="application/pdf" onChange={(event) => void importPdf(event, "calendar")} /><button className="widget-add secondary" disabled={busy} onClick={() => calendarFileInput.current?.click()}><FileUp size={14} /> 학사력 PDF</button><button className="widget-add" onClick={() => setAddMode("schedule")}><Plus size={14} /> 일정 지정</button></div>
            </div>
            <div className="calendar-toolbar">
              <div className="calendar-month-navigation"><button className="icon-button" onClick={() => { const date = new Date(calendarDays.year, calendarDays.month - 1, 1); setViewDate(date); setSelectedDate(dateKey(date)); }} aria-label="이전 달"><ChevronLeft size={17} /></button><strong>{calendarDays.year}년 {calendarDays.month + 1}월</strong><button className="icon-button" onClick={() => { const date = new Date(calendarDays.year, calendarDays.month + 1, 1); setViewDate(date); setSelectedDate(dateKey(date)); }} aria-label="다음 달"><ChevronRight size={17} /></button></div>
              <button className="calendar-today" onClick={() => { const date = new Date(); setViewDate(date); setSelectedDate(dateKey(date)); }}>오늘</button>
            </div>
            {calendarView === "month" ? <>
              <div className="calendar-grid week-row">{week.map((day) => <span key={day}>{day}</span>)}</div>
              <div className="calendar-grid dates">{calendarDays.days.map((day, index) => {
                if (!day) return <span key={"empty-" + index} />;
                const key = dateKey(new Date(calendarDays.year, calendarDays.month, day));
                const events = combinedSchedules.filter((item) => item.date === key);
                const isToday = key === dateKey(new Date());
                return <button key={key} aria-label={key + ", 일정 " + events.length + "개"} aria-pressed={selectedDate === key} className={(isToday ? "today " : "") + (selectedDate === key ? "selected" : "")} onClick={() => setSelectedDate(key)}><span className="date-number">{day}</span><span className="cell-events">{events.map((item) => <em className={item.source} title={sourceLabel(item) + " · " + item.title} key={item.id}>{item.title}</em>)}</span></button>;
              })}</div>
              <div className="selected-day-panel">
                <div><strong>{selectedDate.replaceAll("-", ".")}</strong><button onClick={() => setAddMode("schedule")}><Plus size={13} /> 일정 지정</button></div>
                {selectedEvents.length ? selectedEvents.map((item) => <article key={item.id}><i className={"dot " + sourceColor(item) + "-dot"} /><p><strong>{item.title}</strong><small>{[item.time || "종일", sourceLabel(item), item.location].filter(Boolean).join(" · ")}</small></p>{scheduleAction(item)}</article>) : <p className="empty-line">선택한 날짜에 일정이 없어요.</p>}
              </div>
            </> : <div className="calendar-agenda">
              {monthEvents.length ? monthEvents.map(item => <article key={item.id}><time dateTime={item.date}>{Number(item.date.slice(8))}<small>{week[new Date(item.date + "T00:00:00").getDay()]}</small></time><i className={"schedule-line " + sourceColor(item)} /><div><strong>{item.title}</strong><small>{[item.time || "종일", sourceLabel(item), item.location].filter(Boolean).join(" · ")}</small></div>{scheduleAction(item)}</article>) : <p className="empty-line">이번 달에 등록된 일정이 없어요.</p>}
            </div>}
            <p className="calendar-footnote">학사력 PDF의 전체 페이지를 읽습니다. 같은 파일명으로 다시 넣으면 해당 PDF 일정이 갱신됩니다. Google 일정은 5분마다 확인합니다. 시간은 서울 기준입니다.{data.imports.find((item) => item.kind === "calendar") ? " · 최근 학사 PDF: " + data.imports.find((item) => item.kind === "calendar")?.fileName : ""}</p>
          </Widget>

          <Widget id="timetable" title="주간 시간표" icon={<BookOpen size={16} />} hidden={hidden} className="timetable-widget" action={<div className="header-actions"><input ref={timetableFileInput} className="sr-only" type="file" accept="application/pdf" onChange={(event) => void importPdf(event, "timetable")} /><button className="widget-add secondary" disabled={busy} onClick={() => timetableFileInput.current?.click()}><FileUp size={14} /> 시간표 PDF</button><button className="widget-add" onClick={() => openTimetable()}><Plus size={14} /> 수업</button></div>}>
            <div className="timetable-head"><span>교시</span>{schoolDays.map((day) => <span key={day}>{day}</span>)}</div>
            {Array.from({ length: 7 }, (_, periodIndex) => periodIndex + 1).map((period) => <div className="timetable-row editable-row" key={period}><span>{period}</span>{schoolDays.map((_, day) => {
              const entry = data.timetable.find((item) => item.day === day && item.period === period);
              return entry ? <div className="timetable-cell filled" key={day}><button onClick={() => openTimetable(day, period)}><strong>{entry.subject}</strong>{entry.location && <small>{entry.location}</small>}</button><button className="cell-delete" onClick={() => void deleteResource("timetable", entry.id)} aria-label={`${entry.subject} 삭제`}><X size={10} /></button></div> : <button className="timetable-cell empty" key={day} onClick={() => openTimetable(day, period)} aria-label={`${schoolDays[day]}요일 ${period}교시 추가`}><Plus size={12} /></button>;
            })}</div>)}
            <p className="pdf-note">시간표 PDF를 가져오면 현재 표를 PDF에서 읽은 요일·교시 구성으로 교체합니다.{data.imports.find((item) => item.kind === "timetable") ? ` 최근: ${data.imports.find((item) => item.kind === "timetable")?.fileName}` : ""}</p>
          </Widget>
        </div>

        <div className="column right-column">
          <Widget id="schedule" title="다가오는 일정" icon={<CalendarDays size={16} />} hidden={hidden} action={<button className="widget-add" onClick={() => setAddMode("schedule")}><Plus size={14} /> 추가</button>}>
            {upcoming.length ? <div className="schedule-list">{upcoming.map((item) => <div className="schedule-item" key={item.id}><time>{item.date.slice(5).replace("-", ".")}<small>{item.time || "종일"}</small></time><span className={`schedule-line ${sourceColor(item)}`} /><div><strong>{item.title}</strong><small>{[sourceLabel(item), item.location].filter(Boolean).join(" · ")}</small></div>{scheduleAction(item)}</div>)}</div> : <button className="empty-card compact" onClick={() => setAddMode("schedule")}><Plus size={18} /><span>다가오는 일정을 추가하세요</span></button>}
          </Widget>

          <Widget id="tasks" title="할 일" icon={<ListChecks size={16} />} hidden={hidden} className="tasks-widget">
            <form className="task-form" onSubmit={addTask}><input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="새 할 일을 입력하세요" aria-label="새 할 일" /><button type="submit" disabled={busy} aria-label="할 일 추가"><Plus size={17} /></button></form>
            <div className="task-list">{data.tasks.length ? data.tasks.map((task) => <div key={task.id} className={`task ${Boolean(task.done) ? "done" : ""}`}><button className="task-toggle" onClick={() => void toggleTask(task)} aria-label={`${task.text} ${Boolean(task.done) ? "미완료로" : "완료로"}`}><span className="checkmark">{Boolean(task.done) && <Check size={13} />}</span><span className="task-copy">{task.text}<small>{task.tag}</small></span></button><button className="inline-delete" onClick={() => void deleteResource("task", task.id)} aria-label={`${task.text} 삭제`}><Trash2 size={13} /></button></div>) : !loading && <div className="empty-line">할 일을 입력해 오늘을 시작하세요.</div>}</div>
          </Widget>
        </div>
      </div>

      <footer><span>MY DESK</span><p>오늘도 충분히 잘하고 있어요.</p></footer>

      <Dialog open={addMode !== null} onOpenChange={(open) => { if (!open) { setAddMode(null); setPresetCell(null); } }}>
        <DialogContent className="manager-dialog">
          <DialogHeader><DialogTitle>{addMode === "schedule" ? "일정 지정" : addMode === "timetable" ? "시간표 입력" : "바로가기 추가"}</DialogTitle><DialogDescription>{addMode === "schedule" ? "대시보드에 저장하고 Google 일정과 같은 캘린더에 표시합니다." : addMode === "timetable" ? "같은 요일과 교시를 다시 저장하면 내용이 바뀝니다." : "자주 쓰는 웹사이트를 데스크에 놓아두세요."}</DialogDescription></DialogHeader>
          <form className="manager-form" onSubmit={handleAdd}>
            {addMode === "schedule" && <><label>날짜<input name="date" type="date" required defaultValue={selectedDate} /></label><label>일정명<input name="title" required maxLength={120} placeholder="예: 학부모 상담" /></label><div className="form-row"><label>시간<input name="time" type="time" /></label><label>장소<input name="location" maxLength={80} placeholder="선택 입력" /></label></div></>}
            {addMode === "timetable" && <><div className="form-row"><label>요일<select name="day" defaultValue={presetCell?.day ?? 0}>{schoolDays.map((day, index) => <option value={index} key={day}>{day}요일</option>)}</select></label><label>교시<select name="period" defaultValue={presetCell?.period ?? 1}>{Array.from({ length: 10 }, (_, i) => i + 1).map((period) => <option value={period} key={period}>{period}교시</option>)}</select></label></div><label>과목<input name="subject" required maxLength={30} placeholder="예: 국어" /></label><label>교실 또는 메모<input name="location" maxLength={50} placeholder="선택 입력" /></label></>}
            {addMode === "shortcut" && <><label>이름<input name="label" required maxLength={30} placeholder="예: 학교 홈페이지" /></label><label>웹 주소<input name="url" type="url" required placeholder="https://" /></label><label>아이콘 색상<select name="color" defaultValue="blue">{colorOptions.map((color) => <option value={color} key={color}>{color}</option>)}</select></label></>}
            <button className="save-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} 저장</button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
    </LayoutContext.Provider>
  );
}

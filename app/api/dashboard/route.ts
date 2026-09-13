import { env } from "cloudflare:workers";

const tables = {
  task: "tasks",
  shortcut: "shortcuts",
  schedule: "schedule_events",
  timetable: "timetable_entries",
} as const;

type Resource = keyof typeof tables;

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const [tasks, shortcuts, schedules, timetable, imports, classStatus] = await Promise.all([
    env.DB.prepare("SELECT id, text, tag, done, created_at AS createdAt FROM tasks ORDER BY done ASC, id DESC").all(),
    env.DB.prepare("SELECT id, label, url, color, created_at AS createdAt FROM shortcuts ORDER BY id DESC").all(),
    env.DB.prepare("SELECT id, date, title, time, location, source, source_import_id AS sourceImportId FROM schedule_events ORDER BY date ASC, COALESCE(time, '') ASC").all(),
    env.DB.prepare("SELECT id, day, period, subject, location FROM timetable_entries ORDER BY period ASC, day ASC").all(),
    env.DB.prepare("SELECT id, file_name AS fileName, kind, detected_count AS detectedCount, created_at AS createdAt FROM academic_imports ORDER BY id DESC LIMIT 8").all(),
    env.DB.prepare("SELECT total, attendance, absence, early_dismissal AS earlyDismissal, tardy FROM class_status WHERE id = 1").first(),
  ]);

  return Response.json({
    tasks: tasks.results,
    shortcuts: shortcuts.results,
    schedules: schedules.results,
    timetable: timetable.results,
    imports: imports.results,
    classStatus: classStatus ?? { total: 0, attendance: 0, absence: 0, earlyDismissal: 0, tardy: 0 },
  });
}

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();

  if (resource === "task") {
    const text = String(body.text ?? "").trim();
    if (!text) return jsonError("할 일 내용을 입력해 주세요.");
    const result = await env.DB.prepare("INSERT INTO tasks (text, tag, done, created_at) VALUES (?, ?, 0, ?)")
      .bind(text.slice(0, 160), String(body.tag ?? "할 일").slice(0, 30), now).run();
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  }

  if (resource === "shortcut") {
    const label = String(body.label ?? "").trim();
    const url = String(body.url ?? "").trim();
    if (!label || !url) return jsonError("이름과 주소를 모두 입력해 주세요.");
    let parsed: URL;
    try { parsed = new URL(url); } catch { return jsonError("올바른 웹 주소를 입력해 주세요."); }
    if (!["http:", "https:"].includes(parsed.protocol)) return jsonError("http 또는 https 주소만 사용할 수 있어요.");
    const result = await env.DB.prepare("INSERT INTO shortcuts (label, url, color, created_at) VALUES (?, ?, ?, ?)")
      .bind(label.slice(0, 30), parsed.toString(), String(body.color ?? "blue").slice(0, 20), now).run();
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  }

  if (resource === "schedule") {
    const date = String(body.date ?? "");
    const title = String(body.title ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return jsonError("날짜와 일정명을 입력해 주세요.");
    const result = await env.DB.prepare("INSERT INTO schedule_events (date, title, time, location, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)")
      .bind(date, title.slice(0, 120), String(body.time ?? "").slice(0, 10) || null, String(body.location ?? "").slice(0, 80) || null, now).run();
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  }

  if (resource === "timetable") {
    const day = Number(body.day);
    const period = Number(body.period);
    const subject = String(body.subject ?? "").trim();
    if (!Number.isInteger(day) || day < 0 || day > 4 || !Number.isInteger(period) || period < 1 || period > 10 || !subject) {
      return jsonError("요일, 교시와 과목을 확인해 주세요.");
    }
    const result = await env.DB.prepare(
      "INSERT INTO timetable_entries (day, period, subject, location, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, period) DO UPDATE SET subject = excluded.subject, location = excluded.location",
    ).bind(day, period, subject.slice(0, 30), String(body.location ?? "").slice(0, 50) || null, now).run();
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  }

  if (resource === "class_status") {
    const values = [body.total, body.attendance, body.absence, body.earlyDismissal, body.tardy].map(Number);
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 999)) {
      return jsonError("학급 현황은 0명 이상 999명 이하로 입력해 주세요.");
    }
    await env.DB.prepare(
      "INSERT INTO class_status (id, total, attendance, absence, early_dismissal, tardy, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET total = excluded.total, attendance = excluded.attendance, absence = excluded.absence, early_dismissal = excluded.early_dismissal, tardy = excluded.tardy, updated_at = excluded.updated_at",
    ).bind(...values, now).run();
    return Response.json({ ok: true });
  }

  return jsonError("지원하지 않는 항목이에요.");
}

export async function PATCH(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  if (body.resource !== "task" || !Number.isInteger(Number(body.id))) return jsonError("수정할 할 일을 찾을 수 없어요.");
  await env.DB.prepare("UPDATE tasks SET done = ? WHERE id = ?").bind(body.done ? 1 : 0, Number(body.id)).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") as Resource;
  const id = Number(url.searchParams.get("id"));
  if (!(resource in tables) || !Number.isInteger(id)) return jsonError("삭제할 항목을 찾을 수 없어요.");
  await env.DB.prepare(`DELETE FROM ${tables[resource]} WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
}

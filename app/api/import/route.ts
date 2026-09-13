import { env } from "cloudflare:workers";

type ImportedEvent = { date: string; title: string };
type ImportedClass = { day: number; period: number; subject: string; location?: string };

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const kind = form.get("kind") === "timetable" ? "timetable" : "calendar";
  if (!(file instanceof File)) return error("PDF 파일을 선택해 주세요.");
  if (file.type !== "application/pdf") return error("PDF 파일만 가져올 수 있어요.");
  if (file.size > 10 * 1024 * 1024) return error("PDF는 10MB 이하로 업로드해 주세요.", 413);

  let events: ImportedEvent[] = [];
  let entries: ImportedClass[] = [];
  try {
    if (kind === "calendar") {
      events = (JSON.parse(String(form.get("events") ?? "[]")) as ImportedEvent[])
        .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.title?.trim()).slice(0, 250);
      if (!events.length) return error("날짜가 포함된 일정을 찾지 못했어요.", 422);
    } else {
      entries = (JSON.parse(String(form.get("entries") ?? "[]")) as ImportedClass[])
        .filter((entry) => Number.isInteger(entry.day) && entry.day >= 0 && entry.day <= 4 && Number.isInteger(entry.period) && entry.period >= 1 && entry.period <= 10 && entry.subject?.trim()).slice(0, 50);
      if (!entries.length) return error("요일과 교시가 있는 시간표를 찾지 못했어요.", 422);
    }
  } catch {
    return error("PDF에서 추출된 내용을 읽을 수 없어요.");
  }

  const detectedCount = kind === "calendar" ? events.length : entries.length;
  const key = `${kind}/${Date.now()}-${crypto.randomUUID()}.pdf`;
  await env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { originalName: file.name.slice(0, 180), kind },
  });

  try {
    const imported = await env.DB.prepare(
      "INSERT INTO academic_imports (file_name, r2_key, kind, detected_count, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(file.name.slice(0, 180), key, kind, detectedCount, Date.now()).run();
    const importId = Number(imported.meta.last_row_id);

    if (kind === "calendar") {
      await env.DB.batch(events.map((event) => env.DB.prepare(
        "INSERT INTO schedule_events (date, title, source, source_import_id, created_at) VALUES (?, ?, 'pdf', ?, ?)",
      ).bind(event.date, event.title.trim().slice(0, 120), importId, Date.now())));
    } else {
      const statements = [env.DB.prepare("DELETE FROM timetable_entries")];
      for (const entry of entries) {
        statements.push(env.DB.prepare(
          "INSERT INTO timetable_entries (day, period, subject, location, created_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(entry.day, entry.period, entry.subject.trim().slice(0, 30), String(entry.location ?? "").trim().slice(0, 50) || null, Date.now()));
      }
      await env.DB.batch(statements);
    }

    return Response.json({ imported: detectedCount, kind });
  } catch (reason) {
    await env.BUCKET.delete(key);
    throw reason;
  }
}

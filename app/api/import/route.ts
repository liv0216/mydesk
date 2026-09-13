import { env } from "cloudflare:workers";
type ImportedEvent = { date: string; title: string };
type ImportedClass = { day: number; period: number; subject: string; location?: string };
function error(message: string, status = 400) { return Response.json({ error: message }, { status }); }
export async function POST(request: Request) {
  const form = await request.formData(), file = form.get("file");
  const kind = form.get("kind") === "timetable" ? "timetable" : "calendar";
  if (!(file instanceof File)) return error("PDF 파일을 선택해 주세요.");
  if (file.type !== "application/pdf") return error("PDF 파일만 가져올 수 있어요.");
  if (file.size > 10 * 1024 * 1024) return error("PDF는 10MB 이하로 업로드해 주세요.", 413);
  let events: ImportedEvent[] = [], entries: ImportedClass[] = [];
  try {
    if (kind === "calendar") {
      const parsed = JSON.parse(String(form.get("events") ?? "[]"));
      if (!Array.isArray(parsed) || !parsed.length) return error("날짜가 포함된 일정을 찾지 못했어요.", 422);
      if (parsed.length > 5000) return error("일정이 5,000개를 넘어요. PDF를 나누어 가져와 주세요.", 413);
      if (parsed.some(event => !event || typeof event.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || Number.isNaN(Date.parse(event.date)) || new Date(event.date).toISOString().slice(0,10) !== event.date || typeof event.title !== "string" || !event.title.trim() || event.title.length > 1000)) return error("PDF의 날짜와 일정 내용을 확인해 주세요.", 422);
      events = [...new Map<string, ImportedEvent>(parsed.map(event => [event.date+"\0"+event.title.trim(),{date:event.date,title:event.title.trim()}])).values()];
    } else {
      entries = (JSON.parse(String(form.get("entries") ?? "[]")) as ImportedClass[])
        .filter(entry => Number.isInteger(entry.day) && entry.day>=0 && entry.day<=4 && Number.isInteger(entry.period) && entry.period>=1 && entry.period<=10 && entry.subject?.trim()).slice(0,50);
      if (!entries.length) return error("요일과 교시가 있는 시간표를 찾지 못했어요.",422);
    }
  } catch { return error("PDF에서 추출된 내용을 읽을 수 없어요."); }
  const detectedCount = kind==="calendar" ? events.length : entries.length;
  const key = kind+"/"+Date.now()+"-"+crypto.randomUUID()+".pdf";
  await env.BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:"application/pdf"},customMetadata:{originalName:file.name.slice(0,180),kind}});
  let importId: number | undefined;
  try {
    const imported=await env.DB.prepare("INSERT INTO academic_imports (file_name,r2_key,kind,detected_count,created_at) VALUES (?,?,?,?,?)").bind(file.name.slice(0,180),key,kind,detectedCount,Date.now()).run();
    importId=Number(imported.meta.last_row_id);
    if(kind==="calendar") {
      // Reimport replaces only schedules from earlier copies of this same PDF. The batch is atomic.
      const statements=[env.DB.prepare("DELETE FROM schedule_events WHERE source='pdf' AND source_import_id IN (SELECT id FROM academic_imports WHERE file_name=? AND kind='calendar' AND id!=?)").bind(file.name.slice(0,180),importId)];
      for(const event of events) statements.push(env.DB.prepare("INSERT INTO schedule_events (date,title,source,source_import_id,created_at) VALUES (?,?,'pdf',?,?)").bind(event.date,event.title,importId,Date.now()));
      await env.DB.batch(statements);
    } else {
      const statements=[env.DB.prepare("DELETE FROM timetable_entries")];
      for(const entry of entries) statements.push(env.DB.prepare("INSERT INTO timetable_entries (day,period,subject,location,created_at) VALUES (?,?,?,?,?)").bind(entry.day,entry.period,entry.subject.trim().slice(0,30),String(entry.location??"").trim().slice(0,50)||null,Date.now()));
      await env.DB.batch(statements);
    }
    const dates=events.map(event=>event.date).sort();
    return Response.json({imported:detectedCount,kind,startDate:dates[0]??null,endDate:dates.at(-1)??null});
  } catch {
    await env.BUCKET.delete(key);
    if(importId) await env.DB.prepare("DELETE FROM academic_imports WHERE id=?").bind(importId).run();
    return error("PDF 일정을 저장하지 못했어요. 기존 일정은 유지됩니다. 다시 시도해 주세요.",503);
  }
}

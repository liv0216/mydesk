import { parseAcademicCalendar } from "./academic-calendar";
export type ExtractedAcademicEvent = { date: string; title: string };
export type ExtractedTimetableEntry = { day: number; period: number; subject: string; location?: string };

type PdfText = { text: string; x: number; y: number; width: number; hasEOL: boolean };
type PdfPage = PdfText[];

async function readPdf(file: File): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: PdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PdfText[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      items.push({
        text: item.str.replace(/\s+/g, " ").trim(),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        hasEOL: item.hasEOL,
      });
    }
    pages.push(items);
  }
  return pages;
}

function pageLines(page: PdfPage) {
  const sorted = [...page].sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x);
  const rows: PdfText[][] = [];
  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= 3);
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
}

export async function extractAcademicEvents(file: File): Promise<ExtractedAcademicEvent[]> {
  return parseAcademicCalendar(await readPdf(file), file.name);
}

function dayIndex(label: string) {
  return ["월", "화", "수", "목", "금"].findIndex((day) => new RegExp(`^${day}(?:요일)?$`).test(label));
}

export async function extractTimetableEntries(file: File): Promise<ExtractedTimetableEntry[]> {
  const pages = await readPdf(file);
  const extracted = new Map<string, ExtractedTimetableEntry>();

  for (const page of pages) {
    const headers = page.map((item) => ({ ...item, day: dayIndex(item.text) })).filter((item) => item.day >= 0);
    const periods = page.map((item) => ({ ...item, match: item.text.match(/^([1-9]|10)\s*(?:교시)?$/) })).filter((item) => item.match && item.x < Math.min(...headers.map((header) => header.x), Infinity));
    if (headers.length < 3 || periods.length < 2) continue;

    const dayColumns = headers.reduce<Array<{ day: number; x: number }>>((list, header) => {
      if (!list.some((item) => item.day === header.day)) list.push({ day: header.day, x: header.x + header.width / 2 });
      return list;
    }, []);
    const periodRows = periods.reduce<Array<{ period: number; y: number }>>((list, item) => {
      const period = Number(item.match?.[1]);
      if (!list.some((row) => row.period === period)) list.push({ period, y: item.y });
      return list;
    }, []);

    const cells = new Map<string, PdfText[]>();
    for (const item of page) {
      if (dayIndex(item.text) >= 0 || /^([1-9]|10)\s*(?:교시)?$/.test(item.text)) continue;
      const column = dayColumns.reduce((best, candidate) => Math.abs(candidate.x - (item.x + item.width / 2)) < Math.abs(best.x - (item.x + item.width / 2)) ? candidate : best);
      const row = periodRows.reduce((best, candidate) => Math.abs(candidate.y - item.y) < Math.abs(best.y - item.y) ? candidate : best);
      const columnGap = Math.abs(column.x - (item.x + item.width / 2));
      const rowGap = Math.abs(row.y - item.y);
      if (columnGap > 70 || rowGap > 16) continue;
      const key = `${column.day}-${row.period}`;
      cells.set(key, [...(cells.get(key) ?? []), item]);
    }

    for (const [key, items] of cells) {
      const [day, period] = key.split("-").map(Number);
      const text = items.sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 1 || text.length > 80) continue;
      const [subject, ...details] = text.split(/\s{2,}|\s*·\s*/);
      extracted.set(key, { day, period, subject: subject.slice(0, 30), location: details.join(" ").slice(0, 50) || undefined });
    }
  }

  if (!extracted.size) {
    for (const line of pages.flatMap(pageLines)) {
      const match = line.match(/^([1-9]|10)\s*(?:교시)?\s+(.+)$/);
      if (!match) continue;
      const subjects = match[2].split(/\s{2,}|\s*[|/]\s*/).map((value) => value.trim()).filter(Boolean);
      if (subjects.length < 5) continue;
      subjects.slice(0, 5).forEach((subject, day) => extracted.set(`${day}-${match[1]}`, { day, period: Number(match[1]), subject: subject.slice(0, 30) }));
    }
  }

  return [...extracted.values()].sort((a, b) => a.period - b.period || a.day - b.day).slice(0, 50);
}

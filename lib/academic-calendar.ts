export type AcademicEvent = { date: string; title: string };
export type PdfTextItem = { text: string; x: number; y: number; width: number; height?: number; hasEOL?: boolean };
type Context = { year: number; academic: boolean; month?: number };
const dayMs = 86400000;
export const MAX_ACADEMIC_EVENTS = 5000;
function clean(text: string) { return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim(); }
function iso(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d.toISOString().slice(0, 10) : null;
}
function inferredYear(month: number, context: Context) { return context.year + (context.academic && month <= 2 ? 1 : 0); }
function contextFor(pages: PdfTextItem[][], filename: string, fallbackYear: number): Context {
  const heading = pages.flat().filter(item => /20\d{2}\s*(학년도|년)/.test(item.text)).map(item => item.text).join(" ");
  const academic = (heading + " " + filename).match(/(20\d{2})\s*학년도/);
  const year = academic?.[1] ?? heading.match(/(20\d{2})\s*년/)?.[1] ?? filename.match(/20\d{2}/)?.[0];
  return { year: Number(year ?? fallbackYear), academic: Boolean(academic) };
}
export function textRows(items: PdfTextItem[]): PdfTextItem[][] {
  const rows: PdfTextItem[][] = [];
  for (const item of [...items].sort((a,b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(row => Math.abs(row[0].y - item.y) < 2.5);
    if (row) row.push(item); else rows.push([item]);
  }
  return rows.map(row => row.sort((a,b) => a.x - b.x));
}
const tokenSource = /(?<!\d)(?:(20\d{2})\s*[년./-]\s*)?(\d{1,2})\s*[월./-]\s*(\d{1,2})(?!\d|교시|학년)(?:\s*일|\.)?(?:\s*[（(\[]\s*[월화수목금토일](?:요일)?\s*[）)\]])?/.source;
function datedLine(input: string, context: Context): AcademicEvent[] {
  const text = clean(input), tokens = [...text.matchAll(new RegExp(tokenSource, "g"))];
  if (!tokens.length) {
    const short = context.month && text.match(/^\s*(\d{1,2})(?:일)?(?:\s*[（(]\s*[월화수목금토일](?:요일)?\s*[）)])?\s+(.+)$/);
    if (!short) return [];
    const date = iso(inferredYear(context.month!, context), context.month!, Number(short[1]));
    return date && /[가-힣A-Za-z]/.test(short[2]) ? [{date, title: clean(short[2])}] : [];
  }
  const out: AcademicEvent[] = [];
  let consumed = 0;
  for (let index = 0; index < tokens.length; index++) {
    const match = tokens[index], month = Number(match[2]), day = Number(match[3]);
    const year = Number(match[1] ?? inferredYear(month, context)), start = iso(year, month, day);
    let end = start, expressionEnd = match.index! + match[0].length;
    const next = tokens[index + 1];
    if (next && /^[\s~〜～–—-]+$/.test(text.slice(expressionEnd, next.index)) && /[~〜～–—-]/.test(text.slice(expressionEnd, next.index))) {
      const endMonth = Number(next[2]);
      end = iso(Number(next[1] ?? year + (endMonth < month ? 1 : 0)), endMonth, Number(next[3]));
      expressionEnd = next.index! + next[0].length; index++;
    } else {
      const shortEnd = text.slice(expressionEnd).match(/^\s*[~〜～–—-]\s*(\d{1,2})(?!\d)(?:\s*일|\.)?(?:\s*[（(]\s*[월화수목금토일](?:요일)?\s*[）)])?/);
      if (shortEnd) { end = iso(year, month, Number(shortEnd[1])); expressionEnd += shortEnd[0].length; }
    }
    const following = tokens[index + 1]?.index ?? text.length;
    const before = text.slice(consumed, match.index).replace(/^[\s,;·•)\]）\-]+|[\s(（[]+$/g, "");
    const after = text.slice(expressionEnd, following).replace(/^[\s)）\].,:：\-]+|[\s,;]+$/g, "");
    const prefixStyle = !/[가-힣A-Za-z]/.test(before), title = clean(prefixStyle ? after : before);
    consumed = prefixStyle ? following : expressionEnd;
    if (!start || !end || end < start || !/[가-힣A-Za-z]/.test(title)) continue;
    if ((Date.parse(end)-Date.parse(start))/dayMs > 369) throw new Error("기간이 1년을 넘는 일정이 있어요. PDF 날짜를 확인해 주세요.");
    for (let d=Date.parse(start); d<=Date.parse(end); d+=dayMs) out.push({date:new Date(d).toISOString().slice(0,10),title});
  }
  return out;
}
function gridEvents(page: PdfTextItem[], context: Context): {events: AcademicEvent[]; used: Set<PdfTextItem>} {
  const used=new Set<PdfTextItem>(), events: AcademicEvent[]=[];
  const headerRows=textRows(page).map(row=>row.filter(item=>/^[월화수목금토일](?:요일)?(?:\s*\(|$)/.test(item.text)));
  const header=headerRows.find(row=>row.length>=5 && new Set(row.map(item=>item.text[0])).size>=5);
  const headers=header && [...new Map(header.map(item=>[item.text[0],item])).values()].sort((a,b)=>a.x-b.x);
  if(!headers)return {events,used};
  const centers=headers.map(item=>item.x+item.width/2);
  const gaps=centers.slice(1).map((center,i)=>center-centers[i]);
  const gap=[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
  const bounds=[centers[0]-gap/2-4,...centers.slice(1).map((center,i)=>(center+centers[i])/2),centers.at(-1)!+gap/2+4];
  const column=(item:PdfTextItem)=>bounds.findIndex((left,i)=>i<headers.length && item.x+item.width/2>=left && item.x+item.width/2<bounds[i+1]);
  const anchors=page.filter(item=>item.y<headers[0].y-5 && column(item)>=0 && /^([1-9]|[12]\d|3[01])(?:$|\s+개학식|[[(（])/.test(item.text));
  const rows=textRows(anchors).filter(row=>row.length>=2 || page.some(item=>item!==row[0] && column(item)===column(row[0]) && item.y<row[0].y && item.y>row[0].y-40 && /[가-힣]/.test(item.text)));
  if(rows.length<2)return {events,used};
  const months=page.filter(item=>item.x<bounds[0] && /^(\d{1,2})\s*월$/.test(item.text) && item.y<headers[0].y).sort((a,b)=>b.y-a.y);
  if(!months.length)return {events,used};
  let month=Number(months[0].text.match(/\d+/)![0]),year=inferredYear(month,context),previous=0;
  const firstDay=Number(rows[0][0].text.match(/^\d+/)![0]);
  if(firstDay>20 && rows[0].some(item=>Number(item.text.match(/^\d+/)![0])<10)){if(--month===0){month=12;year--;}}
  for(let rowIndex=0;rowIndex<rows.length;rowIndex++) {
    const row=rows[rowIndex];
    const bottom=rows[rowIndex+1]?.[0].y ?? Math.min(...page.filter(item=>column(item)>=0 && item.y<row[0].y).map(item=>item.y),row[0].y-35)-5;
    for(const anchor of row) {
      const day=Number(anchor.text.match(/^\d+/)![0]);
      if(day<previous){if(++month===13){month=1;year++;}}
      previous=day;
      const date=iso(year,month,day);if(!date)continue;
      const col=column(anchor);
      const contents=page.filter(item=>item!==anchor && column(item)===col && item.y<=anchor.y+2 && item.y>bottom+2);
      used.add(anchor);contents.forEach(item=>used.add(item));
      const extra=anchor.text.replace(/^\d+\s*/,"").replace(/^[[(（]|[\])）]$/g,"");
      const lines=textRows(contents).map(row=>clean(row.map(item=>item.text).join(" ")));
      if(extra)lines.unshift(extra);
      const chunks:string[]=[];
      for(const line of lines){if(/^[（(]/.test(line) && chunks.length)chunks[chunks.length-1]+=" "+line;else chunks.push(line);}
      const pending:string[]=[];
      for(const chunk of chunks){const dated=datedLine(chunk,context);if(dated.length)events.push(...dated);else if(/[가-힣A-Za-z]/.test(chunk))pending.push(chunk);}
      if(pending.length)events.push({date,title:pending.join("\n")});
    }
  }
  headers.forEach(item=>used.add(item));months.forEach(item=>used.add(item));
  return {events,used};
}
export function parseAcademicCalendar(pages: PdfTextItem[][], filename="", fallbackYear=new Date().getFullYear()): AcademicEvent[] {
  const context=contextFor(pages,filename,fallbackYear),found=new Map<string,AcademicEvent>();
  const add=(event:AcademicEvent)=>{
    const title=event.title.trim();
    if(title.length>1000)throw new Error("한 날짜의 일정 내용이 너무 길어요. PDF를 나누어 가져와 주세요.");
    found.set(event.date+"\0"+title,{date:event.date,title});
    if(found.size>MAX_ACADEMIC_EVENTS)throw new Error("일정이 5,000개를 넘어요. PDF를 나누어 가져와 주세요.");
  };
  for(const page of pages) {
    const grid=gridEvents(page,context);grid.events.forEach(add);
    let currentMonth:number|undefined;
    for(const row of textRows(page.filter(item=>!grid.used.has(item)))) {
      const line=clean(row.map(item=>item.text).join(" "));
      const heading=line.match(/^(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월(?:\s|$)/);
      if(heading)currentMonth=Number(heading[2]);
      if(grid.used.size && row.every(item=>item.x<Math.min(...page.filter(item=>grid.used.has(item)).map(item=>item.x))))continue;
      datedLine(line,{...context,month:currentMonth}).forEach(add);
    }
  }
  return [...found.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title,"ko"));
}

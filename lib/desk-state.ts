export type DeskItem = { id: number; [key: string]: unknown };
export type DeskState = { tasks: DeskItem[]; shortcuts: DeskItem[]; schedules: DeskItem[]; timetable: DeskItem[]; imports: DeskItem[]; classStatus: { total: number; attendance: number; absence: number; earlyDismissal: number; tardy: number } };
export function emptyDesk(): DeskState { return { tasks: [], shortcuts: [], schedules: [], timetable: [], imports: [], classStatus: { total: 0, attendance: 0, absence: 0, earlyDismissal: 0, tardy: 0 } }; }
export class InputError extends Error {}
function text(value: unknown, max: number, required = false) { const result = String(value ?? "").trim(); if ((required && !result) || result.length > max) throw new InputError("입력 내용을 확인해 주세요."); return result; }
function number(value: unknown, min: number, max: number) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new InputError("숫자 범위를 확인해 주세요."); return n; }
function nextId(rows: DeskItem[]) { return Math.max(0,...rows.map(row=>row.id)) + 1; }
function date(value: unknown) { const result = text(value,10,true); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result) throw new InputError("올바른 날짜를 입력해 주세요."); return result; }
export function mutateDesk(input: DeskState, method: string, body: Record<string,unknown>): DeskState {
  const state=structuredClone(input); const resource=String(body.resource);
  const tables: Record<string, keyof Pick<DeskState,'tasks'|'shortcuts'|'schedules'|'timetable'>>={task:'tasks',shortcut:'shortcuts',schedule:'schedules',timetable:'timetable'};
  if(method==='DELETE'||method==='PATCH') {
    const table=tables[resource]; if(!table)throw new InputError("항목을 찾을 수 없어요.");
    const id=number(body.id,1,Number.MAX_SAFE_INTEGER); const item=state[table].find(row=>row.id===id);
    if(!item)throw new InputError("항목을 찾을 수 없어요.");
    if(method==='DELETE')state[table]=state[table].filter(row=>row.id!==id);
    else if(resource==='task')item.done=Boolean(body.done); else throw new InputError("수정할 항목을 확인해 주세요.");
    return state;
  }
  if(method!=='POST')throw new InputError("지원하지 않는 요청입니다.");
  const createdAt=Date.now();
  if(resource==='task')state.tasks.unshift({id:nextId(state.tasks),text:text(body.text,160,true),tag:text(body.tag??'할 일',30),done:false,createdAt});
  else if(resource==='shortcut') {
    let url: URL; try { url=new URL(text(body.url,2000,true)); } catch { throw new InputError("웹 주소를 확인해 주세요."); } if(!['https:','http:'].includes(url.protocol))throw new InputError("웹 주소를 확인해 주세요.");
    state.shortcuts.unshift({id:nextId(state.shortcuts),label:text(body.label,30,true),url:url.toString(),color:text(body.color??'blue',20),createdAt});
  } else if(resource==='schedule')state.schedules.push({id:nextId(state.schedules),date:date(body.date),title:text(body.title,120,true),time:text(body.time,10)||null,location:text(body.location,80)||null,source:'manual'});
  else if(resource==='timetable') {
    const day=number(body.day,0,4),period=number(body.period,1,10); const existing=state.timetable.find(row=>row.day===day&&row.period===period);
    const item={id:existing?.id??nextId(state.timetable),day,period,subject:text(body.subject,30,true),location:text(body.location,50)||null};
    state.timetable=state.timetable.filter(row=>row.day!==day||row.period!==period);state.timetable.push(item);
  } else if(resource==='class_status') {
    for(const key of ['total','attendance','absence','earlyDismissal','tardy'] as const)state.classStatus[key]=number(body[key],0,999);
  } else throw new InputError("지원하지 않는 항목입니다.");
  if(state.tasks.length>2000||state.schedules.length>5000||state.shortcuts.length>100)throw new InputError("저장 한도에 도달했어요. 사용하지 않는 항목을 정리해 주세요.");
  return state;
}
export function importDesk(input: DeskState, body: Record<string,unknown>): DeskState {
  const state=structuredClone(input); const kind=body.kind==='timetable'?'timetable':'calendar'; const fileName=text(body.fileName,180,true);
  if(!fileName.toLowerCase().endsWith('.pdf'))throw new InputError("PDF 파일을 선택해 주세요.");
  const priorIds=new Set(state.imports.filter(row=>row.kind==='calendar'&&row.fileName===fileName).map(row=>row.id));
  if(kind==='calendar')state.schedules=state.schedules.filter(row=>row.source!=='pdf'||(row.sourceFileName!==fileName&&!priorIds.has(Number(row.sourceImportId))));
  const imported={id:nextId(state.imports),fileName,kind,detectedCount:0,createdAt:Date.now()};
  if(kind==='calendar') {
    if(!Array.isArray(body.events)||!body.events.length||body.events.length>5000)throw new InputError("일정 개수를 확인해 주세요.");
    let id=nextId(state.schedules); for(const event of body.events){if(!event||typeof event!=='object')throw new InputError("일정 내용을 확인해 주세요.");state.schedules.push({id:id++,date:date(event.date),title:text(event.title,1000,true),time:null,location:null,source:'pdf',sourceImportId:imported.id,sourceFileName:fileName});}
    imported.detectedCount=body.events.length;
    const dates=state.schedules.filter(row=>row.sourceImportId===imported.id).map(row=>String(row.date)).sort();
    Object.assign(imported,{firstDate:dates[0],lastDate:dates.at(-1),months:[...new Set(dates.map(value=>value.slice(0,7)))].sort()});
    if(state.schedules.length>5000)throw new InputError("일정 저장 한도에 도달했어요.");
  } else {
    if(!Array.isArray(body.entries)||!body.entries.length||body.entries.length>50)throw new InputError("시간표를 확인해 주세요.");
    state.timetable=[];
    for(const entry of body.entries) {
      if(!entry||typeof entry!=='object')throw new InputError("시간표 내용을 확인해 주세요.");
      const day=number(entry.day,0,4),period=number(entry.period,1,10);
      state.timetable=state.timetable.filter(row=>row.day!==day||row.period!==period);
      state.timetable.push({id:nextId(state.timetable),day,period,subject:text(entry.subject,30,true),location:text(entry.location,50)||null});
    }
    imported.detectedCount=state.timetable.length;
  }
  state.imports.unshift(imported); state.imports=state.imports.slice(0,100); return state;
}

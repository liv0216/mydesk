import { requireUser, apiError, privateHeaders, ApiError } from "@/lib/api-auth";
import { database, initializeDesk } from "@/lib/desk-store";
import { encryptCalendar, decryptCalendar } from "@/lib/calendar-crypto";
import { parseGoogleCalendar, seoulDate } from "@/lib/google-calendar-feed";
export const dynamic = "force-dynamic";
type Feed = { url: string; text: string; updatedAt: string };
const cache=new Map<string,Feed>();
async function readFeed(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "calendar.google.com" || !parsed.pathname.startsWith("/calendar/ical/") || !parsed.pathname.endsWith(".ics")) throw new Error("Invalid feed configuration");
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "manual" });
  if (!response.ok || !response.body) throw new Error("Calendar unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error("Calendar feed too large");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

function keepCache(id: string, feed: Feed) {
  cache.delete(id);cache.set(id,feed);
  while(cache.size>20||[...cache.values()].reduce((sum,item)=>sum+item.text.length,0)>8000000)cache.delete(cache.keys().next().value!);
}
export async function GET(request: Request) {
 try {
  const user=await requireUser(request); await initializeDesk(user);
  const [row]=await database().query('SELECT google_cipher FROM mydesk_documents WHERE owner_id=$1',[user.id]);
  if(!row.google_cipher)return Response.json({connected:false,events:[],upcoming:[],updatedAt:null,stale:false},{headers:privateHeaders});
  const calendarUrl=decryptCalendar(row.google_cipher,process.env.NEON_AUTH_COOKIE_SECRET!);
  const url=new URL(request.url);const month=url.searchParams.get('month')||seoulDate(new Date()).slice(0,7);
  if(!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new ApiError("월을 확인해 주세요.");
  const [year,number]=month.split('-').map(Number);const start=month+'-01',end=new Date(Date.UTC(year,number,1)).toISOString().slice(0,10);
  const today=seoulDate(new Date()),upcomingEnd=new Date(Date.parse(today+'T00:00:00Z')+90*86400000).toISOString().slice(0,10);
  const ranges=[{start,end},{start:today,end:upcomingEnd}];let feed=cache.get(user.id);let stale=false;
  if(!feed||feed.url!==calendarUrl||Date.now()-Date.parse(feed.updatedAt)>120000||url.searchParams.get('refresh')==='1') {
    try { const text=await readFeed(calendarUrl);parseGoogleCalendar(text,ranges);feed={url:calendarUrl,text,updatedAt:new Date().toISOString()};keepCache(user.id,feed); }
    catch { if(!feed||feed.url!==calendarUrl)throw new ApiError("Google 일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",502);stale=true; }
  }
  const events=parseGoogleCalendar(feed.text,ranges);
  return Response.json({connected:true,events:events.filter(item=>item.date>=start&&item.date<end),upcoming:events.filter(item=>item.date>=today&&item.date<upcomingEnd),updatedAt:feed.updatedAt,stale},{headers:privateHeaders});
 } catch(error) { return apiError(error); }
}
export async function PUT(request: Request) {
 try {
  const user=await requireUser(request);const body=await request.json();const url=String(body.url??'').trim();
  if(url.length>2000)throw new ApiError("주소를 확인해 주세요.");
  try { const text=await readFeed(url);parseGoogleCalendar(text,[{start:seoulDate(new Date()),end:seoulDate(new Date(Date.now()+86400000))}]); }
  catch { throw new ApiError("Google 캘린더의 iCal 비공개 주소를 확인해 주세요."); }
  await initializeDesk(user);
  await database().query('UPDATE mydesk_documents SET google_cipher=$1,updated_at=now() WHERE owner_id=$2',[encryptCalendar(url,process.env.NEON_AUTH_COOKIE_SECRET!),user.id]);cache.delete(user.id);
  return Response.json({connected:true},{headers:privateHeaders});
 } catch(error) { return apiError(error); }
}
export async function DELETE(request: Request) {
 try { const user=await requireUser(request);await database().query('UPDATE mydesk_documents SET google_cipher=NULL,updated_at=now() WHERE owner_id=$1',[user.id]);cache.delete(user.id);return Response.json({connected:false},{headers:privateHeaders}); }
 catch(error) { return apiError(error); }
}

import { requireUser, apiError, privateHeaders, ApiError } from "@/lib/api-auth";
import { readDesk, updateDesk } from "@/lib/desk-store";
import { mutateDesk, InputError } from "@/lib/desk-state";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const data=await readDesk(await requireUser(request)); return Response.json(data,{headers:privateHeaders}); } catch(error) { return apiError(error); } }
async function change(request: Request) {
 try {
  const user=await requireUser(request);
  const body=request.method==='DELETE' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json();
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError("입력을 확인해 주세요.");
  await updateDesk(user,data=>mutateDesk(data,request.method,body)); return Response.json({ok:true},{headers:privateHeaders});
 } catch(error) { return apiError(error instanceof InputError ? new ApiError(error.message) : error); }
}
export const POST=change, PATCH=change, DELETE=change;

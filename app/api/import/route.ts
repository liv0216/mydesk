import { requireUser, apiError, privateHeaders, ApiError } from "@/lib/api-auth";
import { updateDesk } from "@/lib/desk-store";
import { importDesk, InputError } from "@/lib/desk-state";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
 try {
  const user=await requireUser(request); const body=await request.json();
  if(!body||typeof body!=="object"||Array.isArray(body))throw new ApiError("입력 내용을 확인해 주세요.");
  const next=await updateDesk(user,data=>importDesk(data,body));
  return Response.json({imported:next.imports[0].detectedCount,kind:body.kind},{headers:privateHeaders});
 } catch(error) { return apiError(error instanceof InputError ? new ApiError(error.message) : error); }
}

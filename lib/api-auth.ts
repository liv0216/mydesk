import "server-only";
import { currentUser } from "@/lib/auth/server";
export const privateHeaders = { "Cache-Control": "private, no-store" };
export class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function requireUser(request: Request) {
  const user = await currentUser();
  if (!user) throw new ApiError("로그인해 주세요.", 401);
  if (!user.emailVerified) throw new ApiError("이메일 인증을 완료해 주세요.", 403);
  if (!["GET", "HEAD"].includes(request.method)) {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError("허용되지 않은 요청입니다.", 403);
  }
  return user;
}
export function apiError(error: unknown) {
  return Response.json({ error: error instanceof ApiError ? error.message : "저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: error instanceof ApiError ? error.status : 503, headers: privateHeaders });
}

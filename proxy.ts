import { getAuth } from "@/lib/auth/server";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) return NextResponse.next();
  return getAuth().middleware({ loginUrl: "/auth/sign-in" })(request);
}
export const config = { matcher: ["/"] };

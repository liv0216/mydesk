import { getAuth } from "@/lib/auth/server";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, context: Context) { return getAuth().handler().GET(request, context); }
export async function POST(request: NextRequest, context: Context) {
  const response = await getAuth().handler().POST(request, context);
  response.headers.set("Cache-Control", "private, no-store");
  const action = (await context.params).path.join("/");
  if (!response.ok && ["sign-in/email-otp", "email-otp/send-verification-otp"].includes(action)) {
    const failure = await response.clone().json().catch(() => null);
    const code = typeof failure?.code === "string" && /^[A-Z_]{1,64}$/.test(failure.code) ? failure.code : "UNKNOWN";
    // Keep credentials, addresses, request bodies and upstream messages out of logs.
    console.warn("Authentication request rejected", { action, status: response.status, code });
  }
  return response;
}

import { getAuth } from "@/lib/auth/server";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, context: Context) { return getAuth().handler().GET(request, context); }
export async function POST(request: NextRequest, context: Context) { return getAuth().handler().POST(request, context); }

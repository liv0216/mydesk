import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";
let instance: ReturnType<typeof createNeonAuth> | undefined;
export function getAuth() {
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) throw new Error("Authentication is not configured");
  return instance ??= createNeonAuth({ baseUrl: process.env.NEON_AUTH_BASE_URL, cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET, sessionDataTtl: 60 } });
}
export async function currentUser() {
  if (!process.env.NEON_AUTH_BASE_URL || !process.env.NEON_AUTH_COOKIE_SECRET) return null;
  const { data, error } = await getAuth().getSession();
  return error ? null : data?.user ?? null;
}

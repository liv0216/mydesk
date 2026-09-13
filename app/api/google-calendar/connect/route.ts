import { NextResponse } from 'next/server';
import { apiError, privateHeaders, requireUser } from '@/lib/api-auth';
import { GOOGLE_OAUTH_COOKIE, GOOGLE_OAUTH_TTL_SECONDS, GoogleOAuthError, googleAuthorizationUrl } from '@/lib/google-oauth';
import { createStoredGoogleOAuthAttempt, getGoogleOAuthConfig } from '@/lib/google-oauth-store';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const config = getGoogleOAuthConfig();
    const attempt = await createStoredGoogleOAuthAttempt(user.id);
    const response = NextResponse.json({ url: googleAuthorizationUrl(config, attempt, user.email) }, { headers: privateHeaders });
    response.cookies.set(GOOGLE_OAUTH_COOKIE, attempt.state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: GOOGLE_OAUTH_TTL_SECONDS });
    return response;
  } catch (error) {
    if (error instanceof GoogleOAuthError) return NextResponse.json({ error: 'Google 캘린더 연결을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.', reason: error.reason }, { status: error.status, headers: privateHeaders });
    return apiError(error);
  }
}

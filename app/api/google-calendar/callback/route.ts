import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireUser } from '@/lib/api-auth';
import { exchangeGoogleOAuthCode, fetchGoogleOAuthIdentity, GOOGLE_OAUTH_COOKIE, GoogleOAuthError } from '@/lib/google-oauth';
import { consumeStoredGoogleOAuthAttempt, getGoogleOAuthConfig, storeOAuthConnection } from '@/lib/google-oauth-store';

export const dynamic = 'force-dynamic';
type Outcome = 'connected' | 'cancelled' | 'permissions' | 'expired' | 'error';
export async function GET(request: NextRequest) {
  let outcome: Outcome = 'error';
  let destination = new URL('/', request.url);
  try {
    const config = getGoogleOAuthConfig();
    destination = new URL('/', config.redirectUri);
    const user = await requireUser(request);
    const params = request.nextUrl.searchParams;
    if (params.getAll('state').length !== 1 || params.getAll('code').length > 1 || params.getAll('error').length > 1) throw new GoogleOAuthError('expired', 400);
    const verifier = await consumeStoredGoogleOAuthAttempt(user.id, params.get('state'), request.cookies.get(GOOGLE_OAUTH_COOKIE)?.value);
    if (params.has('error')) outcome = params.get('error') === 'access_denied' ? 'cancelled' : 'error';
    else {
      const tokens = await exchangeGoogleOAuthCode(config, params.get('code') || '', verifier);
      const identity = await fetchGoogleOAuthIdentity(tokens.accessToken);
      await storeOAuthConnection(user.id, { ...tokens, ...identity });
      outcome = 'connected';
    }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) outcome = 'expired';
    else if (error instanceof GoogleOAuthError && (error.reason === 'expired' || error.reason === 'permissions')) outcome = error.reason;
  }
  destination.searchParams.set('google', outcome);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(GOOGLE_OAUTH_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}

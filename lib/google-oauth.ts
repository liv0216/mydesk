import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const GOOGLE_OAUTH_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
export const GOOGLE_OAUTH_COOKIE = '__Host-mydesk-google-oauth';
export const GOOGLE_OAUTH_TTL_SECONDS = 600;
export type GoogleOAuthReason = 'not_configured' | 'expired' | 'permissions' | 'reconnect_required' | 'upstream' | 'invalid_response' | 'storage';
export class GoogleOAuthError extends Error {
  readonly reason: GoogleOAuthReason;
  readonly status: number;
  constructor(reason: GoogleOAuthReason, status = 502) {
    super('Google Calendar connection could not be completed.');
    this.name = 'GoogleOAuthError'; this.reason = reason; this.status = status;
  }
}
export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GoogleOAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string };
export type GoogleOAuthIdentity = { googleSubject: string; googleEmail: string };
export type GoogleOAuthCredentials = GoogleOAuthTokens & GoogleOAuthIdentity & { scope: string };
type GoogleFetch = typeof fetch;

export function validateGoogleOAuthConfig(input: { clientId?: string; clientSecret?: string; redirectUri?: string }): GoogleOAuthConfig {
  const { clientId, clientSecret, redirectUri } = input;
  if (!clientId?.trim() || !clientSecret?.trim() || !redirectUri) throw new GoogleOAuthError('not_configured', 503);
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/google-calendar/callback') throw new Error();
  } catch { throw new GoogleOAuthError('not_configured', 503); }
  return { clientId, clientSecret, redirectUri };
}

export function createGoogleOAuthAttempt() {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  return { state, codeVerifier, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url') };
}
export function hashGoogleOAuthState(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new GoogleOAuthError('expired', 400);
  return createHash('sha256').update(state).digest('hex');
}
export function assertGoogleOAuthState(state: string | null | undefined, cookieState: string | null | undefined) {
  if (!state || !cookieState || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(cookieState) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) throw new GoogleOAuthError('expired', 400);
}
export function assertGoogleOAuthAttempt(ownerId: string, attemptOwnerId: string, expiresAt: string | Date, now = Date.now()) {
  const expiry = new Date(expiresAt).getTime();
  if (!ownerId || ownerId !== attemptOwnerId || !Number.isFinite(expiry) || expiry <= now) throw new GoogleOAuthError('expired', 400);
}
export function googleAuthorizationUrl(config: GoogleOAuthConfig, attempt: { state: string; codeChallenge: string }, loginHint?: string) {
  hashGoogleOAuthState(attempt.state);
  if (!/^[A-Za-z0-9_-]{43}$/.test(attempt.codeChallenge)) throw new GoogleOAuthError('expired', 400);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '), access_type: 'offline', include_granted_scopes: 'true',
    prompt: 'consent select_account', state: attempt.state,
    code_challenge: attempt.codeChallenge, code_challenge_method: 'S256',
  }).toString();
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url.toString();
}
export function hasGoogleCalendarScopes(scope: string | undefined) {
  const granted = new Set((scope || '').split(/\s+/));
  return GOOGLE_OAUTH_SCOPES.slice(2).every(value => granted.has(value));
}
async function googleJson(url: string, init: RequestInit, fetcher: GoogleFetch, invalidGrant: GoogleOAuthReason = 'upstream') {
  let response: Response;
  try { response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { throw new GoogleOAuthError('upstream'); }
  let body: Record<string, unknown>;
  try { body = await response.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
  catch { throw new GoogleOAuthError('invalid_response'); }
  if (!response.ok) {
    if (body.error === 'invalid_grant') throw new GoogleOAuthError(invalidGrant, invalidGrant === 'reconnect_required' ? 401 : 400);
    if (body.error === 'invalid_client' || body.error === 'unauthorized_client') throw new GoogleOAuthError('not_configured', 503);
    if (response.status === 401 || response.status === 403 || body.error === 'invalid_scope' || body.error === 'access_denied') throw new GoogleOAuthError('permissions', 403);
    throw new GoogleOAuthError('upstream');
  }
  return body;
}
function parseGoogleTokens(body: Record<string, unknown>): GoogleOAuthTokens {
  if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16384 || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 31536000 || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer') throw new GoogleOAuthError('invalid_response');
  if (body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !body.refresh_token || body.refresh_token.length > 16384)) throw new GoogleOAuthError('invalid_response');
  return { accessToken: body.access_token, refreshToken: body.refresh_token as string | undefined, expiresAt: Date.now() + body.expires_in * 1000, scope: typeof body.scope === 'string' ? body.scope : undefined };
}
export async function exchangeGoogleOAuthCode(config: GoogleOAuthConfig, code: string, codeVerifier: string, fetcher: GoogleFetch = fetch) {
  if (!code || code.length > 4096 || !/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier)) throw new GoogleOAuthError('expired', 400);
  const tokens = parseGoogleTokens(await googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code, code_verifier: codeVerifier }),
  }, fetcher, 'expired'));
  if (!hasGoogleCalendarScopes(tokens.scope)) throw new GoogleOAuthError('permissions', 403);
  return { ...tokens, scope: tokens.scope! };
}
export async function refreshGoogleOAuthToken(config: GoogleOAuthConfig, refreshToken: string, fetcher: GoogleFetch = fetch) {
  if (!refreshToken) throw new GoogleOAuthError('reconnect_required', 401);
  const tokens = parseGoogleTokens(await googleJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
  }, fetcher, 'reconnect_required'));
  if (tokens.scope !== undefined && !hasGoogleCalendarScopes(tokens.scope)) throw new GoogleOAuthError('permissions', 403);
  return tokens;
}
export async function fetchGoogleOAuthIdentity(accessToken: string, fetcher: GoogleFetch = fetch): Promise<GoogleOAuthIdentity> {
  const body = await googleJson('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher);
  if (body.email_verified !== true || typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(body.email) || typeof body.sub !== 'string' || !body.sub || body.sub.length > 255) throw new GoogleOAuthError('permissions', 403);
  return { googleSubject: body.sub, googleEmail: body.email.toLowerCase() };
}
export function mergeGoogleOAuthCredentials(next: GoogleOAuthCredentials, previous?: GoogleOAuthCredentials): GoogleOAuthCredentials {
  const refreshToken = next.refreshToken || (previous?.googleSubject === next.googleSubject ? previous.refreshToken : undefined);
  if (!refreshToken) throw new GoogleOAuthError('reconnect_required', 401);
  if (!hasGoogleCalendarScopes(next.scope)) throw new GoogleOAuthError('permissions', 403);
  return { ...next, refreshToken };
}
export async function revokeGoogleOAuthToken(token: string, fetcher: GoogleFetch = fetch) {
  try {
    await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch { /* Local disconnection still succeeds when Google is unavailable. */ }
}

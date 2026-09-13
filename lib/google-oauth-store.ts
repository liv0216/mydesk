import 'server-only';
import { database } from '@/lib/desk-store';
import { encryptCalendar, decryptCalendar } from '@/lib/calendar-crypto';
import { assertGoogleOAuthAttempt, assertGoogleOAuthState, createGoogleOAuthAttempt, GOOGLE_OAUTH_TTL_SECONDS, GoogleOAuthError, hashGoogleOAuthState, mergeGoogleOAuthCredentials, refreshGoogleOAuthToken, revokeGoogleOAuthToken, validateGoogleOAuthConfig, type GoogleOAuthCredentials } from '@/lib/google-oauth';

export function getGoogleOAuthConfig() {
  return validateGoogleOAuthConfig({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI });
}
function secret() {
  const value = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!value || value.length < 32) throw new GoogleOAuthError('not_configured', 503);
  return value;
}
function decodeCredentials(cipher: string): GoogleOAuthCredentials {
  try {
    const value = JSON.parse(decryptCalendar(cipher, secret()));
    if (!value || typeof value.accessToken !== 'string' || !value.accessToken || typeof value.googleSubject !== 'string' || !value.googleSubject || typeof value.googleEmail !== 'string' || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || typeof value.scope !== 'string' || (value.refreshToken !== undefined && typeof value.refreshToken !== 'string')) throw new Error();
    return value;
  } catch { throw new GoogleOAuthError('storage', 503); }
}
export async function createStoredGoogleOAuthAttempt(ownerId: string) {
  if (!ownerId) throw new GoogleOAuthError('expired', 401);
  const attempt = createGoogleOAuthAttempt();
  const sql = database();
  await sql.query('DELETE FROM mydesk_google_oauth_attempts WHERE owner_id=$1 AND expires_at <= now()', [ownerId]);
  await sql.query('INSERT INTO mydesk_google_oauth_attempts(state_hash,owner_id,verifier_cipher,expires_at) VALUES($1,$2,$3,$4)', [hashGoogleOAuthState(attempt.state), ownerId, encryptCalendar(attempt.codeVerifier, secret()), new Date(Date.now() + GOOGLE_OAUTH_TTL_SECONDS * 1000).toISOString()]);
  return { state: attempt.state, codeChallenge: attempt.codeChallenge };
}
export async function consumeStoredGoogleOAuthAttempt(ownerId: string, state: string | null, cookieState: string | undefined) {
  assertGoogleOAuthState(state, cookieState);
  const [row] = await database().query('DELETE FROM mydesk_google_oauth_attempts WHERE state_hash=$1 AND owner_id=$2 AND expires_at>now() RETURNING owner_id,verifier_cipher,expires_at', [hashGoogleOAuthState(state!), ownerId]);
  if (!row) throw new GoogleOAuthError('expired', 400);
  assertGoogleOAuthAttempt(ownerId, row.owner_id, row.expires_at);
  try { return decryptCalendar(row.verifier_cipher, secret()); }
  catch { throw new GoogleOAuthError('expired', 400); }
}
export async function storeOAuthConnection(ownerId: string, credentials: GoogleOAuthCredentials) {
  if (!ownerId) throw new GoogleOAuthError('expired', 401);
  const sql = database();
  const [row] = await sql.query('SELECT credentials_cipher FROM mydesk_google_connections WHERE owner_id=$1', [ownerId]);
  let previous: GoogleOAuthCredentials | undefined;
  if (row) { try { previous = decodeCredentials(row.credentials_cipher); } catch { /* A complete new grant can replace unreadable old credentials. */ } }
  const merged = mergeGoogleOAuthCredentials(credentials, previous);
  await sql.query('INSERT INTO mydesk_google_connections(owner_id,credentials_cipher,google_email) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET credentials_cipher=EXCLUDED.credentials_cipher,google_email=EXCLUDED.google_email,updated_at=now()', [ownerId, encryptCalendar(JSON.stringify(merged), secret()), merged.googleEmail]);
}
export type GoogleOAuthConnection = { accessToken: string; googleEmail: string; expiresAt: number };
export async function getOAuthConnection(ownerId: string, forceRefresh = false): Promise<GoogleOAuthConnection | null> {
  if (!ownerId) throw new GoogleOAuthError('expired', 401);
  const sql = database();
  const [row] = await sql.query('SELECT credentials_cipher FROM mydesk_google_connections WHERE owner_id=$1', [ownerId]);
  if (!row) return null;
  let credentials = decodeCredentials(row.credentials_cipher);
  if (forceRefresh || credentials.expiresAt <= Date.now() + 60000) {
    try {
      const refreshed = await refreshGoogleOAuthToken(getGoogleOAuthConfig(), credentials.refreshToken || '');
      credentials = { ...credentials, ...refreshed, refreshToken: refreshed.refreshToken || credentials.refreshToken, scope: refreshed.scope || credentials.scope };
      const updated = await sql.query('UPDATE mydesk_google_connections SET credentials_cipher=$1,updated_at=now() WHERE owner_id=$2 AND credentials_cipher=$3 RETURNING owner_id', [encryptCalendar(JSON.stringify(credentials), secret()), ownerId, row.credentials_cipher]);
      if (!updated.length) return getOAuthConnection(ownerId);
    } catch (error) {
      if (error instanceof GoogleOAuthError && (error.reason === 'reconnect_required' || error.reason === 'permissions')) {
        const removed = await sql.query('DELETE FROM mydesk_google_connections WHERE owner_id=$1 AND credentials_cipher=$2 RETURNING owner_id', [ownerId, row.credentials_cipher]);
        if (!removed.length) return getOAuthConnection(ownerId);
        throw new GoogleOAuthError('reconnect_required', 401);
      }
      throw error;
    }
  }
  return { accessToken: credentials.accessToken, googleEmail: credentials.googleEmail, expiresAt: credentials.expiresAt };
}
export async function disconnectOAuthConnection(ownerId: string) {
  if (!ownerId) throw new GoogleOAuthError('expired', 401);
  const sql = database();
  const [row] = await sql.query('DELETE FROM mydesk_google_connections WHERE owner_id=$1 RETURNING credentials_cipher', [ownerId]);
  await sql.query('DELETE FROM mydesk_google_oauth_attempts WHERE owner_id=$1', [ownerId]);
  if (row) {
    try { const credentials = decodeCredentials(row.credentials_cipher); await revokeGoogleOAuthToken(credentials.refreshToken || credentials.accessToken); }
    catch { /* Removing the local connection must not depend on successful revocation. */ }
  }
}

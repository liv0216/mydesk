import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  assertGoogleOAuthAttempt, assertGoogleOAuthState, createGoogleOAuthAttempt,
  exchangeGoogleOAuthCode, fetchGoogleOAuthIdentity, GOOGLE_OAUTH_SCOPES,
  GoogleOAuthError, googleAuthorizationUrl, hashGoogleOAuthState,
  mergeGoogleOAuthCredentials, refreshGoogleOAuthToken, revokeGoogleOAuthToken,
  validateGoogleOAuthConfig,
} from '../lib/google-oauth.ts';

// Public-safe fixtures. Every HTTP call below is intercepted; no real credentials or requests.
const config = {
  clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret',
  redirectUri: 'https://desk.example.invalid/api/google-calendar/callback',
};
const scope = GOOGLE_OAUTH_SCOPES.join(' ');
const tokenResponse = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'Bearer', scope };
const credentials = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1, scope, googleSubject: 'account-a', googleEmail: 'first@example.invalid' };
function response(body, status = 200, requests = []) {
  return async (url, init) => { requests.push({ url, init }); return Response.json(body, { status }); };
}
function reason(expected) {
  return error => { assert.ok(error instanceof GoogleOAuthError); assert.equal(error.reason, expected); return true; };
}

test('OAuth configuration requires an HTTPS callback without query strings or credentials', () => {
  assert.deepEqual(validateGoogleOAuthConfig(config), config);
  for (const patch of [{ clientId: '' }, { clientSecret: undefined }, { redirectUri: 'http://desk.example.invalid/api/google-calendar/callback' }, { redirectUri: config.redirectUri + '?code=unsafe' }, { redirectUri: 'https://user:pass@desk.example.invalid/api/google-calendar/callback' }, { redirectUri: 'https://desk.example.invalid/other' }]) {
    assert.throws(() => validateGoogleOAuthConfig({ ...config, ...patch }), reason('not_configured'));
  }
});

test('OAuth attempts contain independent 32-byte state and verifier values with an S256 challenge', () => {
  const first = createGoogleOAuthAttempt(), second = createGoogleOAuthAttempt();
  assert.equal(Buffer.from(first.state, 'base64url').length, 32);
  assert.equal(Buffer.from(first.codeVerifier, 'base64url').length, 32);
  assert.notEqual(first.state, first.codeVerifier);
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.codeVerifier, second.codeVerifier);
  assert.equal(first.codeChallenge, createHash('sha256').update(first.codeVerifier).digest('base64url'));
  assert.match(hashGoogleOAuthState(first.state), /^[a-f0-9]{64}$/);
  assert.notEqual(hashGoogleOAuthState(first.state), first.state);
});

test('callback state rejects missing, malformed, or mismatched browser values', () => {
  const { state } = createGoogleOAuthAttempt();
  assert.doesNotThrow(() => assertGoogleOAuthState(state, state));
  for (const [actual, cookie] of [[null, state], [state, undefined], ['', state], [state, 'a'.repeat(43)], ['a'.repeat(44), state], ['/'.repeat(43), state]]) {
    assert.throws(() => assertGoogleOAuthState(actual, cookie), reason('expired'));
  }
  assert.throws(() => hashGoogleOAuthState('malformed'), reason('expired'));
});

test('callback attempts require the initiating account and an unexpired deadline', () => {
  const now = Date.parse('2030-03-01T10:00:00Z');
  assert.doesNotThrow(() => assertGoogleOAuthAttempt('desk-a', 'desk-a', new Date(now + 1), now));
  for (const [owner, expected, expiry] of [['desk-b', 'desk-a', new Date(now + 1)], ['', '', new Date(now + 1)], ['desk-a', 'desk-a', new Date(now)], ['desk-a', 'desk-a', 'invalid']]) {
    assert.throws(() => assertGoogleOAuthAttempt(owner, expected, expiry, now), reason('expired'));
  }
});

test('authorization requests only the agreed read scopes with offline access and PKCE', () => {
  const attempt = createGoogleOAuthAttempt();
  const url = new URL(googleAuthorizationUrl(config, attempt, 'desk@example.invalid'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.pathname, '/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', access_type: 'offline', include_granted_scopes: 'true', state: attempt.state, code_challenge: attempt.codeChallenge, code_challenge_method: 'S256', prompt: 'consent select_account', login_hint: 'desk@example.invalid' })) assert.equal(url.searchParams.get(key), value);
  assert.deepEqual(url.searchParams.get('scope').split(' '), GOOGLE_OAUTH_SCOPES);
  assert.equal(url.toString().includes(config.clientSecret), false);
  assert.equal(url.toString().includes(attempt.codeVerifier), false);
});

test('authorization codes are exchanged in a POST body with their matching verifier', async () => {
  const requests = [], attempt = createGoogleOAuthAttempt(), before = Date.now();
  const tokens = await exchangeGoogleOAuthCode(config, 'synthetic-code', attempt.codeVerifier, response(tokenResponse, 200, requests));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token');
  const { init } = requests[0];
  assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
  assert.deepEqual(Object.fromEntries(init.body), { client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code: 'synthetic-code', code_verifier: attempt.codeVerifier });
  assert.equal(tokens.accessToken, tokenResponse.access_token);
  assert.equal(tokens.refreshToken, tokenResponse.refresh_token);
  assert.equal(tokens.scope, scope);
  assert.ok(tokens.expiresAt >= before + 3600000 && tokens.expiresAt <= Date.now() + 3600000);
});

test('partial permission grants and malformed tokens cannot become connections', async () => {
  const { codeVerifier } = createGoogleOAuthAttempt();
  for (const missing of [undefined, GOOGLE_OAUTH_SCOPES[2], GOOGLE_OAUTH_SCOPES[3], 'openid email']) {
    await assert.rejects(exchangeGoogleOAuthCode(config, 'synthetic-code', codeVerifier, response({ ...tokenResponse, scope: missing })), reason('permissions'));
  }
  for (const patch of [{ access_token: '' }, { expires_in: 0 }, { expires_in: '3600' }, { token_type: 'other' }, { refresh_token: {} }]) {
    await assert.rejects(exchangeGoogleOAuthCode(config, 'synthetic-code', codeVerifier, response({ ...tokenResponse, ...patch })), reason('invalid_response'));
  }
});

test('token exchange errors expose only a safe reason and never upstream descriptions', async () => {
  const { codeVerifier } = createGoogleOAuthAttempt();
  await assert.rejects(exchangeGoogleOAuthCode(config, 'synthetic-code', codeVerifier, response({ error: 'invalid_grant', error_description: 'synthetic-private-detail' }, 400)), error => {
    assert.equal(error.reason, 'expired'); assert.equal(error.status, 400);
    assert.equal(String(error).includes('synthetic-private-detail'), false);
    assert.equal(error.cause, undefined); return true;
  });
  await assert.rejects(exchangeGoogleOAuthCode(config, 'synthetic-code', codeVerifier, async () => { throw new Error('synthetic-private-network-detail'); }), reason('upstream'));
});

test('Google identity requires a verified email and stable subject', async () => {
  const requests = [];
  const identity = await fetchGoogleOAuthIdentity('synthetic-access', response({ sub: 'google-b', email: 'Other@Example.invalid', email_verified: true }, 200, requests));
  assert.deepEqual(identity, { googleSubject: 'google-b', googleEmail: 'other@example.invalid' });
  assert.equal(requests[0].url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer synthetic-access');
  for (const body of [{ sub: 'google-b', email: 'other@example.invalid', email_verified: false }, { sub: 'google-b', email: 'other@example.invalid', email_verified: 'true' }, { email: 'other@example.invalid', email_verified: true }, { sub: 'google-b', email: '', email_verified: true }]) {
    await assert.rejects(fetchGoogleOAuthIdentity('synthetic-access', response(body)), reason('permissions'));
  }
});

test('only the same Google subject can retain a previously issued refresh token', () => {
  const same = { ...credentials, accessToken: 'new-access', refreshToken: undefined, googleEmail: 'renamed@example.invalid' };
  assert.equal(mergeGoogleOAuthCredentials(same, credentials).refreshToken, 'old-refresh');
  assert.throws(() => mergeGoogleOAuthCredentials({ ...same, googleSubject: 'account-b' }, credentials), reason('reconnect_required'));
  assert.throws(() => mergeGoogleOAuthCredentials(same), reason('reconnect_required'));
  const replacement = { ...same, googleSubject: 'account-b', refreshToken: 'new-refresh' };
  assert.equal(mergeGoogleOAuthCredentials(replacement, credentials).refreshToken, 'new-refresh');
  assert.equal(credentials.refreshToken, 'old-refresh');
});

test('refresh requests support omitted replacement tokens and identify revoked grants', async () => {
  const requests = [];
  const refreshed = await refreshGoogleOAuthToken(config, 'synthetic-refresh', response({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' }, 200, requests));
  assert.equal(refreshed.accessToken, 'new-access');
  assert.equal(refreshed.refreshToken, undefined); assert.equal(refreshed.scope, undefined);
  assert.deepEqual(Object.fromEntries(requests[0].init.body), { client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: 'synthetic-refresh' });
  await assert.rejects(refreshGoogleOAuthToken(config, 'synthetic-refresh', response({ error: 'invalid_grant' }, 400)), error => {
    assert.equal(error.reason, 'reconnect_required'); assert.equal(error.status, 401); return true;
  });
});

test('a refreshed token that lost a required Calendar scope requires new permission', async () => {
  await assert.rejects(refreshGoogleOAuthToken(config, 'synthetic-refresh', response({ ...tokenResponse, scope: GOOGLE_OAUTH_SCOPES[2] })), reason('permissions'));
});

test('client configuration errors do not look like revoked user credentials', async () => {
  for (const error of ['invalid_client', 'unauthorized_client']) {
    await assert.rejects(refreshGoogleOAuthToken(config, 'synthetic-refresh', response({ error, error_description: 'synthetic-private-client-detail' }, 401)), failure => {
      assert.equal(failure.reason, 'not_configured'); assert.equal(failure.status, 503);
      assert.equal(String(failure).includes('synthetic-private-client-detail'), false); return true;
    });
  }
});

test('disconnect revokes using a POST body and tolerates Google being unavailable', async () => {
  const requests = [];
  await revokeGoogleOAuthToken('synthetic-refresh', response({}, 200, requests));
  assert.equal(requests[0].url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(Object.fromEntries(requests[0].init.body), { token: 'synthetic-refresh' });
  await assert.doesNotReject(revokeGoogleOAuthToken('synthetic-refresh', async () => { throw new Error('unavailable'); }));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthApiError, createAuthClient } from '@neondatabase/auth/next';

// Exercise the installed SDK's public API with synthetic data and mocked fetch only.
const email = 'person@example.invalid';

function mockResponse(t, body, status = 200) {
  return t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
}

function assertRequest(fetchMock, path, body) {
  assert.equal(fetchMock.mock.callCount(), 1);
  const [input, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(new URL(String(input), 'https://desk.example.invalid').pathname, path);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'include');
  assert.deepEqual(JSON.parse(init.body), body);
}

test('SDK sends a sign-in OTP through the local auth route with credentials', async (t) => {
  const fetchMock = mockResponse(t, { success: true });
  const client = createAuthClient();

  const result = await client.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });

  assertRequest(fetchMock, '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { success: true });
});

test('SDK verifies an OTP as a string, preserving its leading zero and credentials', async (t) => {
  const response = { token: 'synthetic-token', user: { id: 'synthetic-user', email, emailVerified: true } };
  const fetchMock = mockResponse(t, response);
  const client = createAuthClient();

  const result = await client.signIn.emailOtp({ email, otp: '012345' });

  assertRequest(fetchMock, '/api/auth/sign-in/email-otp', { email, otp: '012345' });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, response);
});

test('SDK throws a normalized AuthApiError for an upstream INVALID_OTP response', async (t) => {
  const fetchMock = mockResponse(t, { code: 'INVALID_OTP', message: 'Invalid OTP' }, 400);
  const client = createAuthClient();

  await assert.rejects(client.signIn.emailOtp({ email, otp: '012345' }), (error) => {
    assert.ok(error instanceof AuthApiError);
    assert.equal(error.name, 'AuthApiError');
    assert.equal(error.status, 400);
    assert.equal(error.code, 'validation_failed');
    assert.equal(error.message, 'Invalid OTP');
    return true;
  });
  assertRequest(fetchMock, '/api/auth/sign-in/email-otp', { email, otp: '012345' });
});

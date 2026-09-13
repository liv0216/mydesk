import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidSignInOtp, normalizeSignInEmail, normalizeSignInOtp, newerSignInRecord, resendSecondsRemaining, restoreSignInRecord, serializeSignInRecord, signInIssue, SIGN_IN_RECORD_TTL_MS } from '../lib/sign-in-flow.ts';

test('send and verify use a trimmed lowercase email identity', () => {
  assert.equal(normalizeSignInEmail('  Person+Desk@EXAMPLE.COM\n'), 'person+desk@example.com');
});
test('OTP normalization accepts fullwidth digits, whitespace, and hyphens without losing leading zeroes', () => {
  assert.equal(normalizeSignInOtp(' ０１２－３４５\n'), '012345');
  assert.equal(normalizeSignInOtp('01\u00a023\t45'), '012345');
  assert.equal(normalizeSignInOtp('01–23—45'), '012345');
  assert.equal(isValidSignInOtp(' ０１２－３４５ '), true);
  for (const value of ['', '12345', '1234567', '123a56', '12.345', '١٢٣٤٥٦']) assert.equal(isValidSignInOtp(value), false, value);
});
test('resend cooldown includes the entire thirty-second interval', () => {
  assert.equal(resendSecondsRemaining(null, 100000), 0);
  assert.equal(resendSecondsRemaining(100000, 100000), 30);
  assert.equal(resendSecondsRemaining(100000, 100001), 30);
  assert.equal(resendSecondsRemaining(100000, 129999), 1);
  assert.equal(resendSecondsRemaining(100000, 130000), 0);
  assert.equal(resendSecondsRemaining(100000, 140000), 0);
});
test('refresh records contain only normalized email and send time, never OTPs or tokens', () => {
  const raw = serializeSignInRecord({ email: ' Person@EXAMPLE.COM ', sentAt: 100000, otp: '123456', token: 'do-not-store' });
  assert.deepEqual(JSON.parse(raw), { email: 'person@example.com', sentAt: 100000 });
  assert.deepEqual(restoreSignInRecord(raw, 100001), { email: 'person@example.com', sentAt: 100000 });
  assert.deepEqual(restoreSignInRecord(JSON.stringify({ email: 'Person@example.com', sentAt: 100000, otp: '123456' }), 100001), { email: 'person@example.com', sentAt: 100000 });
});
test('restore rejects records exactly ten minutes old, future dates, and malformed storage', () => {
  const raw = JSON.stringify({ email: 'person@example.com', sentAt: 100000 });
  assert.ok(restoreSignInRecord(raw, 100000 + SIGN_IN_RECORD_TTL_MS - 1));
  assert.equal(restoreSignInRecord(raw, 100000 + SIGN_IN_RECORD_TTL_MS), null);
  assert.equal(restoreSignInRecord(raw, 99999), null);
  for (const invalid of [null, '', '{broken', 'null', '[]', '{}', JSON.stringify({ email: 'bad email', sentAt: 100000 }), JSON.stringify({ email: 'person@example.com', sentAt: '100000' })]) assert.equal(restoreSignInRecord(invalid, 100001), null);
});
test('cross-tab synchronization accepts only a newer request for the same email', () => {
  const raw = JSON.stringify({ email: 'Person@example.com', sentAt: 110000 });
  assert.deepEqual(newerSignInRecord(raw, ' PERSON@EXAMPLE.COM ', 100000, 110001), { email: 'person@example.com', sentAt: 110000 });
  assert.equal(newerSignInRecord(raw, 'different@example.com', 100000, 110001), null);
  assert.equal(newerSignInRecord(raw, '', null, 110001), null);
  assert.equal(newerSignInRecord(raw, 'person@example.com', 110000, 110001), null);
  assert.equal(newerSignInRecord(raw, 'person@example.com', 120000, 120001), null);
  assert.equal(newerSignInRecord(raw, 'person@example.com', 100000, 110000 + SIGN_IN_RECORD_TTL_MS), null);
});
test('thrown validation_failed SDK errors still recognize the upstream Invalid OTP message', () => {
  const thrown = Object.assign(new Error('Invalid OTP'), { name: 'AuthApiError', code: 'validation_failed', status: 400 });
  assert.equal(signInIssue(thrown, 'verify').kind, 'invalid-otp');
  assert.equal(signInIssue({ error: { code: 'INVALID_OTP', message: 'Invalid OTP' } }, 'verify').kind, 'invalid-otp');
  assert.equal(signInIssue(thrown, 'verify').requiresNewCode, false);
});
test('exhausted attempts and expired codes require a new number while rate limiting asks the user to wait', () => {
  const exhausted = signInIssue({ status: 403, code: 'TOO_MANY_ATTEMPTS' }, 'verify');
  assert.equal(exhausted.kind, 'attempts');
  assert.equal(exhausted.requiresNewCode, true);
  assert.match(exhausted.message, /새 인증번호/);
  assert.equal(signInIssue({ body: { code: 'OTP_EXPIRED' }, status: 400 }, 'verify').requiresNewCode, true);
  const limited = signInIssue({ status: 429, message: 'Too many requests' }, 'send');
  assert.equal(limited.kind, 'rate-limit');
  assert.equal(limited.requiresNewCode, false);
});
test('origin, configuration, server, and network problems have distinct safe Korean explanations', () => {
  assert.equal(signInIssue({ code: 'INVALID_ORIGIN', status: 403 }, 'send').kind, 'origin');
  assert.equal(signInIssue(new Error('Authentication is not configured'), 'send').kind, 'configuration');
  assert.equal(signInIssue({ status: 503, message: 'Service unavailable' }, 'send').kind, 'server');
  assert.equal(signInIssue(new TypeError('Failed to fetch'), 'send').kind, 'network');
  assert.equal(signInIssue({ status: 502, code: 'NEON_AUTH_UPSTREAM_TIMEOUT' }, 'send').kind, 'network');
});
test('unknown SDK errors never disclose raw messages, URLs, or tokens', () => {
  const raw = 'private token abc123 https://internal.example/session';
  const error = Object.assign(new Error(raw), { code: 'UNEXPECTED', body: { debug: raw } });
  error.cause = error;
  for (const reason of [error, raw, null, undefined, { status: 400, message: raw }]) {
    const issue = signInIssue(reason, 'verify');
    assert.match(issue.message, /[가-힣]/);
    assert.equal(issue.message.includes(raw), false);
    assert.equal(issue.message.includes('abc123'), false);
  }
});

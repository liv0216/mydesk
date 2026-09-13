import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptCalendar, encryptCalendar } from '../lib/calendar-crypto.ts';

// Test fixtures only; these values do not identify a real calendar or deployment.
const secret = 'calendar-test-only-secret-0123456789abcdef';
const otherSecret = 'another-test-only-secret-0123456789abcdef';
const url = 'https://calendar.google.com/calendar/ical/test%40example.com/private-test-token/basic.ics';

test('calendar addresses survive encryption and decryption without being stored as plaintext', () => {
  const encrypted = encryptCalendar(url, secret);
  assert.equal(typeof encrypted, 'string');
  assert.notEqual(encrypted, url);
  assert.equal(Buffer.from(encrypted, 'base64').includes(Buffer.from(url)), false);
  assert.equal(decryptCalendar(encrypted, secret), url);
});

test('encrypting the same address twice produces independent ciphertexts that both decrypt', () => {
  const first = encryptCalendar(url, secret);
  const second = encryptCalendar(url, secret);
  assert.notEqual(first, second);
  assert.equal(decryptCalendar(first, secret), url);
  assert.equal(decryptCalendar(second, secret), url);
});

test('a different encryption secret cannot decrypt a saved calendar', () => {
  const encrypted = encryptCalendar(url, secret);
  assert.throws(() => decryptCalendar(encrypted, otherSecret));
  assert.equal(decryptCalendar(encrypted, secret), url);
});

test('tampering with the nonce, authentication tag, or ciphertext is rejected', () => {
  const encrypted = encryptCalendar(url, secret);
  const bytes = Buffer.from(encrypted, 'base64');
  for (const [part, offset] of [['nonce', 0], ['authentication tag', 12], ['ciphertext', bytes.length - 1]]) {
    const tampered = Buffer.from(bytes);
    tampered[offset] ^= 1;
    assert.throws(() => decryptCalendar(tampered.toString('base64'), secret), undefined, `${part} tampering must fail`);
  }
  assert.equal(decryptCalendar(encrypted, secret), url);
});

test('truncated or malformed saved values fail closed', () => {
  const bytes = Buffer.from(encryptCalendar(url, secret), 'base64');
  for (const invalid of ['', 'not-a-calendar-cipher', bytes.subarray(0, 20).toString('base64'), bytes.subarray(0, bytes.length - 1).toString('base64')]) {
    assert.throws(() => decryptCalendar(invalid, secret));
  }
});

test('an undersized encryption secret is rejected for both saving and reading', () => {
  const encrypted = encryptCalendar(url, secret);
  assert.throws(() => encryptCalendar(url, 'too-short'));
  assert.throws(() => decryptCalendar(encrypted, 'too-short'));
});

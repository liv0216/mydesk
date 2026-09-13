export const SIGN_IN_RECORD_KEY = 'mydesk-sign-in-request-v1';
export const SIGN_IN_RECORD_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
export type SignInRecord = { email: string; sentAt: number };
export type SignInIssue = { kind: string; message: string; requiresNewCode: boolean };
export function normalizeSignInEmail(value: string) { return value.trim().toLowerCase(); }
export function normalizeSignInOtp(value: string) { return value.normalize('NFKC').replace(/[\s\-‐‑‒–—−]/gu, ''); }
export function isValidSignInOtp(value: string) { return /^\d{6}$/.test(normalizeSignInOtp(value)); }
export function resendSecondsRemaining(sentAt: number | null, now: number) {
  return sentAt === null ? 0 : Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - (now - sentAt)) / 1000));
}
export function serializeSignInRecord(record: SignInRecord) {
  return JSON.stringify({ email: normalizeSignInEmail(record.email), sentAt: record.sentAt });
}
export function restoreSignInRecord(raw: string | null, now: number): SignInRecord | null {
  if (!raw || !Number.isFinite(now)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.email !== 'string' || typeof record.sentAt !== 'number' || !Number.isFinite(record.sentAt)) return null;
    const email = normalizeSignInEmail(record.email), age = now - record.sentAt;
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254 || record.sentAt <= 0 || age < 0 || age >= SIGN_IN_RECORD_TTL_MS) return null;
    return { email, sentAt: record.sentAt };
  } catch { return null; }
}
export function newerSignInRecord(raw: string | null, email: string, sentAt: number | null, now: number) {
  const record = restoreSignInRecord(raw, now);
  return record && record.email === normalizeSignInEmail(email) && record.sentAt > (sentAt ?? 0) ? record : null;
}
export function signInIssue(error: unknown, action: 'send' | 'verify'): SignInIssue {
  const pieces: string[] = [], statuses: number[] = [];
  const seen = new Set<object>();
  function inspect(value: unknown, depth = 0) {
    if (depth > 3) return;
    if (typeof value === 'string') { pieces.push(value.slice(0, 2000)); return; }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const item = value as Record<string, unknown>;
    for (const key of ['code', 'message', 'statusText', 'name']) if (typeof item[key] === 'string') pieces.push(item[key].slice(0, 2000));
    for (const key of ['status', 'statusCode']) {
      const status = Number(item[key]);
      if (Number.isInteger(status) && status >= 100 && status <= 599) statuses.push(status);
    }
    for (const key of ['error', 'body', 'data', 'cause', 'response']) inspect(item[key], depth + 1);
  }
  inspect(error);
  const detail = pieces.join(' ').toLowerCase().replace(/[_-]+/g, ' ');
  const issue = (kind: string, message: string, requiresNewCode = false) => ({ kind, message, requiresNewCode });
  if (/too many attempts|maximum.*attempt|attempt.*exceed|attempts? limit/.test(detail)) return issue('attempts', '입력 시도 횟수를 초과했어요. 새 인증번호를 받은 뒤 다시 입력해 주세요.', true);
  if (/expired|expir(?:y|ation)/.test(detail)) return issue('expired', '인증번호가 만료됐어요. 새 인증번호를 받아 주세요.', true);
  if (statuses.includes(429) || /rate limit|too many requests|throttl/.test(detail)) return issue('rate-limit', '요청이 많아 잠시 제한됐어요. 잠시 기다린 뒤 다시 시도해 주세요.');
  if (/invalid otp|incorrect otp|otp.*(?:invalid|incorrect)|invalid verification code|invalid code/.test(detail)) return issue('invalid-otp', '인증번호가 맞지 않아요. 가장 최근 메일의 6자리 번호를 확인해 주세요.');
  if (/origin|cors/.test(detail)) return issue('origin', '이 사이트 주소에서 로그인이 허용되지 않아요. 사이트의 로그인 설정을 확인해야 합니다.');
  if (/not configured|configuration|missing.*(?:secret|config)|not enabled|disabled|invalid.*base ?url/.test(detail)) return issue('configuration', '이메일 로그인 설정이 준비되지 않았어요. 사이트 관리자에게 확인을 요청해 주세요.');
  if (/network|failed to fetch|fetch failed|timeout|timed out|econn|enotfound|abort/.test(detail)) return issue('network', '서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
  if (statuses.some(status => status >= 500)) return issue('server', '로그인 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.');
  if (statuses.includes(403)) return issue('forbidden', '로그인 요청이 허용되지 않았어요. 잠시 후에도 계속되면 사이트 관리자에게 알려 주세요.');
  return issue('unknown', action === 'send' ? '인증번호를 보내지 못했어요. 이메일 주소를 확인하고 잠시 후 다시 시도해 주세요.' : '로그인하지 못했어요. 가장 최근 메일의 번호를 확인하고 다시 시도해 주세요.');
}

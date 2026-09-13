"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { CalendarDays, ArrowRight, LoaderCircle } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { isValidSignInOtp, normalizeSignInEmail, normalizeSignInOtp, newerSignInRecord, resendSecondsRemaining, restoreSignInRecord, serializeSignInRecord, signInIssue, SIGN_IN_RECORD_KEY, SIGN_IN_RECORD_TTL_MS } from "@/lib/sign-in-flow";

function savedRequest(now: number) {
  try {
    const record = restoreSignInRecord(window.localStorage.getItem(SIGN_IN_RECORD_KEY), now);
    if (!record) window.localStorage.removeItem(SIGN_IN_RECORD_KEY);
    return record;
  } catch { return null; }
}
function forgetRequest(email: string) {
  try {
    const record = savedRequest(Date.now());
    if (!record || record.email === email) window.localStorage.removeItem(SIGN_IN_RECORD_KEY);
  } catch { /* Storage is optional. */ }
}

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsNewCode, setNeedsNewCode] = useState(false);
  const inFlight = useRef(false);
  const otpInput = useRef<HTMLInputElement>(null);
  const cooldown = resendSecondsRemaining(sentAt, now);

  useEffect(() => {
    const current = Date.now(), record = savedRequest(current);
    setNow(current);
    if (record) { setEmail(record.email); setSentAt(record.sentAt); setSent(true); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (sentAt === null) return;
    const timer = window.setInterval(() => {
      const current = Date.now(); setNow(current);
      if (current - sentAt >= SIGN_IN_RECORD_TTL_MS) savedRequest(current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sentAt]);

  useEffect(() => {
    function received(event: StorageEvent) {
      if (event.key !== SIGN_IN_RECORD_KEY) return;
      const current = Date.now(), record = newerSignInRecord(event.newValue, email, sentAt, current);
      if (!record) return;
      setSent(true); setSentAt(record.sentAt); setNow(current); setOtp(""); setNeedsNewCode(false); setError("");
      setNotice("다른 탭에서 새 인증번호를 받았어요. 가장 최근 메일의 번호를 입력해 주세요.");
    }
    window.addEventListener('storage', received);
    return () => window.removeEventListener('storage', received);
  }, [email, sentAt]);

  useEffect(() => { if (sent && !busy) otpInput.current?.focus(); }, [sent, busy]);

  async function request(action: 'send' | 'verify') {
    if (!ready || inFlight.current) return;
    const normalizedEmail = normalizeSignInEmail(email), current = Date.now();
    if (action === 'send') {
      const shared = savedRequest(current);
      if (shared?.email === normalizedEmail && resendSecondsRemaining(shared.sentAt, current) > 0) {
        setEmail(normalizedEmail); setSent(true); setSentAt(shared.sentAt); setNow(current); setOtp(""); setNeedsNewCode(false); setError("");
        setNotice("방금 발송한 번호가 있어요. 가장 최근 메일의 번호를 입력하거나 잠시 후 다시 받아 주세요.");
        return;
      }
      if (resendSecondsRemaining(sentAt, current) > 0) return;
    }
    if (action === 'verify' && needsNewCode) return;
    const normalizedOtp = normalizeSignInOtp(otp);
    if (action === 'verify' && !isValidSignInOtp(normalizedOtp)) {
      setError('인증번호는 숫자 6자리로 입력해 주세요.'); otpInput.current?.focus(); return;
    }
    inFlight.current = true; setBusy(action); setError(""); setNotice(""); setEmail(normalizedEmail);
    let navigating = false;
    try {
      if (action === 'send') {
        setOtp("");
        const result = await authClient.emailOtp.sendVerificationOtp({ email: normalizedEmail, type: 'sign-in' });
        if (result.error) throw result.error;
        const timestamp = Date.now();
        setSent(true); setSentAt(timestamp); setNow(timestamp); setNeedsNewCode(false);
        try { window.localStorage.setItem(SIGN_IN_RECORD_KEY, serializeSignInRecord({ email: normalizedEmail, sentAt: timestamp })); } catch { /* Sign-in works without storage. */ }
      } else {
        setOtp(normalizedOtp);
        const result = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: normalizedOtp });
        if (result.error) throw result.error;
        forgetRequest(normalizedEmail); window.location.assign('/'); navigating = true;
      }
    } catch (reason) {
      const issue = signInIssue(reason, action); setError(issue.message);
      if (issue.requiresNewCode) { setNeedsNewCode(true); setOtp(""); }
    } finally {
      if (!navigating) { inFlight.current = false; setBusy(null); }
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void request(sent ? 'verify' : 'send'); }
  function changeEmail() {
    if (inFlight.current) return;
    setSent(false); setOtp(""); setError(""); setNotice(""); setNeedsNewCode(false);
  }
  const disabled = !ready || busy !== null;
  const sentTime = sentAt === null ? '' : new Date(sentAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return <main className="sign-in-screen"><section className="sign-in-card">
    <div className="sign-in-brand"><CalendarDays size={25} /><span>MY DESK</span></div>
    <h1>나만의 하루를<br />한곳에.</h1>
    <p>일정, 시간표, 할 일을 내 계정에 저장하세요.<br />Google 캘린더도 함께 볼 수 있어요.</p>
    <form onSubmit={submit} aria-busy={busy !== null}>
      <label>이메일<input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={sent || disabled} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      {sent && <>
        <div className="auth-delivery" role="status"><strong>인증번호 발송 완료 · {sentTime}</strong><p>가장 최근에 받은 메일의 번호만 입력해 주세요. 다시 받으면 이전 번호는 사용할 수 없어요.</p></div>
        <label>이메일로 받은 인증번호<input ref={otpInput} inputMode="numeric" autoComplete="one-time-code" required maxLength={24} value={otp} disabled={disabled || needsNewCode} onChange={event => setOtp(event.target.value)} onBlur={() => setOtp(value => normalizeSignInOtp(value))} placeholder="숫자 6자리" aria-describedby="auth-code-help" aria-invalid={Boolean(error)} /></label>
        <p id="auth-code-help" className="auth-help">다른 탭에서 새 번호를 받았다면 가장 최근 메일의 번호를 사용하세요. 메일이 보이지 않으면 스팸함도 확인해 주세요.</p>
      </>}
      {notice && <p className="auth-help auth-notice" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="sign-in-submit" disabled={disabled || (sent ? needsNewCode : cooldown > 0)}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{busy === 'send' ? '인증번호 보내는 중…' : busy === 'verify' ? '로그인 확인 중…' : sent ? '내 데스크 열기' : cooldown > 0 ? cooldown + '초 후 발송 가능' : '이메일로 시작하기'}</button>
      {sent && <div className="auth-secondary-actions"><button type="button" className="auth-resend" disabled={disabled || cooldown > 0} onClick={() => void request('send')}>{cooldown > 0 ? '인증번호 다시 받기 (' + cooldown + '초)' : '인증번호 다시 받기'}</button><button type="button" className="auth-back" disabled={disabled} onClick={changeEmail}>이메일 변경</button></div>}
    </form>
    <small>처음이라면 인증 후 개인 데스크가 만들어집니다.<br />내 일정은 다른 사용자에게 보이지 않습니다.</small>
  </section></main>;
}

"use client";
import { FormEvent, useState } from "react";
import { CalendarDays, ArrowRight, LoaderCircle } from "lucide-react";
import { authClient } from "@/lib/auth/client";
export default function SignIn() {
  const [email, setEmail] = useState(""); const [otp, setOtp] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!sent) {
        const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
        if (result.error) throw new Error("인증번호를 보내지 못했어요. 이메일 주소를 확인하거나 잠시 후 다시 시도해 주세요.");
        setSent(true);
      } else {
        const result = await authClient.signIn.emailOtp({ email: email.trim(), otp: otp.trim() });
        if (result.error) throw new Error("인증번호가 올바르지 않거나 만료됐어요.");
        window.location.assign("/");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그인하지 못했어요."); } finally { setBusy(false); }
  }
  return <main className="sign-in-screen"><section className="sign-in-card"><div className="sign-in-brand"><CalendarDays size={25} /><span>MY DESK</span></div><h1>나만의 하루를<br />한곳에.</h1><p>일정, 시간표, 할 일을 내 계정에 저장하세요.<br />Google 캘린더도 함께 볼 수 있어요.</p><form onSubmit={submit}><label>이메일<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={sent || busy} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></label>{sent && <label>이메일로 받은 인증번호<input inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} value={otp} onChange={e=>setOtp(e.target.value)} autoFocus /></label>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="sign-in-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{sent ? "내 데스크 열기" : "이메일로 시작하기"}</button>{sent && <button type="button" className="auth-back" onClick={()=>{setSent(false);setOtp("");}}>이메일 변경 · 인증번호 다시 받기</button>}</form><small>처음이라면 인증 후 개인 데스크가 만들어집니다.<br />내 일정은 다른 사용자에게 보이지 않습니다.</small></section></main>;
}

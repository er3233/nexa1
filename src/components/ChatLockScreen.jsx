import React, { useState, useRef, useEffect, useCallback } from "react";
import { Lock, Loader2, AlertTriangle, KeyRound, ChevronLeft } from "lucide-react";

function PinBoxes({ value, onChange, disabled, onComplete }) {
  const refs = useRef([]);
  const set = (i, v) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = value.split("");
    next[i] = d;
    const joined = next.join("").slice(0, 4);
    onChange(joined);
    if (d && i < 3) refs.current[i + 1]?.focus();
    if (joined.length === 4 && next.every((x) => x)) onComplete?.(joined);
  };
  const onKey = (i, e) => {
    if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
  };
  return (
    <div className="flex items-center justify-center gap-3" onPaste={(e) => e.preventDefault()}>
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={value[i] || ""}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          disabled={disabled}
          inputMode="numeric"
          type="password"
          autoComplete="one-time-code"
          maxLength={1}
          aria-label={`PIN ${i + 1}. hane`}
          className="w-14 h-16 text-center rounded-[18px] nx-surface outline-none"
          style={{ fontSize: "24px", color: "var(--txt)", caretColor: "var(--blue)" }}
        />
      ))}
    </div>
  );
}

function useCountdown(until) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return 0;
  return Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000));
}

export default function ChatLockScreen({ name, status, onVerify, onForgot, onBack }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [remaining, setRemaining] = useState(status?.remaining_attempts ?? 5);
  const [lockedUntil, setLockedUntil] = useState(status?.locked_until || null);
  const [showForgot, setShowForgot] = useState(false);
  const [pwd, setPwd] = useState("");
  const [forgotErr, setForgotErr] = useState("");

  useEffect(() => { setLockedUntil(status?.locked_until || null); setRemaining(status?.remaining_attempts ?? 5); }, [status]);

  const secs = useCountdown(lockedUntil);
  const hardLocked = !!lockedUntil && secs > 0;

  const submit = useCallback(async (val) => {
    const p = (val ?? pin);
    if (busy || hardLocked || p.length !== 4) return;
    setBusy(true); setErr("");
    try {
      const res = await onVerify(p);
      if (res?.success) return; // ebeveyn durum yenileyip ekranı kaldırır
      setPin("");
      if (res?.locked_until) { setLockedUntil(res.locked_until); setErr("Çok fazla hatalı deneme. Sohbet geçici olarak kilitlendi."); }
      else { setRemaining(res?.remaining_attempts ?? 0); setErr(`Yanlış PIN. Kalan deneme: ${res?.remaining_attempts ?? 0}`); }
    } catch (_) {
      setErr("Doğrulama başarısız. Tekrar deneyin."); setPin("");
    } finally { setBusy(false); }
  }, [pin, busy, hardLocked, onVerify]);

  const doForgot = async () => {
    if (!pwd) return;
    setBusy(true); setForgotErr("");
    try { await onForgot(pwd); } catch (e) { setForgotErr(e?.message || "Parola doğrulanamadı."); } finally { setBusy(false); }
  };

  const mm = Math.floor(secs / 60), ss = secs % 60;

  return (
    <div className="absolute inset-0 z-[45] flex flex-col items-center justify-center px-8 nx-in"
      style={{ background: "var(--ink0)", paddingTop: "calc(env(safe-area-inset-top) + 12px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      {onBack && (
        <button onClick={onBack} className="absolute left-3 p-2 rounded-xl active:scale-90 transition-transform"
          style={{ top: "calc(env(safe-area-inset-top) + 10px)" }} aria-label="Geri">
          <ChevronLeft size={22} style={{ color: "var(--txt2)" }} />
        </button>
      )}
      <div className="w-16 h-16 rounded-[24px] flex items-center justify-center mb-5" style={{ background: "var(--ink2)", border: "1px solid var(--line)" }}>
        <Lock size={26} style={{ color: "var(--blue)" }} />
      </div>
      <h2 className="nx-display text-[18px] font-bold">Kilitli Sohbet</h2>
      <p className="text-[12.5px] text-center mt-1 mb-6" style={{ color: "var(--txt3)" }}>
        {name ? `${name} sohbeti kilitli.` : "Bu sohbet kilitli."} Açmak için 4 haneli PIN girin.
      </p>

      {!showForgot ? (
        <>
          <PinBoxes value={pin} onChange={setPin} disabled={busy || hardLocked} onComplete={(v) => submit(v)} />

          {err && (
            <div className="flex items-center gap-1.5 mt-4" style={{ color: "var(--red)" }}>
              <AlertTriangle size={13} /> <span className="text-[12px]">{err}</span>
            </div>
          )}
          {hardLocked ? (
            <p className="nx-mono text-[11px] mt-4" style={{ color: "var(--warn)" }}>
              {mm}:{String(ss).padStart(2, "0")} sonra tekrar deneyebilirsiniz
            </p>
          ) : (
            !err && <p className="text-[11px] mt-4" style={{ color: "var(--txt3)" }}>Kalan deneme: {remaining}</p>
          )}

          <button onClick={() => submit()} disabled={busy || hardLocked || pin.length !== 4}
            className="mt-6 w-full max-w-[280px] h-12 rounded-[18px] nx-btn-primary flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ fontSize: "14px", fontWeight: 600 }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />} Kilidi Aç
          </button>

          <button onClick={() => { setShowForgot(true); setErr(""); }} className="mt-4 text-[12px]" style={{ color: "var(--txt3)" }}>
            PIN'i mi unuttunuz?
          </button>
        </>
      ) : (
        <div className="w-full max-w-[300px] flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-3" style={{ color: "var(--txt2)" }}>
            <KeyRound size={14} /> <span className="text-[12.5px]">Hesap parolanızla kilidi kaldırın</span>
          </div>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Hesap parolası"
            className="w-full h-12 rounded-[16px] nx-surface px-4 outline-none" style={{ fontSize: "16px", color: "var(--txt)" }} />
          {forgotErr && <p className="text-[12px] mt-2" style={{ color: "var(--red)" }}>{forgotErr}</p>}
          <button onClick={doForgot} disabled={busy || !pwd}
            className="mt-4 w-full h-12 rounded-[18px] nx-btn-primary flex items-center justify-center gap-2 disabled:opacity-40" style={{ fontSize: "14px", fontWeight: 600 }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} Kilidi Kaldır
          </button>
          <button onClick={() => { setShowForgot(false); setForgotErr(""); setPwd(""); }} className="mt-3 text-[12px]" style={{ color: "var(--txt3)" }}>
            Geri
          </button>
        </div>
      )}
    </div>
  );
}

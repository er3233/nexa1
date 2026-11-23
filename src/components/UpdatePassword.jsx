import React, { useState } from "react";
import { KeyRound, Loader2, Shield, AlertTriangle } from "lucide-react";
import { updatePassword, toTurkishAuthError } from "../services/auth";

// Şifre sıfırlama bağlantısından dönen kullanıcı için yeni parola belirleme.
export default function UpdatePassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const submit = async () => {
    if (busy) return;
    setErr("");
    if (pw.length < 6) { setErr("Parola en az 6 karakter olmalı."); return; }
    if (pw !== pw2) { setErr("Parolalar eşleşmiyor."); return; }
    setBusy(true);
    try {
      await updatePassword(pw);
      setOk(true);
      setTimeout(() => onDone?.(), 900);
    } catch (e) {
      setErr(toTurkishAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col px-7 nx-in relative z-10">
      <div className="flex-1 flex flex-col justify-center">
        <div className="mb-8">
          <p className="nx-mono text-[9px] tracking-[0.34em] mb-3" style={{ color: "var(--txt3)" }}>PAROLA YENİLEME</p>
          <h1 className="nx-display text-[28px] font-bold tracking-tight leading-none">Yeni parola</h1>
          <p className="text-[13px] mt-3" style={{ color: "var(--txt2)" }}>Hesabın için yeni bir parola belirle.</p>
        </div>

        {err && (
          <div className="rounded-[18px] px-3.5 py-3 mb-4 flex items-center gap-2.5"
            style={{ background: "rgba(229,72,77,0.10)", border: "1px solid rgba(229,72,77,0.3)" }}>
            <AlertTriangle size={13} className="shrink-0" style={{ color: "var(--red)" }} />
            <span className="text-[11.5px] leading-snug" style={{ color: "var(--red)" }}>{err}</span>
          </div>
        )}
        {ok && (
          <div className="rounded-[18px] px-3.5 py-3 mb-4 flex items-center gap-2.5"
            style={{ background: "rgba(62,207,142,0.08)", border: "1px solid rgba(62,207,142,0.28)" }}>
            <Shield size={13} className="shrink-0" style={{ color: "var(--green)" }} />
            <span className="text-[11.5px] leading-snug" style={{ color: "var(--txt2)" }}>Parola güncellendi. Yönlendiriliyorsun…</span>
          </div>
        )}

        <div className="space-y-2.5 mb-6">
          <div className="nx-surface rounded-[20px] flex items-center gap-3 px-4" style={{ height: 52 }}>
            <KeyRound size={15} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Yeni parola"
              autoComplete="new-password" className="flex-1 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--txt)" }} />
          </div>
          <div className="nx-surface rounded-[20px] flex items-center gap-3 px-4" style={{ height: 52 }}>
            <KeyRound size={15} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder="Yeni parola (tekrar)" autoComplete="new-password"
              className="flex-1 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--txt)" }} />
          </div>
        </div>

        <button onClick={submit} disabled={busy}
          className="h-[52px] rounded-[20px] nx-btn-primary text-[14px] flex items-center justify-center gap-2"
          style={{ opacity: busy ? 0.7 : 1 }}>
          {busy && <Loader2 size={15} className="animate-spin" />} Parolayı Güncelle
        </button>
      </div>
    </div>
  );
}

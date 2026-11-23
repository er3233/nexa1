import React, { useState } from "react";
import { Shield, User, KeyRound, AlertTriangle, AtSign, Loader2 } from "lucide-react";
import { signIn, signUp, resetPassword, toTurkishAuthError } from "../services/auth";
import { isSupabaseConfigured } from "../lib/supabase";
import NexaModel from "./NexaModel";

export default function Login() {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "reset"
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [username, setUsername] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";
  const isReset = mode === "reset";

  const submit = async () => {
    if (busy) return;
    setErr("");
    setInfo("");

    if (!isSupabaseConfigured) {
      setErr("Supabase ayarlı değil. Proje kökündeki .env dosyasına anahtarları girip sunucuyu yeniden başlat.");
      return;
    }
    if (!email.trim()) {
      setErr("E-posta gerekli.");
      return;
    }

    if (isReset) {
      setBusy(true);
      try {
        await resetPassword(email.trim());
        setInfo("Şifre sıfırlama bağlantısı e-postana gönderildi. Gelen kutunu kontrol et.");
      } catch (e) {
        setErr(toTurkishAuthError(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!pw) {
      setErr("Parola gerekli.");
      return;
    }
    if (isSignup && pw.length < 6) {
      setErr("Parola en az 6 karakter olmalı.");
      return;
    }

    setBusy(true);
    try {
      if (isSignup) {
        const data = await signUp({ email: email.trim(), password: pw, username: username.trim() });
        // Oturum gelirse useAuth otomatik olarak "onay bekliyor" ekranına yönlendirir.
        if (!data.session) {
          setInfo("Kayıt alındı. Giriş yaptıktan sonra hesabınız yönetici onayına düşecek.");
          setMode("login");
        }
      } else {
        await signIn({ email: email.trim(), password: pw });
        // Başarılı giriş: useAuth oturum değişimini yakalar, ekran otomatik geçer.
      }
    } catch (e) {
      setErr(toTurkishAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="nx-login h-full flex flex-col px-7 nx-in relative z-10">
      <div className="flex-1 flex flex-col justify-center">
        <div className="nx-login-heading mb-8">
          <NexaModel />
          <p className="nx-mono text-[9px] tracking-[0.24em] mb-3" style={{ color: "var(--txt3)" }}>DAHA YAKIN İLETİŞİM</p>
          <h1 className="nx-display text-[38px] font-bold tracking-tight leading-none">NEXA<span className="nx-title-dot">.</span></h1>
          <p className="text-[13.5px] mt-3" style={{ color: "var(--txt2)" }}>Konuşmaların için özel bir alan.</p>
        </div>

        {/* mod seçici */}
        <div className="nx-surface rounded-[18px] p-1 flex mb-5">
          {[
            { id: "login", label: "Giriş Yap" },
            { id: "signup", label: "Kayıt Ol" },
          ].map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => { setMode(m.id); setErr(""); setInfo(""); }}
                className="flex-1 h-10 rounded-[14px] text-[13px] font-semibold transition-colors"
                style={{ background: active ? "var(--ink3)" : "transparent", color: active ? "var(--txt)" : "var(--txt3)" }}>
                {m.label}
              </button>
            );
          })}
        </div>

        {!isSupabaseConfigured && (
          <div className="nx-surface rounded-[18px] px-3.5 py-3 mb-4 flex items-center gap-2.5">
            <AlertTriangle size={13} className="shrink-0" style={{ color: "var(--warn)" }} />
            <span className="text-[11.5px] leading-snug" style={{ color: "var(--txt2)" }}>
              Supabase bağlantısı yok. .env dosyasına VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY girip sunucuyu yeniden başlat.
            </span>
          </div>
        )}

        {err && (
          <div className="rounded-[18px] px-3.5 py-3 mb-4 flex items-center gap-2.5 nx-in"
            style={{ background: "rgba(229,72,77,0.10)", border: "1px solid rgba(229,72,77,0.3)" }}>
            <AlertTriangle size={13} className="shrink-0" style={{ color: "var(--red)" }} />
            <span className="text-[11.5px] leading-snug" style={{ color: "var(--red)" }}>{err}</span>
          </div>
        )}
        {info && (
          <div className="rounded-[18px] px-3.5 py-3 mb-4 flex items-center gap-2.5 nx-in"
            style={{ background: "rgba(62,207,142,0.08)", border: "1px solid rgba(62,207,142,0.28)" }}>
            <Shield size={13} className="shrink-0" style={{ color: "var(--green)" }} />
            <span className="text-[11.5px] leading-snug" style={{ color: "var(--txt2)" }}>{info}</span>
          </div>
        )}

        <div className="space-y-2.5 mb-6">
          {isSignup && (
            <div className="nx-surface rounded-[20px] flex items-center gap-3 px-4 nx-in" style={{ height: 52 }}>
              <AtSign size={15} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
              <input aria-label="Kullanıcı adı" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={onKeyDown}
                placeholder="Kullanıcı adı (opsiyonel)" autoComplete="username"
                className="flex-1 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--txt)" }} />
            </div>
          )}
          <div className="nx-surface rounded-[20px] flex items-center gap-3 px-4" style={{ height: 52 }}>
            <User size={15} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
            <input aria-label="E-posta" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKeyDown}
              type="email" placeholder="E-posta" autoComplete="email"
              className="flex-1 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--txt)" }} />
          </div>
          {!isReset && (
            <div className="nx-surface rounded-[20px] flex items-center gap-3 px-4" style={{ height: 52 }}>
              <KeyRound size={15} strokeWidth={1.8} style={{ color: "var(--txt3)" }} />
              <input aria-label="Parola" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={onKeyDown}
                placeholder="Parola" autoComplete={isSignup ? "new-password" : "current-password"}
                className="flex-1 bg-transparent outline-none text-[13.5px]" style={{ color: "var(--txt)" }} />
            </div>
          )}
          {mode === "login" && (
            <button onClick={() => { setMode("reset"); setErr(""); setInfo(""); }}
              className="text-[11.5px] font-medium ml-1" style={{ color: "var(--txt3)" }}>
              Şifremi unuttum?
            </button>
          )}
          {isReset && (
            <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }}
              className="text-[11.5px] font-medium ml-1" style={{ color: "var(--txt3)" }}>
              ← Girişe dön
            </button>
          )}
        </div>

        <div className="flex gap-2.5 items-center">
          <button onClick={submit} disabled={busy}
            className="flex-1 h-[52px] rounded-[20px] nx-btn-primary text-[14px] flex items-center justify-center gap-2"
            style={{ opacity: busy ? 0.7 : 1 }}>
            {busy && <Loader2 size={15} className="animate-spin" />}
            {isReset ? "Sıfırlama Bağlantısı Gönder" : isSignup ? "Hesap Oluştur" : "Güvenli Giriş"}
          </button>
        </div>
      </div>

      <div className="pb-8 flex items-center justify-center gap-3">
        <span className="flex items-center gap-1.5 nx-mono text-[8.5px] tracking-[0.18em]" style={{ color: "var(--txt3)" }}>
          <Shield size={10} style={{ color: "var(--txt2)" }} /> NEXA CHAT
        </span>
        <span className="w-[3px] h-[3px] rounded-full" style={{ background: "var(--txt3)" }} />
        <span className="nx-mono text-[8.5px] tracking-[0.18em]" style={{ color: "var(--txt3)" }}>İLETİŞİM ALANIN</span>
      </div>
    </div>
  );
}

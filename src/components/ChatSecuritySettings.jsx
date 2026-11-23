import React, { useState } from "react";
import { X, Radio, Lock, LockOpen, KeyRound, ShieldOff, Loader2, AlertTriangle, Check, Clock } from "lucide-react";

const DISAPPEARING_PRESETS = [
  { label: "Kapalı", seconds: null },
  { label: "1 saat", seconds: 3600 },
  { label: "1 gün", seconds: 86400 },
  { label: "1 hafta", seconds: 604800 },
];

function NumPin({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      inputMode="numeric"
      type="password"
      autoComplete="one-time-code"
      placeholder={placeholder || "4 haneli PIN"}
      onPaste={(e) => e.preventDefault()}
      className="w-full h-12 rounded-[16px] nx-surface px-4 outline-none tracking-[0.4em]"
      style={{ fontSize: "16px", color: "var(--txt)" }}
    />
  );
}

function Row({ icon: Icon, label, tone, onClick, danger }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3.5 py-3.5 rounded-[16px] nx-surface text-left min-h-[48px] active:scale-[0.99] transition-transform">
      <Icon size={16} style={{ color: tone || (danger ? "var(--red)" : "var(--txt2)") }} />
      <span className="text-[13.5px]" style={{ color: danger ? "var(--red)" : "var(--txt)" }}>{label}</span>
    </button>
  );
}

export default function ChatSecuritySettings({ conversationName, lock, live, onClose, disappearingSeconds = null, onSetDisappearing }) {
  const [mode, setMode] = useState(null); // 'create' | 'change' | 'remove'
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [disBusy, setDisBusy] = useState(false);

  const ls = lock.status || {};
  const lt = live.status || {};

  const reset = () => { setPin(""); setPin2(""); setErr(""); setOk(""); setMode(null); };

  const run = async (fn, successMsg) => {
    setBusy(true); setErr(""); setOk("");
    try {
      const res = await fn();
      if (res && res.success === false) {
        setErr(res.locked_until ? "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin." : `Yanlış PIN. Kalan deneme: ${res.remaining_attempts ?? 0}`);
        return;
      }
      setOk(successMsg); setPin(""); setPin2(""); setMode(null);
      await lock.reload?.();
    } catch (e) {
      setErr(e?.message || "İşlem başarısız.");
    } finally { setBusy(false); }
  };

  const createPinFlow = async () => {
    if (pin.length !== 4) { setErr("PIN 4 rakam olmalıdır."); return; }
    if (pin !== pin2) { setErr("PIN'ler eşleşmiyor."); return; }
    setBusy(true); setErr(""); setOk("");
    try {
      await lock.createPin(pin);
      setOk("Sohbet kilidi oluşturuldu. 'Şimdi Kilitle' ile sohbeti gizleyebilirsiniz.");
      setPin(""); setPin2(""); setMode(null);
    } catch (e) {
      setErr(e?.message || "PIN oluşturulamadı.");
    } finally { setBusy(false); }
  };

  const toggleLive = async () => {
    setErr(""); setOk("");
    try {
      await live.setEnabled(!lt.me_enabled);
      setOk(lt.me_enabled ? "Canlı yazım kapatıldı." : "Canlı yazım açıldı. Karşı taraf da açmalı.");
      await live.reloadStatus?.();
    } catch (e) { setErr(e?.message || "Canlı yazım değiştirilemedi."); }
  };

  const changeDisappearing = async (seconds) => {
    if (seconds === disappearingSeconds) return;
    setErr(""); setOk(""); setDisBusy(true);
    try {
      await onSetDisappearing?.(seconds);
      setOk(seconds ? "Kaybolan mesajlar açıldı." : "Kaybolan mesajlar kapatıldı.");
    } catch (e) {
      setErr(e?.message || "Kaybolan mesaj süresi değiştirilemedi.");
    } finally { setDisBusy(false); }
  };

  return (
    <div className="absolute inset-0 z-[60] flex flex-col" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="mt-auto nx-raised rounded-t-[26px] flex flex-col" style={{ background: "var(--ink1)", maxHeight: "88%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
          <ShieldOff size={16} style={{ color: "var(--txt2)" }} />
          <h2 className="nx-display text-[15px] font-bold">Sohbet Güvenliği</h2>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg" aria-label="Kapat"><X size={18} style={{ color: "var(--txt3)" }} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto nx-scroll px-4 py-4 space-y-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          {ok && <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--green, #35C28B)" }}><Check size={14} /> {ok}</div>}
          {(err || lock.error || live.error) && (
            <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--red)" }}>
              <AlertTriangle size={14} /> {err || lock.error || live.error}
            </div>
          )}

          {/* CANLI YAZIM */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Radio size={14} style={{ color: "var(--violet)" }} />
              <h3 className="text-[13px] font-semibold">Canlı Yazım</h3>
            </div>
            {!lt.eligible ? (
              <p className="text-[12px] px-1" style={{ color: "var(--txt3)" }}>
                Canlı yazım yalnızca birebir, onaylı ve engelsiz sohbetlerde kullanılabilir.
              </p>
            ) : (
              <>
                <button onClick={toggleLive} className="w-full flex items-center gap-3 px-3.5 py-3.5 rounded-[16px] nx-surface text-left min-h-[48px]">
                  <span className="flex-1 text-[13.5px]">Canlı yazımı {lt.me_enabled ? "kapat" : "aç"}</span>
                  <span className="w-11 h-6 rounded-full relative transition-colors" style={{ background: lt.me_enabled ? "var(--blue)" : "var(--ink3)" }}>
                    <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: lt.me_enabled ? "22px" : "2px" }} />
                  </span>
                </button>
                <p className="text-[11.5px] mt-2 px-1" style={{ color: "var(--txt3)" }}>
                  Karşı taraf: {lt.other_enabled ? "açık" : "kapalı"}. İki taraf da açınca çalışır.
                </p>
                {lt.active && (
                  <p className="text-[11.5px] mt-2 px-3 py-2 rounded-[12px]" style={{ color: "var(--violet)", background: "rgba(139,124,255,0.10)", border: "1px dashed var(--violet)" }}>
                    Canlı yazım açık — yazdıkların gönderilmeden karşı tarafça görülebilir.
                  </p>
                )}
              </>
            )}
          </section>

          {/* KAYBOLAN MESAJLAR */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Clock size={14} style={{ color: "var(--warn)" }} />
              <h3 className="text-[13px] font-semibold">Kaybolan Mesajlar</h3>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {DISAPPEARING_PRESETS.map((p) => {
                const activePreset = (disappearingSeconds || null) === p.seconds;
                return (
                  <button
                    key={p.label}
                    disabled={disBusy}
                    onClick={() => changeDisappearing(p.seconds)}
                    className="h-11 rounded-[14px] text-[11.5px] font-semibold flex items-center justify-center disabled:opacity-50"
                    style={activePreset
                      ? { background: "var(--warn)", color: "#1A1206" }
                      : { background: "var(--ink3)", border: "1px solid var(--line)", color: "var(--txt2)" }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] mt-2 px-1 leading-relaxed" style={{ color: "var(--txt3)" }}>
              Açıksa, gönderilen yeni mesajlar seçili süre sonunda sunucudan kalıcı olarak silinir
              (geçmiş mesajlar etkilenmez). Bu bir uçtan uca (E2E) şifreleme garantisi <b>değildir</b>;
              süre dolana kadar mesaj sunucuda normal şekilde saklanır.
            </p>
          </section>

          {/* SOHBET KİLİDİ */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Lock size={14} style={{ color: "var(--blue)" }} />
              <h3 className="text-[13px] font-semibold">Sohbet Kilidi</h3>
            </div>

            {mode === null && (
              <div className="space-y-2">
                {!ls.has_pin ? (
                  <Row icon={Lock} label="Sohbeti Kilitle (PIN oluştur)" tone="var(--blue)" onClick={() => { reset(); setMode("create"); }} />
                ) : (
                  <>
                    <Row icon={Lock} label="Şimdi Kilitle" tone="var(--blue)" onClick={() => run(() => lock.lockNow(), "Sohbet kilitlendi.")} />
                    <Row icon={KeyRound} label="PIN Değiştir" onClick={() => { reset(); setMode("change"); }} />
                    <Row icon={LockOpen} label="Sohbet Kilidini Kaldır" danger onClick={() => { reset(); setMode("remove"); }} />
                  </>
                )}
              </div>
            )}

            {mode === "create" && (
              <div className="space-y-3">
                <NumPin value={pin} onChange={setPin} placeholder="Yeni 4 haneli PIN" />
                <NumPin value={pin2} onChange={setPin2} placeholder="PIN tekrar" />
                <div className="flex gap-2">
                  <button onClick={reset} className="flex-1 h-11 rounded-[16px] nx-surface text-[13px]">Vazgeç</button>
                  <button disabled={busy || pin.length !== 4 || pin !== pin2}
                    onClick={createPinFlow}
                    className="flex-1 h-11 rounded-[16px] nx-btn-primary text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : null} Kilitle
                  </button>
                </div>
              </div>
            )}

            {mode === "change" && (
              <div className="space-y-3">
                <NumPin value={pin} onChange={setPin} placeholder="Mevcut PIN" />
                <NumPin value={pin2} onChange={setPin2} placeholder="Yeni PIN" />
                <div className="flex gap-2">
                  <button onClick={reset} className="flex-1 h-11 rounded-[16px] nx-surface text-[13px]">Vazgeç</button>
                  <button disabled={busy || pin.length !== 4 || pin2.length !== 4}
                    onClick={() => run(() => lock.changePin(pin, pin2), "PIN güncellendi.")}
                    className="flex-1 h-11 rounded-[16px] nx-btn-primary text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : null} Güncelle
                  </button>
                </div>
              </div>
            )}

            {mode === "remove" && (
              <div className="space-y-3">
                <NumPin value={pin} onChange={setPin} placeholder="Mevcut PIN" />
                <div className="flex gap-2">
                  <button onClick={reset} className="flex-1 h-11 rounded-[16px] nx-surface text-[13px]">Vazgeç</button>
                  <button disabled={busy || pin.length !== 4}
                    onClick={() => run(() => lock.removePin(pin), "Sohbet kilidi kaldırıldı.")}
                    className="flex-1 h-11 rounded-[16px] text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: "var(--red)", color: "#fff" }}>
                    {busy ? <Loader2 size={15} className="animate-spin" /> : null} Kilidi Kaldır
                  </button>
                </div>
              </div>
            )}

            <p className="text-[10.5px] mt-3 px-1 leading-relaxed" style={{ color: "var(--txt3)" }}>
              Sohbet Kilidi bu cihazda sohbeti gizler ve sunucu tarafında mesaj erişimini kısıtlar.
              Sunucu erişimi nedeniyle uçtan uca (E2E) şifreleme <b>değildir</b>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

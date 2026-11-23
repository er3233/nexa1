import React, { useState } from "react";
import { Check, X, Ban, Loader2, Inbox, Send, Clock } from "lucide-react";
import { UserAvatar, nameOf, fmtDateShort } from "../lib/ui";

const OUT_STATUS = {
  pending: { label: "Bekliyor", tone: "var(--blue)" },
  accepted: { label: "Kabul edildi", tone: "var(--green)" },
  rejected: { label: "Reddedildi", tone: "var(--red)" },
  cancelled: { label: "İptal edildi", tone: "var(--txt3)" },
};

export default function MessageRequests({
  incoming = [], outgoing = [], loading,
  onAccept, onReject, onCancel, onBlock,
}) {
  const [sub, setSub] = useState("incoming");
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");

  const run = async (id, fn) => {
    setBusyId(id);
    setErr("");
    try { await fn(); }
    catch (e) { setErr(e?.message || "İşlem başarısız."); }
    finally { setBusyId(null); }
  };

  return (
    <div className="flex flex-col h-full nx-in">
      <div className="px-5 pt-5 pb-3">
        <h1 className="nx-display text-[22px] font-bold tracking-tight">İstekler</h1>
        <span className="nx-mono text-[8.5px] tracking-[0.28em]" style={{ color: "var(--txt3)" }}>MESAJLAŞMA İSTEKLERİ</span>

        <div className="nx-surface rounded-[16px] p-1 flex mt-4">
          {[
            { id: "incoming", label: `Gelen${incoming.length ? ` (${incoming.length})` : ""}` },
            { id: "outgoing", label: "Giden" },
          ].map((t) => (
            <button key={t.id} onClick={() => setSub(t.id)}
              className="flex-1 h-9 rounded-[12px] text-[12.5px] font-semibold transition-colors"
              style={{ background: sub === t.id ? "var(--ink3)" : "transparent", color: sub === t.id ? "var(--txt)" : "var(--txt3)" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nx-scroll px-4 pb-3">
        {err && <p className="text-[12px] mb-3 px-1" style={{ color: "var(--red)" }}>{err}</p>}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10" style={{ color: "var(--txt3)" }}>
            <Loader2 size={16} className="animate-spin" /> <span className="text-[12.5px]">Yükleniyor…</span>
          </div>
        ) : sub === "incoming" ? (
          incoming.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-8 py-12">
              <Inbox size={22} style={{ color: "var(--txt3)" }} />
              <p className="text-[13.5px] font-semibold mt-3" style={{ color: "var(--txt2)" }}>Gelen istek yok</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--txt3)" }}>Biri sana istek gönderince burada görünür.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {incoming.map((r) => (
                <div key={r.id} className="nx-surface rounded-[20px] p-3.5">
                  <div className="flex items-center gap-3">
                    <UserAvatar url={r.avatar_url} name={nameOf(r)} id={r.sender_id} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold truncate">{nameOf(r)}</p>
                      <p className="nx-mono text-[9.5px] truncate" style={{ color: "var(--txt3)" }}>@{r.username} · {fmtDateShort(r.created_at)}</p>
                    </div>
                  </div>
                  {r.message_preview && (
                    <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--txt2)", overflowWrap: "anywhere" }}>“{r.message_preview}”</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => run(r.id, () => onAccept(r))} disabled={busyId === r.id}
                      className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-[14px] text-[12.5px] font-semibold disabled:opacity-50"
                      style={{ background: "rgba(62,207,142,0.12)", border: "1px solid rgba(62,207,142,0.3)", color: "var(--green)" }}>
                      {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Kabul Et
                    </button>
                    <button onClick={() => run(r.id, () => onReject(r.id))} disabled={busyId === r.id}
                      className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-[14px] text-[12.5px] font-semibold disabled:opacity-50"
                      style={{ background: "var(--ink3)", border: "1px solid var(--line)", color: "var(--txt2)" }}>
                      <X size={14} /> Reddet
                    </button>
                    <button onClick={() => run(r.id, () => onBlock(r.sender_id))} disabled={busyId === r.id}
                      className="flex items-center justify-center h-10 w-10 rounded-[14px] disabled:opacity-50"
                      style={{ background: "rgba(229,72,77,0.1)", border: "1px solid rgba(229,72,77,0.3)", color: "var(--red)" }}
                      aria-label="Engelle" title="Engelle">
                      <Ban size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : outgoing.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-8 py-12">
            <Send size={20} style={{ color: "var(--txt3)" }} />
            <p className="text-[13.5px] font-semibold mt-3" style={{ color: "var(--txt2)" }}>Giden istek yok</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--txt3)" }}>Kişiler sekmesinden birini arayıp istek gönder.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {outgoing.map((r) => {
              const st = OUT_STATUS[r.status] || OUT_STATUS.pending;
              return (
                <div key={r.id} className="nx-surface rounded-[20px] p-3.5">
                  <div className="flex items-center gap-3">
                    <UserAvatar url={r.avatar_url} name={nameOf(r)} id={r.receiver_id} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold truncate">{nameOf(r)}</p>
                      <p className="nx-mono text-[9.5px] truncate" style={{ color: "var(--txt3)" }}>@{r.username} · {fmtDateShort(r.created_at)}</p>
                    </div>
                    <span className="nx-mono text-[9px] px-1.5 py-0.5 rounded-md shrink-0" style={{ color: st.tone, background: "var(--ink3)" }}>{st.label}</span>
                  </div>
                  {r.message_preview && (
                    <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--txt2)", overflowWrap: "anywhere" }}>“{r.message_preview}”</p>
                  )}
                  {r.status === "pending" && (
                    <div className="flex justify-end mt-3">
                      <button onClick={() => run(r.id, () => onCancel(r.id))} disabled={busyId === r.id}
                        className="flex items-center gap-1.5 h-9 px-3.5 rounded-[12px] text-[12px] font-semibold disabled:opacity-50 nx-surface" style={{ color: "var(--txt2)" }}>
                        {busyId === r.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} İsteği İptal Et
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

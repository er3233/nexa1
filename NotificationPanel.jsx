import React from "react";
import { X, Loader2, UserPlus, Bell, CheckCheck, AlertTriangle } from "lucide-react";
import { fmtDateShort } from "../lib/ui";

function iconFor(type) {
  if (type === "account_application") return UserPlus;
  return Bell;
}

export default function NotificationPanel({ open, items = [], loading, error, unread = 0, onClose, onItemClick, onMarkAll }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[55] flex flex-col" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div
        className="mt-auto sm:mt-0 nx-raised rounded-t-[26px] sm:rounded-[26px] sm:m-4 flex flex-col nx-sheet"
        style={{ background: "var(--ink1)", maxHeight: "72%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
          <Bell size={16} style={{ color: "var(--txt2)" }} />
          <h2 className="nx-display text-[15px] font-bold">Bildirimler</h2>
          {unread > 0 && (
            <button onClick={onMarkAll} className="ml-auto flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "var(--blue)" }}>
              <CheckCheck size={13} /> Tümünü okundu yap
            </button>
          )}
          <button onClick={onClose} className={`p-1.5 rounded-lg ${unread > 0 ? "" : "ml-auto"}`} aria-label="Kapat">
            <X size={18} style={{ color: "var(--txt3)" }} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto nx-scroll px-3 py-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10" style={{ color: "var(--txt3)" }}>
              <Loader2 size={16} className="animate-spin" /> <span className="text-[12.5px]">Yükleniyor…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-10">
              <AlertTriangle size={20} style={{ color: "var(--red)" }} />
              <p className="text-[12.5px] mt-2" style={{ color: "var(--red)" }}>{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-8 py-12">
              <Bell size={22} style={{ color: "var(--txt3)" }} />
              <p className="text-[13.5px] font-semibold mt-3" style={{ color: "var(--txt2)" }}>Bildirim yok</p>
              <p className="text-[12px] mt-1" style={{ color: "var(--txt3)" }}>Yeni başvurular burada görünür.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((n) => {
                const Icon = iconFor(n.type);
                return (
                  <button
                    key={n.id}
                    onClick={() => onItemClick?.(n)}
                    className="w-full flex items-start gap-3 p-3 rounded-[18px] text-left active:scale-[0.99] transition-transform"
                    style={{ background: n.is_read ? "transparent" : "rgba(77,158,255,0.08)", border: `1px solid ${n.is_read ? "var(--line)" : "var(--blue-line)"}` }}
                  >
                    <span className="w-9 h-9 rounded-[13px] flex items-center justify-center shrink-0" style={{ background: "var(--ink3)", color: "var(--blue)" }}>
                      <Icon size={16} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold truncate">{n.title}</p>
                        {!n.is_read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--blue)" }} />}
                        <span className="ml-auto nx-mono text-[9.5px] shrink-0" style={{ color: "var(--txt3)" }}>{fmtDateShort(n.created_at)}</span>
                      </div>
                      {n.body && <p className="text-[12px] mt-0.5 leading-snug" style={{ color: "var(--txt2)", overflowWrap: "anywhere" }}>{n.body}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { X, Send, MessageCircle, Loader2, Check, Clock } from "lucide-react";
import { UserAvatar, nameOf } from "../lib/ui";
import { sendMessageRequest } from "../services/messageRequests";

const MAX_PREVIEW = 200;

// Arama sonucuna dokununca açılan mini profil kartı + mesaj isteği gönderme.
export default function UserProfileCard({
  user, existingConvId, outgoingPending, onClose, onOpenConversation, onSent,
}) {
  const [preview, setPreview] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(outgoingPending || false);
  const [convId, setConvId] = useState(existingConvId || null);
  const [err, setErr] = useState("");

  const doSend = async () => {
    if (sending) return;
    setSending(true);
    setErr("");
    try {
      const res = await sendMessageRequest(user.id, preview.trim() || null);
      if (res?.type === "existing_conversation" && res.conversation_id) {
        setConvId(res.conversation_id);
      } else {
        // request_sent veya already_pending → gönderildi durumu
        setSent(true);
        onSent?.();
      }
    } catch (e) {
      setErr(e?.message || "İstek gönderilemedi.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div
        className="w-full max-w-[400px] nx-raised rounded-t-[28px] sm:rounded-[28px] p-5 nx-sheet"
        style={{ background: "var(--ink1)", paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <UserAvatar url={user?.avatar_url} name={nameOf(user)} id={user?.id} size={60} />
          <div className="flex-1 min-w-0">
            <p className="nx-display font-semibold text-[16px] truncate">{nameOf(user)}</p>
            <p className="nx-mono text-[11px] mt-0.5 truncate" style={{ color: "var(--txt3)" }}>{user?.username ? "@" + user.username : ""}</p>
            {user?.status && <p className="text-[12px] mt-1 truncate" style={{ color: "var(--txt2)" }}>{user.status}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl -mr-1 -mt-1" aria-label="Kapat">
            <X size={18} style={{ color: "var(--txt3)" }} />
          </button>
        </div>

        {err && <p className="text-[12px] mt-3" style={{ color: "var(--red)" }}>{err}</p>}

        <div className="mt-5">
          {convId ? (
            <button
              onClick={() => onOpenConversation(convId)}
              className="w-full h-[50px] rounded-[18px] nx-btn-primary flex items-center justify-center gap-2 text-[14px]"
            >
              <MessageCircle size={16} /> Sohbete Git
            </button>
          ) : sent ? (
            <div
              className="w-full h-[50px] rounded-[18px] flex items-center justify-center gap-2 text-[13.5px] font-semibold"
              style={{ background: "var(--ink2)", border: "1px solid var(--line)", color: "var(--txt2)" }}
            >
              <Clock size={15} style={{ color: "var(--blue)" }} /> İstek gönderildi
            </div>
          ) : (
            <>
              <textarea
                value={preview}
                onChange={(e) => setPreview(e.target.value.slice(0, MAX_PREVIEW))}
                rows={2}
                placeholder="Kısa bir tanışma mesajı (opsiyonel)…"
                className="w-full nx-surface rounded-[16px] px-4 py-3 bg-transparent outline-none resize-none mb-3"
                style={{ color: "var(--txt)", fontSize: "16px", lineHeight: 1.35 }}
              />
              <button
                onClick={doSend}
                disabled={sending}
                className="w-full h-[50px] rounded-[18px] nx-btn-primary flex items-center justify-center gap-2 text-[14px] disabled:opacity-60"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />} Mesaj İsteği Gönder
              </button>
              <p className="text-[10.5px] text-center mt-2" style={{ color: "var(--txt3)" }}>
                Karşı taraf kabul edene kadar mesaj gönderemezsiniz.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

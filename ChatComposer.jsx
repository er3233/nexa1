import React, { useRef, useEffect, useCallback } from "react";
import { Send, Mic, Pencil, Loader2 } from "lucide-react";
import MediaUploader from "./MediaUploader";
import ReplyPreview from "./ReplyPreview";
import { syncVisualViewport } from "../hooks/useVisualViewport";

const MIN_PX = 24;
const MAX_PX = 96;
const COMPOSER_MIN = 52;

export default function ChatComposer({
  input, setInput, notifyTyping, onSubmit, onFocus, onBlur, sending,
  editingId, onCancelEdit, replyTo, onCancelReply,
  mediaErr, conversationId, onMediaUploaded, onMediaError,
  meId, contactName, onDraftChange, liveActive,
  /** true iken textarea focus/tab dışı (ör. sohbet araması açık). */
  suppressFocus = false,
}) {
  const taRef = useRef(null);

  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, MIN_PX), MAX_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => { autoGrow(); }, [input, autoGrow]);

  // Arama/overlay açıkken mesaj alanı focusable olmasın (iOS prev/next listesi).
  useEffect(() => {
    if (suppressFocus && document.activeElement === taRef.current) {
      taRef.current?.blur();
    }
  }, [suppressFocus]);

  const handleFocus = (e) => {
    if (suppressFocus) {
      e.target.blur();
      return;
    }
    syncVisualViewport();
    setTimeout(() => syncVisualViewport(), 120);
    setTimeout(() => syncVisualViewport(), 220);
    onFocus?.(e);
  };

  const canSend = input.trim().length > 0 || !!editingId;
  const hasTop = !!mediaErr || liveActive || !!replyTo || !!editingId;

  return (
    <div className="nx-composer composer-wrapper px-3 pt-1 z-10">
      {hasTop && (
        <div className="shrink-0">
          {mediaErr && <p className="text-[11px] px-3 pb-1" style={{ color: "var(--red)" }}>{mediaErr}</p>}
          {liveActive && (
            <p className="text-[10.5px] px-3 pb-1" style={{ color: "var(--violet)" }}>
              Canlı yazım açık — yazdıkların gönderilmeden görülebilir.
            </p>
          )}
          {replyTo && (
            <div className="px-2 pb-1">
              <ReplyPreview message={replyTo} authorName={replyTo.sender_id === meId ? "Sen" : contactName} onCancel={onCancelReply} />
            </div>
          )}
          {editingId && (
            <div className="flex items-center gap-2 px-3 pb-1.5">
              <Pencil size={12} style={{ color: "var(--blue)" }} />
              <span className="nx-mono text-[9px] tracking-[0.14em]" style={{ color: "var(--txt3)" }}>MESAJ DÜZENLENİYOR</span>
              <button type="button" tabIndex={-1} onClick={onCancelEdit} className="ml-auto text-[11px]" style={{ color: "var(--txt3)" }}>vazgeç</button>
            </div>
          )}
        </div>
      )}

      <div
        className="nx-raised rounded-[26px] flex items-end gap-1 p-1.5 shrink-0"
        style={{ minHeight: COMPOSER_MIN }}
      >
        <div className="shrink-0">
          <MediaUploader conversationId={conversationId} onUploaded={onMediaUploaded} onError={onMediaError} disabled={!!editingId || suppressFocus} />
        </div>
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          readOnly={suppressFocus}
          tabIndex={suppressFocus ? -1 : 0}
          autoComplete="off"
          autoCorrect="on"
          spellCheck={true}
          enterKeyHint="send"
          inputMode="text"
          onChange={(e) => { const v = e.target.value; setInput(v); notifyTyping?.(); onDraftChange?.(v); }}
          onFocus={handleFocus}
          onBlur={onBlur}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
          placeholder={editingId ? "Düzenle…" : "Mesaj yaz…"}
          className="flex-1 bg-transparent outline-none resize-none min-w-0 px-1"
          style={{
            color: "var(--txt)",
            fontSize: "16px",
            lineHeight: "1.35",
            minHeight: `${MIN_PX}px`,
            height: `${MIN_PX}px`,
            maxHeight: `${MAX_PX}px`,
            overflowY: "hidden",
            paddingTop: 8,
            paddingBottom: 8,
          }}
        />
        {canSend ? (
          <button type="button" tabIndex={-1} onClick={onSubmit} disabled={sending}
            className="w-[42px] h-[42px] rounded-full flex items-center justify-center nx-btn-primary shrink-0"
            aria-label="Gönder" style={{ opacity: sending ? 0.6 : 1 }}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        ) : (
          <button type="button" tabIndex={-1} disabled title="Yakında"
            className="w-[42px] h-[42px] rounded-full flex items-center justify-center opacity-40 cursor-not-allowed shrink-0"
            style={{ color: "var(--txt3)" }} aria-label="Ses mesajı (yakında)">
            <Mic size={17} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}

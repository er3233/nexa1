import React from "react";
import { X, CornerUpLeft } from "lucide-react";

// Yanıtlanan mesajın alıntısı. Composer'da (onCancel ile) veya balon üstünde kullanılır.
export default function ReplyPreview({ message, authorName, onCancel, onClick }) {
  if (!message) return null;
  const text = message.deleted_at
    ? "Silinmiş mesaj"
    : message.content || (message.message_type && message.message_type !== "text" ? "Medya" : "");
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 rounded-[14px] px-3 py-2 mb-1"
      style={{ background: "var(--ink3)", borderLeft: "2px solid var(--blue)", cursor: onClick ? "pointer" : "default" }}
    >
      <CornerUpLeft size={13} style={{ color: "var(--blue)" }} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="nx-mono text-[9px] tracking-[0.14em]" style={{ color: "var(--blue)" }}>
          {authorName || "Yanıt"}
        </div>
        <div className="text-[12px] truncate" style={{ color: "var(--txt2)" }}>{text}</div>
      </div>
      {onCancel && (
        <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onCancel(); }} className="p-1 rounded-lg shrink-0" style={{ color: "var(--txt3)" }} aria-label="Yanıtı iptal et">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

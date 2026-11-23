import React, { useState, useRef, useCallback } from "react";
import { Check, CheckCheck, FileText, Loader2, Pencil, Trash2, Flag, CornerUpLeft, Clock } from "lucide-react";
import ReplyPreview from "./ReplyPreview";
import MessageReactions from "./MessageReactions";
import { getSignedUrl } from "../services/media";

function fmtTime(ts) {
  if (!ts) return "";
  try { return new Date(ts).toTimeString().slice(0, 5); } catch { return ""; }
}

function StatusTicks({ status }) {
  if (status === "sent") return <Check size={12} strokeWidth={2.5} style={{ color: "var(--txt3)" }} />;
  if (status === "read") return <CheckCheck size={12} strokeWidth={2.5} style={{ color: "var(--blue)" }} />;
  return <CheckCheck size={12} strokeWidth={2.5} style={{ color: "var(--txt3)" }} />;
}

function MediaMessage({ metadata, mine }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  React.useEffect(() => {
    let active = true;
    if (metadata?.path) {
      getSignedUrl(metadata.path).then((u) => active && setUrl(u)).catch(() => active && setErr(true));
    }
    return () => { active = false; };
  }, [metadata?.path]);

  if (err) return <span className="text-[12px]" style={{ color: "var(--txt3)" }}>Medya yüklenemedi</span>;
  if (!url) return (
    <div className="flex items-center gap-2 py-2" style={{ color: "var(--txt3)" }}>
      <Loader2 size={13} className="animate-spin" /> <span className="text-[12px]">Yükleniyor…</span>
    </div>
  );
  const kind = metadata?.kind;
  if (kind === "image") return <img src={url} alt={metadata?.name || ""} className="rounded-[14px] max-h-[240px] max-w-full" />;
  if (kind === "video") return <video src={url} controls className="rounded-[14px] max-h-[240px] max-w-full" />;
  if (kind === "audio") return <audio src={url} controls className="max-w-full" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] underline min-w-0" style={{ color: mine ? "#dbe9ff" : "var(--txt)" }}>
      <FileText size={15} className="shrink-0" /> <span className="truncate">{metadata?.name || "Dosya"}</span>
    </a>
  );
}

const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 10;

export default function MessageBubble({
  message: m, mine, meId, contactName, repliedTo, reactions = [],
  onToggleReaction, onReply, onEdit, onDelete, onReport,
  readStatus, highlighted,
}) {
  const [focused, setFocused] = useState(false);
  const pressTimer = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const deleted = !!m.deleted_at;
  const isMedia = m.message_type && m.message_type !== "text" && m.metadata?.path;
  const expiring = !!m.expires_at;

  const clearPressTimer = useCallback(() => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }, []);

  const onTouchStart = useCallback((e) => {
    const t = e.touches?.[0];
    moved.current = false;
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    clearPressTimer();
    pressTimer.current = setTimeout(() => { if (!moved.current) setFocused(true); }, LONG_PRESS_MS);
  }, [clearPressTimer]);

  const onTouchMove = useCallback((e) => {
    const t = e.touches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - startPos.current.x);
    const dy = Math.abs(t.clientY - startPos.current.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) { moved.current = true; clearPressTimer(); }
  }, [clearPressTimer]);

  const onTouchEnd = useCallback(() => clearPressTimer(), [clearPressTimer]);

  const onBubbleClick = useCallback(() => {
    // Masaüstünde tıklama açmaz (hover kullanılır); mobilde yalnızca zaten
    // uzun-basmayla açılmışsa kapatmak için kullanılır.
    if (focused) setFocused(false);
  }, [focused]);

  return (
    <div
      className={`group flex flex-col ${mine ? "items-end" : "items-start"} nx-in`}
      data-msg-id={m.id}
      style={highlighted ? { animation: "nxPop .5s var(--ease-premium)" } : undefined}
    >
      <div
        onClick={onBubbleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className={`select-none text-left max-w-[82%] px-4 py-2.5 transition-shadow ${mine ? "rounded-[24px] rounded-br-[9px]" : "rounded-[24px] rounded-tl-[9px]"}`}
        style={{
          ...(mine
            ? { background: "linear-gradient(170deg, #1D3350, var(--blue-ink))", border: "1px solid var(--blue-line)" }
            : { background: "var(--ink2)", border: "1px solid var(--line)" }),
          boxShadow: highlighted ? "0 0 0 2px var(--blue)" : "none",
        }}
      >
        {repliedTo && (
          <ReplyPreview message={repliedTo} authorName={repliedTo.sender_id === meId ? "Sen" : contactName} />
        )}
        {deleted ? (
          <p className="text-[14px] leading-relaxed" style={{ fontStyle: "italic", color: "var(--txt3)" }}>Bu mesaj silindi</p>
        ) : isMedia ? (
          <div className="space-y-1">
            <MediaMessage metadata={m.metadata} mine={mine} />
            {m.content && m.content !== m.metadata?.name && <p className="text-[14px] leading-relaxed">{m.content}</p>}
          </div>
        ) : (
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{m.content}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1 justify-end">
          {expiring && !deleted && <Clock size={10} style={{ color: "var(--txt3)" }} aria-label="Kaybolan mesaj" />}
          {m.edited_at && !deleted && <span className="nx-mono text-[8.5px]" style={{ color: "var(--txt3)" }}>düzenlendi</span>}
          <span className="nx-mono text-[9.5px]" style={{ color: "var(--txt3)" }}>{fmtTime(m.created_at)}</span>
          {mine && <StatusTicks status={readStatus} />}
        </div>
      </div>

      {!deleted && (
        <div className={mine ? "pr-1" : "pl-1"}>
          <MessageReactions reactions={reactions} meId={meId} align={mine ? "right" : "left"} onToggle={onToggleReaction} />
        </div>
      )}

      {/* Aksiyon çubuğu: masaüstünde hover ile, mobilde uzun-basma ile görünür. */}
      {!deleted && (
        <div
          className={`flex items-center gap-1 mt-1 transition-opacity duration-150 ${mine ? "flex-row-reverse" : ""} ${
            focused ? "opacity-100" : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
          }`}
        >
          <button type="button" tabIndex={-1} onClick={() => { onReply(m); setFocused(false); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[12px] nx-surface text-[11px] active:scale-95 transition-transform">
            <CornerUpLeft size={12} /> Yanıtla
          </button>
          {mine && m.message_type === "text" && (
            <button type="button" tabIndex={-1} onClick={() => { onEdit(m); setFocused(false); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[12px] nx-surface text-[11px] active:scale-95 transition-transform">
              <Pencil size={12} /> Düzenle
            </button>
          )}
          {mine && (
            <button type="button" tabIndex={-1} onClick={() => { onDelete(m.id); setFocused(false); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[12px] nx-surface text-[11px] active:scale-95 transition-transform" style={{ color: "var(--red)" }}>
              <Trash2 size={12} /> Sil
            </button>
          )}
          {!mine && (
            <button type="button" tabIndex={-1} onClick={() => { onReport(m.id); setFocused(false); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-[12px] nx-surface text-[11px] active:scale-95 transition-transform" style={{ color: "var(--warn)" }}>
              <Flag size={12} /> Şikâyet
            </button>
          )}
        </div>
      )}
    </div>
  );
}

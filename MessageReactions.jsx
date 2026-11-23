import React, { useState } from "react";
import { SmilePlus } from "lucide-react";

export const REACTION_PALETTE = ["👍", "❤️", "😂", "🔥", "😮", "😢", "🙏"];

// reactions: bu mesaja ait reaksiyon satırları [{id,message_id,user_id,emoji}]
export default function MessageReactions({ reactions = [], meId, onToggle, align = "left" }) {
  const [open, setOpen] = useState(false);
  const groups = {};
  for (const r of reactions) (groups[r.emoji] ||= []).push(r);
  const entries = Object.entries(groups);

  return (
    <div className={`flex flex-wrap items-center gap-1 mt-1 ${align === "right" ? "justify-end" : "justify-start"}`}>
      {entries.map(([emoji, list]) => {
        const mine = list.some((r) => r.user_id === meId);
        return (
          <button
            key={emoji}
            type="button"
            tabIndex={-1}
            onClick={() => onToggle?.(emoji)}
            className="flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] transition-colors"
            style={{
              background: mine ? "rgba(77,158,255,0.16)" : "var(--ink3)",
              border: `1px solid ${mine ? "var(--blue-line)" : "var(--line)"}`,
              color: "var(--txt)",
            }}
          >
            <span>{emoji}</span>
            <span className="nx-mono" style={{ color: "var(--txt2)" }}>{list.length}</span>
          </button>
        );
      })}

      <div className="relative">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center justify-center rounded-full w-[24px] h-[24px]"
          style={{ background: "var(--ink3)", border: "1px solid var(--line)", color: "var(--txt3)" }}
          aria-label="Reaksiyon ekle"
        >
          <SmilePlus size={13} />
        </button>
        {open && (
          <div
            className="absolute z-40 bottom-8 flex gap-1 p-1.5 rounded-[16px] nx-raised nx-in"
            style={{ [align === "right" ? "right" : "left"]: 0 }}
          >
            {REACTION_PALETTE.map((e) => (
              <button
                key={e}
                type="button"
                tabIndex={-1}
                onClick={() => { onToggle?.(e); setOpen(false); }}
                className="text-[16px] px-1 active:scale-90 transition-transform"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

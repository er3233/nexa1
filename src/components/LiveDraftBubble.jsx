import React from "react";
import { Radio } from "lucide-react";

// Karşı tarafın GÖNDERİLMEMİŞ canlı taslağı — kalıcı mesajdan görsel olarak ayrı.
export default function LiveDraftBubble({ text, name }) {
  if (!text) return null;
  return (
    <div className="flex flex-col items-start nx-in">
      <div
        className="max-w-[82%] px-4 py-2.5 rounded-[24px] rounded-tl-[9px]"
        style={{ background: "rgba(139,124,255,0.10)", border: "1px dashed var(--violet)" }}
      >
        <div className="flex items-center gap-1.5 mb-0.5">
          <Radio size={11} style={{ color: "var(--violet)" }} />
          <span className="nx-mono text-[8.5px] tracking-[0.16em]" style={{ color: "var(--violet)" }}>
            {(name || "Karşı taraf").toUpperCase()} · CANLI YAZIYOR
          </span>
        </div>
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words" style={{ overflowWrap: "anywhere", color: "var(--txt2)" }}>
          {text}
        </p>
      </div>
    </div>
  );
}

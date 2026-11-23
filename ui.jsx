import React from "react";

const PALETTE = ["#4D9EFF", "#8B7CF6", "#3ECF8E", "#E0A458", "#4DD0E1", "#F06292", "#E5484D"];

export function toneFromId(id) {
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function nameOf(p) {
  return p?.display_name || p?.username || "Bilinmeyen";
}

export function initial(nameOrProfile) {
  const n = typeof nameOrProfile === "string" ? nameOrProfile : nameOf(nameOrProfile);
  return (n || "?").trim().charAt(0).toUpperCase() || "?";
}

export function fmtDateShort(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toTimeString().slice(0, 5);
    return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

// Ortak avatar: fotoğraf varsa gösterir, yoksa baş harfli güvenli fallback.
export function UserAvatar({ url, name, id, size = 44, online = false }) {
  const tone = toneFromId(id || name);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full overflow-hidden flex items-center justify-center nx-display font-semibold"
        style={{ background: "var(--ink3)", border: "1px solid var(--line2)", borderRadius: "31%", color: tone, fontSize: size * 0.36 }}
      >
        {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : initial(name)}
      </div>
      {online && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full"
          style={{ width: size * 0.24, height: size * 0.24, background: "var(--green)", border: "2px solid var(--ink0)" }}
        />
      )}
    </div>
  );
}

import React from "react";
import { Bell } from "lucide-react";

export default function NotificationBell({ count = 0, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Bildirimler${count > 0 ? ` (${count} okunmamış)` : ""}`}
      className="relative w-11 h-11 rounded-[18px] nx-surface flex items-center justify-center active:scale-95 transition-transform"
    >
      <Bell size={18} strokeWidth={1.8} style={{ color: "var(--txt2)" }} />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[9.5px] font-bold flex items-center justify-center"
          style={{ background: "var(--blue)", color: "#05070A", border: "2px solid var(--ink0)" }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

import React from "react";
import { MessageCircle, Users, Inbox, Shield, User } from "lucide-react";

const NAV = [
  { id: "chats", icon: MessageCircle, label: "Sohbetler" },
  { id: "requests", icon: Inbox, label: "İstekler" },
  { id: "contacts", icon: Users, label: "Kişiler" },
  { id: "security", icon: Shield, label: "Güvenlik" },
  { id: "profile", icon: User, label: "Profil" },
];

function Badge({ n }) {
  if (!n || n <= 0) return null;
  return (
    <span
      className="absolute top-1 right-1/2 translate-x-3.5 min-w-[15px] h-[15px] px-1 rounded-full text-[8.5px] font-bold flex items-center justify-center"
      style={{ background: "var(--blue)", color: "#05070A" }}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

// Görünür viewport (--visual-viewport-height) ile altta sabitlenir.
// Klavye açıkken html[data-keyboard-open=true] ile gizlenir (yer kaplamaz).
export default function MobileNav({ tab, setTab, unreadTotal = 0, requestCount = 0 }) {
  const activeIndex = Math.max(0, NAV.findIndex((n) => n.id === tab));
  return (
    <div className="nx-mobile-nav bottom-navigation relative z-30 px-5 pt-1 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      <nav className="nx-raised rounded-full flex p-1.5 relative">
        {/* Kayan aktif sekme pill'i — yalnızca transform animasyonu, düzen yeniden hesaplanmaz. */}
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 rounded-full transition-transform duration-300"
          style={{
            left: "6px", width: `calc(${100 / NAV.length}% - 3px)`,
            transform: `translateX(${activeIndex * 100}%)`,
            background: "var(--ink3)",
            transitionTimingFunction: "var(--ease-premium)",
          }}
        />
        {NAV.map((n) => {
          const active = tab === n.id;
          const badge = n.id === "chats" ? unreadTotal : n.id === "requests" ? requestCount : 0;
          return (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              aria-label={n.label}
              className="relative flex-1 flex flex-col items-center justify-center gap-[3px] rounded-full active:scale-95 transition-transform"
              style={{ minHeight: 46 }}
            >
              <n.icon size={17} strokeWidth={active ? 2 : 1.7} style={{ color: active ? "var(--txt)" : "var(--txt3)", transition: "color .2s" }} />
              <Badge n={badge} />
              <span className="w-[3px] h-[3px] rounded-full transition-opacity duration-200" style={{ background: "var(--blue)", opacity: active ? 1 : 0 }} />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

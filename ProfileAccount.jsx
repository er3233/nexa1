import React from "react";
import {
  Settings, ShieldAlert, ChevronRight, QrCode, Shield, FileText,
  LogOut, Loader2, Pencil,
} from "lucide-react";
import { UserAvatar } from "../lib/ui";

// "Hesabım" ekranı — tek veri kaynağı public.profiles (useAuth.profile).
export default function ProfileAccount({ user, profile, onLogout, busy, onOpenSettings, onOpenAdmin, isModerator }) {
  const display = profile?.display_name || profile?.username || user?.email?.split("@")[0] || "Kullanıcı";
  const handle = profile?.username ? "@" + profile.username : (user?.email || "");
  const bio = (profile?.bio || "").trim();

  return (
    <div className="h-full overflow-y-auto nx-scroll px-5 pt-5 pb-6 nx-in">
      <h1 className="nx-display text-[22px] font-bold tracking-tight mb-5">Hesabım</h1>

      <div className="nx-raised rounded-[28px] p-5 mb-5">
        <div className="flex items-center gap-4">
          <UserAvatar url={profile?.avatar_url} name={display} id={user?.id} size={64} />
          <div className="min-w-0 flex-1">
            <p className="nx-display font-semibold text-[16px] truncate">{display}</p>
            <p className="nx-mono text-[11px] mt-0.5 truncate" style={{ color: "var(--txt3)" }}>{handle}</p>
          </div>
          <button
            onClick={onOpenSettings}
            className="shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-[14px] nx-surface text-[12.5px] font-semibold"
            style={{ color: "var(--txt2)" }}
            aria-label="Profili düzenle"
          >
            <Pencil size={13} /> Düzenle
          </button>
        </div>
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <p className="nx-mono text-[9px] tracking-[0.2em] mb-1" style={{ color: "var(--txt3)" }}>HAKKIMDA</p>
          <p className="text-[13px] leading-relaxed" style={{ color: bio ? "var(--txt)" : "var(--txt3)" }}>
            {bio || "Hakkımda bilgisi eklenmedi."}
          </p>
        </div>
      </div>

      <div className="nx-surface rounded-[28px] overflow-hidden mb-4">
        <button onClick={onOpenSettings} className="w-full p-4 flex items-center gap-3.5 text-left min-h-[44px]" style={{ borderBottom: "1px solid var(--line)" }}>
          <Settings size={16} strokeWidth={1.8} style={{ color: "var(--txt2)" }} />
          <span className="text-[13.5px] font-medium">Ayarlar ve profil</span>
          <ChevronRight size={14} className="ml-auto" style={{ color: "var(--txt3)" }} />
        </button>
        {isModerator && (
          <button onClick={onOpenAdmin} className="w-full p-4 flex items-center gap-3.5 text-left min-h-[44px]" style={{ borderBottom: "1px solid var(--line)" }}>
            <ShieldAlert size={16} strokeWidth={1.8} style={{ color: "var(--red)" }} />
            <span className="text-[13.5px] font-medium">Admin Paneli</span>
            <ChevronRight size={14} className="ml-auto" style={{ color: "var(--txt3)" }} />
          </button>
        )}
        {[
          { icon: QrCode, label: "QR kodum" },
          { icon: Shield, label: "Güvenlik anahtarını doğrula" },
          { icon: FileText, label: "Verilerimi indir" },
        ].map((r, i, arr) => (
          <div key={i} className="w-full p-4 flex items-center gap-3.5 text-left min-h-[44px] opacity-50" style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "none" }}>
            <r.icon size={16} strokeWidth={1.8} style={{ color: "var(--txt2)" }} />
            <span className="text-[13.5px] font-medium">{r.label}</span>
            <span className="ml-auto text-[10px] nx-mono tracking-wider px-1.5 py-0.5 rounded-md uppercase" style={{ color: "var(--txt3)", background: "var(--ink3)" }}>Yakında</span>
          </div>
        ))}
      </div>

      <button onClick={onLogout} disabled={busy} className="w-full rounded-[22px] p-4 flex items-center justify-center gap-2.5 disabled:opacity-60"
        style={{ background: "rgba(229,72,77,0.08)", border: "1px solid rgba(229,72,77,0.25)" }}>
        {busy ? <Loader2 size={15} className="animate-spin" style={{ color: "var(--red)" }} /> : <LogOut size={15} style={{ color: "var(--red)" }} />}
        <span className="text-[13.5px] font-semibold" style={{ color: "var(--red)" }}>Oturumu kapat</span>
      </button>
      <p className="nx-mono text-[8.5px] text-center mt-7 tracking-[0.2em]" style={{ color: "var(--txt3)" }}>NEXA v0.6 · SUPABASE BACKEND</p>
    </div>
  );
}

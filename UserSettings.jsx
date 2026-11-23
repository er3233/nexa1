import React, { useEffect, useState } from "react";
import { ChevronLeft, Loader2, Check, Camera } from "lucide-react";
import { getSettings, upsertSettings, updateProfile } from "../services/profiles";
import { uploadAvatar } from "../services/media";

function Toggle({ label, value, onChange, hint }) {
  return (
    <button onClick={() => onChange(!value)} className="w-full p-4 flex items-center gap-3 text-left"
      style={{ borderBottom: "1px solid var(--line)" }}>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-medium">{label}</p>
        {hint && <p className="text-[11px] mt-0.5" style={{ color: "var(--txt3)" }}>{hint}</p>}
      </div>
      <span className="w-[42px] h-[24px] rounded-full relative transition-colors shrink-0"
        style={{ background: value ? "var(--blue)" : "var(--ink3)", border: "1px solid var(--line2)" }}>
        <span className="absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all"
          style={{ left: value ? "20px" : "2px", background: "#fff" }} />
      </span>
    </button>
  );
}

function SelectRow({ label, value, options, onChange }) {
  return (
    <div className="w-full p-4 flex items-center gap-3" style={{ borderBottom: "1px solid var(--line)" }}>
      <p className="text-[13.5px] font-medium flex-1">{label}</p>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none text-[13px] text-right"
        style={{ color: "var(--txt2)" }}>
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: "var(--ink2)", color: "var(--txt)" }}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function UserSettings({ user, profile, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || "");
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    getSettings(user.id)
      .then((s) => { if (active) setSettings(s || {}); })
      .catch(() => { if (active) setErr("Ayarlar yüklenemedi."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id]);

  const patch = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  const onAvatar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    setErr("");
    try {
      const { publicUrl } = await uploadAvatar(user.id, file);
      setAvatarUrl(publicUrl);
    } catch (ex) {
      setErr(ex?.message || "Avatar yüklenemedi.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      await updateProfile(user.id, { display_name: displayName.trim(), bio: bio.trim(), avatar_url: avatarUrl || null });
      await upsertSettings(user.id, {
        theme: settings.theme ?? "dark",
        language: settings.language ?? "tr",
        notifications_enabled: settings.notifications_enabled ?? true,
        read_receipts_enabled: settings.read_receipts_enabled ?? true,
        last_seen_visibility: settings.last_seen_visibility ?? "contacts",
        profile_photo_visibility: settings.profile_photo_visibility ?? "everyone",
      });
      setMsg("Kaydedildi.");
      onSaved?.();
    } catch (ex) {
      setErr("Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col nx-in" style={{ background: "var(--ink0)" }}>
      <div className="px-3 pb-3 flex items-center gap-2 nx-hairline-b" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
        <button onClick={onClose} className="p-2 rounded-xl" aria-label="Geri"><ChevronLeft size={20} style={{ color: "var(--txt2)" }} /></button>
        <h1 className="nx-display text-[16px] font-bold">Ayarlar</h1>
        <button onClick={save} disabled={saving || loading} className="ml-auto px-4 h-9 rounded-[16px] nx-btn-primary text-[13px] flex items-center gap-1.5">
          {saving && <Loader2 size={13} className="animate-spin" />} Kaydet
        </button>
      </div>

      <div className="flex-1 overflow-y-auto nx-scroll px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10" style={{ color: "var(--txt3)" }}>
            <Loader2 size={16} className="animate-spin" /> <span className="text-[12.5px]">Yükleniyor…</span>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center mb-6">
              <label className="relative cursor-pointer">
                <div className="w-[84px] h-[84px] rounded-[28px] overflow-hidden flex items-center justify-center nx-display text-[30px] font-bold"
                  style={{ background: "var(--ink3)", border: "1px solid var(--line2)", color: "var(--blue)" }}>
                  {avatarUrl ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" /> : (displayName || user.email || "?")[0].toUpperCase()}
                </div>
                <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center nx-raised">
                  {uploadingAvatar ? <Loader2 size={14} className="animate-spin" style={{ color: "var(--txt2)" }} /> : <Camera size={14} style={{ color: "var(--txt2)" }} />}
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={onAvatar} />
              </label>
              <p className="nx-mono text-[10px] mt-2" style={{ color: "var(--txt3)" }}>@{profile?.username}</p>
            </div>

            <h2 className="text-[11px] font-bold tracking-[0.14em] mb-2" style={{ color: "var(--txt3)" }}>PROFİL</h2>
            <div className="nx-surface rounded-[22px] overflow-hidden mb-6">
              <div className="p-4" style={{ borderBottom: "1px solid var(--line)" }}>
                <label className="text-[11px]" style={{ color: "var(--txt3)" }}>Görünen ad</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-transparent outline-none text-[14px] mt-1" style={{ color: "var(--txt)" }} />
              </div>
              <div className="p-4">
                <label className="text-[11px]" style={{ color: "var(--txt3)" }}>Hakkında</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2}
                  className="w-full bg-transparent outline-none text-[14px] mt-1 resize-none" style={{ color: "var(--txt)" }} />
              </div>
            </div>

            <h2 className="text-[11px] font-bold tracking-[0.14em] mb-2" style={{ color: "var(--txt3)" }}>TERCİHLER</h2>
            <div className="nx-surface rounded-[22px] overflow-hidden mb-6">
              <SelectRow label="Dil" value={settings.language ?? "tr"} onChange={(v) => patch("language", v)}
                options={[{ value: "tr", label: "Türkçe" }, { value: "en", label: "English" }]} />
              <Toggle label="Bildirimler" value={settings.notifications_enabled ?? true} onChange={(v) => patch("notifications_enabled", v)} />
              <Toggle label="Okundu bilgisi" hint="Kapalıysa okundu bilginiz paylaşılmaz" value={settings.read_receipts_enabled ?? true} onChange={(v) => patch("read_receipts_enabled", v)} />
              <SelectRow label="Son görülme" value={settings.last_seen_visibility ?? "contacts"} onChange={(v) => patch("last_seen_visibility", v)}
                options={[{ value: "everyone", label: "Herkes" }, { value: "contacts", label: "Kişiler" }, { value: "nobody", label: "Kimse" }]} />
              <div style={{ borderBottom: "none" }}>
                <SelectRow label="Profil fotoğrafı" value={settings.profile_photo_visibility ?? "everyone"} onChange={(v) => patch("profile_photo_visibility", v)}
                  options={[{ value: "everyone", label: "Herkes" }, { value: "contacts", label: "Kişiler" }, { value: "nobody", label: "Kimse" }]} />
              </div>
            </div>

            {err && <p className="text-[12px] mb-3" style={{ color: "var(--red)" }}>{err}</p>}
            {msg && <p className="text-[12px] mb-3 flex items-center gap-1.5" style={{ color: "var(--green)" }}><Check size={13} /> {msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}

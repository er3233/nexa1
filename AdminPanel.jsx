import React, { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft, Loader2, ShieldAlert, Ban, ShieldCheck, Flag,
  Check, X, UserX, UserCheck, Trash2, RefreshCw, Clock, Search, Mail,
} from "lucide-react";
import {
  listUsers, listReports, banUser, unbanUser, setRole, reviewReport,
  listPendingUsers, approveUser, rejectUser, deactivateUser, reactivateUser,
  deleteUserPermanent, isDeleteEnabled,
} from "../services/admin";

const ROLE_TONE = { admin: "var(--red)", moderator: "var(--warn)", user: "var(--txt3)" };
const STATUS_TONE = { open: "var(--warn)", reviewing: "var(--blue)", resolved: "var(--green)", dismissed: "var(--txt3)" };
const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  { id: "", label: "Tümü" },
  { id: "pending", label: "Bekleyen" },
  { id: "approved", label: "Onaylı" },
  { id: "rejected", label: "Reddedilen" },
  { id: "deactivated", label: "Devre dışı" },
  { id: "banned", label: "Yasaklı" },
];

function fmt(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("tr-TR"); } catch { return String(ts); }
}

function userStatus(u) {
  if (u.banned_at) return { label: "YASAKLI", tone: "var(--red)", bg: "rgba(229,72,77,0.12)" };
  if (u.deactivated_at) return { label: "DEVRE DIŞI", tone: "var(--warn)", bg: "rgba(240,180,41,0.12)" };
  if (u.approval_status === "pending") return { label: "BEKLİYOR", tone: "var(--blue)", bg: "rgba(77,158,255,0.12)" };
  if (u.approval_status === "rejected") return { label: "REDDEDİLDİ", tone: "var(--red)", bg: "rgba(229,72,77,0.12)" };
  return { label: "AKTİF", tone: "var(--green)", bg: "rgba(62,207,142,0.12)" };
}

/* ---------------- Onay penceresi (opsiyonel sebep alanı) ---------------- */
function ConfirmDialog({ open, title, message, needReason, confirmLabel, tone, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-[340px] nx-raised rounded-[24px] p-5" style={{ background: "var(--ink1)" }}>
        <h3 className="nx-display text-[15px] font-bold mb-1.5">{title}</h3>
        {message && <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: "var(--txt2)" }}>{message}</p>}
        {needReason && (
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="Sebep (opsiyonel)…"
            className="w-full nx-surface rounded-[14px] px-3 py-2.5 mb-3 bg-transparent outline-none text-[12.5px] resize-none"
            style={{ color: "var(--txt)" }}
          />
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="min-h-[42px] px-4 rounded-[14px] nx-surface text-[12.5px] font-semibold" style={{ color: "var(--txt2)" }}>
            Vazgeç
          </button>
          <button onClick={() => onConfirm(reason)} disabled={busy}
            className="min-h-[42px] px-4 rounded-[14px] text-[12.5px] font-semibold flex items-center gap-1.5"
            style={{ background: `${tone || "var(--red)"}22`, border: `1px solid ${tone || "var(--red)"}55`, color: tone || "var(--red)" }}>
            {busy && <Loader2 size={13} className="animate-spin" />} {confirmLabel || "Onayla"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPanel({ me, onClose }) {
  const [tab, setTab] = useState("applications");

  // ortak
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busyId, setBusyId] = useState(null);

  // applications
  const [pending, setPending] = useState([]);

  // users
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // reports
  const [reports, setReports] = useState([]);

  // confirm dialog
  const [dialog, setDialog] = useState(null); // { title, message, needReason, confirmLabel, tone, run }

  const flash = (msg) => { setOkMsg(msg); setTimeout(() => setOkMsg(""), 2500); };

  const reload = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      if (tab === "applications") {
        setPending(await listPendingUsers());
      } else if (tab === "users") {
        const rows = await listUsers({ search: search || null, status: statusFilter || null, pageSize: PAGE_SIZE, pageOffset: 0 });
        setUsers(rows);
        setOffset(0);
        setTotal(rows[0]?.total_count ? Number(rows[0].total_count) : rows.length);
      } else {
        setReports(await listReports({}));
      }
    } catch (ex) {
      setErr(ex?.message || "Veri alınamadı (yetki gerekli olabilir).");
    } finally {
      setLoading(false);
    }
  }, [tab, search, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const loadMore = async () => {
    const next = offset + PAGE_SIZE;
    try {
      const rows = await listUsers({ search: search || null, status: statusFilter || null, pageSize: PAGE_SIZE, pageOffset: next });
      setUsers((prev) => [...prev, ...rows]);
      setOffset(next);
      if (rows[0]?.total_count) setTotal(Number(rows[0].total_count));
    } catch (ex) { setErr(ex?.message || "Daha fazla yüklenemedi."); }
  };

  const runAction = async (fn, u, successMsg) => {
    setBusyId(u.id);
    setErr("");
    try { await fn(); flash(successMsg); await reload(); }
    catch (ex) { setErr(ex?.message || "İşlem başarısız."); }
    finally { setBusyId(null); }
  };

  const confirm = (cfg) => setDialog(cfg);
  const closeDialog = () => setDialog(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const onDialogConfirm = async (reason) => {
    if (!dialog) return;
    setDialogBusy(true);
    try { await dialog.run(reason); closeDialog(); }
    finally { setDialogBusy(false); }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col nx-in" style={{ background: "var(--ink0)" }}>
      <div className="px-3 pb-3 flex items-center gap-2 nx-hairline-b" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
        <button onClick={onClose} className="p-2 rounded-xl" aria-label="Geri"><ChevronLeft size={20} style={{ color: "var(--txt2)" }} /></button>
        <ShieldAlert size={16} style={{ color: "var(--red)" }} />
        <h1 className="nx-display text-[16px] font-bold">Admin Paneli</h1>
      </div>

      <div className="px-3 pt-3">
        <div className="nx-surface rounded-[16px] p-1 flex">
          {[
            { id: "applications", label: "Başvurular" },
            { id: "users", label: "Kullanıcılar" },
            { id: "reports", label: "Şikâyetler" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 h-9 rounded-[12px] text-[12px] font-semibold transition-colors"
              style={{ background: tab === t.id ? "var(--ink3)" : "transparent", color: tab === t.id ? "var(--txt)" : "var(--txt3)" }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "users" && (
          <div className="mt-2 space-y-2">
            <div className="nx-surface rounded-[14px] flex items-center gap-2 px-3 h-11">
              <Search size={15} style={{ color: "var(--txt3)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kullanıcı adı / e-posta ara…"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="flex-1 bg-transparent outline-none text-[13px] min-w-0" style={{ color: "var(--txt)" }} />
            </div>
            <div className="flex gap-1.5 overflow-x-auto nx-scroll pb-0.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.id} onClick={() => setStatusFilter(f.id)}
                  className="shrink-0 px-3 h-8 rounded-[12px] text-[11.5px] font-semibold"
                  style={{ background: statusFilter === f.id ? "var(--ink3)" : "var(--ink2)", color: statusFilter === f.id ? "var(--txt)" : "var(--txt3)", border: "1px solid var(--line)" }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {(tab === "applications" || tab === "users") && (
          <button onClick={reload} disabled={loading}
            className="mt-2 h-8 px-3 rounded-[12px] nx-surface text-[11.5px] font-semibold flex items-center gap-1.5" style={{ color: "var(--txt2)" }}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Durumu yenile
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto nx-scroll px-3 py-3">
        {err && <p className="text-[12px] mb-3 px-1" style={{ color: "var(--red)" }}>{err}</p>}
        {okMsg && <p className="text-[12px] mb-3 px-1" style={{ color: "var(--green)" }}>{okMsg}</p>}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10" style={{ color: "var(--txt3)" }}>
            <Loader2 size={16} className="animate-spin" /> <span className="text-[12.5px]">Yükleniyor…</span>
          </div>
        ) : tab === "applications" ? (
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.id} className="nx-surface rounded-[18px] p-3.5">
                <div className="flex items-center gap-2">
                  <Clock size={13} style={{ color: "var(--blue)" }} />
                  <span className="text-[13.5px] font-semibold truncate">{u.display_name || u.username || "—"}</span>
                </div>
                <p className="nx-mono text-[9.5px] mt-1 truncate" style={{ color: "var(--txt3)" }}>@{u.username}</p>
                <p className="text-[11.5px] mt-1 flex items-center gap-1.5 truncate" style={{ color: "var(--txt2)" }}>
                  <Mail size={11} /> {u.email || "—"}
                </p>
                <p className="nx-mono text-[9px] mt-1" style={{ color: "var(--txt3)" }}>Kayıt: {fmt(u.created_at)}</p>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => runAction(() => approveUser(u.id), u, "Kullanıcı onaylandı.")} disabled={busyId === u.id}
                    className="flex items-center gap-1.5 px-3 h-9 rounded-[12px] text-[12px] font-semibold disabled:opacity-50"
                    style={{ background: "rgba(62,207,142,0.12)", border: "1px solid rgba(62,207,142,0.3)", color: "var(--green)" }}>
                    {busyId === u.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Onayla
                  </button>
                  <button onClick={() => confirm({
                      title: "Başvuruyu reddet", message: `${u.username} başvurusu reddedilecek.`, needReason: true,
                      confirmLabel: "Reddet", tone: "var(--red)",
                      run: (reason) => runAction(() => rejectUser(u.id, reason || null), u, "Başvuru reddedildi."),
                    })} disabled={busyId === u.id}
                    className="flex items-center gap-1.5 px-3 h-9 rounded-[12px] text-[12px] font-semibold disabled:opacity-50"
                    style={{ background: "rgba(229,72,77,0.1)", border: "1px solid rgba(229,72,77,0.3)", color: "var(--red)" }}>
                    <X size={13} /> Reddet
                  </button>
                </div>
              </div>
            ))}
            {pending.length === 0 && <p className="text-center text-[12.5px] py-8" style={{ color: "var(--txt3)" }}>Bekleyen başvuru yok.</p>}
          </div>
        ) : tab === "users" ? (
          <div className="space-y-2">
            {users.map((u) => {
              const st = userStatus(u);
              const self = u.id === me?.id;
              return (
                <div key={u.id} className="nx-surface rounded-[18px] p-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold truncate">{u.display_name || u.username || "—"}</span>
                    <span className="nx-mono text-[9px] uppercase px-1.5 py-0.5 rounded-md" style={{ color: ROLE_TONE[u.role], background: "var(--ink3)" }}>{u.role}</span>
                    <span className="nx-mono text-[9px] px-1.5 py-0.5 rounded-md" style={{ color: st.tone, background: st.bg }}>{st.label}</span>
                    {self && <span className="nx-mono text-[9px] px-1.5 py-0.5 rounded-md" style={{ color: "var(--txt3)", background: "var(--ink3)" }}>SİZ</span>}
                  </div>
                  <p className="nx-mono text-[9.5px] mt-1 truncate" style={{ color: "var(--txt3)" }}>@{u.username} · {u.id.slice(0, 8)}</p>
                  <p className="text-[11.5px] mt-1 flex items-center gap-1.5 truncate" style={{ color: "var(--txt2)" }}><Mail size={11} /> {u.email || "—"}</p>
                  {u.rejection_reason && <p className="text-[11px] mt-1" style={{ color: "var(--red)" }}>Red: {u.rejection_reason}</p>}
                  {u.deactivation_reason && <p className="text-[11px] mt-1" style={{ color: "var(--warn)" }}>Devre dışı: {u.deactivation_reason}</p>}

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <select value={u.role} disabled={self || busyId === u.id} onChange={(e) => runAction(() => setRole(u.id, e.target.value), u, "Rol güncellendi.")}
                      className="nx-surface rounded-[12px] px-2 h-9 text-[12px] bg-transparent outline-none disabled:opacity-50" style={{ color: "var(--txt)" }}>
                      {["user", "moderator", "admin"].map((r) => <option key={r} value={r} style={{ background: "var(--ink2)" }}>{r}</option>)}
                    </select>

                    {u.deactivated_at ? (
                      <button onClick={() => runAction(() => reactivateUser(u.id), u, "Yeniden etkinleştirildi.")} disabled={busyId === u.id}
                        className="flex items-center gap-1.5 px-3 h-9 rounded-[12px] text-[12px] font-semibold disabled:opacity-50"
                        style={{ background: "rgba(62,207,142,0.1)", border: "1px solid rgba(62,207,142,0.3)", color: "var(--green)" }}>
                        <UserCheck size={13} /> Etkinleştir
                      </button>
                    ) : (
                      <button onClick={() => confirm({
                          title: "Kullanıcıyı devre dışı bırak", message: `${u.username} erişimi kısıtlanacak. Geçmiş mesajları korunur.`, needReason: true,
                          confirmLabel: "Devre dışı bırak", tone: "var(--warn)",
                          run: (reason) => runAction(() => deactivateUser(u.id, reason || null), u, "Devre dışı bırakıldı."),
                        })} disabled={self || busyId === u.id}
                        className="flex items-center gap-1.5 px-3 h-9 rounded-[12px] text-[12px] font-semibold disabled:opacity-50"
                        style={{ background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.3)", color: "var(--warn)" }}>
                        <UserX size={13} /> Devre dışı
                      </button>
                    )}

                    <button onClick={() => {
                        if (u.banned_at) return runAction(() => unbanUser(u.id), u, "Yasak kaldırıldı.");
                        confirm({
                          title: "Kullanıcıyı yasakla", message: `${u.username} yasaklanacak.`, needReason: true,
                          confirmLabel: "Yasakla", tone: "var(--red)",
                          run: (reason) => runAction(() => banUser(u.id, reason || "Panelden yasaklandı"), u, "Yasaklandı."),
                        });
                      }} disabled={self || busyId === u.id}
                      className="flex items-center gap-1.5 px-3 h-9 rounded-[12px] text-[12px] font-semibold disabled:opacity-50"
                      style={{ background: u.banned_at ? "rgba(62,207,142,0.1)" : "rgba(229,72,77,0.1)", border: `1px solid ${u.banned_at ? "rgba(62,207,142,0.3)" : "rgba(229,72,77,0.3)"}`, color: u.banned_at ? "var(--green)" : "var(--red)" }}>
                      {busyId === u.id ? <Loader2 size={13} className="animate-spin" /> : (u.banned_at ? <ShieldCheck size={13} /> : <Ban size={13} />)}
                      {u.banned_at ? "Yasağı kaldır" : "Yasakla"}
                    </button>

                    {isDeleteEnabled && (
                      <button onClick={() => confirm({
                          title: "Kalıcı sil", message: `${u.username} kalıcı olarak silinecek. Bu işlem geri alınamaz.`, needReason: false,
                          confirmLabel: "Kalıcı sil", tone: "var(--red)",
                          run: () => runAction(() => deleteUserPermanent(u.id), u, "Kullanıcı silindi."),
                        })} disabled={self || busyId === u.id}
                        className="flex items-center gap-1.5 px-3 h-9 rounded-[12px] text-[12px] font-semibold disabled:opacity-50"
                        style={{ background: "rgba(229,72,77,0.14)", border: "1px solid rgba(229,72,77,0.4)", color: "var(--red)" }}>
                        <Trash2 size={13} /> Kalıcı sil
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {users.length === 0 && <p className="text-center text-[12.5px] py-8" style={{ color: "var(--txt3)" }}>Kullanıcı yok.</p>}
            {users.length > 0 && users.length < total && (
              <button onClick={loadMore} className="w-full h-10 rounded-[14px] nx-surface text-[12.5px] font-semibold mt-1" style={{ color: "var(--txt2)" }}>
                Daha fazla ({users.length}/{total})
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => (
              <div key={r.id} className="nx-surface rounded-[18px] p-3.5">
                <div className="flex items-center gap-2">
                  <Flag size={13} style={{ color: "var(--warn)" }} />
                  <span className="text-[13px] font-semibold">{r.reason}</span>
                  <span className="ml-auto nx-mono text-[9px] uppercase px-1.5 py-0.5 rounded-md" style={{ color: STATUS_TONE[r.status], background: "var(--ink3)" }}>{r.status}</span>
                </div>
                {r.details && <p className="text-[12px] mt-1.5" style={{ color: "var(--txt2)" }}>{r.details}</p>}
                <p className="nx-mono text-[9px] mt-1" style={{ color: "var(--txt3)" }}>{fmt(r.created_at)}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {["reviewing", "resolved", "dismissed"].map((s) => (
                    <button key={s} onClick={() => runAction(() => reviewReport(r.id, s), { id: r.id }, "Güncellendi.")} disabled={busyId === r.id}
                      className="px-3 h-8 rounded-[12px] text-[11.5px] font-semibold nx-surface disabled:opacity-50" style={{ color: "var(--txt2)" }}>
                      {s === "reviewing" ? "İncele" : s === "resolved" ? "Çöz" : "Reddet"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {reports.length === 0 && <p className="text-center text-[12.5px] py-8" style={{ color: "var(--txt3)" }}>Şikâyet yok.</p>}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title}
        message={dialog?.message}
        needReason={dialog?.needReason}
        confirmLabel={dialog?.confirmLabel}
        tone={dialog?.tone}
        busy={dialogBusy}
        onCancel={closeDialog}
        onConfirm={onDialogConfirm}
      />
    </div>
  );
}

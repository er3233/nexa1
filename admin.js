import { supabase } from "../lib/supabase";

/* ---------------- Kullanıcı yönetimi (arama + filtre + sayfalama) ---------------- */
export async function listUsers({ search = null, status = null, pageSize = 25, pageOffset = 0 } = {}) {
  const { data, error } = await supabase.rpc("admin_list_users", {
    search_text: search,
    status_filter: status,
    page_size: pageSize,
    page_offset: pageOffset,
  });
  if (error) throw error;
  return data || [];
}

/* ---------------- Hesap başvuruları ---------------- */
export async function listPendingUsers() {
  const { data, error } = await supabase.rpc("admin_list_pending_users");
  if (error) throw error;
  return data || [];
}

export async function approveUser(targetUserId) {
  const { error } = await supabase.rpc("admin_approve_user", { target_user_id: targetUserId });
  if (error) throw error;
}

export async function rejectUser(targetUserId, reason = null) {
  const { error } = await supabase.rpc("admin_reject_user", { target_user_id: targetUserId, reason });
  if (error) throw error;
}

/* ---------------- Devre dışı / yeniden etkinleştir ---------------- */
export async function deactivateUser(targetUserId, reason = null) {
  const { error } = await supabase.rpc("admin_deactivate_user", { target_user_id: targetUserId, reason });
  if (error) throw error;
}

export async function reactivateUser(targetUserId) {
  const { error } = await supabase.rpc("admin_reactivate_user", { target_user_id: targetUserId });
  if (error) throw error;
}

/* ---------------- Yasak / rol / şikâyet ---------------- */
export async function banUser(target, reason = null) {
  const { error } = await supabase.rpc("admin_ban_user", { target, reason });
  if (error) throw error;
}

export async function unbanUser(target) {
  const { error } = await supabase.rpc("admin_unban_user", { target });
  if (error) throw error;
}

export async function setRole(target, newRole) {
  const { error } = await supabase.rpc("admin_set_role", { target, new_role: newRole });
  if (error) throw error;
}

export async function softDeleteMessage(messageId) {
  const { error } = await supabase.rpc("admin_soft_delete_message", { msg: messageId });
  if (error) throw error;
}

export async function reviewReport(reportId, newStatus) {
  const { error } = await supabase.rpc("admin_review_report", { report_id: reportId, new_status: newStatus });
  if (error) throw error;
}

export async function listReports({ status = null, limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc("admin_list_reports", { status_filter: status, lim: limit, off: offset });
  if (error) throw error;
  return data || [];
}

export async function getAuditLogs({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("id, admin_id, action, target_type, target_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/* ---------------- Kalıcı silme (Edge Function) ---------------- */
// service_role ASLA tarayıcıda tutulmaz. Silme, sunucu tarafındaki
// admin-delete-user Edge Function'ı üzerinden yapılır.
// Buton yalnızca VITE_ADMIN_DELETE_ENABLED=true iken gösterilir.
export const isDeleteEnabled =
  String(import.meta.env.VITE_ADMIN_DELETE_ENABLED || "").toLowerCase() === "true";

export async function deleteUserPermanent(targetUserId) {
  const { data, error } = await supabase.functions.invoke("admin-delete-user", {
    body: { target_user_id: targetUserId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

import { supabase } from "../lib/supabase";

// Sohbet Kilidi (4 haneli PIN). Hash/salt yalnızca sunucuda; frontend PIN'i loglamaz.
// RPC parametreleri: p_conversation_id, p_pin (015 — ambiguous column düzeltmesi).

export function formatLockError(err) {
  const m = (err?.message || err?.details || String(err || "")).trim();
  if (/ambiguous|column reference/i.test(m)) {
    return "Sohbet kilidi SQL hatası (conversation_id). Supabase'te 015 migration'ını çalıştırın.";
  }
  if (/gen_salt|function crypt|pgcrypto|extensions\.crypt/i.test(m)) {
    return "PIN güvenlik modülü (pgcrypto) hatası. Supabase SQL Editor'de 012–015 migration'larını kontrol edin.";
  }
  if (/PIN tam olarak|Hesabınız|üyesi değilsiniz|Önce PIN|kaydedilemedi/i.test(m)) return m;
  if (/permission denied|row-level security/i.test(m)) return "Sohbet kilidi için yetki hatası (RLS). Migration 011–015 uygulandığından emin olun.";
  if (m.length > 0 && m.length < 200) return m;
  return "Sohbet kilidi işlemi başarısız oldu.";
}

export async function getLockStatus(conversationId) {
  const { data, error } = await supabase.rpc("get_conversation_lock_status", { p_conversation_id: conversationId });
  if (error) throw new Error(formatLockError(error));
  return data || { has_pin: false, requires_pin: false, locked: false };
}

export async function setPin(conversationId, pin) {
  const { data, error } = await supabase.rpc("set_conversation_pin", { p_conversation_id: conversationId, p_pin: pin });
  if (error) throw new Error(formatLockError(error));
  return data;
}

export async function verifyPin(conversationId, pin) {
  const { data, error } = await supabase.rpc("verify_conversation_pin", { p_conversation_id: conversationId, p_pin: pin });
  if (error) throw new Error(formatLockError(error));
  return data;
}

export async function lockNow(conversationId) {
  const { data, error } = await supabase.rpc("lock_conversation_now", { p_conversation_id: conversationId });
  if (error) throw new Error(formatLockError(error));
  return data;
}

export async function removePin(conversationId, pin) {
  const { data, error } = await supabase.rpc("remove_conversation_pin", { p_conversation_id: conversationId, p_pin: pin });
  if (error) throw new Error(formatLockError(error));
  return data;
}

export async function forgotPinReauthAndRemove(conversationId, email, password) {
  const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error("Parola doğrulanamadı. Hesap parolanızı kontrol edin.");
  const { error } = await supabase.rpc("force_remove_conversation_lock", { p_conversation_id: conversationId });
  if (error) throw new Error(formatLockError(error));
}

export async function getLockedConversationIds() {
  const { data, error } = await supabase.rpc("get_locked_conversation_ids");
  if (error) throw new Error(formatLockError(error));
  return (data || []).map((r) => (typeof r === "string" ? r : r?.get_locked_conversation_ids)).filter(Boolean);
}

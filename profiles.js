import { supabase } from "../lib/supabase";
import { normalizeSearchQuery } from "../lib/searchText";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Yalnızca kullanıcının değiştirmesine izin verilen güvenli alanlar.
const SAFE_PROFILE_FIELDS = ["display_name", "bio", "avatar_url", "status"];

export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, username, display_name, avatar_url, bio, role, status, is_online, last_seen_at, banned_at, ban_reason, approval_status, approved_at, rejected_at, rejection_reason, deactivated_at, deactivation_reason, created_at"
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Güvenli kullanıcı arama (yalnızca onaylı/aktif kullanıcılar; e-posta dönmez).
// RPC güvenli tarafta filtreler: kendini, engellenenleri ve onaysızları hariç tutar.
export async function searchApprovedUsers(searchText, resultLimit = 20) {
  const q = normalizeSearchQuery(searchText);
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("search_approved_users", {
    search_text: q,
    result_limit: resultLimit,
  });
  if (error) throw error;
  return data || [];
}

export async function getProfile(id) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, is_online, last_seen_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProfiles(excludeId, { search = "" } = {}) {
  let q = supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, is_online, last_seen_at")
    .order("created_at", { ascending: true });
  if (search) q = q.or(`username.ilike.%${search}%,display_name.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).filter((p) => p.id !== excludeId);
}

export async function updateProfile(userId, fields) {
  const safe = {};
  for (const k of SAFE_PROFILE_FIELDS) if (k in fields) safe[k] = fields[k];
  const { data, error } = await supabase
    .from("profiles")
    .update(safe)
    .eq("id", userId)
    .select("id, username, display_name, avatar_url, bio, status")
    .single();
  if (error) throw error;
  return data;
}

/* ---------------- user_settings ---------------- */
const SAFE_SETTINGS_FIELDS = [
  "theme",
  "language",
  "notifications_enabled",
  "read_receipts_enabled",
  "last_seen_visibility",
  "profile_photo_visibility",
];

export async function getSettings(userId) {
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertSettings(userId, fields) {
  const safe = { user_id: userId };
  for (const k of SAFE_SETTINGS_FIELDS) if (k in fields) safe[k] = fields[k];
  const { data, error } = await supabase
    .from("user_settings")
    .upsert(safe, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/* ---------------- presence ---------------- */
export async function setPresence(userId, isOnline) {
  const { error } = await supabase
    .from("profiles")
    .update({ is_online: isOnline, last_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

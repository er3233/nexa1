import { supabase } from "../lib/supabase";

// Bildirim servisleri. RLS yalnızca kendi bildirimlerine izin verir; ekstra
// recipient filtresine gerek yok ama açıklık için select basit tutuldu.

export async function listNotifications(limit = 50) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, recipient_id, actor_id, type, title, body, entity_id, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getUnreadNotificationCount() {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);
  if (error) throw error;
  return count || 0;
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("is_read", false);
  if (error) throw error;
}

// Realtime: yalnızca bu kullanıcının bildirim satırları (benzersiz topic).
export function subscribeNotifications(userId, onChange) {
  const token = Math.random().toString(36).slice(2, 8);
  const channel = supabase
    .channel(`notif:${userId}:${token}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
      () => onChange?.()
    )
    .subscribe();
  return channel;
}

export function unsubscribeNotifications(channel) {
  if (channel) supabase.removeChannel(channel);
}

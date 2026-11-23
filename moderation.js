import { supabase } from "../lib/supabase";

export async function blockUser(blockerId, blockedId) {
  const { error } = await supabase
    .from("blocked_users")
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
}

export async function unblockUser(blockerId, blockedId) {
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

export async function listBlocked(blockerId) {
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_id, created_at")
    .eq("blocker_id", blockerId);
  if (error) throw error;
  return data || [];
}

export async function reportContent({ reporterId, reportedUserId = null, messageId = null, conversationId = null, reason, details = null }) {
  const { data, error } = await supabase
    .from("reports")
    .insert({
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      message_id: messageId,
      conversation_id: conversationId,
      reason,
      details,
    })
    .select("id, status, created_at")
    .single();
  if (error) throw error;
  return data;
}

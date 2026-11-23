import { supabase } from "../lib/supabase";

// Mesajlaşma isteği servisleri — hepsi güvenli SECURITY DEFINER RPC'leri çağırır.

export async function sendMessageRequest(receiverUserId, preview = null) {
  const { data, error } = await supabase.rpc("send_message_request", {
    receiver_user_id: receiverUserId,
    preview,
  });
  if (error) throw error;
  // { type: 'existing_conversation'|'already_pending'|'request_sent', conversation_id, request_id }
  return data;
}

export async function listIncomingRequests() {
  const { data, error } = await supabase.rpc("list_incoming_message_requests");
  if (error) throw error;
  return data || [];
}

export async function listOutgoingRequests() {
  const { data, error } = await supabase.rpc("list_outgoing_message_requests");
  if (error) throw error;
  return data || [];
}

export async function acceptMessageRequest(requestId) {
  const { data, error } = await supabase.rpc("accept_message_request", { request_id: requestId });
  if (error) throw error;
  return data; // conversation_id
}

export async function rejectMessageRequest(requestId) {
  const { error } = await supabase.rpc("reject_message_request", { request_id: requestId });
  if (error) throw error;
}

export async function cancelMessageRequest(requestId) {
  const { error } = await supabase.rpc("cancel_message_request", { request_id: requestId });
  if (error) throw error;
}

export async function getMessageRequestCount() {
  const { data, error } = await supabase.rpc("get_message_request_count");
  if (error) throw error;
  return typeof data === "number" ? data : Number(data || 0);
}

// Realtime: kullanıcının alıcı/gönderen olduğu istek değişimleri.
// Benzersiz topic (birden fazla abone çakışmasın).
export function subscribeToMessageRequests(userId, onChange) {
  const token = Math.random().toString(36).slice(2, 8);
  const channel = supabase
    .channel(`msg-req:${userId}:${token}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_requests", filter: `receiver_id=eq.${userId}` },
      () => onChange?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_requests", filter: `sender_id=eq.${userId}` },
      () => onChange?.()
    )
    .subscribe();
  return channel;
}

export function unsubscribeMessageRequests(channel) {
  if (channel) supabase.removeChannel(channel);
}

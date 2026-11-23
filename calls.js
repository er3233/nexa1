import { supabase } from "../lib/supabase";

// Çağrı süresiz ringing kalmasın: 45 sn sonra missed.
export const RING_TIMEOUT_MS = 45000;

// ------------------------------------------------------------
// ICE sunucuları — env üzerinden yapılandırılır.
// UYARI: STUN tek başına birçok mobil/NAT ağında YETMEZ; production'da
// güvenilir çağrı için TURN sunucusu gerekir. TURN credential'ları frontend'de
// tam gizli sayılmaz; ideali sunucudan kısa ömürlü credential üretmektir.
// ------------------------------------------------------------
export function getIceServers() {
  const stun = import.meta.env.VITE_STUN_URL || "stun:stun.l.google.com:19302";
  const servers = [{ urls: stun }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

export function hasTurn() {
  return !!import.meta.env.VITE_TURN_URL;
}

export function mediaConstraints(callType) {
  if (callType === "video") {
    return {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    };
  }
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

// ------------------------------------------------------------
// RPC sarmalayıcılar (güvenli durum değişimi)
// ------------------------------------------------------------
export async function startCall(receiverUserId, conversationId, callType) {
  const { data, error } = await supabase.rpc("start_call", {
    receiver_user_id: receiverUserId,
    conversation_id: conversationId,
    call_type: callType,
  });
  if (error) throw error;
  return data; // call_id
}
export async function acceptCall(callId) {
  const { error } = await supabase.rpc("accept_call", { call_id: callId });
  if (error) throw error;
}
export async function rejectCall(callId) {
  const { error } = await supabase.rpc("reject_call", { call_id: callId });
  if (error) throw error;
}
export async function cancelCall(callId) {
  const { error } = await supabase.rpc("cancel_call", { call_id: callId });
  if (error) throw error;
}
export async function endCall(callId) {
  const { error } = await supabase.rpc("end_call", { call_id: callId });
  if (error) throw error;
}
export async function markMissedCall(callId) {
  const { error } = await supabase.rpc("mark_missed_call", { call_id: callId });
  if (error) throw error;
}

export async function expireStaleCalls() {
  const { error } = await supabase.rpc("expire_stale_calls");
  if (error) throw error;
}

/** Stuck ringing/accepted oturumlarını mevcut RPC'lerle kapat (katılımcı olduğun satırlar). */
export async function clearMyActiveCallSessions(userId) {
  await expireStaleCalls().catch(() => {});
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id, status, caller_id, receiver_id")
    .in("status", ["ringing", "accepted"])
    .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`);
  if (error) throw error;
  for (const row of data || []) {
    try {
      if (row.status === "ringing" && row.caller_id === userId) await cancelCall(row.id);
      else if (row.status === "ringing" && row.receiver_id === userId) await rejectCall(row.id);
      else await endCall(row.id);
    } catch (_) { /* tek satır başarısız olsa diğerlerini dene */ }
  }
  return (data || []).length;
}

export async function getProfileBrief(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCallSession(callId) {
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id, caller_id, receiver_id, conversation_id, call_type, status, answered_at, ended_at, created_at")
    .eq("id", callId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Realtime kaçarsa gelen çalma yedeği (RLS: yalnızca receiver kendi ringing satırını görür).
export async function getRingingIncoming(userId) {
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id, caller_id, receiver_id, conversation_id, call_type, status, created_at")
    .eq("receiver_id", userId)
    .eq("status", "ringing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------
// Sinyalleşme
// ------------------------------------------------------------
export async function sendSignal(callId, senderId, signalType, payload) {
  const { error } = await supabase
    .from("call_signals")
    .insert({ call_id: callId, sender_id: senderId, signal_type: signalType, payload });
  if (error) throw error;
}

// Bir çağrının mevcut tüm sinyalleri (kabul anında erken offer/ICE'ı yakalamak için).
export async function getSignals(callId) {
  const { data, error } = await supabase
    .from("call_signals")
    .select("id, call_id, sender_id, signal_type, payload, created_at")
    .eq("call_id", callId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ------------------------------------------------------------
// Realtime abonelikleri (benzersiz topic → çakışma yok)
// ------------------------------------------------------------
// Kullanıcının dahil olduğu tüm oturum değişimleri (gelen çağrı + durum güncellemeleri).
export function subscribeUserCalls(userId, { onIncoming, onSessionChange } = {}) {
  const token = Math.random().toString(36).slice(2, 8);
  const channel = supabase
    .channel(`calls:user:${userId}:${token}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "call_sessions", filter: `receiver_id=eq.${userId}` },
      (p) => onIncoming?.(p.new))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "call_sessions", filter: `receiver_id=eq.${userId}` },
      (p) => onSessionChange?.(p.new))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "call_sessions", filter: `caller_id=eq.${userId}` },
      (p) => onSessionChange?.(p.new))
    .subscribe();
  return channel;
}

// Belirli bir çağrının sinyalleri + durum değişimleri.
export function subscribeCallChannel(callId, { onSignal, onSessionChange } = {}) {
  const token = Math.random().toString(36).slice(2, 8);
  const channel = supabase
    .channel(`calls:session:${callId}:${token}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${callId}` },
      (p) => onSignal?.(p.new))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "call_sessions", filter: `id=eq.${callId}` },
      (p) => onSessionChange?.(p.new))
    .subscribe();
  return channel;
}

export function removeCallChannel(channel) {
  if (channel) supabase.removeChannel(channel);
}

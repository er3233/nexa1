import { supabase } from "../lib/supabase";
import { escapeIlike, normalizeSearchQuery } from "../lib/searchText";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const MESSAGE_PAGE_SIZE = 30;

// undefined_column (42703): migration 019 (disappearing messages) henüz çalıştırılmamış olabilir.
// Bu durumda yeni kolonlar olmadan sorguyu TEKRAR dener — sohbet/mesaj listesi asla tamamen çökmez,
// yalnızca kaybolan mesaj özelliği migration çalıştırılana kadar pasif kalır.
const UNDEFINED_COLUMN = "42703";

function logDevError(label, e) {
  if (import.meta.env?.DEV) {
    console.error(`[services/chat] ${label}:`, { message: e?.message, code: e?.code, details: e?.details, hint: e?.hint });
  }
}

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, reply_to_id, message_type, content, metadata, created_at, updated_at, edited_at, deleted_at";
const MESSAGE_COLUMNS_EXT = `${MESSAGE_COLUMNS}, expires_at`;
const CONVERSATION_COLUMNS = "id, title, type, is_group, avatar_url, last_message_at, created_at";
const CONVERSATION_COLUMNS_EXT = `${CONVERSATION_COLUMNS}, disappearing_seconds`;

/* ---------------- conversations ---------------- */
export async function getConversations(userId) {
  const { data: mem, error: e1 } = await supabase
    .from("conversation_members")
    .select("conversation_id, muted_until, archived_at, last_read_at, last_read_message_id")
    .eq("user_id", userId);
  if (e1) throw e1;

  const ids = [...new Set((mem || []).map((m) => m.conversation_id))];
  if (!ids.length) return [];
  const memByConv = Object.fromEntries((mem || []).map((m) => [m.conversation_id, m]));

  let { data: convs, error: e2 } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS_EXT)
    .in("id", ids);
  if (e2) {
    logDevError("conversations select (disappearing_seconds)", e2);
    if (e2.code === UNDEFINED_COLUMN) {
      ({ data: convs, error: e2 } = await supabase.from("conversations").select(CONVERSATION_COLUMNS).in("id", ids));
    }
  }
  if (e2) throw e2;

  const { data: members, error: e3 } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id, member_role")
    .in("conversation_id", ids);
  if (e3) throw e3;

  const memberIds = [...new Set((members || []).map((m) => m.user_id))];
  const { data: profs, error: e4 } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, is_online, last_seen_at")
    .in("id", memberIds.length ? memberIds : [NIL_UUID]);
  if (e4) throw e4;
  const profById = Object.fromEntries((profs || []).map((p) => [p.id, p]));

  const { data: lastMsgs, error: e5 } = await supabase
    .from("messages")
    .select("id, conversation_id, content, message_type, created_at, sender_id, deleted_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false });
  if (e5) throw e5;
  const lastByConv = {};
  for (const m of lastMsgs || []) if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m;

  let unreadMap = {};
  try {
    const { data: counts } = await supabase.rpc("get_unread_counts");
    unreadMap = Object.fromEntries((counts || []).map((c) => [c.conversation_id, c.unread]));
  } catch (_) {
    unreadMap = {};
  }

  return (convs || [])
    .map((c) => {
      const cm = (members || []).filter((m) => m.conversation_id === c.id);
      const others = cm.filter((m) => m.user_id !== userId).map((m) => profById[m.user_id]).filter(Boolean);
      const myMem = memByConv[c.id] || {};
      return {
        ...c,
        members: cm.map((m) => ({ ...profById[m.user_id], member_role: m.member_role })).filter((p) => p && p.id),
        others,
        lastMessage: lastByConv[c.id] || null,
        unread: unreadMap[c.id] || 0,
        muted_until: myMem.muted_until || null,
        archived_at: myMem.archived_at || null,
        last_read_at: myMem.last_read_at || null,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.last_message_at || b.lastMessage?.created_at || b.created_at) -
        new Date(a.last_message_at || a.lastMessage?.created_at || a.created_at)
    );
}

export async function getOrCreateDirectConversation(otherId) {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { other_id: otherId });
  if (error) throw error;
  return data;
}

/* ---------------- messages (cursor pagination) ---------------- */
export async function getMessagesPage(conversationId, { before = null, limit = MESSAGE_PAGE_SIZE } = {}) {
  const build = (columns) => {
    let q = supabase
      .from("messages")
      .select(columns)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) q = q.lt("created_at", before);
    return q;
  };

  let { data, error } = await build(MESSAGE_COLUMNS_EXT);
  if (error) {
    logDevError("getMessagesPage (expires_at)", error);
    if (error.code === UNDEFINED_COLUMN) {
      ({ data, error } = await build(MESSAGE_COLUMNS));
    }
  }
  if (error) throw error;
  const rows = (data || []).slice().reverse(); // eskiden yeniye
  return { messages: rows, hasMore: (data || []).length === limit, oldestCreatedAt: rows[0]?.created_at || null };
}

// Sohbet içi mesaj arama (yalnızca mevcut RLS'e tabi, sunucu tarafı ilike).
export async function searchMessages(conversationId, query, limit = 30) {
  const q = normalizeSearchQuery(query);
  if (!q) return [];
  const pattern = `%${escapeIlike(q)}%`;
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, content, message_type, created_at, deleted_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .ilike("content", pattern)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getMessagesByIds(ids) {
  if (!ids?.length) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, content, message_type, deleted_at")
    .in("id", ids);
  if (error) throw error;
  return data || [];
}

export async function sendMessage({ conversationId, senderId, content, replyToId = null, messageType = "text", metadata = {} }) {
  const payload = {
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    reply_to_id: replyToId,
    message_type: messageType,
    metadata,
  };
  // INSERT ... RETURNING tek bir atomik ifadedir: RETURNING listesindeki bilinmeyen
  // bir kolon TÜM insert'i başarısız kılar (satır kaydedilmez) — bu yüzden ikinci
  // denemede aynı isteği tekrar göndermek güvenlidir, kopya kayıt oluşmaz.
  let { data, error } = await supabase.from("messages").insert(payload).select(MESSAGE_COLUMNS_EXT).single();
  if (error) {
    logDevError("sendMessage (expires_at)", error);
    if (error.code === UNDEFINED_COLUMN) {
      ({ data, error } = await supabase.from("messages").insert(payload).select(MESSAGE_COLUMNS).single());
    }
  }
  if (error) throw error;
  return data;
}

export async function editMessage({ messageId, content }) {
  const now = new Date().toISOString();
  const patch = { content, edited_at: now, updated_at: now };
  let { data, error } = await supabase.from("messages").update(patch).eq("id", messageId).select(MESSAGE_COLUMNS_EXT).single();
  if (error) {
    logDevError("editMessage (expires_at)", error);
    if (error.code === UNDEFINED_COLUMN) {
      ({ data, error } = await supabase.from("messages").update(patch).eq("id", messageId).select(MESSAGE_COLUMNS).single());
    }
  }
  if (error) throw error;
  return data;
}

export async function softDeleteMessage({ messageId }) {
  const now = new Date().toISOString();
  const patch = { deleted_at: now, updated_at: now };
  let { data, error } = await supabase.from("messages").update(patch).eq("id", messageId).select(MESSAGE_COLUMNS_EXT).single();
  if (error) {
    logDevError("softDeleteMessage (expires_at)", error);
    if (error.code === UNDEFINED_COLUMN) {
      ({ data, error } = await supabase.from("messages").update(patch).eq("id", messageId).select(MESSAGE_COLUMNS).single());
    }
  }
  if (error) throw error;
  return data;
}

/* ---------------- reactions ---------------- */
export async function getReactionsForMessages(messageIds) {
  if (!messageIds?.length) return [];
  const { data, error } = await supabase
    .from("message_reactions")
    .select("id, message_id, user_id, emoji, created_at")
    .in("message_id", messageIds);
  if (error) throw error;
  return data || [];
}

export async function addReaction({ messageId, userId, emoji }) {
  const { data, error } = await supabase
    .from("message_reactions")
    .insert({ message_id: messageId, user_id: userId, emoji })
    .select("id, message_id, user_id, emoji, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function removeReaction({ messageId, userId, emoji }) {
  const { error } = await supabase
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji);
  if (error) throw error;
}

/* ---------------- typing / read ---------------- */
export async function setTyping(conversationId, userId) {
  const { error } = await supabase
    .from("typing_indicators")
    .upsert(
      { conversation_id: conversationId, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "conversation_id,user_id" }
    );
  if (error) throw error;
}

export async function clearTyping(conversationId, userId) {
  await supabase.from("typing_indicators").delete().eq("conversation_id", conversationId).eq("user_id", userId);
}

export async function markRead(conversationId, messageId = null) {
  const { error } = await supabase.rpc("mark_conversation_read", { conv: conversationId, msg: messageId });
  if (error) throw error;
}

export async function getUnreadCounts() {
  const { data, error } = await supabase.rpc("get_unread_counts");
  if (error) throw error;
  return Object.fromEntries((data || []).map((c) => [c.conversation_id, c.unread]));
}

export async function setMuted(conversationId, until = null) {
  const { error } = await supabase.rpc("set_conversation_muted", { conv: conversationId, until });
  if (error) throw error;
}

export async function setArchived(conversationId, archived) {
  const { error } = await supabase.rpc("set_conversation_archived", { conv: conversationId, archived });
  if (error) throw error;
}

// Karşı üyenin last_read_at değeri — gerçek okundu/iletildi tikleri için.
// RLS zaten aynı konuşmanın üyelerine birbirinin conversation_members satırını
// göstermeye izin veriyor (getConversations'ta da aynı desen kullanılıyor).
export async function getMemberReadStates(conversationId) {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id, last_read_at")
    .eq("conversation_id", conversationId);
  if (error) throw error;
  return data || [];
}

export async function setDisappearingMessages(conversationId, seconds) {
  const { error } = await supabase.rpc("set_disappearing_messages", {
    p_conversation_id: conversationId,
    p_seconds: seconds,
  });
  if (error) throw error;
}

export async function cleanupExpiredMessages(conversationId) {
  const { error } = await supabase.rpc("cleanup_expired_messages", { p_conversation_id: conversationId });
  if (error) throw error;
}

/* ---------------- realtime ---------------- */
// Tek kanal: mesaj (insert/update/delete), reaksiyon (insert/delete), yazıyor.
export function subscribeToConversation(conversationId, handlers = {}) {
  const { onMessageInsert, onMessageUpdate, onMessageDelete, onReactionInsert, onReactionDelete, onTyping } = handlers;
  const channel = supabase.channel(`conv:${conversationId}`);

  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => onMessageInsert?.(p.new));
  channel.on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => onMessageUpdate?.(p.new));
  channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (p) => onMessageDelete?.(p.old));
  // reaksiyonlarda conversation kolonu yok; RLS + client filtre ile
  channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (p) => onReactionInsert?.(p.new));
  channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (p) => onReactionDelete?.(p.old));
  channel.on("postgres_changes", { event: "*", schema: "public", table: "typing_indicators", filter: `conversation_id=eq.${conversationId}` }, (p) => onTyping?.(p));

  channel.subscribe();
  return channel;
}

// Konuşma listesini tazelemek için: kullanıcının üyeliklerindeki mesaj değişimleri.
// Birden fazla hook aynı anda abone olabildiği için benzersiz topic kullanılır.
export function subscribeToConversationList(userId, onChange) {
  const token = Math.random().toString(36).slice(2, 8);
  const channel = supabase
    .channel(`conv-list:${userId}:${token}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => onChange?.())
    .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` }, () => onChange?.())
    .subscribe();
  return channel;
}

export async function unsubscribe(channel) {
  try {
    if (channel) await supabase.removeChannel(channel);
  } catch (_) {
    /* noop */
  }
}

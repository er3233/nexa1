import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMessagesPage,
  getReactionsForMessages,
  sendMessage as apiSend,
  editMessage as apiEdit,
  softDeleteMessage as apiDelete,
  addReaction as apiAddReaction,
  removeReaction as apiRemoveReaction,
  subscribeToConversation,
  unsubscribe,
  markRead,
  cleanupExpiredMessages,
  MESSAGE_PAGE_SIZE,
} from "../services/chat";

function logDevError(label, e) {
  if (import.meta.env?.DEV) {
    console.error(`[useMessages] ${label}:`, { message: e?.message, code: e?.code, details: e?.details, hint: e?.hint });
  }
}

export function useMessages(conversationId, userId, reloadToken = 0, disappearingActive = false) {
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const channelRef = useRef(null);
  const msgIdsRef = useRef(new Set());

  const upsertMessage = useCallback((row) => {
    setMessages((prev) => {
      const i = prev.findIndex((m) => m.id === row.id);
      if (i === -1) {
        msgIdsRef.current.add(row.id);
        return [...prev, row].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
      const next = prev.slice();
      next[i] = { ...next[i], ...row };
      return next;
    });
  }, []);

  useEffect(() => {
    msgIdsRef.current = new Set();
    setMessages([]);
    setReactions([]);
    setError(null);
    setHasMore(false);
    if (!conversationId) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    (async () => {
      try {
        const { messages: rows, hasMore: more } = await getMessagesPage(conversationId, { limit: MESSAGE_PAGE_SIZE });
        if (!active) return;
        msgIdsRef.current = new Set(rows.map((r) => r.id));
        setMessages(rows);
        setHasMore(more);
        const rx = await getReactionsForMessages(rows.map((r) => r.id));
        if (active) setReactions(rx);
        const lastId = rows[rows.length - 1]?.id || null;
        markRead(conversationId, lastId).catch(() => {});
        if (disappearingActive) cleanupExpiredMessages(conversationId).catch(() => {});
      } catch (e) {
        logDevError("ilk mesaj sayfası", e);
        if (active) setError("Mesajlar yüklenemedi.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    const channel = subscribeToConversation(conversationId, {
      onMessageInsert: (row) => {
        upsertMessage(row);
        markRead(conversationId, row.id).catch(() => {});
      },
      onMessageUpdate: (row) => upsertMessage(row),
      onMessageDelete: (old) => {
        if (!old?.id) return;
        msgIdsRef.current.delete(old.id);
        setMessages((prev) => prev.filter((m) => m.id !== old.id));
      },
      onReactionInsert: (r) => {
        if (!msgIdsRef.current.has(r.message_id)) return;
        setReactions((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
      },
      onReactionDelete: (r) => {
        setReactions((prev) =>
          prev.filter((x) =>
            r.id ? x.id !== r.id : !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)
          )
        );
      },
    });
    channelRef.current = channel;

    return () => {
      active = false;
      unsubscribe(channelRef.current);
      channelRef.current = null;
    };
  }, [conversationId, upsertMessage, reloadToken, disappearingActive]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const before = messages[0]?.created_at;
      const { messages: older, hasMore: more } = await getMessagesPage(conversationId, { before, limit: MESSAGE_PAGE_SIZE });
      const fresh = older.filter((m) => !msgIdsRef.current.has(m.id));
      fresh.forEach((m) => msgIdsRef.current.add(m.id));
      setMessages((prev) => [...fresh, ...prev]);
      setHasMore(more);
      if (fresh.length) {
        const rx = await getReactionsForMessages(fresh.map((r) => r.id));
        setReactions((prev) => [...prev, ...rx.filter((r) => !prev.some((x) => x.id === r.id))]);
      }
    } catch (e) {
      logDevError("eski mesajlar", e);
      setError("Eski mesajlar yüklenemedi.");
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, hasMore, messages]);

  // Arama sonucundan bir mesaja atlamak için: o mesajı içeren yeni bir sayfa yükler
  // (mevcut pencereyi değiştirir, cursor sayfalama mantığıyla aynı sorguyu kullanır).
  const jumpToMessage = useCallback(
    async (targetId, targetCreatedAt) => {
      if (!conversationId || !targetCreatedAt) return;
      setLoading(true);
      setError(null);
      try {
        const before = new Date(new Date(targetCreatedAt).getTime() + 1000).toISOString();
        const { messages: rows, hasMore: more } = await getMessagesPage(conversationId, { before, limit: MESSAGE_PAGE_SIZE });
        msgIdsRef.current = new Set(rows.map((r) => r.id));
        setMessages(rows);
        setHasMore(more);
        const rx = await getReactionsForMessages(rows.map((r) => r.id));
        setReactions(rx);
      } catch (e) {
        logDevError("mesaja atlama", e);
        setError("Mesaja gidilemedi.");
      } finally {
        setLoading(false);
      }
    },
    [conversationId]
  );

  const send = useCallback(
    async (content, opts = {}) => {
      const text = (content || "").trim();
      if ((!text && !opts.metadata) || !conversationId || !userId) return;
      setSending(true);
      setError(null);
      try {
        const row = await apiSend({
          conversationId,
          senderId: userId,
          content: text || opts.content || "",
          replyToId: opts.replyToId || null,
          messageType: opts.messageType || "text",
          metadata: opts.metadata || {},
        });
        upsertMessage(row);
      } catch (e) {
        logDevError("mesaj gönderme", e);
        setError("Mesaj gönderilemedi.");
      } finally {
        setSending(false);
      }
    },
    [conversationId, userId, upsertMessage]
  );

  const edit = useCallback(
    async (messageId, content) => {
      const text = (content || "").trim();
      if (!text) return;
      try {
        const row = await apiEdit({ messageId, content: text });
        upsertMessage(row);
      } catch (e) {
        logDevError("mesaj düzenleme", e);
        setError("Mesaj düzenlenemedi.");
      }
    },
    [upsertMessage]
  );

  const remove = useCallback(
    async (messageId) => {
      try {
        const row = await apiDelete({ messageId });
        upsertMessage(row);
      } catch (e) {
        logDevError("mesaj silme", e);
        setError("Mesaj silinemedi.");
      }
    },
    [upsertMessage]
  );

  const react = useCallback(
    async (messageId, emoji) => {
      try {
        const row = await apiAddReaction({ messageId, userId, emoji });
        setReactions((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]));
      } catch (e) {
        logDevError("reaksiyon ekleme (zaten var olabilir)", e);
      }
    },
    [userId]
  );

  const unreact = useCallback(
    async (messageId, emoji) => {
      setReactions((prev) => prev.filter((x) => !(x.message_id === messageId && x.user_id === userId && x.emoji === emoji)));
      try {
        await apiRemoveReaction({ messageId, userId, emoji });
      } catch (e) {
        logDevError("reaksiyon kaldırma", e);
      }
    },
    [userId]
  );

  return {
    messages,
    reactions,
    loading,
    loadingOlder,
    hasMore,
    error,
    sending,
    send,
    edit,
    remove,
    react,
    unreact,
    loadOlder,
    jumpToMessage,
  };
}

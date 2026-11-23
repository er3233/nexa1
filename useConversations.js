import { useState, useEffect, useCallback, useRef } from "react";
import { getConversations, subscribeToConversationList, unsubscribe } from "../services/chat";

export function useConversations(userId) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);
  const debRef = useRef(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const data = await getConversations(userId);
      setConversations(data);
    } catch (e) {
      if (import.meta.env?.DEV) {
        console.error("[useConversations] Sohbetler yüklenemedi:", {
          message: e?.message, code: e?.code, details: e?.details, hint: e?.hint,
        });
      }
      setError("Sohbetler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    reload();

    const scheduleReload = () => {
      clearTimeout(debRef.current);
      debRef.current = setTimeout(reload, 400);
    };
    channelRef.current = subscribeToConversationList(userId, scheduleReload);

    return () => {
      clearTimeout(debRef.current);
      unsubscribe(channelRef.current);
      channelRef.current = null;
    };
  }, [userId, reload]);

  return { conversations, loading, error, reload };
}

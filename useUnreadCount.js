import { useState, useEffect, useCallback, useRef } from "react";
import { getUnreadCounts, subscribeToConversationList, unsubscribe } from "../services/chat";
import { setAppBadgeCount } from "../lib/badge";

export function useUnreadCount(userId) {
  const [counts, setCounts] = useState({});
  const channelRef = useRef(null);
  const debRef = useRef(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setCounts({});
      await setAppBadgeCount(0);
      return;
    }
    try {
      const map = await getUnreadCounts();
      setCounts(map);
      const total = Object.values(map).reduce((a, b) => a + (b || 0), 0);
      await setAppBadgeCount(total);
    } catch (_) {
      /* noop */
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setCounts({});
      setAppBadgeCount(0);
      return;
    }
    reload();
    const schedule = () => {
      clearTimeout(debRef.current);
      debRef.current = setTimeout(reload, 400);
    };
    channelRef.current = subscribeToConversationList(userId, schedule);
    return () => {
      clearTimeout(debRef.current);
      unsubscribe(channelRef.current);
      channelRef.current = null;
    };
  }, [userId, reload]);

  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  return { counts, total, reload };
}

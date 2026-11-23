import { useState, useEffect, useCallback, useRef } from "react";
import {
  listNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
  subscribeNotifications, unsubscribeNotifications,
} from "../services/notifications";

// enabled=false ise (ör. normal kullanıcı) abonelik/sorgu yapılmaz.
export function useNotifications(userId, enabled = true) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);
  const debRef = useRef(null);

  const reload = useCallback(async () => {
    if (!userId || !enabled) return;
    setError(null);
    try {
      const [list, count] = await Promise.all([listNotifications(), getUnreadNotificationCount()]);
      setItems(list);
      setUnread(count);
    } catch (_) {
      setError("Bildirimler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [userId, enabled]);

  useEffect(() => {
    if (!userId || !enabled) { setLoading(false); return; }
    setLoading(true);
    reload();
    const schedule = () => {
      clearTimeout(debRef.current);
      debRef.current = setTimeout(reload, 300);
    };
    channelRef.current = subscribeNotifications(userId, schedule);
    return () => {
      clearTimeout(debRef.current);
      unsubscribeNotifications(channelRef.current);
      channelRef.current = null;
    };
  }, [userId, enabled, reload]);

  const markRead = useCallback(async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try { await markNotificationRead(id); } catch (_) { reload(); }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
    try { await markAllNotificationsRead(); } catch (_) { reload(); }
  }, [reload]);

  return { items, unread, loading, error, reload, markRead, markAllRead };
}

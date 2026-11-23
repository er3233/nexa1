import { useState, useEffect, useCallback, useRef } from "react";
import {
  listIncomingRequests, listOutgoingRequests, getMessageRequestCount,
  subscribeToMessageRequests, unsubscribeMessageRequests,
} from "../services/messageRequests";

export function useMessageRequests(userId) {
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef(null);
  const debRef = useRef(null);

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      const [inc, out, c] = await Promise.all([
        listIncomingRequests(),
        listOutgoingRequests(),
        getMessageRequestCount(),
      ]);
      setIncoming(inc);
      setOutgoing(out);
      setCount(c);
    } catch (_) {
      /* sessizce geç: rozet 0 kalır */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    reload();

    const schedule = () => {
      clearTimeout(debRef.current);
      debRef.current = setTimeout(reload, 350);
    };
    channelRef.current = subscribeToMessageRequests(userId, schedule);

    return () => {
      clearTimeout(debRef.current);
      unsubscribeMessageRequests(channelRef.current);
      channelRef.current = null;
    };
  }, [userId, reload]);

  return { incoming, outgoing, count, loading, reload };
}

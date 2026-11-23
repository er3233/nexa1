import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { setTyping, clearTyping } from "../services/chat";

const TYPING_TTL = 5000;

export function useTyping(conversationId, userId) {
  const [typingUsers, setTypingUsers] = useState([]);
  const channelRef = useRef(null);
  const seenRef = useRef(new Map()); // userId -> lastTs
  const lastSentRef = useRef(0);
  const pruneRef = useRef(null);

  useEffect(() => {
    setTypingUsers([]);
    seenRef.current = new Map();
    if (!conversationId) return;

    const apply = (row, isDelete) => {
      if (!row || row.user_id === userId) return;
      if (isDelete) seenRef.current.delete(row.user_id);
      else seenRef.current.set(row.user_id, Date.now());
      refresh();
    };
    const refresh = () => {
      const now = Date.now();
      const users = [];
      for (const [uid, ts] of seenRef.current.entries()) {
        if (now - ts <= TYPING_TTL) users.push(uid);
        else seenRef.current.delete(uid);
      }
      setTypingUsers(users);
    };

    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "typing_indicators", filter: `conversation_id=eq.${conversationId}` }, (p) => apply(p.new, false))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "typing_indicators", filter: `conversation_id=eq.${conversationId}` }, (p) => apply(p.new, false))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "typing_indicators", filter: `conversation_id=eq.${conversationId}` }, (p) => apply(p.old, true))
      .subscribe();
    channelRef.current = channel;

    pruneRef.current = setInterval(refresh, 2000);

    return () => {
      clearInterval(pruneRef.current);
      try {
        supabase.removeChannel(channelRef.current);
      } catch (_) {
        /* noop */
      }
      if (userId) clearTyping(conversationId, userId).catch(() => {});
    };
  }, [conversationId, userId]);

  const notifyTyping = useCallback(() => {
    if (!conversationId || !userId) return;
    const now = Date.now();
    if (now - lastSentRef.current < 2500) return; // throttle
    lastSentRef.current = now;
    setTyping(conversationId, userId).catch(() => {});
  }, [conversationId, userId]);

  return { typingUsers, notifyTyping };
}

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { getMemberReadStates } from "../services/chat";

// 1:1 sohbetlerde karşı üyenin last_read_at değerini gerçek zamanlı takip eder.
// Grup sohbetlerinde "herkes okudu" iddiası yapılmaz — yalnızca gönderildi/tek kişi
// okundu ayrımı için kullanılır (statusFor grup için her zaman "delivered" döner).
export function useReadReceipts(conversationId, meId, isGroup = false) {
  const [otherReadAt, setOtherReadAt] = useState(null);
  const chanRef = useRef(null);

  const reload = useCallback(async () => {
    if (!conversationId || isGroup) {
      setOtherReadAt(null);
      return;
    }
    try {
      const rows = await getMemberReadStates(conversationId);
      const other = rows.find((r) => r.user_id !== meId);
      setOtherReadAt(other?.last_read_at || null);
    } catch (_) {
      /* önceki değeri koru */
    }
  }, [conversationId, meId, isGroup]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!conversationId || isGroup) return;
    const token = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`read-state:${conversationId}:${token}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (payload.new?.user_id && payload.new.user_id !== meId) {
            setOtherReadAt(payload.new.last_read_at || null);
          }
        }
      )
      .subscribe();
    chanRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      chanRef.current = null;
    };
  }, [conversationId, meId, isGroup]);

  const statusFor = useCallback(
    (message) => {
      if (!message) return "sent";
      if (isGroup) return "delivered";
      if (otherReadAt && new Date(otherReadAt).getTime() >= new Date(message.created_at).getTime()) return "read";
      return "delivered";
    },
    [otherReadAt, isGroup]
  );

  return { otherReadAt, statusFor };
}

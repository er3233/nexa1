import { supabase } from "../lib/supabase";

const DEV = !!(import.meta?.env?.DEV);

const dlog = (...a) => { if (DEV) console.debug("[live-draft]", ...a); };

export async function upsertLiveDraft(conversationId, text) {
  const { error } = await supabase.rpc("upsert_live_draft", {
    p_conversation_id: conversationId,
    p_draft_text: text ?? "",
  });
  if (error) throw error;
}

export async function clearLiveDraft(conversationId) {
  const { error } = await supabase.rpc("clear_live_draft", { p_conversation_id: conversationId });
  if (error) throw error;
}

export function subscribeLiveDrafts(conversationId, meId, onEvent) {
  const token = Math.random().toString(36).slice(2, 8);
  const channel = supabase
    .channel(`live-drafts:${conversationId}:${token}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "live_drafts", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const row = payload.eventType === "DELETE" ? payload.old : payload.new;
        if (!row || row.sender_id === meId) return;
        dlog(payload.eventType, { sender: row.sender_id, conv: row.conversation_id });
        onEvent?.(payload.eventType, row);
      }
    )
    .subscribe((status, err) => {
      dlog("subscribe", status, err?.message || "");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn(`[live-draft] Realtime bağlantısı: ${status}${err?.message ? " — " + err.message : ""}`);
      }
    });
  return channel;
}

export function unsubscribeLiveDrafts(channel) {
  if (channel) supabase.removeChannel(channel);
}

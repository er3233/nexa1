import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { upsertLiveDraft, clearLiveDraft, subscribeLiveDrafts, unsubscribeLiveDrafts } from "../services/liveDrafts";

const THROTTLE_MS = 150;
const STALE_MS = 5000;

// Canlı yazım: geçici live_drafts tablosu + Postgres Realtime (Broadcast YOK).
export function useLiveTyping(conversationId, meId) {
  const [status, setStatus] = useState({ eligible: false, me_enabled: false, other_enabled: false, active: false });
  const [loading, setLoading] = useState(true);
  const [remoteDraft, setRemoteDraft] = useState("");
  const [error, setError] = useState(null);

  const chanRef = useRef(null);
  const throttleRef = useRef(null);
  const pendingRef = useRef("");
  const dirtyRef = useRef(false);
  const staleRef = useRef(null);
  const lastRemoteAtRef = useRef(0);

  const reloadStatus = useCallback(async () => {
    if (!conversationId) return;
    try {
      const { data, error: rpcErr } = await supabase.rpc("get_live_typing_status", { p_conversation_id: conversationId });
      if (rpcErr) throw rpcErr;
      if (data) setStatus(data);
      setError(null);
    } catch (e) {
      const msg = e?.message || "";
      if (/ambiguous|column reference/i.test(msg)) {
        setError("Canlı yazım SQL hatası. Supabase'te 015 migration'ını çalıştırın.");
      } else {
        setError("Canlı yazım durumu alınamadı.");
      }
      console.warn("[live-draft] status error:", e?.message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { setLoading(true); reloadStatus(); }, [reloadStatus]);

  // Üyelik değişince status yenile.
  useEffect(() => {
    if (!conversationId) return;
    const token = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`lt-status:${conversationId}:${token}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `conversation_id=eq.${conversationId}` }, () => reloadStatus())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, reloadStatus]);

  const applyRemote = useCallback((eventType, row) => {
    if (!row || row.sender_id === meId) return;
    const ts = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
    if (ts < lastRemoteAtRef.current && eventType !== "DELETE") return;
    lastRemoteAtRef.current = ts;
    clearTimeout(staleRef.current);
    if (eventType === "DELETE" || !row.text?.trim()) {
      setRemoteDraft("");
      return;
    }
    setRemoteDraft(row.text);
    staleRef.current = setTimeout(() => setRemoteDraft(""), STALE_MS);
  }, [meId]);

  // Postgres Realtime: yalnızca active iken dinle.
  useEffect(() => {
    setRemoteDraft("");
    lastRemoteAtRef.current = 0;
    if (!conversationId || !status.active) {
      if (chanRef.current) { unsubscribeLiveDrafts(chanRef.current); chanRef.current = null; }
      return;
    }
    chanRef.current = subscribeLiveDrafts(conversationId, meId, applyRemote);
    return () => {
      clearTimeout(staleRef.current);
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
      dirtyRef.current = false;
      pendingRef.current = "";
      unsubscribeLiveDrafts(chanRef.current);
      chanRef.current = null;
      clearLiveDraft(conversationId).catch(() => {});
      setRemoteDraft("");
    };
  }, [conversationId, status.active, meId, applyRemote]);

  const flush = useCallback(async () => {
    if (!dirtyRef.current || !status.active) return;
    dirtyRef.current = false;
    const text = pendingRef.current ?? "";
    try {
      await upsertLiveDraft(conversationId, text);
      setError(null);
    } catch (e) {
      setError("Canlı taslak gönderilemedi. İki tarafın da canlı yazımı açtığından emin olun.");
      console.warn("[live-draft] upsert error:", e?.message);
    }
  }, [conversationId, status.active]);

  const sendDraft = useCallback((text) => {
    if (!status.active) return;
    pendingRef.current = text || "";
    dirtyRef.current = true;
    if (throttleRef.current) return;
    flush();
    throttleRef.current = setTimeout(() => { throttleRef.current = null; flush(); }, THROTTLE_MS);
  }, [status.active, flush]);

  const clearDraft = useCallback(async () => {
    clearTimeout(throttleRef.current);
    throttleRef.current = null;
    pendingRef.current = "";
    dirtyRef.current = false;
    try {
      await clearLiveDraft(conversationId);
    } catch (e) {
      setError("Canlı taslak temizlenemedi.");
      console.warn("[live-draft] clear error:", e?.message);
    }
  }, [conversationId]);

  const setEnabled = useCallback(async (enabled) => {
    const { error: rpcErr } = await supabase.rpc("set_live_typing_enabled", { p_conversation_id: conversationId, p_enabled: enabled });
    if (rpcErr) throw rpcErr;
    if (!enabled) await clearLiveDraft(conversationId).catch(() => {});
    setRemoteDraft("");
    await reloadStatus();
  }, [conversationId, reloadStatus]);

  return { status, loading, remoteDraft, error, sendDraft, clearDraft, setEnabled, reloadStatus };
}

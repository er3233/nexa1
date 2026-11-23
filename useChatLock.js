import { useState, useEffect, useCallback, useRef } from "react";
import {
  getLockStatus, setPin as apiSetPin, verifyPin as apiVerifyPin, lockNow as apiLockNow,
  removePin as apiRemovePin, forgotPinReauthAndRemove,
} from "../services/chatLocks";

const IDLE_MS = 10 * 60 * 1000;

export function useChatLock(conversationId) {
  const [status, setStatus] = useState({ has_pin: false, requires_pin: false, locked: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const idleRef = useRef(null);

  const reload = useCallback(async () => {
    if (!conversationId) return null;
    setError(null);
    try {
      const s = await getLockStatus(conversationId);
      setStatus(s);
      return s;
    } catch (e) {
      const msg = e?.message || "Kilit durumu alınamadı.";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    reload().catch(() => { /* error state set */ });
  }, [reload]);

  const relock = useCallback(async () => {
    if (!conversationId || !status.has_pin) return;
    try {
      await apiLockNow(conversationId);
      await reload();
    } catch (e) {
      setError(e?.message || "Sohbet kilitlenemedi.");
      throw e;
    }
  }, [conversationId, status.has_pin, reload]);

  const touch = useCallback(() => {
    if (!status.has_pin) return;
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => { relock().catch(() => {}); }, IDLE_MS);
  }, [status.has_pin, relock]);

  useEffect(() => {
    if (!status.has_pin) { clearTimeout(idleRef.current); return; }
    touch();
    const onHidden = () => { if (document.visibilityState === "hidden") relock().catch(() => {}); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", () => relock().catch(() => {}));
    return () => {
      clearTimeout(idleRef.current);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [status.has_pin, touch, relock]);

  const verify = useCallback(async (pin) => {
    const res = await apiVerifyPin(conversationId, pin);
    await reload();
    return res;
  }, [conversationId, reload]);

  const createPin = useCallback(async (pin) => {
    const rpcRes = await apiSetPin(conversationId, pin);
    const s = await reload();
    if (!s?.has_pin) {
      throw new Error("PIN kaydedildi ancak kilit satırı doğrulanamadı. Sayfayı yenileyip tekrar deneyin.");
    }
    return { ...rpcRes, status: s };
  }, [conversationId, reload]);

  const changePin = useCallback(async (oldPin, newPin) => {
    const res = await apiVerifyPin(conversationId, oldPin);
    if (!res?.success) return res;
    await apiSetPin(conversationId, newPin);
    await reload();
    return { success: true };
  }, [conversationId, reload]);

  const removePin = useCallback(async (pin) => {
    const res = await apiRemovePin(conversationId, pin);
    await reload();
    return res;
  }, [conversationId, reload]);

  const lockNow = useCallback(async () => {
    const res = await apiLockNow(conversationId);
    const s = await reload();
    if (!s?.requires_pin) {
      throw new Error("Sohbet kilitlenemedi. PIN durumu doğrulanamadı.");
    }
    return { ...res, status: s };
  }, [conversationId, reload]);

  const forgotRemove = useCallback(async (email, password) => {
    await forgotPinReauthAndRemove(conversationId, email, password);
    await reload();
  }, [conversationId, reload]);

  return { status, loading, error, reload, touch, verify, createPin, changePin, removePin, lockNow, forgotRemove };
}

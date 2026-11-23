import { useEffect } from "react";
import { setPresence } from "../services/profiles";

// Kullanıcı çevrimiçi durumunu periyodik olarak günceller.
export function usePresence(userId, { intervalMs = 45000 } = {}) {
  useEffect(() => {
    if (!userId) return;
    let stopped = false;

    const beat = (online) => {
      if (stopped) return;
      setPresence(userId, online).catch(() => {});
    };

    beat(true);
    const id = setInterval(() => beat(true), intervalMs);

    const onVisibility = () => beat(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);

    const onBeforeUnload = () => {
      // En iyi çaba; her tarayıcıda garanti değil.
      setPresence(userId, false).catch(() => {});
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      setPresence(userId, false).catch(() => {});
    };
  }, [userId, intervalMs]);
}

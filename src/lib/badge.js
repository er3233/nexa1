/** App icon badge helpers (Badging API + service worker fallback). */

export function supportsAppBadge() {
  return typeof navigator !== "undefined" && typeof navigator.setAppBadge === "function";
}

export async function setAppBadgeCount(count) {
  const n = Math.max(0, Number(count) || 0);
  try {
    if (n > 0) {
      if (supportsAppBadge()) await navigator.setAppBadge(n);
    } else if (typeof navigator.clearAppBadge === "function") {
      await navigator.clearAppBadge();
    } else if (supportsAppBadge()) {
      await navigator.setAppBadge(0);
    }
  } catch (_) { /* destek yok / izin yok */ }

  // SW tarafında da dene (iOS/Android PWA bazı durumlarda SW üzerinden daha tutarlı)
  try {
    const reg = await navigator.serviceWorker?.ready;
    reg?.active?.postMessage({ type: n > 0 ? "SET_BADGE" : "CLEAR_BADGE", count: n });
  } catch (_) { /* SW yok */ }
}

export async function clearAppBadgeCount() {
  return setAppBadgeCount(0);
}

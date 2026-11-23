import { supabase } from "./supabase";

const SW_URL = "/sw.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerNexaServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    return reg;
  } catch (_) {
    return null;
  }
}

export function isPushConfigured() {
  return Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY);
}

/** Kullanıcı onaylıysa ve VAPID varsa Web Push aboneliği oluşturup Supabase'e kaydeder. */
export async function ensurePushSubscription(userId) {
  if (!userId || !isPushConfigured()) return null;
  if (!("Notification" in window) || !("PushManager" in window)) return null;
  if (!window.isSecureContext) return null;

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh || null,
      auth: json.keys?.auth || null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return sub;
}

export async function removePushSubscription() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).catch(() => {});
    }
  } catch (_) { /* noop */ }
}

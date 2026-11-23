/* Nexa Chat service worker — badge + Web Push */
/* global self, clients */

const SW_VERSION = "nexa-sw-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function setBadge(count) {
  const n = Math.max(0, Number(count) || 0);
  try {
    if (n > 0 && self.navigator?.setAppBadge) await self.navigator.setAppBadge(n);
    else if (self.navigator?.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (_) { /* Badging API yok / reddedildi */ }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SET_BADGE") {
    event.waitUntil(setBadge(data.count));
  } else if (data.type === "CLEAR_BADGE") {
    event.waitUntil(setBadge(0));
  } else if (data.type === "PING") {
    event.source?.postMessage?.({ type: "PONG", version: SW_VERSION });
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: "Nexa", body: event.data?.text?.() || "Yeni mesaj" };
  }

  const title = payload.title || "Nexa";
  const body = payload.body || "Yeni mesajınız var";
  const unread = payload.unread != null ? Number(payload.unread) : null;
  const url = payload.url || "/";
  const tag = payload.tag || "nexa-message";

  event.waitUntil((async () => {
    if (unread != null) await setBadge(unread);
    else if (self.navigator?.setAppBadge) {
      try {
        // Okunmamış bilinmiyorsa en azından 1 göster
        await self.navigator.setAppBadge(1);
      } catch (_) {}
    }

    await self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag,
      renotify: true,
      data: { url, unread },
      vibrate: [80, 40, 80],
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        await client.focus();
        client.postMessage?.({ type: "NOTIFICATION_CLICK", url });
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});

// Push-only service worker for Fenjan. No fetch handler and no caching,
// so it can never serve stale app code — it only receives push notifications.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "فنجان";
  const body = d.body || "";
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    dir: "rtl", lang: "ar", tag: "fenjan-ann", renotify: true
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.includes("/Fenjan/") && "focus" in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  }));
});

// Fenjan service worker: network-first (always fetches latest when online, so the
// installed app icon auto-updates) + push notifications.
const V = "v32";
const CACHE = "fenjan-" + V;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

// Network-first for same-origin GETs: always try the network so updates come down
// immediately; fall back to cache only when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase / CDN alone
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: "no-store" });
      if (fresh && fresh.ok) { const c = await caches.open(CACHE); c.put(req, fresh.clone()); }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") { const idx = await caches.match("./"); if (idx) return idx; }
      throw err;
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "فنجان";
  const body = d.body || "";
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    dir: "rtl", lang: "ar", tag: "fenjan-ann", renotify: true,
    silent: false, vibrate: [200, 100, 200, 100, 200], requireInteraction: true
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.includes("/Fenjan/") && "focus" in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow("./");
  }));
});

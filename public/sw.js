// Unshaken service worker: instant loads and offline reading.
// App shell: cache first, refreshed in the background. Listings: network first, cached copy offline.
// API calls are never cached.
const VERSION = "unshaken-v6";
const SHELL = ["/", "/index.html", "/app.js", "/i18n.js", "/share.js", "/app.css", "/ds/ds.css", "/ds/cmdk.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  if (url.pathname.startsWith("/data/")) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: url.pathname === "/" }).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; }).catch(() => hit || caches.match("/index.html"));
    return hit || net;
  }));
});

// Deadline alerts
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || "Unshaken", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag, data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => { for (const w of ws) { if ("focus" in w) { w.navigate(url); return w.focus(); } } return clients.openWindow(url); }));
});

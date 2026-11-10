/* Fielora service worker.
   Keeps the app itself (page, script, map library, icons) on the device so it opens
   instantly from the home screen. Customer and job data is never stored here: every
   /api request goes straight to the server. */
const VERSION = "fielora-v6";
const SHELL = ["/", "/app.js", "/manifest.webmanifest", "/vendor/leaflet/leaflet.js", "/vendor/leaflet/leaflet.css",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/favicon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;           // map tiles, posts: untouched
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;   // live data only, never cached

  const isShell = req.mode === "navigate" || url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/manifest.webmanifest";
  if (isShell) {
    // Network first so updates show up right away; fall back to the saved copy when offline.
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req.mode === "navigate" ? "/" : req, copy)); }
        return res;
      }).catch(() => caches.match(req.mode === "navigate" ? "/" : req).then(r => r || caches.match("/")))
    );
    return;
  }
  // Icons and the map library rarely change: use the saved copy, refresh it in the background.
  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; }).catch(() => cached);
      return cached || fresh;
    })
  );
});

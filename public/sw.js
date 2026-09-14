/* sw.js — TrustLine service worker.
 *
 * Strategy is network-first everywhere. TrustLine's pages change whenever the
 * repo changes, so the only healthy behaviour is to take what the server offers
 * and keep a copy only as an offline fallback. A cached-at-build snapshot would
 * be a second, stale version of the site.
 *
 * The API is deliberately not cached at all: a trace response is a credential,
 * and "reports 12" cached for a week is a lie on a screen that advertises a
 * running count.
 */

const CACHE = "trustline-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ops")) {
    // Sensitive or staff: never touch the cache.
    return event.respondWith(fetch(request));
  }
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const copy = fresh.clone();
        const cache = await caches.open(CACHE);
        await cache.put(url.origin + "/", copy);
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        const fallback = await cache.match(url.origin + "/");
        if (fallback) return fallback;
        throw new Error("offline and nothing cached yet");
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      await cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const hit = await cache.match(request);
      if (hit) return hit;
      throw new Error("offline: " + request.url);
    }
  })());
});
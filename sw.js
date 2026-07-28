// Shelfie service worker.
//
// The app shell is cached so the app opens instantly — airplane mode
// included; the library itself already lives in localStorage. Same-origin
// requests use stale-while-revalidate: the cached copy is served
// immediately and refreshed in the background, so a new deploy lands on
// the next launch without any manual version bumps. Book covers are cached
// best-effort so shelves look right offline; API calls (Open Library,
// Google Books, Firebase) always go to the network.

const SHELL_CACHE = "shelfie-shell-v6";
const COVER_CACHE = "shelfie-covers-v1";

const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./css/custom.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/api.js",
  "./js/db.js",
  "./js/sync.js",
  "./js/filters.js",
  "./js/themes.js",
  "./js/export.js",
  "./js/scanner.js",
  "./js/community.js",
  "./js/social.js",
  "./js/icons.js",
  "./js/assets.js",
  "./js/firebase-config.js",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL_CACHE && key !== COVER_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
  } else if (/covers\.openlibrary\.org|books\.google/.test(url.hostname)) {
    event.respondWith(coverCacheFirst(event.request));
  }
  // Everything else (JSON APIs, Firestore, the Firebase SDK) → network.
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  // All navigations resolve to the one app shell, whatever the query
  // string (e.g. the "Scan a book" home-screen shortcut).
  const key = request.mode === "navigate" ? "./index.html" : request;
  const cached = await cache.match(key);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached ?? refresh;
}

async function coverCacheFirst(request) {
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    // Opaque responses (cross-origin <img>) are cacheable too.
    if (res.ok || res.type === "opaque") cache.put(request, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

// Caches the app shell (HTML/CSS/JS/icons) so the app opens instantly and
// looks right even on a flaky connection. Deliberately does NOT cache
// anything under /api/ — your financial data should always come fresh
// from the server, never from a cache.
//
// Bump CACHE_NAME whenever you change frontend files so old caches get
// cleared out. Uses network-first: always tries to fetch the latest file,
// and only falls back to the cached copy if the network request fails
// (e.g. offline). This means you always see your latest changes and the
// cache is purely a fallback, not a way updates can get "stuck".
const CACHE_NAME = "ledger-shell-v2";
const SHELL_FILES = [
  "/",
  "/static/style.css",
  "/static/app.js",
  "/static/manifest.json",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always go to the network.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

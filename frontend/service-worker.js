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

// ---------------------------------------------------------------------------
// push notifications — the backend sends {title, body} as JSON payload
// (see push.py::send_notification). This fires even if the app tab is
// closed, as long as the browser/OS allows background service workers.
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let title = "Ledger";
  let body = "You have a payment update.";
  try {
    const data = event.data.json();
    title = data.title || title;
    body = data.body || body;
  } catch {
    if (event.data) body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/static/icons/icon-192.png",
      badge: "/static/icons/icon-192.png",
      tag: "ledger-due-date",  // replaces any previous unread one instead of stacking
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

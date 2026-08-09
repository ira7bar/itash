const CACHE_NAME = "tashbetz-shell-v26";
const SHELL_FILES = [
  ".",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "src/main.js",
  "src/model.js",
  "src/render.js",
  "src/interaction.js",
  "src/storage.js",
  "src/share.js",
  "src/sync.js",
  "src/firebase-config.js",
  "src/hebrew.js",
  "src/presence.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "fonts/assistant-hebrew.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Puzzle filenames carry the week's date (puzzle_YYYY-MM-DD.json/.png), so
  // match by pattern rather than a fixed name.
  if (/^puzzle.*\.(json|png)$/.test(url.pathname.split("/").pop())) {
    // network-first: always try to get this week's latest puzzle (data + rendered
    // page image), fall back to cache if offline
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // app shell: cache-first, so the app opens instantly and works fully offline
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

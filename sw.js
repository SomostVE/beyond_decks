const APP_VERSION = new URL(self.location.href).searchParams.get("v") || "00.00.000";
const CACHE_PREFIX = "svwb-app-";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const CODEX_API_PATH = "/beyond_codex/api/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Beyond Codex changes independently from the Beyond Decks application version.
  // Never cache its same-origin GitHub Pages API in the app service-worker cache,
  // otherwise a newly released card set could remain hidden until the next app bump.
  if (url.origin === self.location.origin && url.pathname.startsWith(CODEX_API_PATH)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  const alwaysFresh = request.mode === "navigate" || url.pathname.endsWith("/version.json");
  event.respondWith(alwaysFresh ? networkFirst(request, url) : cacheFirst(request));
});

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && !url.pathname.endsWith("/version.json")) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request, { cache: "no-store" });
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

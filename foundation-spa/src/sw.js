/* eslint-disable no-restricted-globals */
/*
 * Rock Solid Ops — service worker (PWA Phase C.1)
 *
 * Hand-written fetch logic (NOT ported from the Nexus reference, whose SW
 * network-first-caches ALL Supabase REST responses — that would cache the
 * RLS-gated/mutable tables this project explicitly forbids caching). The
 * caching boundaries below are exactly the ones approved in the prior brief;
 * nothing is added to either list without sign-off (see docs/migration-log.md).
 *
 * Built with vite-plugin-pwa `injectManifest`: `self.__WB_MANIFEST` is the
 * content-hashed app-shell file list injected at build time. We precache it
 * with the plain Cache API rather than workbox so every strategy is explicit
 * and auditable in one file.
 */

const SW_VERSION = 'rso-pwa-v1';
const SHELL_CACHE = `${SW_VERSION}-shell`;
const CONFIG_CACHE = `${SW_VERSION}-config`;

// Injected by vite-plugin-pwa at build time (array of { url, revision }).
const PRECACHE_MANIFEST = self.__WB_MANIFEST || [];
const PRECACHE_URLS = PRECACHE_MANIFEST.map((entry) =>
  typeof entry === 'string' ? entry : entry.url
);

// ── Approved caching boundaries ───────────────────────────────────────────────
// CACHE-FIRST config/reference tables (static-ish, non-sensitive). The app
// shell (JS/CSS/HTML/icons) is precached separately from PRECACHE_URLS; the
// help-guide content is part of the shell bundle, so it is covered there.
const CONFIG_TABLES = new Set([
  'class_options',
  'milestone_definitions',
  'batches',
]);

// NEVER-CACHE: RLS-gated or mutable data. These bypass the SW entirely — never
// read from cache, never written to cache. Default behaviour for any table NOT
// in CONFIG_TABLES is also network-only, so this list is a belt-and-braces
// guard (and documents intent) rather than the sole protection.
const NEVER_CACHE_TABLES = new Set([
  'applicants',        // registration records + status live here
  'profiles',
  'attendance_records',
  'attendance_log',
  'audit_logs',
  'audit_log',
  'email_queue',
  'attention_flags',
]);

function isSupabaseRest(url) {
  return url.hostname.includes('supabase') && url.pathname.includes('/rest/v1/');
}

// Extract the table name immediately after /rest/v1/ (rpc calls yield "rpc").
function restTableOf(url) {
  const m = url.pathname.match(/\/rest\/v1\/([^/?]+)/);
  return m ? m[1] : null;
}

// ── Install: precache the app shell ───────────────────────────────────────────
// Cache each entry independently (NOT cache.addAll, which is atomic — one 404
// would discard the whole precache). A missing asset is logged and skipped.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[sw] precache miss', url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// ── Activate: drop caches from older SW versions ──────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(SW_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route by the approved boundaries ──────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is ever cacheable; everything else goes straight to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // Supabase auth + realtime must never be intercepted (token replay hazard).
  if (url.pathname.includes('/auth/v1/') || url.pathname.includes('/realtime/v1/')) {
    return;
  }

  // Supabase REST data.
  if (isSupabaseRest(url)) {
    const table = restTableOf(url);
    if (table && CONFIG_TABLES.has(table)) {
      event.respondWith(cacheFirst(request, CONFIG_CACHE));
    }
    // NEVER_CACHE tables + every other table (default): do not intercept —
    // let the request hit the network directly with no cache involvement.
    return;
  }

  // App navigations: serve the network, fall back to the precached shell
  // (index.html) when offline so the SPA still boots.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html', { ignoreSearch: true }).then(
          (cached) => cached || caches.match('/')
        )
      )
    );
    return;
  }

  // Same-origin static assets (content-hashed by Vite): cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
  // Cross-origin non-Supabase (e.g. Google Fonts) is intentionally left to the
  // browser: fonts were NOT part of the approved cache-first set. Revisit only
  // with sign-off.
});

// Cache-first: return cache if present, otherwise fetch + populate. On a cache
// miss while offline the promise rejects, which the caller surfaces normally.
function cacheFirst(request, cacheName) {
  return caches.match(request).then((cached) => {
    if (cached) {
      // Refresh in the background so config data does not go stale forever.
      revalidate(request, cacheName);
      return cached;
    }
    return fetch(request).then((response) => {
      if (response && response.status === 200 && response.type !== 'opaque') {
        const copy = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

// Fire-and-forget revalidation for cache-first entries.
function revalidate(request, cacheName) {
  fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type !== 'opaque') {
        const copy = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, copy));
      }
    })
    .catch(() => {
      /* offline: keep the cached copy */
    });
}

// ── Push (wired in Phase C.2; handler present so the shell is push-ready) ─────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Rock Solid Ops', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Rock Solid Ops';
  const options = {
    body: payload.body || payload.message || '',
    icon: '/pwa-icon.svg',
    badge: '/pwa-icon.svg',
    tag: payload.type || 'rso-notification',
    data: { url: payload.url || '/', type: payload.type },
    requireInteraction: !!payload.requireInteraction,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

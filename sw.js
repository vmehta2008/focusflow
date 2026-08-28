/* FocusFlow — service worker
   =============================================================
   The app is one big HTML file with everything inlined, so the
   cache is tiny: the page itself, and nothing else.

   Strategy: cache-first for the app shell, network-in-background
   to pick up new versions. That means:
     • opens instantly, even with no signal
     • a new upload is picked up on the next visit
     • the user is told a new version exists rather than being
       silently swapped mid-session
   =============================================================
   IMPORTANT: bump CACHE_VERSION whenever you upload a new
   index.html, otherwise people keep seeing the old one.        */

const CACHE_VERSION = 'focusflow-v2';
const APP_SHELL = ['./', './index.html'];

/* Install — pre-cache the shell */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(APP_SHELL))
      .catch(() => {})          // a failed pre-cache must not block install
      .then(() => self.skipWaiting())
  );
});

/* Activate — bin every older cache */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Fetch */
self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;                       // never cache writes

  const url = new URL(req.url);

  /* Anything that must be live is left alone entirely:
     Firebase sync, the AI providers, Tesseract, Telegram.
     Caching these would produce stale data or broken auth. */
  const LIVE_ONLY = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'generativelanguage.googleapis.com',
    'api.openai.com',
    'api.anthropic.com',
    'cdn.jsdelivr.net',
    'www.googletagmanager.com',
    'google-analytics.com'
  ];
  if (LIVE_ONLY.some(h => url.hostname.includes(h))) return;

  /* Navigations: try network first so a fresh upload is seen quickly,
     fall back to cache when offline. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* Everything else same-origin: cache first, refresh in background */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(hit => {
        const network = fetch(req)
          .then(res => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
  }
});

/* Let the page ask us to activate a waiting update immediately */
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

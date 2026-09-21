/**
 * Offline start-up for CHECKPOINT.
 *
 * The tap queue already keeps a conductor working when the signal drops, but
 * only while the app is open. Reload with no signal and there was nothing to
 * reload — a blank browser error, on a moving bus, at the moment the screen was
 * needed. This worker keeps the application itself on the phone so it always
 * opens, and the app then shows the last trip it knew about.
 *
 * What it caches, and deliberately nothing else:
 *   - the page and its hashed build files, so the app starts;
 *   - the web fonts, so it looks the same doing so.
 *
 * It never caches /api. Trip data is live or it is labelled as a snapshot by
 * the app itself; a worker quietly answering API calls from cache would put
 * old times on a passenger board with nothing saying so.
 */

const SHELL = 'checkpoint-shell-v2';
const FONTS = 'checkpoint-fonts-v1';
const INDEX = '/index.html';

/**
 * The server sends `Vary: Origin` (its CORS layer), and the browser loads the
 * bundle as a module script, which carries an Origin header the stored copy
 * was not fetched with. Matching strictly then misses every time — found by
 * reloading with the server stopped and getting a blank page. These files are
 * named by their content, so any stored copy is the right one.
 */
const MATCH = { ignoreVary: true };

/** The hashed files a given index.html loads. */
const assetsIn = (html) =>
  [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

/**
 * Keep exactly the shell of the index just fetched. Build files are named by
 * their content, so the previous deploy's files are dead weight once a new
 * index stops pointing at them.
 */
async function storeShell(response) {
  const cache = await caches.open(SHELL);
  const html = await response.clone().text();
  const wanted = new Set([INDEX, ...assetsIn(html)]);

  await cache.put(INDEX, response.clone());
  await Promise.all(
    [...wanted]
      .filter((url) => url !== INDEX)
      .map(async (url) => {
        if (!(await cache.match(url, MATCH))) {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
        }
      })
  );

  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (!wanted.has(path)) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    fetch(INDEX, { cache: 'no-store' })
      .then((res) => (res.ok ? storeShell(res) : undefined))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Fonts: they never change under the same URL, so the cache answers first.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const hit = await cache.match(request, MATCH);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  // Live data and the health check always go to the network.
  if (url.pathname.startsWith('/api') || url.pathname === '/health') return;

  // Opening any page: the network when there is one, so a deploy is picked up
  // at once; the stored shell when there is not, so the app still opens.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) event.waitUntil(storeShell(res.clone()).catch(() => undefined));
          return res;
        })
        .catch(async () => (await caches.match(INDEX, MATCH)) ?? Response.error())
    );
    return;
  }

  // Build files are named by content, so a stored one is always correct.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request, MATCH).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then((cache) => cache.put(request, copy));
            }
            return res;
          })
      )
    );
  }
});

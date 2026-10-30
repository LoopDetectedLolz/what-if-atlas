/* What-If Atlas service worker. Scope is the app's subpath, so it touches
   nothing else on networkfieldnotes.com — the blog has its own /sw.js for the
   field kit, and the more specific scope wins for pages under it.

   MILESTONE 0: runtime caching only. A hand-rolled worker cannot know Vite's
   content-hashed filenames at build time, so instead of precaching a manifest
   it caches same-origin assets as they are requested. That gives offline on a
   second visit, which is all milestone 0 claims.

   Milestone 7 replaces this with the real two-tier design:
     - a z0-z5 world PMTiles archive stored as a Blob in IndexedDB and read
       through a custom pmtiles Source
     - higher zooms streamed over the network
   It does NOT use the Cache API for tiles, because Cache.put() rejects 206
   partial responses by spec and PMTiles works entirely by Range request.
   See PLAN.md section 3. */

var VERSION = 'atlas-v0';
var SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', function (e) {
  // The shell only. Hashed assets arrive via the fetch handler below.
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return c.addAll([SCOPE, SCOPE + 'fonts.css']);
    }).then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('atlas-') === 0 && k !== VERSION;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;         // DEM tiles etc: leave alone
  if (url.pathname.indexOf(SCOPE) !== 0) return;      // not ours

  // A Range request can only ever be answered from the network: the Cache API
  // refuses to store the 206 that comes back. Don't even try.
  if (req.headers.has('range')) return;

  // Navigations: network first so a deploy is picked up, cache as fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return r;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match(SCOPE);
        });
      })
    );
    return;
  }

  // Everything else under scope: cache first. Vite's filenames are
  // content-hashed, so a cached hit can never be stale.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && r.status === 200 && r.type === 'basic') {
          var copy = r.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return r;
      });
    })
  );
});

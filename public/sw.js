/* What-If Atlas service worker. Scope is the app's subpath, so it touches
   nothing else on networkfieldnotes.com — the blog has its own /sw.js for the
   field kit, and the more specific scope wins for pages under it.

   MILESTONE 0: runtime caching only. A hand-rolled worker cannot know Vite's
   content-hashed filenames at build time, so instead of precaching a manifest
   it caches same-origin responses as they are requested.

   ⚠️ THAT DOES NOT YET ADD UP TO OFFLINE, AND AN EARLIER VERSION OF THIS
   COMMENT CLAIMED IT DID ("offline on a second visit"). It does not, and the
   cache contents after a first visit say so plainly: the shell and fonts.css,
   and no `assets/` at all. src/main.ts registers this worker from the window
   `load` event, which does not fire until every subresource of the first visit
   has already been fetched — so on visit 1 there is nothing left for the fetch
   handler to intercept. Visit 2 is the first one this worker sees end to end,
   which makes visit 3 the first that could work offline; and WebKit's
   seven-day eviction returns an idle iPad to visit 1 repeatedly. Offline on
   visit 2 needs the shell's hashed asset urls precached at install, by reading
   them out of the shell HTML. Not done here. PLAN.md section 3 and 15.

   ── Why the default is stale-while-revalidate ───────────────────────────────

   ⚠️ CACHE-FIRST IS FOR CONTENT-HASHED NAMES AND NOTHING ELSE. The first
   version of this file cached every same-origin response under scope
   cache-first, for ever, on the reasoning that "Vite's filenames are
   content-hashed, so a cached hit can never be stale". That holds for
   `assets/*`. It is false for `data/labels.json`, `data/neighbours.json`,
   `fonts.css`, `fonts/*.woff2`, `icons/*.png` and `manifest.webmanifest`,
   every one of which keeps its name across builds. A returning visitor was
   therefore pinned to whichever copy they happened to download first — with no
   way out but clearing site data. A corrected adjacency table, a new label, an
   extra font subset: none of it would ever have reached them.

   Note what that would have cost. `data/neighbours.json` is what the fill tool
   floods across and what decides which borders may fade; a child with a stale
   copy gets a fill that stops at the wrong coastline and no way to tell why.

   So, three classes of file and three strategies:

     assets/   cache-first. A content hash in the name means a hit cannot be
               stale, and a new build asks for a new name.
     tiles/    never stored here. PMTiles reads archives by Range request and
               Cache.put() rejects the 206 that comes back, so these escaped
               the old cache-first rule by accident; make it deliberate, and
               leave whole-archive offline to IndexedDB (PLAN.md section 3).
     anything  stale-while-revalidate. Answer from the cache immediately, then
     else      refresh in the background IF the stored copy has outlived the
               max-age the server itself gave it. Offline still works, the app
               still starts instantly, and nothing stays wrong for ever.

   The default matters more than the two exceptions: a file added to public/
   later inherits stale-while-revalidate, which is wrong by at most one load.
   The old default was wrong until the user wiped the site.

   Navigations stay network-first, so a deploy is picked up on the next load. */

/* ⚠️ BUMP ON ANY CHANGE TO THIS FILE'S STRATEGY. activate() deletes every
   other `atlas-` cache, which is the only way to reach a client already
   holding a frozen copy from an earlier worker. It is also the escape hatch if
   a future build ever needs the data files and the code to move together: a
   bump purges both, so nothing survives one load out of step. */
var VERSION = 'atlas-v1';
var SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', function (e) {
  /* The shell only. Everything else arrives via the fetch handler below.

     ⚠️ NOT Cache.addAll(), which writes straight past store() and so leaves
     these two entries with no stamp — and an unstamped entry is stale by
     definition, so the shell and fonts.css would have revalidated on every
     single load, for ever, while the files they sit beside behaved.

     ⚠️ AND NOTHING CATCHES. Letting install reject is the whole point of
     install: the browser throws the half-built worker away and the previous
     one keeps serving its intact cache until a later attempt succeeds. The
     earlier version ended `.catch(function () { return self.skipWaiting(); })`,
     which did the opposite — a precache that failed because the wifi dropped
     mid-install still promoted the worker, and activate() below then deleted
     the fully populated cache it was replacing. One flaky moment during a
     deploy and the shell fallback at the bottom of this file was dead for the
     life of that VERSION, because `SCOPE` is written here and nowhere else. */
  e.waitUntil(
    Promise.all([SCOPE, SCOPE + 'fonts.css'].map(function (p) {
      return fetchFresh(p).then(function (r) { return store(new Request(p), r); });
    })).then(function () { return self.skipWaiting(); })
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

/* When we stored a copy, by this device's clock. Set on the way into the cache
   by store(), read on the way out by isFresh(). */
var STAMP = 'x-atlas-stored';

/**
 * Has the stored copy outlived the freshness the SERVER gave it?
 *
 * The budget is the origin's own `max-age`, not a number invented here, so one
 * rule covers files on very different footings: Pages sends max-age=600 for the
 * JSON and max-age=14400 for fonts.css, and each is then revalidated at its own
 * pace rather than both on every load. No max-age means revalidate; unknown
 * freshness is stale freshness.
 *
 * ⚠️ THE AGE COMES FROM OUR OWN STAMP, NOT FROM THE RESPONSE'S `Date`, for two
 * separate reasons and either would be enough:
 *
 *   - A conditional refresh that comes back 304 is answered out of the HTTP
 *     cache. Whether the stored `Date` is then updated from the 304 is up to
 *     the engine, and if it is not, the copy is permanently past its max-age:
 *     every single load would fire a revalidation that can never settle it.
 *     Measuring with our own stamp converges by construction.
 *   - An iPad's clock is routinely minutes out and can be hours out after a
 *     flat battery. `Date.now()` against a server `Date` turns that skew into
 *     either a storm of pointless refreshes or a file frozen until the clock
 *     is fixed. Both ends of this subtraction now come from the same clock, so
 *     skew cancels and only elapsed time is left.
 */
function isFresh(res) {
  var cc = res.headers.get('cache-control') || '';
  if (/\b(?:no-cache|no-store|must-revalidate)\b/i.test(cc)) return false;
  var m = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(cc);
  if (!m) return false;
  var at = Number(res.headers.get(STAMP));
  if (!at) return false;
  return (Date.now() - at) / 1000 < Number(m[1]);
}

/**
 * Put a copy in the cache, stamped with the time.
 *
 * Only a complete, same-origin, successful response is worth keeping: an opaque
 * or partial one would poison the cache with something unreadable. The body is
 * buffered to add the stamp, because a Response's headers are immutable once it
 * exists — but this always runs inside waitUntil, off the path the page is
 * waiting on, so the copying costs the user nothing.
 */
function store(req, res) {
  if (!res || res.status !== 200 || res.type !== 'basic') return Promise.resolve();
  var copy = res.clone();
  return copy.blob().then(function (body) {
    var headers = new Headers(copy.headers);
    headers.set(STAMP, String(Date.now()));
    return caches.open(VERSION).then(function (c) {
      return c.put(req, new Response(body, {
        status: copy.status, statusText: copy.statusText, headers: headers,
      }));
    });
  }).catch(function () { /* a cache we could not write is not a page we fail */ });
}

/**
 * Fetch with the HTTP cache forced to revalidate.
 *
 * `cache: 'no-cache'` means "ask the server, but send a conditional request" —
 * not "download it again". Every file here is served with an ETag, so an
 * unchanged `labels.json` costs a 304 of a few hundred bytes rather than the
 * megabyte it weighs.
 *
 * ⚠️ WITHOUT THIS, THE WHOLE SCHEME QUIETLY MEASURES THE WRONG THING. The
 * browser keeps its own HTTP cache underneath this one, holding the same files
 * under the same max-age. A plain fetch() can be answered from it without ever
 * reaching the network, so:
 *   - a background refresh would replace a stale copy with one exactly as
 *     stale, and stamp it as new — a refresh that refreshes nothing;
 *   - a cold miss would store a copy already up to max-age old and stamp it
 *     as current, stacking the HTTP cache's window on top of ours and
 *     doubling how long a file can be wrong.
 * Both were in the first version of this file and both were invisible: the
 * cache looked full, the stamps looked recent, and the content was old.
 *
 * The one place a plain fetch() is still right is `assets/*`, where the name
 * carries a content hash and the HTTP cache cannot hand back the wrong thing.
 */
function fetchFresh(url) {
  return fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
}

/** Refresh a stale cached copy in the background. */
function refresh(req) {
  return fetchFresh(req.url)
    .then(function (r) { return store(req, r); })
    .catch(function () { /* offline: the stored copy is still being served */ });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;         // DEM tiles etc: leave alone
  if (url.pathname.indexOf(SCOPE) !== 0) return;      // not ours

  var path = url.pathname.slice(SCOPE.length);

  // A Range request can only ever be answered from the network: the Cache API
  // refuses to store the 206 that comes back. Don't even try.
  if (req.headers.has('range')) return;
  // ...and the archives are off limits whole, too. A plain GET of one is a
  // 24 MB body that this cache has no business holding and no way to update.
  if (path.indexOf('tiles/') === 0) return;

  // Navigations: network first so a deploy is picked up, cache as fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        e.waitUntil(store(req, r));
        return r;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match(SCOPE);
        });
      })
    );
    return;
  }

  // Vite's own output: content-hashed, so a hit is final.
  if (path.indexOf('assets/') === 0) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (r) {
          e.waitUntil(store(req, r));
          return r;
        });
      })
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // ⚠️ waitUntil, not a bare promise: a worker is free to be killed the
        // moment it has answered, and a floating fetch dies with it. That is
        // why the old code's writes were never guaranteed to land either.
        if (!isFresh(hit)) e.waitUntil(refresh(req));
        return hit;
      }
      // Cold miss: revalidate rather than accept whatever the HTTP cache has,
      // so the stamp we write means "confirmed current", not "found lying about".
      return fetchFresh(req.url).then(function (r) {
        e.waitUntil(store(req, r));
        return r;
      });
    })
  );
});

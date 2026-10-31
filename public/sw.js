/* What-If Atlas service worker. Scope is the app's subpath, so it touches
   nothing else on networkfieldnotes.com — the blog has its own /sw.js for the
   field kit, and the more specific scope wins for pages under it.

   A hand-rolled worker cannot know Vite's content-hashed filenames at build
   time — but it does not have to. install() reads them out of the shell it has
   just fetched and follows them one hop into the bundles, so the whole boot
   path is cached on the FIRST visit rather than the third. See precache().

   ⚠️ OFFLINE STILL MEANS "THE APP, WITHOUT A BASEMAP". The tile archives are
   deliberately never stored here — they are read by Range request and the
   Cache API refuses a 206 — so an offline launch gives a working editor over
   empty ocean. Whole-archive offline is PLAN.md section 3, and belongs in
   IndexedDB. What this file guarantees is that the app boots, which it
   previously did not: see PLAN.md section 16.

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

/* The name of this generation's cache.
   Bump it to start a clean one — if a future build ever needs the data files
   and the code to move together, say. It is no longer the blunt instrument it
   was: a bump used to delete every other `atlas-` cache outright, which is
   what made it dangerous while a page was open. activate() now keeps the
   generation immediately before this one, and lookups start here, so the older
   copies can serve a page still running the old build without ever shadowing
   a current one. Bumping is cheap and safe; it is simply rarely needed. */
var VERSION = 'atlas-v1';
var SCOPE = new URL(self.registration.scope).pathname;

/* How far the crawl below will follow chunk names before giving up. The real
   graph is two deep and six wide; this only exists so a pathological regex
   match can never turn install into a spider. */
var MAX_CRAWL = 60;

/* Files the app wants but can live without, fetched last and never allowed to
   fail the install. Neither is linked from the shell, so neither is reachable
   by crawling: `neighbours.json` is what the fill tool floods across, and
   without it fill quietly degrades to one region at a time. */
var EXTRA = ['data/neighbours.json', 'data/labels.json', 'manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(precache().then(function () { return self.skipWaiting(); }));
});

/**
 * Cache everything needed to boot with no network, discovered rather than
 * listed.
 *
 * ⚠️ PRECACHING THE SHELL ALONE IS NOT OFFLINE, AND CLAIMING OTHERWISE IS HOW
 * THIS WENT UNNOTICED. The previous version cached `SCOPE` and `fonts.css` and
 * the comment at the top of this file said that gave "offline on a second
 * visit". It did not. src/main.ts registers this worker from the window `load`
 * event, which does not fire until every subresource of the first visit has
 * already been fetched — so on visit 1 there was nothing left for the fetch
 * handler to intercept, and the cache afterwards held two entries and no
 * `assets/` at all. An offline visit 2 then served the shell and failed every
 * script and stylesheet it asked for: a page that looks loaded, with a toolbar
 * that does nothing. Only visit 3 worked, and WebKit's seven-day eviction
 * (PLAN.md section 13) puts an idle iPad back to visit 1 again and again.
 *
 * A hand-rolled worker cannot know Vite's hashed filenames at build time, but
 * it can read them at install time out of the shell it just fetched, which is
 * what this does:
 *
 *   1. the shell, and every `src`/`href` in it — scripts and stylesheets are
 *      REQUIRED, because without them an offline load is a dead page;
 *   2. asset names written INSIDE those bundles. MapLibre's worker chunk is
 *      reached this way and appears nowhere in the shell: it is a bare string
 *      in the maplibre chunk, handed to WORKER_URL at runtime. Miss it and the
 *      map cannot start at all, offline or on;
 *   3. the woff2 files named by the stylesheets, then the icons, manifest and
 *      the two data tables — best effort, because the app degrades without
 *      these rather than dying, and a worker that refuses to install is worse
 *      than one that installs without a font.
 *
 * None of this is free, but almost none of it is new traffic: install runs
 * after `load`, so the browser has just fetched these and `fetchFresh` asks
 * conditionally. Measured against the live site, a first visit's precache is
 * 304s the whole way down.
 *
 * ⚠️ NOTHING CATCHES AT THE TOP. Letting install reject is the whole point of
 * install: the browser throws the half-built worker away and the previous one
 * keeps serving its intact cache until a later attempt succeeds. An earlier
 * version ended `.catch(function () { return self.skipWaiting(); })`, which did
 * the opposite — a precache that failed because the wifi dropped mid-install
 * still promoted the worker, and activate() below then deleted the fully
 * populated cache it was replacing.
 */
function precache() {
  var shell = new URL(SCOPE, self.location.href).href;
  var seen = {};
  var code = [];
  var styles = [];
  var extras = [];

  /** Drop anything already queued, so the crawl cannot revisit or loop. */
  function fresh(list) {
    return list.filter(function (u) {
      if (seen[u]) return false;
      seen[u] = true;
      return true;
    });
  }

  fresh([shell]);
  return take(shell, true, true).then(function (html) {
    fresh(linksIn(html || '', shell)).forEach(function (u) {
      var path = new URL(u).pathname;
      if (/\.m?js$/.test(path)) code.push(u);
      else if (/\.css$/.test(path)) styles.push(u);
      else extras.push(u);
    });
    // The boot path. A failure here means an offline load would be the dead
    // page described above, so it must sink the install instead.
    return Promise.all(code.map(function (u) { return take(u, true, true); }));
  }).then(function (sources) {
    var named = [];
    sources.forEach(function (src) { named = named.concat(assetsIn(src || '', shell)); });
    return Promise.all([
      Promise.all(fresh(named).slice(0, MAX_CRAWL).map(function (u) { return take(u, false, false); })),
      Promise.all(styles.map(function (u) { return take(u, true, true); })),
    ]);
  }).then(function (pair) {
    var fonts = [];
    pair[1].forEach(function (css, i) { fonts = fonts.concat(fontsIn(css || '', styles[i])); });
    var rest = fresh(fonts).concat(extras, fresh(EXTRA.map(function (f) { return shell + f; })));
    return Promise.all(rest.map(function (u) { return take(u, false, false); }));
  });
}

/**
 * Fetch one url into the cache, and hand back its text if asked.
 *
 * `required` is the difference between "this install is not worth keeping" and
 * "the app will manage". store() reads a clone, so the body is still ours.
 */
function take(url, required, wantText) {
  return fetchFresh(url).then(function (r) {
    if (!r.ok) {
      if (required) throw new Error(r.status + ' for ' + url);
      return null;
    }
    return store(new Request(url), r).then(function () {
      return wantText ? r.text() : null;
    });
  }).catch(function (err) {
    if (required) throw err;
    return null;
  });
}

/** Absolute, hash-free, and only if it is ours to cache. */
function resolve(value, base) {
  try {
    var u = new URL(value, base);
    u.hash = '';
    if (u.origin !== self.location.origin) return null;
    if (u.pathname.indexOf(SCOPE) !== 0) return null;
    // Tiles are never stored (see the fetch handler), so do not drag a 24 MB
    // archive in here by accident either.
    if (u.pathname.slice(SCOPE.length).indexOf('tiles/') === 0) return null;
    return u.href;
  } catch (err) {
    return null;
  }
}

/** Everything the shell links: `src="…"` and `href="…"`. */
function linksIn(html, base) {
  var out = [];
  var re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  var m;
  while ((m = re.exec(html))) {
    var u = resolve(m[1], base);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Asset filenames written inside a bundle.
 *
 * Vite leaves a chunk it loads at runtime as a plain string in the code, which
 * is the only way to find MapLibre's worker. Matching is deliberately narrow —
 * `assets/` plus a filename plus a code extension — and anything it gets wrong
 * is only ever fetched best-effort, so a false positive costs one 404.
 */
function assetsIn(code, base) {
  var out = [];
  var re = /assets\/[A-Za-z0-9_.-]+\.(?:m?js|css)/g;
  var m;
  while ((m = re.exec(code))) {
    var u = resolve(m[0], base);
    if (u) out.push(u);
  }
  return out;
}

/** The woff2 files a stylesheet names. */
function fontsIn(css, base) {
  var out = [];
  var re = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  var m;
  while ((m = re.exec(css))) {
    if (m[1].slice(0, 5) === 'data:') continue;
    var u = resolve(m[1], base);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Clear out old generations — but not the one immediately before this.
 *
 * ⚠️ AN OPEN PAGE IS STILL RUNNING THE PREVIOUS BUILD. install() skip-waits and
 * this claims every client, so an atlas left open on an iPad across a deploy
 * keeps executing build A's code while the worker underneath it has become
 * build B's. Deleting build A's cache in that moment takes the floor out: any
 * file that page asks for afterwards — and a hashed chunk loaded late is one
 * only build A's cache can have — misses, and offline it simply fails.
 *
 * The earlier version deleted everything regardless, and that WAS necessary
 * while lookups went through `caches.match()`, which searches every cache in
 * creation order: an old generation's copy would have shadowed the new one for
 * ever, which is the very bug section 15 fixed. Lookups now start at the
 * current cache (see `current()`), so an older generation can only ever answer
 * a miss. That removes the reason to delete it, and with it the tension.
 *
 * One generation back is kept, which is as far as an open page can be behind;
 * anything older goes. `caches.keys()` is in creation order, so the last of
 * them is the one to keep.
 */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      var old = keys.filter(function (k) {
        return k.indexOf('atlas-') === 0 && k !== VERSION;
      });
      old.pop();
      return Promise.all(old.map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/**
 * This worker's own cache. ⚠️ ALWAYS LOOK HERE FIRST — `caches.match()` walks
 * every cache in creation order, so going straight to it would let the oldest
 * copy of a file win for ever.
 */
function current(req) {
  return caches.open(VERSION).then(function (c) { return c.match(req); });
}

/** Any generation, oldest first. Only ever consulted after `current` misses. */
function anyGeneration(req) {
  return caches.match(req);
}

/**
 * Lift a previous generation's copy into this one, so the next load is a hit.
 *
 * ⚠️ THE CLONE IS TAKEN SYNCHRONOUSLY, before this function returns. The same
 * response is being handed to the page at the same moment, and a body can only
 * be read once: clone it inside the `caches.open` callback instead and by then
 * the page has usually started reading, so the clone throws and the adoption
 * silently never happens. It cost nothing visible — the file was still served
 * from the older generation every time — which is exactly why it survived a
 * unit test that read the body only after the adoption had finished.
 */
function adopt(req, res) {
  var copy = res.clone();
  return caches.open(VERSION).then(function (c) { return c.put(req, copy); });
}

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
  // Nor this script. The browser's update check never passes through here, so
  // caching it cannot break an update — but a page that fetches `sw.js` for
  // itself (a debug probe did, and it landed in the cache) leaves a copy that
  // is dead weight at best and a stale script to read at worst.
  if (path === 'sw.js') return;

  // Navigations: network first so a deploy is picked up, cache as fallback.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        e.waitUntil(store(req, r));
        return r;
      }).catch(function () {
        // Offline. This generation's copy of the page, then this generation's
        // shell, and only then an older one — otherwise `caches.match()` would
        // hand back the PREVIOUS build's index.html, which is the oldest entry
        // under that url and would win on creation order.
        return current(req)
          .then(function (hit) { return hit || current(SCOPE); })
          .then(function (hit) { return hit || anyGeneration(req); })
          .then(function (hit) { return hit || anyGeneration(SCOPE); });
      })
    );
    return;
  }

  // Vite's own output: content-hashed, so a hit is final.
  if (path.indexOf('assets/') === 0) {
    e.respondWith(
      current(req).then(function (hit) {
        if (hit) return hit;
        // A page still running the previous build asking for one of ITS chunks.
        // The name carries a content hash, so the bytes cannot be wrong — they
        // are just filed under the last generation. Serve them and adopt them.
        return anyGeneration(req).then(function (old) {
          if (old) {
            e.waitUntil(adopt(req, old));
            return old;
          }
          return fetch(req).then(function (r) {
            e.waitUntil(store(req, r));
            return r;
          });
        });
      })
    );
    return;
  }

  // Everything else: stale-while-revalidate.
  e.respondWith(
    current(req).then(function (hit) {
      if (hit) {
        // ⚠️ waitUntil, not a bare promise: a worker is free to be killed the
        // moment it has answered, and a floating fetch dies with it. That is
        // why the old code's writes were never guaranteed to land either.
        if (!isFresh(hit)) e.waitUntil(refresh(req));
        return hit;
      }
      return anyGeneration(req).then(function (old) {
        if (old) {
          // Same path, previous generation. Serve it so nothing breaks, but
          // ALWAYS refresh regardless of its stamp: that stamp was taken
          // against a build which is no longer the one running, and these are
          // the unhashed files whose whole problem is that the name never
          // changes. One load and this generation has its own copy.
          e.waitUntil(refresh(req));
          return old;
        }
        // Cold miss: revalidate rather than accept whatever the HTTP cache has,
        // so the stamp we write means "confirmed current", not "found lying about".
        return fetchFresh(req.url).then(function (r) {
          e.waitUntil(store(req, r));
          return r;
        });
      });
    })
  );
});

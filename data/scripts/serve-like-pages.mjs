/**
 * Serve dist/ the way the live site is actually served, for testing the
 * service worker.
 *
 *   node data/scripts/serve-like-pages.mjs        # after `npm run build`
 *   http://127.0.0.1:4178/what-if-atlas/
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * ⚠️ `npm run preview` CANNOT TEST THE SERVICE WORKER, because the worker's
 * behaviour is driven entirely by response headers vite preview does not send.
 * public/sw.js decides whether a cached copy is stale from the origin's own
 * `Cache-Control: max-age`, refreshes it with a conditional request that is
 * only cheap if the origin answers `304`, and stores it through a Cache API
 * that honours `Vary` when matching. Vite preview sends no max-age, no ETag
 * and no Vary, so against it every branch of that logic takes a path it would
 * never take in production — and a worker bug sails through.
 *
 * The values here are MEASURED from https://networkfieldnotes.com/what-if-atlas/
 * (GitHub Pages behind Cloudflare), not guessed:
 *
 *   index.html, data/*.json, manifest   Cache-Control: max-age=600
 *   fonts.css, fonts/*, icons/*, tiles/ Cache-Control: max-age=14400
 *   everything                          ETag (weak), Last-Modified, Date,
 *                                       Vary: Accept-Encoding, Accept-Ranges
 *
 * Pages serves `assets/*` with the same max-age as everything else — the names
 * are content-hashed, so it does not need more, and neither does the worker.
 *
 * Range requests are answered because PMTiles reads archives by range and the
 * map renders nothing without them. Suffix ranges (`bytes=-500`, the directory
 * at the tail of an archive) are supported, as in vite.config.ts.
 *
 * This is a test fixture, not a deployment target: no compression, no HTTPS, no
 * concurrency limits. Note that a service worker needs a secure context, and
 * 127.0.0.1 counts as one — `localhost` does too, but an IP on the LAN does
 * not, so testing from a real iPad needs a tunnel rather than this.
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const ROOT = resolve('dist');
const BASE = '/what-if-atlas/';
const PORT = Number(process.env.PORT || 4178);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  // Not a lie about compression: the archives are named .gz to stop Pages
  // gzipping them and then slicing ranges out of the compressed copy. See
  // PLAN.md section 8.
  '.gz': 'application/gzip',
};

/** The two values Pages actually uses, by path. */
const maxAge = (rel) => (/\.(?:woff2|png)$|^fonts\.css$|\.pmtiles\.gz$/.test(rel) ? 14400 : 600);

createServer((req, res) => {
  const path = decodeURIComponent((req.url || '').split('?')[0]);
  if (!path.startsWith(BASE)) {
    // Everything outside the app's subpath is the blog's, and is not here.
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('outside the app scope\n');
    return;
  }

  let rel = path.slice(BASE.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }

  let st;
  try { st = statSync(file); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found\n'); return; }
  if (st.isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not a file\n'); return; }

  // Pages derives its ETag from the content; mtime+size is enough to make it
  // change exactly when the file does, which is all the worker depends on.
  const etag = `W/"${st.mtimeMs.toString(16)}-${st.size.toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': `max-age=${maxAge(rel)}`,
    'Vary': 'Accept-Encoding',
    'ETag': etag,
    'Last-Modified': new Date(st.mtimeMs).toUTCString(),
    'Date': new Date().toUTCString(),
    'Accept-Ranges': 'bytes',
  };

  // The conditional answer. refresh() in sw.js forces `cache: 'no-cache'`
  // precisely so an unchanged labels.json costs this and not its megabyte.
  if (req.headers['if-none-match'] === etag) {
    console.log(`304 ${rel}`);
    res.writeHead(304, headers).end();
    return;
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range) {
    const [, rawStart, rawEnd] = range;
    const start = rawStart === '' ? st.size - Number(rawEnd) : Number(rawStart);
    const end = rawStart === '' || rawEnd === '' ? st.size - 1 : Math.min(Number(rawEnd), st.size - 1);
    if (!(start >= 0) || start > end || start >= st.size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Content-Length': String(end - start + 1),
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }

  console.log(`200 ${rel} (${st.size}b)`);
  res.writeHead(200, { ...headers, 'Content-Length': String(st.size) });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} like Pages at http://127.0.0.1:${PORT}${BASE}`);
});

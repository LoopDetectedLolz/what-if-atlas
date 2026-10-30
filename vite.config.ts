import { defineConfig, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/**
 * The atlas is served from a SUBPATH of networkfieldnotes.com, because a
 * GitHub Pages project page inherits the user page's custom domain:
 *
 *   repo LoopDetectedLolz/what-if-atlas  →  networkfieldnotes.com/what-if-atlas/
 *
 * So `base` must match the repo name, with a leading AND trailing slash.
 * Change BASE here and in nothing else — every runtime path is built from
 * import.meta.env.BASE_URL.
 *
 * ⚠️ Vite's base rewriting covers JS-imported asset URLs and CSS url(), but NOT
 * paths you construct as strings at runtime. Any PMTiles URL, MapLibre
 * style/sprite/glyph URL, or fetch() of a data file must be prefixed with
 * import.meta.env.BASE_URL, written out literally. That is the most likely
 * cause of a build that works locally and 404s on Pages.
 */
const BASE = '/what-if-atlas/';

/**
 * Serve the tile archives ourselves, because their names lie.
 *
 * `public/tiles/*.pmtiles.gz` are NOT gzipped — the extension is a workaround
 * for GitHub Pages, which compresses `application/octet-stream` and then answers
 * byte-range requests out of the compressed copy, feeding PMTiles garbage. See
 * PLAN.md section 8.
 *
 * ⚠️ The static server Vite uses takes `.gz` at its word and answers with
 * `Content-Encoding: gzip`, so the browser tries to inflate plain bytes and
 * fails with ERR_CONTENT_DECODING_FAILED. The map then renders nothing LOCALLY
 * while the deployed site is fine — the exact inverse of the bug the rename
 * fixed. Hence this: a plain range-capable file handler, no content encoding,
 * which is also what Pages does for `application/gzip`.
 */
function pmtilesPlugin(): Plugin {
  const pattern = new RegExp(`^${BASE}(tiles/[\\w.-]+\\.pmtiles\\.gz)(?:\\?.*)?$`);

  /** dev serves out of public/, `npm run preview` out of the built dist/. */
  const attach = (root: string) => (server: { middlewares: { use: (fn: Middleware) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const match = req.url && pattern.exec(req.url);
      if (!match) return next();

      const path = resolve(__dirname, root, match[1]);
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        return next();
      }

      // application/gzip is the type Pages leaves alone, so serve the same one
      // here: the only honest statement is "opaque bytes, ranges supported".
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');

      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (!range) {
        res.writeHead(200, { 'Content-Length': String(size) });
        return createReadStream(path).pipe(res);
      }

      // An open-ended suffix range (`bytes=-500`) means the LAST n bytes, which
      // is how PMTiles reads a directory at the end of an archive.
      const [, rawStart, rawEnd] = range;
      const start = rawStart === '' ? size - Number(rawEnd) : Number(rawStart);
      const end = rawStart === '' || rawEnd === '' ? size - 1 : Number(rawEnd);
      if (!(start >= 0) || start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }

      const last = Math.min(end, size - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${last}/${size}`,
        'Content-Length': String(last - start + 1),
      });
      return createReadStream(path, { start, end: last }).pipe(res);
    });
  };

  return {
    name: 'atlas-pmtiles',
    configureServer: attach('public'),
    // `npm run preview` serves dist/, where public/ has been copied verbatim.
    configurePreviewServer: attach('dist'),
  };
}

export default defineConfig({
  base: BASE,
  plugins: [pmtilesPlugin()],
  build: {
    // Multi-page: the app shell and the milestone-0 device probe.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        probe: resolve(__dirname, 'probe.html'),
      },
      output: {
        // MapLibre is ~1 MB and changes only when the dependency is bumped,
        // while app code changes constantly. Giving it its own chunk means a
        // deploy does not invalidate it in the browser cache — which matters
        // on an iPad over school wifi. Without this it lands in a shared chunk
        // named after whichever module sorted first, which is also misleading.
        manualChunks: (id) =>
          id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined,
      },
    },
    // GitHub Pages has a 100 MiB per-file hard limit; warn well before that.
    chunkSizeWarningLimit: 4000,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    // Bind on all interfaces so the iPad on the same wifi can reach the dev
    // server: `npm run dev` then open http://<mac-lan-ip>:5173/what-if-atlas/
    host: true,
    port: 5173,
  },
});

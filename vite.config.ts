import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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

export default defineConfig({
  base: BASE,
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

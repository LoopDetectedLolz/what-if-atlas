/**
 * Point MapLibre at its web worker. Import this ONCE, before any Map is built.
 *
 * Why it is needed: maplibre-gl v6 works out its worker URL at runtime as a
 * sibling of its own module —
 *
 *     const t = 'maplibre-gl-worker.mjs';
 *     const n = new URL(`./${t}`, import.meta.url);
 *
 * A bundler cannot see through `import.meta.url`, so Vite never copies that
 * file. The bundled chunk lands at `assets/maplibre-<hash>.js`, MapLibre asks
 * for `assets/maplibre-gl-worker.mjs`, GitHub Pages (or any static host) serves
 * the 404 page instead, and the browser rejects it:
 *
 *     Failed to load module script: non-JavaScript MIME type of "text/html"
 *     Error: Worker failed to load. Check that the worker URL is correct.
 *
 * The map then renders nothing at all — no tiles, no geometry — while the rest
 * of the page looks perfectly healthy, which makes it a confusing one to
 * diagnose from a screenshot.
 *
 * The fix: `?url` makes Vite emit the worker as a real asset and hand back its
 * hashed, base-prefixed URL, which works in dev and in the subpath build alike.
 * Taking it from node_modules means it can never drift from the installed
 * version — which matters, because MapLibre stamps `?v=<version>` on the URL it
 * would otherwise build itself.
 */

import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);

export { workerUrl };

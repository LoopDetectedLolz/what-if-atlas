/**
 * Build the milestone-0 placeholder basemap.
 *
 * Source:   data/raw/ne_110m_admin_0_countries.geojson
 *           Natural Earth v5.1.2 (pinned tag), PUBLIC DOMAIN
 *           https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2
 * Output:   public/data/placeholder-countries.geojson
 *
 * TEMPORARY. This exists only so milestone 0 has real geometry to pinch-zoom
 * while measuring frame rate. It is replaced in milestone 1 by the PMTiles
 * pipeline built from ne_10m_admin_0_countries_usa.
 *
 * ⚠️ Point of view: the 110m file has NO point-of-view variant, so it carries
 * Natural Earth's de facto POV — Crimea is drawn with Russia here. The real
 * basemap uses the _usa POV file. Do not read anything into this placeholder's
 * borders, and do not ship it past milestone 1. See PLAN.md §3.
 *
 * Keeps only ADM0_A3 (the stable key — unique 177/177 here, whereas ISO_A3
 * already has 5 '-99' values at this scale) and NAME. Coordinates are rounded
 * to 2 decimal places, which is ~1 km and far finer than 110m data warrants.
 *
 * Usage: node data/scripts/build-placeholder.mjs    (from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'data/raw/ne_110m_admin_0_countries.geojson';
const OUT = 'public/data/placeholder-countries.geojson';
const DP = 2;

const round = (n) => Math.round(n * 10 ** DP) / 10 ** DP;

/** Recursively round every coordinate pair, whatever the nesting depth. */
function roundCoords(c) {
  return typeof c[0] === 'number'
    ? [round(c[0]), round(c[1])]
    : c.map(roundCoords);
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));

let dropped = 0;
const features = src.features.flatMap((f) => {
  const id = f.properties?.ADM0_A3;
  // Natural Earth uses the literal string '-99' for missing text. A feature
  // with no stable key cannot be coloured or joined to, so it has no place in
  // the output — but say so rather than silently losing it.
  if (!id || id === '-99') {
    dropped++;
    return [];
  }
  return [{
    type: 'Feature',
    // A top-level string id is what MapLibre's feature-state needs.
    id,
    properties: { ADM0_A3: id, NAME: f.properties.NAME ?? id },
    geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) },
  }];
});

mkdirSync('public/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));

const kb = (p) => (readFileSync(p).length / 1024).toFixed(0);
console.log(`${OUT}: ${features.length} features, ${kb(OUT)} KB (from ${kb(SRC)} KB)`);
if (dropped) console.log(`dropped ${dropped} feature(s) with no usable ADM0_A3`);

const ids = new Set(features.map((f) => f.id));
if (ids.size !== features.length) {
  throw new Error(`ADM0_A3 is not unique: ${features.length} features, ${ids.size} distinct ids`);
}

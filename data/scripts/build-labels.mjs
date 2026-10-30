/**
 * Build the map's label anchors.
 *
 * Source:  Natural Earth v5.1.2 (pinned tag), PUBLIC DOMAIN
 * Output:  public/data/labels.json   (GeoJSON FeatureCollection of Points)
 *
 * ⚠️ LABELS DO NOT COME OFF THE PAINTABLE POLYGON LAYERS, AND THAT IS DELIBERATE.
 *
 * Two reasons, both of which show up immediately on screen if you ignore them:
 *
 *   1. ONE LABEL PER TILE, NOT PER COUNTRY. MapLibre places a point label for a
 *      polygon at the pole of inaccessibility of the geometry IN THAT TILE. A
 *      country that spans several tiles therefore gets several labels — "Russia"
 *      four times across Siberia — and nothing dedupes them, because the two
 *      labels do not overlap so the collision index has no reason to drop one.
 *   2. NATURAL EARTH ALREADY CARRIES CARTOGRAPHER-CHOSEN LABEL POINTS, and they
 *      are far better than any centroid. `LABEL_X`/`LABEL_Y` on admin-0 put
 *      "Chile" down the spine of the country rather than out in the Pacific
 *      where a bounding-box centre lands; `latitude`/`longitude` on admin-1 do
 *      the same per province. Both are present on every feature (verified: 0
 *      missing of 258 and 0 of 4,596).
 *
 * So label anchors are their own layer of points, and the polygons stay purely
 * about painting.
 *
 * ── The reveal schedule is Natural Earth's, not invented here ───────────────
 *
 * Every feature carries a `rank` that is NE's own judgement of label
 * importance, lower being more important:
 *
 *   country   LABELRANK   2 (Brazil) … 10 (Vatican)
 *   province  min_label   the zoom NE says the label should first appear at
 *   place     SCALERANK   0 (Tokyo, London) … 10 (small towns)
 *
 * The style feeds that straight into `symbol-sort-key`, so MapLibre places
 * labels in NE's order of importance and the ones that will not fit simply lose
 * the collision. That gives the progressive reveal for free and from the data,
 * rather than from hand-tuned per-layer zoom cutoffs — and it has the nicer
 * property that a minor label sitting in empty space appears early, because
 * there is nothing for it to collide with.
 *
 * ── Cities are places, not urban areas ─────────────────────────────────────
 *
 * City labels come from `ne_50m_populated_places` (1,251 points), not from the
 * 2,143 urban-area polygons, which have no names of their own at all. Every
 * place is labelled, including the ~600 with no urban polygon around them, so
 * the map names Reykjavík even though there is no city-level region to paint
 * there. `urban_id` ties a place back to its paintable polygon where one
 * contains it, and is null otherwise — see the note in the output's meta block.
 *
 * Usage: node data/scripts/build-labels.mjs     (from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const RAW = 'data/raw';
const OUT = 'public/data';
const DEST = `${OUT}/labels.json`;

const read = (f) => JSON.parse(readFileSync(`${RAW}/${f}.geojson`, 'utf8'));

/** Natural Earth uses the literal '-99' for missing text and -99 for numbers. */
const clean = (v) => (v === '-99' || v === -99 || v === '' ? null : v ?? null);

/**
 * 4 decimal places is ~11 m at the equator — far finer than a label anchor
 * needs, and it keeps the file to a size worth downloading on a tablet.
 */
const round = (n) => Number(Number(n).toFixed(4));

const num = (v, fallback) => {
  const n = Number(clean(v));
  return Number.isFinite(n) ? n : fallback;
};

// ── geometry helpers (the fallbacks, and the place-in-polygon join) ─────────

function* eachRing(geom) {
  if (geom.type === 'Polygon') yield* geom.coordinates;
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) yield* poly;
}

function bbox(geom) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of eachRing(geom)) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

function pointInPolygon([px, py], geom) {
  let inside = false;
  for (const ring of eachRing(geom)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ── countries ───────────────────────────────────────────────────────────────

function countryLabels() {
  // The same `_usa` point of view the paintable tiles use, so a label can never
  // name a country the map does not draw. See build-regions.mjs.
  const src = read('ne_10m_admin_0_countries_usa');
  const out = [];
  let fellBack = 0;

  for (const f of src.features) {
    const id = clean(f.properties.ADM0_A3);
    const name = clean(f.properties.NAME);
    if (!id || !name) continue;

    let x = clean(f.properties.LABEL_X);
    let y = clean(f.properties.LABEL_Y);
    if (x === null || y === null) {
      const [w, s, e, n] = bbox(f.geometry);
      [x, y] = [(w + e) / 2, (s + n) / 2];
      fellBack++;
    }

    out.push(point([x, y], {
      id,
      level: 'country',
      name,
      // LABELRANK runs 1–10, lower being more important.
      rank: num(f.properties.LABELRANK, 8),
    }));
  }

  console.log(`  countries: ${out.length} (${fellBack} fell back to a bbox centre)`);
  return out;
}

// ── provinces ───────────────────────────────────────────────────────────────

function provinceLabels() {
  const src = read('ne_10m_admin_1_states_provinces');
  const out = [];
  let fellBack = 0;

  for (const f of src.features) {
    const id = clean(f.properties.adm1_code);
    const name = clean(f.properties.name);
    if (!id || !name) continue;

    let x = clean(f.properties.longitude);
    let y = clean(f.properties.latitude);
    if (x === null || y === null) {
      const [w, s, e, n] = bbox(f.geometry);
      [x, y] = [(w + e) / 2, (s + n) / 2];
      fellBack++;
    }

    out.push(point([x, y], {
      id,
      level: 'province',
      name,
      country: clean(f.properties.adm0_a3),
      // `min_label` is the zoom NE intends the label to appear at, which is
      // exactly a priority: 4 for Bavaria, 11 for a rural district. 38 features
      // carry 18, NE's way of saying "do not label this"; they keep that rank
      // and so are only ever placed if nothing else wants the space.
      rank: num(f.properties.min_label, 11),
    }));
  }

  console.log(`  provinces: ${out.length} (${fellBack} fell back to a bbox centre)`);
  return out;
}

// ── cities ──────────────────────────────────────────────────────────────────

function placeLabels() {
  const places = read('ne_50m_populated_places').features;
  const urban = read('ne_50m_urban_areas').features;

  // The urban ids have to be derived the same way build-regions.mjs derives
  // them — sort on the rounded bbox centre, then number — or `urban_id` would
  // point at the wrong polygon. Keep the two in step.
  const withCentre = urban.map((f) => {
    const [w, s, e, n] = bbox(f.geometry);
    return { f, c: [(w + e) / 2, (s + n) / 2] };
  });
  withCentre.sort((a, b) => {
    const ax = a.c[0].toFixed(4), bx = b.c[0].toFixed(4);
    if (ax !== bx) return ax < bx ? -1 : 1;
    return a.c[1].toFixed(4) < b.c[1].toFixed(4) ? -1 : 1;
  });
  const polys = withCentre.map(({ f }, i) => ({
    id: `U${String(i).padStart(4, '0')}`,
    bbox: bbox(f.geometry),
    geom: f.geometry,
  }));

  const out = [];
  let matched = 0;

  for (const p of places) {
    const name = clean(p.properties.NAME);
    if (!name || p.geometry?.type !== 'Point') continue;
    const [x, y] = p.geometry.coordinates;

    let urbanId = null;
    for (const poly of polys) {
      const [w, s, e, n] = poly.bbox;
      if (x < w || x > e || y < s || y > n) continue;
      if (pointInPolygon([x, y], poly.geom)) { urbanId = poly.id; break; }
    }
    if (urbanId) matched++;

    out.push(point([x, y], {
      // Places have no stable id of their own in Natural Earth, and this layer
      // is never painted, so the name plus country is identity enough.
      level: 'place',
      name,
      country: clean(p.properties.ADM0_A3),
      // SCALERANK: 0 is a world city, 10 a small town.
      rank: num(p.properties.SCALERANK, 8),
      capital: p.properties.ADM0CAP === 1 ? 1 : 0,
      urban_id: urbanId,
    }));
  }

  console.log(`  places: ${out.length} (${matched} inside an urban polygon, ` +
              `${out.length - matched} with no paintable city region)`);
  return out;
}

// ── run ─────────────────────────────────────────────────────────────────────

function point([x, y], properties) {
  // Drop nulls rather than writing them: a vector-tile style tests `has`, and
  // the file is smaller for it.
  const props = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v !== null && v !== undefined) props[k] = v;
  }
  return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [round(x), round(y)] } };
}

console.log('label anchors');
const features = [...countryLabels(), ...provinceLabels(), ...placeLabels()];

mkdirSync(OUT, { recursive: true });
writeFileSync(DEST, JSON.stringify({
  type: 'FeatureCollection',
  meta: {
    source: 'Natural Earth v5.1.2 (ne_10m_admin_0_countries_usa, ne_10m_admin_1_states_provinces, ne_50m_populated_places, ne_50m_urban_areas)',
    source_url: 'https://www.naturalearthdata.com/',
    licence: 'Public domain',
    retrieved: '2026-10-30',
    built_by: 'data/scripts/build-labels.mjs',
    note: 'Anchors are Natural Earth\'s own label coordinates (LABEL_X/LABEL_Y, latitude/longitude), not computed centroids. `rank` is NE\'s label priority, lower being more important, and drives symbol-sort-key. `urban_id` is null where a place has no urban-area polygon around it, so the map can name a city that has no paintable city region.',
  },
  features,
}));

const kb = (readFileSync(DEST).length / 1024).toFixed(0);
console.log(`  -> ${DEST}  ${features.length} points, ${kb} KB`);

// Self-check: a label anchor outside its own country is the failure mode that
// matters, and the one that would be hardest to spot by eye at low zoom.
const bad = features.filter((f) => {
  const [x, y] = f.geometry.coordinates;
  return !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90;
});
if (bad.length) {
  throw new Error(`${bad.length} label anchors are not valid coordinates, e.g. ${JSON.stringify(bad[0])}`);
}

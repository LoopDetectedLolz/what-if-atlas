/**
 * Normalise the Natural Earth layers into the three paintable "snap levels".
 *
 * Source:  Natural Earth v5.1.2 (pinned tag), PUBLIC DOMAIN
 * Output:  data/out/countries.geojson
 *          data/out/provinces.geojson
 *          data/out/urban.geojson
 *
 * The editor paints REGIONS, not pixels, so every feature needs an id that is
 * stable across rebuilds and across save/load — a scenario file stores colours
 * keyed by these ids, and a key that shifts would silently repaint the map.
 *
 *   country   ADM0_A3      unique 258/258, stable across NE versions
 *   province  adm1_code    unique 4596/4596, zero missing
 *   urban     SYNTHESISED  — see below
 *
 * ⚠️ Natural Earth's urban-area layer has NO identifier and NO name: all 2,143
 * features have `name: null`. So ids are synthesised here by sorting on rounded
 * centroid coordinates and numbering the result. That is deterministic for a
 * given input file, which is pinned and vendored, so the ids are reproducible.
 * Names are joined from ne_50m_populated_places (the highest-ranked place
 * inside each polygon), because "colour in U0423" is not a usable interface.
 *
 * Usage: node data/scripts/build-regions.mjs     (from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const RAW = 'data/raw';
const OUT = 'data/out';

const read = (f) => JSON.parse(readFileSync(`${RAW}/${f}.geojson`, 'utf8'));

/** Natural Earth uses the literal '-99' for missing text and -99 for numbers. */
const clean = (v) => (v === '-99' || v === -99 || v === '' ? null : v ?? null);

// ── geometry helpers ────────────────────────────────────────────────────────

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

/** Centroid of the bbox. Good enough for deterministic ordering. */
function centre(geom) {
  const [w, s, e, n] = bbox(geom);
  return [(w + e) / 2, (s + n) / 2];
}

/** Ray casting against every ring. Even-odd, so holes exclude correctly. */
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

function buildCountries() {
  // The _usa point of view: effectively gap-free, where _iso and _tlc leave
  // Kashmir, Arunachal Pradesh, Crimea and the Golan as sea-coloured holes.
  // Documented in the app; see PLAN.md.
  const pov = read('ne_10m_admin_0_countries_usa');
  const def = read('ne_10m_admin_0_countries');

  const features = [];
  const seen = new Set();
  let dropped = 0;

  for (const f of pov.features) {
    const id = clean(f.properties.ADM0_A3);
    if (!id) { dropped++; continue; }
    seen.add(id);
    features.push({
      type: 'Feature',
      id,
      properties: {
        id,
        level: 'country',
        name: clean(f.properties.NAME) ?? id,
        name_long: clean(f.properties.NAME_LONG),
        continent: clean(f.properties.CONTINENT),
        iso_a2: clean(f.properties.ISO_A2_EH) ?? clean(f.properties.ISO_A2),
        pop_est: clean(f.properties.POP_EST),
        pop_year: clean(f.properties.POP_YEAR),
      },
      geometry: f.geometry,
    });
  }

  // ⚠️ Features present in the default POV but absent from _usa fall into TWO
  // very different cases, and treating them alike is a trap:
  //
  //   (a) ABSORBED — the territory is drawn inside its parent state. Somaliland
  //       sits inside Somalia, N. Cyprus inside Cyprus. That IS the _usa point
  //       of view, and patching them back would overlay a second polygon on
  //       ground that is already covered. Two features at one point makes the
  //       snap target ambiguous, which breaks region painting outright.
  //
  //   (b) GENUINE HOLES — no _usa polygon covers the ground at all, so the map
  //       would show sea where there is land. The Siachen Glacier is the known
  //       case.
  //
  // Only (b) gets patched. The test is whether any _usa polygon already
  // contains the feature's centre.
  const povIndex = features.map((f) => ({ bbox: bbox(f.geometry), geom: f.geometry, id: f.id }));
  const coveredByPov = (geom) => {
    const c = centre(geom);
    for (const cand of povIndex) {
      const [w, s, e, n] = cand.bbox;
      if (c[0] < w || c[0] > e || c[1] < s || c[1] > n) continue;
      if (pointInPolygon(c, cand.geom)) return cand.id;
    }
    return null;
  };

  let patched = 0;
  for (const f of def.features) {
    const id = clean(f.properties.ADM0_A3);
    if (id && !seen.has(id)) {
      const absorbedInto = coveredByPov(f.geometry);
      if (absorbedInto) {
        console.log(`  absorbed by the _usa POV: ${id} (${clean(f.properties.NAME)}) ` +
                    `-> inside ${absorbedInto}; not patched`);
        seen.add(id);
        continue;
      }
      features.push({
        type: 'Feature',
        id,
        properties: {
          id,
          level: 'country',
          name: clean(f.properties.NAME) ?? id,
          name_long: clean(f.properties.NAME_LONG),
          continent: clean(f.properties.CONTINENT),
          iso_a2: clean(f.properties.ISO_A2_EH) ?? clean(f.properties.ISO_A2),
          pop_est: clean(f.properties.POP_EST),
          pop_year: clean(f.properties.POP_YEAR),
          patched_from_default_pov: true,
        },
        geometry: f.geometry,
      });
      seen.add(id);
      patched++;
      console.log(`  patched in from default POV: ${id} (${clean(f.properties.NAME)})`);
    }
  }

  if (dropped) console.log(`  dropped ${dropped} countries with no ADM0_A3`);
  console.log(`  countries: ${features.length} (${patched} patched)`);
  return features;
}

// ── provinces ───────────────────────────────────────────────────────────────

function buildProvinces() {
  const src = read('ne_10m_admin_1_states_provinces');
  const features = src.features.flatMap((f) => {
    const id = clean(f.properties.adm1_code);
    if (!id) return [];
    return [{
      type: 'Feature',
      id,
      properties: {
        id,
        level: 'province',
        name: clean(f.properties.name) ?? id,
        // The country this province sits in. Needed so a country-level paint
        // knows which provinces it underlies, and for the panel.
        country: clean(f.properties.adm0_a3),
        type_en: clean(f.properties.type_en),
        iso_3166_2: clean(f.properties.iso_3166_2),
      },
      geometry: f.geometry,
    }];
  });
  console.log(`  provinces: ${features.length}`);
  return features;
}

// ── urban areas ─────────────────────────────────────────────────────────────

function buildUrban(countries) {
  const src = read('ne_50m_urban_areas');
  const places = read('ne_50m_populated_places').features;

  // Deterministic order: rounded centroid, so ids are reproducible for this
  // pinned input regardless of how the file happens to be ordered.
  const withCentre = src.features.map((f) => ({ f, c: centre(f.geometry) }));
  withCentre.sort((a, b) => {
    const ax = a.c[0].toFixed(4), bx = b.c[0].toFixed(4);
    if (ax !== bx) return ax < bx ? -1 : 1;
    return a.c[1].toFixed(4) < b.c[1].toFixed(4) ? -1 : 1;
  });

  // Pre-bucket places by integer degree so the point-in-polygon pass is not
  // 2,143 x 1,251.
  const grid = new Map();
  for (const p of places) {
    const [x, y] = p.geometry.coordinates;
    const k = `${Math.floor(x)},${Math.floor(y)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }

  let named = 0;
  const features = withCentre.map(({ f, c }, i) => {
    const id = `U${String(i).padStart(4, '0')}`;
    const [w, s, e, n] = bbox(f.geometry);

    // Lowest SCALERANK wins: in Natural Earth, lower rank = more important.
    let best = null;
    for (let gx = Math.floor(w); gx <= Math.floor(e); gx++) {
      for (let gy = Math.floor(s); gy <= Math.floor(n); gy++) {
        for (const p of grid.get(`${gx},${gy}`) ?? []) {
          if (!pointInPolygon(p.geometry.coordinates, f.geometry)) continue;
          const rank = p.properties.SCALERANK ?? 99;
          if (!best || rank < best.rank) {
            best = { rank, name: clean(p.properties.NAME), country: clean(p.properties.ADM0_A3) };
          }
        }
      }
    }
    if (best?.name) named++;

    return {
      type: 'Feature',
      id,
      properties: {
        id,
        level: 'urban',
        name: best?.name ?? null,
        country: best?.country ?? null,
        scalerank: clean(f.properties.scalerank),
        area_sqkm: clean(f.properties.area_sqkm),
        // Natural Earth authored min_zoom for exactly this kind of reveal.
        min_zoom: clean(f.properties.min_zoom),
        centre_lng: Number(c[0].toFixed(4)),
        centre_lat: Number(c[1].toFixed(4)),
      },
      geometry: f.geometry,
    };
  });

  console.log(`  urban areas: ${features.length} (${named} matched to a place name, ` +
              `${features.length - named} unnamed)`);
  void countries;
  return features;
}

// ── run ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const write = (name, features) => {
  const path = `${OUT}/${name}.geojson`;
  // Newline-delimited would be friendlier to tippecanoe for huge inputs, but
  // these fit comfortably in memory and plain GeoJSON keeps the files readable.
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }));
  const mb = (readFileSync(path).length / 1048576).toFixed(1);
  console.log(`  -> ${path}  ${mb} MB`);

  const ids = new Set(features.map((f) => f.id));
  if (ids.size !== features.length) {
    throw new Error(`${name}: ids are not unique (${features.length} features, ${ids.size} ids)`);
  }
};

console.log('countries');
write('countries', buildCountries());
console.log('provinces');
write('provinces', buildProvinces());
console.log('urban');
write('urban', buildUrban());

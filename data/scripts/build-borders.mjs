/**
 * Split the region outlines into SHARED BORDERS and COASTLINE.
 *
 * Input:   data/out/{countries,provinces}.geojson   (build-regions.mjs)
 * Output:  data/out/borders-{country,province}.geojson
 *
 * ⚠️ THIS EXISTS BECAUSE A BORDER HAS TO BE ITS OWN FEATURE BEFORE IT CAN FADE.
 *
 * The map's headline feature is that the border between two regions fades away
 * when both are painted the same colour, while coastlines never do. MapLibre has
 * no way to fade part of a feature: opacity is per feature, and a country
 * polygon's outline is one feature carrying its coast AND every border it has.
 * Fading that fades the coast with it.
 *
 * So the outlines are taken apart here. Every segment of every ring is counted by
 * how many regions own it:
 *
 *   one owner   → COAST. Nothing else is on the other side. Never fades.
 *   two owners  → BORDER between those two regions. Fadeable, and emitted ONCE
 *                 rather than twice as the polygons carry it.
 *
 * ── Ids are PAIR ids, and that is the point ────────────────────────────────
 *
 * A border feature's id is `A|B`, the two region ids sorted. One border usually
 * breaks into several disjoint chains — interrupted by a lake, by a third
 * country at a tripoint, by an island — and every chain of the same pair gets
 * the SAME id. MapLibre keys feature-state by id and applies it to every feature
 * carrying that id, so one setFeatureState call fades a whole border however
 * many pieces it is in. There are ~300 country pairs, not thousands of segments.
 *
 * ── Why both levels come from their own file ───────────────────────────────
 *
 * Country borders are cut from data/out/countries.geojson and province borders
 * from data/out/provinces.geojson, never from one file for both. Each line layer
 * then sits on the fills cut from the same source with the same tippecanoe
 * settings, so it does not drift off the colour boundary it is drawing.
 *
 * ⚠️ It is its OWN tippecanoe run, not the same one, and the alignment is very
 * good rather than exact: measured median 0 px, worst 0.9 px, because
 * --no-simplification-of-shared-nodes keeps every vertex shared between features
 * in both the polygons and the lines. Putting both layers in ONE run was tried
 * and is worse, not better — shared-node protection then retains border vertices
 * in tiles where the matching fill has been dropped, and ITA|VAT drifts 6.3 px.
 *
 * It also sidesteps a real inconsistency between the two files: the country
 * layer uses Natural Earth's `_usa` point of view, where Somaliland, Northern
 * Cyprus and Kosovo-adjacent territory are absorbed into their parent states,
 * while the admin-1 file still attributes provinces to SOL, CYN and KAB. Cutting
 * each level from its own file means neither has to be reconciled with the other.
 *
 * Usage: node data/scripts/build-borders.mjs     (from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
// MapLibre's own id hash, reached through maplibre-gl's dependency on it. If
// this import ever fails, MapLibre has changed how it keys feature ids and the
// check at the bottom of this file needs revisiting rather than deleting.
import murmur3 from 'murmurhash-js';

const OUT = 'data/out';

/**
 * Decimal places used to decide whether two vertices are the same point.
 *
 * ⚠️ MUST MATCH build-neighbours.mjs. Both answer the same question — do these
 * two regions touch — and a disagreement would mean the fill tool floods across
 * a pair whose border cannot fade, or the reverse. 4 dp is ~11 m, which absorbs
 * floating-point noise without merging genuinely distinct points.
 */
const DP = 4;

const k = (x, y) => `${x.toFixed(DP)},${y.toFixed(DP)}`;

function* eachRing(geom) {
  if (!geom) return;
  if (geom.type === 'Polygon') yield* geom.coordinates;
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) yield* poly;
}

/** The pair id a border feature carries. Sorted, so A|B and B|A are one border. */
const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Whether this level's coastline is worth emitting.
 *
 * ⚠️ THE PROVINCE COASTLINE IS DELIBERATELY DROPPED. It is the same line as the
 * country coastline — 407,896 segments against 407,006 — and it is never seen:
 * the country coast is drawn on top of it, darker and wider at every zoom. Only
 * the country file's copy is kept, which is almost half of the province border
 * data gone for nothing visible.
 */
const WANT_COAST = { country: true, province: false };

function build(level, file) {
  const src = JSON.parse(readFileSync(`${OUT}/${file}.geojson`, 'utf8'));

  // segment key -> { owners:Set, p, q }  with p/q the ROUNDED endpoints, so the
  // chains below join on exactly the keys that made two segments neighbours.
  const segs = new Map();
  let degenerate = 0;

  for (const f of src.features) {
    const id = f.properties?.id ?? f.id;
    if (!id) continue;
    for (const ring of eachRing(f.geometry)) {
      for (let i = 1; i < ring.length; i++) {
        const a = k(ring[i - 1][0], ring[i - 1][1]);
        const b = k(ring[i][0], ring[i][1]);
        // A segment whose ends round together carries no direction and would
        // make a self-loop in the chaining below.
        if (a === b) { degenerate++; continue; }
        const key = a < b ? `${a};${b}` : `${b};${a}`;
        let s = segs.get(key);
        if (!s) segs.set(key, (s = { owners: new Set(), p: a, q: b }));
        s.owners.add(id);
      }
    }
  }

  // Group the segments by what is on either side of them, then chain each group
  // into as few LineStrings as it will make.
  const groups = new Map();
  const counts = { coast: 0, border: 0, crowded: 0 };

  for (const s of segs.values()) {
    const owners = [...s.owners];
    let key, props;
    if (owners.length === 1) {
      key = 'coast';
      props = { kind: 'coast' };
      counts.coast++;
    } else if (owners.length === 2) {
      const id = pairId(owners[0], owners[1]);
      key = id;
      props = { kind: 'border', id, a: owners[0], b: owners[1] };
      counts.border++;
    } else {
      // Three or more regions on one segment is not geography, it is a data
      // artefact — a sliver polygon, or a region drawn twice. Drawn as coast so
      // the line is never missing from the map, but never faded, because there
      // is no single pair to match colours on.
      key = 'coast';
      props = { kind: 'coast' };
      counts.crowded++;
    }
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { props, segs: [] }));
    g.segs.push(s);
  }

  // Rounded-key point -> the original coordinate pair, so the output keeps full
  // precision and only the MATCHING was done at 4 dp.
  const coord = new Map();
  for (const f of src.features) {
    for (const ring of eachRing(f.geometry)) {
      for (const [x, y] of ring) {
        const key = k(x, y);
        if (!coord.has(key)) coord.set(key, [x, y]);
      }
    }
  }

  const features = [];
  for (const [key, g] of groups) {
    if (key === 'coast' && !WANT_COAST[level]) continue;
    for (const chain of chainSegments(g.segs)) {
      features.push({
        type: 'Feature',
        properties: g.props,
        geometry: { type: 'LineString', coordinates: chain.map((key) => coord.get(key)) },
      });
    }
  }

  const vertices = features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
  console.log(`${level}:`);
  console.log(`  segments: ${counts.coast} coast, ${counts.border} border` +
              `${counts.crowded ? `, ${counts.crowded} with 3+ owners (drawn as coast)` : ''}` +
              `${degenerate ? `, ${degenerate} zero-length dropped` : ''}`);
  console.log(`  borders:  ${groups.size - (groups.has('coast') ? 1 : 0)} region pairs`);
  console.log(`  features: ${features.length} chains, ${vertices} vertices`);

  // A pair that produced no chain would be a border that can never fade. The
  // fill tool's adjacency table is built from the same shared vertices, so the
  // two must agree; this is the cheap half of that check.
  const pairs = [...groups.keys()].filter((key) => key !== 'coast');
  if (counts.border && !pairs.length) {
    throw new Error(`${level}: segments were classified as borders but no pair survived`);
  }

  return { features, pairs };
}

/**
 * Join segments that meet end to end into the longest runs they will make.
 *
 * Fewer, longer LineStrings than one feature per segment, which matters twice
 * over: tippecanoe simplifies a long line usefully and a two-point one not at
 * all, and MapLibre's line joins are only drawn WITHIN a feature, so a border
 * chopped into segments draws visible notches at every bend.
 *
 * Greedy and deliberately simple: walk from each unused endpoint of degree 1,
 * then mop up anything left, which is the closed rings — an island's whole
 * coast, or a country entirely surrounded by one neighbour.
 */
function chainSegments(segs) {
  const adj = new Map();
  const used = new Set();
  const link = (from, to, i) => {
    let list = adj.get(from);
    if (!list) adj.set(from, (list = []));
    list.push({ to, i });
  };
  segs.forEach((s, i) => { link(s.p, s.q, i); link(s.q, s.p, i); });

  const chains = [];

  const walk = (start) => {
    const points = [start];
    let at = start;
    for (;;) {
      const next = (adj.get(at) ?? []).find((e) => !used.has(e.i));
      if (!next) break;
      used.add(next.i);
      points.push(next.to);
      at = next.to;
      // Stop at a junction rather than guessing which way to go through it, so
      // a chain never doubles back on itself at a tripoint.
      if (at === start) break;
    }
    if (points.length > 1) chains.push(points);
  };

  // Open ends first: starting mid-way along a line would split it in two.
  for (const [point, edges] of adj) {
    if (edges.length === 1 && !used.has(edges[0].i)) walk(point);
  }
  for (const [point, edges] of adj) {
    if (edges.some((e) => !used.has(e.i))) walk(point);
  }

  if (used.size !== segs.length) {
    throw new Error(`chaining lost segments: ${used.size} of ${segs.length}`);
  }
  return chains;
}

// ── run ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

for (const [level, file] of [['country', 'countries'], ['province', 'provinces']]) {
  const { features, pairs } = build(level, file);
  const path = `${OUT}/borders-${level}.geojson`;
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }));
  const mb = (readFileSync(path).length / 1048576).toFixed(1);
  console.log(`  -> ${path}  ${mb} MB`);

  // Cross-check against the fill tool's own adjacency: the two are built from
  // the same shared vertices and answer the same question, so a pair in one and
  // not the other means a border that cannot fade, or a fill that floods across
  // a line still drawn. Either would be invisible until a child found it.
  const table = JSON.parse(readFileSync('public/data/neighbours.json', 'utf8'))[level] ?? {};
  const fromTable = new Set();
  for (const [id, others] of Object.entries(table)) {
    for (const other of others) fromTable.add(pairId(id, other));
  }
  const mine = new Set(pairs);
  const onlyHere = [...mine].filter((p) => !fromTable.has(p));
  const onlyThere = [...fromTable].filter((p) => !mine.has(p));
  console.log(`  adjacency: ${mine.size} pairs here, ${fromTable.size} in neighbours.json` +
              `, ${onlyHere.length} only here, ${onlyThere.length} only there`);
  if (onlyThere.length) {
    // Expected and harmless in one direction: neighbours.json counts two shared
    // VERTICES as adjacency, which includes regions that merely touch at a
    // point, and a point has no border to draw.
    console.log(`    (touch-only pairs, e.g. ${onlyThere.slice(0, 5).join(', ')})`);
  }
  if (onlyHere.length) {
    throw new Error(`${level}: ${onlyHere.length} borders have no entry in neighbours.json, ` +
                    `e.g. ${onlyHere.slice(0, 5).join(', ')} — the two builds disagree`);
  }

  // ⚠️ MAPLIBRE DOES NOT KEY FEATURE STATE ON THE STRING. A non-numeric feature
  // id is hashed to 32 bits with murmur3 (node_modules/maplibre-gl/src/data/
  // feature_position_map.ts, getNumericId) and the lookup returns EVERY feature
  // whose hash matches. Two border ids that collide would fade together, and
  // only in the tiles that happen to contain both — a bug that would surface as
  // one unrelated border in one country vanishing, months later, with nothing to
  // connect it to.
  //
  // At 10,769 province pairs the birthday odds of at least one collision are
  // about 1.3%, so this is cheap insurance rather than paranoia, and it is a
  // refresh of Natural Earth that would introduce one.
  const hashes = new Map();
  for (const id of mine) {
    const h = murmur3(String(id));
    const other = hashes.get(h);
    if (other !== undefined) {
      throw new Error(`${level}: border ids "${id}" and "${other}" hash to the same ` +
                      `murmur3 value (${h}). MapLibre would fade them together. ` +
                      `Rename one of the regions' ids, or change borderId()'s separator.`);
    }
    hashes.set(h, id);
  }
  console.log(`  ids: ${mine.size} pairs, ${hashes.size} distinct murmur3 hashes (no collisions)`);
}

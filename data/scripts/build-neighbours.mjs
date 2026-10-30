/**
 * Build the region adjacency table.
 *
 * Input:   data/out/{countries,provinces}.geojson   (build-regions.mjs)
 * Output:  public/data/neighbours.json
 *
 * Two features are neighbours when they share at least two boundary vertices —
 * two points being the minimum that can define a shared edge. Natural Earth's
 * admin-0 and admin-1 layers are topologically consistent (the province borders
 * are cut from the same lines as the country borders), so genuine neighbours
 * share exact coordinates.
 *
 * Why this exists rather than computing adjacency at runtime:
 *
 *   - The FILL tool needs exact adjacency. Testing bounding-box overlap instead
 *     over-connects badly: Chile's bbox covers half of South America, and the
 *     United Kingdom's touches France straight across the Channel, so a fill
 *     would hop over water.
 *   - The shared-border fade needs the same pairs, so it is built once here.
 *
 * Coordinates are rounded to 4 decimal places (~11 m) before hashing, which
 * absorbs floating-point noise without merging genuinely distinct points.
 *
 * Urban areas are deliberately excluded: they are isolated blobs with rural land
 * between them and have no meaningful adjacency.
 *
 * Usage: node data/scripts/build-neighbours.mjs    (from the repo root)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DP = 4;
const MIN_SHARED = 2;

function* eachRing(geom) {
  if (!geom) return;
  if (geom.type === 'Polygon') yield* geom.coordinates;
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) yield* poly;
}

const key = (x, y) => `${x.toFixed(DP)},${y.toFixed(DP)}`;

function buildLevel(name) {
  const src = JSON.parse(readFileSync(`data/out/${name}.geojson`, 'utf8'));

  // vertex -> set of feature ids touching it
  const vertexOwners = new Map();
  for (const f of src.features) {
    const id = f.id ?? f.properties?.id;
    if (!id) continue;
    for (const ring of eachRing(f.geometry)) {
      for (const [x, y] of ring) {
        const k = key(x, y);
        let owners = vertexOwners.get(k);
        if (!owners) vertexOwners.set(k, (owners = new Set()));
        owners.add(id);
      }
    }
  }

  // Count shared vertices per unordered pair.
  const shared = new Map();
  for (const owners of vertexOwners.values()) {
    if (owners.size < 2) continue;
    const ids = [...owners].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair = `${ids[i]}\u0000${ids[j]}`;
        shared.set(pair, (shared.get(pair) ?? 0) + 1);
      }
    }
  }

  const neighbours = {};
  const add = (a, b) => {
    (neighbours[a] ??= []).push(b);
  };
  let pairs = 0;
  for (const [pair, count] of shared) {
    if (count < MIN_SHARED) continue;
    const [a, b] = pair.split('\u0000');
    add(a, b);
    add(b, a);
    pairs++;
  }
  for (const list of Object.values(neighbours)) list.sort();

  const degrees = Object.values(neighbours).map((l) => l.length);
  const isolated = src.features.length - Object.keys(neighbours).length;
  console.log(
    `  ${name}: ${pairs} adjacent pairs, ` +
    `median degree ${median(degrees)}, max ${Math.max(0, ...degrees)}, ` +
    `${isolated} with no land neighbour (islands)`,
  );
  return neighbours;
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * Which continent each country belongs to, so the fill tool can stop at the
 * edge of a landmass people think of as one place.
 *
 * Without it, flood fill is geographically correct but useless: tapping Chad
 * fills Africa AND Eurasia, because they are land-connected through Sinai —
 * measured at 112 countries from one tap. Nobody means that by "fill".
 */
function buildContinents() {
  const src = JSON.parse(readFileSync('data/out/countries.geojson', 'utf8'));
  const out = {};
  for (const f of src.features) {
    const id = f.id ?? f.properties?.id;
    const continent = f.properties?.continent;
    if (id && continent) out[id] = continent;
  }
  const counts = {};
  for (const c of Object.values(out)) counts[c] = (counts[c] ?? 0) + 1;
  console.log(`  continents: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  return out;
}

console.log('neighbours');
const out = {
  country: buildLevel('countries'),
  province: buildLevel('provinces'),
};
console.log('grouping');
out.continent = buildContinents();

mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/neighbours.json', JSON.stringify(out));
console.log(`  -> public/data/neighbours.json  ` +
            `${(readFileSync('public/data/neighbours.json').length / 1024).toFixed(0)} KB`);

// Sanity check against known geography. If these fail, the vertex-sharing
// assumption is wrong and the fill tool would behave strangely.
const CHECKS = [
  ['FRA', ['BEL', 'DEU', 'CHE', 'ITA', 'ESP', 'LUX', 'AND', 'MCO']],
  ['PRT', ['ESP']],
  ['CAN', ['USA']],
];
let failed = 0;
for (const [id, expected] of CHECKS) {
  const got = new Set(out.country[id] ?? []);
  const missing = expected.filter((e) => !got.has(e));
  if (missing.length) {
    console.log(`  CHECK FAILED ${id}: missing ${missing.join(', ')} (got ${[...got].join(', ')})`);
    failed++;
  } else {
    console.log(`  check ${id}: ok (${got.size} neighbours)`);
  }
}
// The UK must NOT neighbour France: they are separated by the Channel, and a
// bounding-box test would wrongly join them.
if ((out.country.GBR ?? []).includes('FRA')) {
  console.log('  CHECK FAILED: GBR is adjacent to FRA across the Channel');
  failed++;
} else {
  console.log('  check GBR-FRA: correctly not adjacent');
}
if (failed) process.exitCode = 1;

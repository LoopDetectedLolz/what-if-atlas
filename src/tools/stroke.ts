/**
 * Turning a hand-drawn path into a clipped geographic polygon.
 *
 * Pure geometry: no MapLibre, no DOM, so it can be exercised from node. The pen
 * controller in pen.ts owns the pointer handling and calls into this.
 *
 * ── Why everything happens in "world units" ────────────────────────────────
 *
 * Not in longitude and latitude, where a degree is 111 km across at the equator
 * and nothing near the poles, so a stroke of constant width would taper as it
 * ran north. Not in screen pixels either, because a finger may pan the map
 * mid-stroke and the screen moves under the pen.
 *
 * So: Web Mercator, scaled up to whole numbers. One world unit is one screen
 * pixel at zoom 11, which keeps every coordinate in a comfortable range —
 * `polygon-clipping` works on floats and gets fragile when fed the 1e-6 values
 * that raw Mercator produces for a pen's width.
 */

// ⚠️ DEFAULT import, not a namespace one. polygon-clipping 0.15 ships
// `export { index as default }` and nothing else, so `import * as` yields a
// module object whose functions are all one level down — and the symptom is
// `clipping.union is not a function` only at runtime, since the hand-written
// .d.ts in the package declares named exports that do not exist.
import clipping from 'polygon-clipping';

/** Side of the world in world units: one unit is a screen pixel at zoom 11. */
export const WORLD = 512 * 2 ** 11;

export type Position = [number, number];
export type Ring = Position[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

/** A sampled point of a drawn path: where the nib was, and how wide. */
export interface PenPoint {
  x: number;
  y: number;
  /** Half-width at this point, in world units. Varies with pen pressure. */
  r: number;
}

// ── projection ──────────────────────────────────────────────────────────────
//
// The same Web Mercator MapLibre uses (src/geo/mercator_coordinate.ts), written
// out here so this module stays free of it. Round-tripped in the tests below.

export function toWorld(lng: number, lat: number): Position {
  const x = (180 + lng) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return [x * WORLD, y * WORLD];
}

export function fromWorld(x: number, y: number): Position {
  const lng = (x / WORLD) * 360 - 180;
  const y2 = (y / WORLD) * 360;
  const lat = (360 / Math.PI) * Math.atan(Math.exp(((180 - y2) * Math.PI) / 180)) - 90;
  return [lng, lat];
}

// ── simplification ──────────────────────────────────────────────────────────

/** Perpendicular distance from p to the segment ab. */
function distToSegment(p: PenPoint, a: PenPoint, b: PenPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Ramer–Douglas–Peucker, iterative so a long path cannot blow the stack. */
function rdp(points: PenPoint[], tolerance: number): PenPoint[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distToSegment(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at !== -1 && worst > tolerance) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Thin a raw pen path down to something worth building a polygon from.
 *
 * ⚠️ THE CAP IS NOT A NICETY. Building the outline is a boolean union whose
 * cost climbs faster than the point count: measured here, 100 points take 12 ms
 * and 400 take 93 ms, and an iPad is several times slower than the machine that
 * measured that. A Pencil samples at up to 240 Hz, so a two-second stroke
 * arrives with hundreds of points, most of them a fraction of a pixel apart.
 *
 * Three passes, cheapest first: drop points too close together to see, run
 * RDP, and if the result is still over `max`, raise the tolerance and go again
 * so the worst case is bounded rather than merely unlikely.
 *
 * A point whose width differs sharply from its neighbour's is kept regardless:
 * dropping it would flatten exactly the pressure change the pen was expressing.
 */
export function simplifyPath(points: PenPoint[], tolerance: number, max: number): PenPoint[] {
  if (points.length < 3) return points.slice();

  const spaced: PenPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = spaced[spaced.length - 1];
    const moved = Math.hypot(points[i].x - last.x, points[i].y - last.y) >= tolerance;
    const widthChanged = Math.abs(points[i].r - last.r) > last.r * 0.2;
    if (moved || widthChanged) spaced.push(points[i]);
  }
  if (spaced[spaced.length - 1] !== points[points.length - 1]) {
    spaced.push(points[points.length - 1]);
  }

  let out = rdp(spaced, tolerance);
  let t = tolerance;
  while (out.length > max && t < tolerance * 64) {
    t *= 2;
    out = rdp(spaced, t);
  }
  return out;
}

/** The same thinning for a finished ring, to keep the saved file small. */
function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length < 5) return ring;
  const asPoints = ring.map(([x, y]) => ({ x, y, r: 0 }));
  const thinned = rdp(asPoints, tolerance).map(({ x, y }) => [x, y] as Position);
  // A ring needs four distinct corners to still be an area.
  if (thinned.length < 4) return ring;
  thinned[thinned.length - 1] = thinned[0];
  return thinned;
}

export function simplifyShape(shape: MultiPolygon, tolerance: number): MultiPolygon {
  return shape
    .map((poly) => poly.map((ring) => simplifyRing(ring, tolerance)).filter((r) => r.length >= 4))
    .filter((poly) => poly.length > 0);
}

// ── building the outline ────────────────────────────────────────────────────

/**
 * Segments of a circle of radius `r`, few enough to be cheap and many enough
 * that the flat edges are invisible. A pen nib at the width this draws is a few
 * pixels across, so eight sides is usually already more than the screen shows.
 */
function circleSegments(r: number, tolerance: number): number {
  if (r <= tolerance) return 4;
  const n = Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / r)));
  return Math.max(6, Math.min(16, n));
}

function circle(x: number, y: number, r: number, tolerance: number): Ring {
  const n = circleSegments(r, tolerance);
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  ring.push(ring[0]);
  return ring;
}

/** The quadrilateral swept between two points, widening with them. */
function sweep(a: PenPoint, b: PenPoint): Ring | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const ring: Ring = [
    [a.x + nx * a.r, a.y + ny * a.r],
    [b.x + nx * b.r, b.y + ny * b.r],
    [b.x - nx * b.r, b.y - ny * b.r],
    [a.x - nx * a.r, a.y - ny * a.r],
  ];
  ring.push(ring[0]);
  return ring;
}

/**
 * The area a nib of varying width covers along a path.
 *
 * A disc at every sample plus the quad swept between consecutive samples, all
 * unioned. That gives round caps and round joins for nothing — the disc at a
 * corner IS the join — and it is the one construction that stays correct when
 * the path doubles back on itself, which a hand-drawn line does constantly.
 */
export function outline(points: PenPoint[], tolerance: number): MultiPolygon {
  if (!points.length) return [];
  if (points.length === 1) return [[circle(points[0].x, points[0].y, points[0].r, tolerance)]];

  const parts: Polygon[] = [];
  for (const p of points) parts.push([circle(p.x, p.y, p.r, tolerance)]);
  for (let i = 1; i < points.length; i++) {
    const ring = sweep(points[i - 1], points[i]);
    if (ring) parts.push([ring]);
  }
  return clipping.union(parts[0], ...parts.slice(1)) as MultiPolygon;
}

/**
 * The part of `shape` inside `clip` — the whole point of the pen tool.
 *
 * Returns a MULTI-polygon because clipping a hand-drawn mark to a region
 * routinely breaks it into pieces: the stroke leaves the country and comes
 * back, or crosses a lake drawn as a hole.
 */
export function clipTo(shape: MultiPolygon, clip: MultiPolygon): MultiPolygon {
  if (!shape.length || !clip.length) return [];
  return clipping.intersection(shape, clip) as MultiPolygon;
}

/** Total area in square world units, for rejecting a stroke that clipped to nothing. */
export function area(shape: MultiPolygon): number {
  let total = 0;
  for (const poly of shape) {
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      let sum = 0;
      for (let i = 1; i < ring.length; i++) {
        sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
      }
      // Ring 0 is the outer boundary, the rest are holes.
      total += (r === 0 ? 1 : -1) * Math.abs(sum / 2);
    }
  }
  return total;
}

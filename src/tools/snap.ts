/**
 * Resolving a point on screen to the region it should snap to.
 *
 * The rule: take the FINEST enabled level that actually has a region under the
 * point, falling back to coarser levels. That fallback is not a nicety —
 * Natural Earth's urban areas are isolated blobs with rural land between them,
 * so at city zoom most of the map has no city under the finger. Without the
 * fallback those areas would simply be unpaintable.
 */

// Point is imported as a VALUE, not just a type. queryRenderedFeatures checks
// for a real Point instance: handed a plain {x, y} object it silently ignores
// the point filter and returns EVERY feature in the layer, so a sweep would
// paint whatever happened to come back first regardless of where the pen was.
import { Point, type Map as MlMap, type MapGeoJSONFeature } from 'maplibre-gl';
import {
  LEVEL_DEFS,
  type Level,
  type Region,
  autoLevel,
  resolutionOrder,
  snapOutlineLayerFor,
  NO_MATCH,
} from '../map/regions';

/** How far from the tap point to look, in CSS pixels. A fingertip is blunt. */
const TOUCH_SLOP = 6;

export interface SnapResult extends Region {
  /** The level that was asked for, before any fallback. */
  requested: Level;
  /** True when the result came from a coarser level than requested. */
  fellBack: boolean;
}

function toRegion(level: Level, f: MapGeoJSONFeature): Region | null {
  const p = f.properties ?? {};
  const id = typeof p.id === 'string' ? p.id : null;
  if (!id) return null;
  return {
    level,
    id,
    name: typeof p.name === 'string' && p.name ? p.name : id,
    country: typeof p.country === 'string' ? p.country : null,
  };
}

/**
 * The region under `point` at the given snap level, with fallback.
 *
 * `point` is in CSS pixels relative to the map canvas. Queried as a small box
 * rather than a single pixel so a fingertip on a thin coastal province still
 * hits something.
 */
export function snapAt(map: MlMap, point: Point, level: Level): SnapResult | null {
  const box: [[number, number], [number, number]] = [
    [point.x - TOUCH_SLOP, point.y - TOUCH_SLOP],
    [point.x + TOUCH_SLOP, point.y + TOUCH_SLOP],
  ];

  for (const candidate of resolutionOrder(level)) {
    const layer = LEVEL_DEFS[candidate].fillLayer;
    if (!map.getLayer(layer)) continue;

    // Try the exact point first: a box query can catch a neighbour across the
    // border, and painting the wrong side of a border is the one thing this
    // whole model exists to prevent.
    let hits = map.queryRenderedFeatures(point, { layers: [layer] });
    if (hits.length === 0) hits = map.queryRenderedFeatures(box, { layers: [layer] });
    if (hits.length === 0) continue;

    const region = toRegion(candidate, hits[0]);
    if (region) {
      return { ...region, requested: level, fellBack: candidate !== level };
    }
  }
  return null;
}

/**
 * Every region of `level` whose geometry the segment from `a` to `b` passes
 * over. Used by the sweep brush: dragging quickly produces widely spaced
 * pointer samples, and sampling only at those points skips narrow countries
 * entirely — drag across Europe fast and Luxembourg is missed.
 */
export function snapAlong(
  map: MlMap,
  a: Point,
  b: Point,
  level: Level,
  stepPx = 8,
): SnapResult[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / stepPx));

  const out: SnapResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = new Point(a.x + dx * t, a.y + dy * t);
    const hit = snapAt(map, p, level);
    if (!hit) continue;
    const key = `${hit.level}:${hit.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/** The level the UI should use: the pinned one, or whatever zoom implies. */
export function effectiveLevel(zoom: number, pinned: Level | null): Level {
  return pinned ?? autoLevel(zoom);
}

/** Show (or clear) the outline that previews the snap target. */
export function showSnapOutline(map: MlMap, region: Region | null): void {
  for (const level of ['country', 'province', 'urban'] as Level[]) {
    const layer = snapOutlineLayerFor(level);
    if (!map.getLayer(layer)) continue;
    const id = region && region.level === level ? region.id : null;
    map.setFilter(layer, ['==', ['get', 'id'], id ?? NO_MATCH]);
  }
}

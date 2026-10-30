/**
 * Occupation hatching: diagonal stripes in the occupier's colour, laid over
 * whatever the region is already painted.
 *
 * THE STRIPES SIT ON ONE WORLD GRID. Two hatched neighbours must line up across
 * their shared border so the result reads as a single mask over the map, not as
 * per-country patterns at different phases.
 *
 * How that is achieved: MapLibre positions a `fill-pattern` in TILE space, not
 * per feature, so every polygon in a tile samples the same grid and adjacent
 * regions are automatically continuous. For the grid to survive tile edges too,
 * the pattern must tile seamlessly AND its size must divide the 512 px tile
 * size — hence a 32 px pattern with a 16 px stripe period. Both divide 512, so
 * the grid is continuous across the whole world at a given zoom.
 *
 * ⚠️ Why not feature-state, as painting uses? The style spec gives
 * `fill-pattern` the parameters ["zoom", "feature"] — `feature-state` is NOT
 * among them, so `['feature-state', ...]` cannot drive it. It does accept
 * property expressions, so the pattern is selected by `['match', ['get','id'],
 * …]`, rebuilt whenever the hatch set changes. That is a user action, not a
 * per-frame cost.
 *
 * ⚠️ Why not stripe geometry clipped to each region? It would give crisp vector
 * stripes, but clipping needs each region's FULL polygon, and
 * queryRenderedFeatures only ever returns tile-clipped pieces of what is on
 * screen. The hatch would then stop at the viewport edge and have to be
 * recomputed on every pan. A pattern uses the region's own geometry at every
 * zoom for free, which matters more on an iPad than vector crispness.
 */

import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl';
import { LEVEL_DEFS, LEVELS, type Level } from '../map/regions';
import type { ScenarioStore } from '../state/scenario';

/** Pattern tile size in CSS px. 32 divides the 512 px tile size. */
const TILE = 32;
/** Stripe period in CSS px. 16 divides 32, so the pattern wraps seamlessly. */
const PERIOD = 16;
/**
 * Stripe thickness in CSS px.
 *
 * A 45-degree line of width w covers w*sqrt(2) along a horizontal cut, so
 * coverage is thickness*sqrt(2)/PERIOD, not thickness/PERIOD. At 4.0 that is
 * about 35% — enough to read as hatching while leaving the colour underneath
 * clearly visible. 5.5 looked like half-and-half and swamped the base fill.
 */
const THICKNESS = 4;
/** Rendered at 2x so the stripes stay crisp on a retina iPad. */
const SCALE = 2;

/** Image id for a colour, e.g. '#23457A' -> 'hatch-23457a'. */
const imageId = (hex: string): string => `hatch-${hex.replace('#', '').toLowerCase()}`;

/** A pattern that draws nothing, for regions with no hatch. */
export const HATCH_NONE = 'hatch-none';

const registered = new Set<string>();

/**
 * Draw one seamless 45-degree stripe tile.
 *
 * Lines run from (o, 0) to (o + size, size). Stepping `o` by the period and
 * covering o from -size to 2*size guarantees every pixel of the tile is reached
 * by the same infinite diagonal family, so opposite edges match exactly and the
 * tile can repeat without a seam.
 */
function stripeTile(hex: string): ImageData {
  const size = TILE * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.strokeStyle = hex;
  ctx.lineWidth = THICKNESS * SCALE;
  ctx.lineCap = 'butt';
  for (let o = -size; o <= size * 2; o += PERIOD * SCALE) {
    ctx.beginPath();
    ctx.moveTo(o, 0);
    ctx.lineTo(o + size, size);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

/** Register the image for a colour, once. */
export function ensureHatchImage(map: MlMap, hex: string): string {
  const id = imageId(hex);
  if (registered.has(id) && map.hasImage(id)) return id;
  if (!map.hasImage(id)) {
    map.addImage(id, stripeTile(hex), { pixelRatio: SCALE });
  }
  registered.add(id);
  return id;
}

/** Register the empty pattern used as the match fallback. */
export function ensureHatchNone(map: MlMap): void {
  if (map.hasImage(HATCH_NONE)) return;
  const size = TILE * SCALE;
  // One fully transparent tile. A `match` must have a fallback, and an
  // unresolvable image id logs a warning on every tile.
  map.addImage(HATCH_NONE, new ImageData(size, size), { pixelRatio: SCALE });
}

/** Images are per-Map, so a style reload invalidates the cache. */
export function resetHatchImages(): void {
  registered.clear();
}

/** Layer id carrying the hatching for a level. */
export function hatchLayerFor(level: Level): string {
  return `hatch-${level}`;
}

/**
 * Push the scenario's hatching into the three hatch layers.
 *
 * Builds one `match` per level mapping region id to its stripe image. With no
 * hatching the layer is hidden outright, so the common case costs nothing.
 */
export function syncHatch(map: MlMap, store: ScenarioStore): void {
  ensureHatchNone(map);

  for (const level of LEVELS) {
    const layer = hatchLayerFor(level);
    if (!map.getLayer(layer)) continue;

    const entries = Object.entries(store.current.hatch[level]);
    if (entries.length === 0) {
      map.setLayoutProperty(layer, 'visibility', 'none');
      continue;
    }

    // ['match', ['get','id'], 'FRA', 'hatch-23457a', ..., 'hatch-none']
    //
    // Built as a plain array and cast: the style-spec types model `match` as a
    // fixed-arity tuple, which cannot express a list whose length depends on how
    // many regions are hatched.
    const match: unknown[] = ['match', ['get', 'id']];
    for (const [id, hex] of entries) {
      match.push(id, ensureHatchImage(map, hex));
    }
    match.push(HATCH_NONE);
    const pattern = match as unknown as ExpressionSpecification;

    map.setLayoutProperty(layer, 'visibility', 'visible');
    // fill-pattern lives in paint_fill in the style spec, so it is a PAINT
    // property — `visibility` above is the layout one.
    map.setPaintProperty(layer, 'fill-pattern', pattern);
    void LEVEL_DEFS[level];
  }
}

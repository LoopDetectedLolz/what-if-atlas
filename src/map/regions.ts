/**
 * The snap-level model.
 *
 * The editor paints REGIONS, not pixels. A stroke sweeping across the map fills
 * whole regions, so colour can never cross a border — "start colouring within
 * the lines and don't let it go out" is a property of the data model, not
 * something enforced afterwards.
 *
 * Which regions depends on zoom. Zoomed out the smallest paintable unit is a
 * whole country; zoom in and it becomes a province, then an urban area. The
 * active level moves automatically with zoom, and can be pinned by hand.
 *
 * Levels are a STACK, not alternatives. Painting is layered: a country colour
 * renders beneath the provinces inside it, so colouring a country can never
 * destroy finer work already done within it. See src/state/scenario.ts.
 */

export type Level = 'country' | 'province' | 'urban';

/** Coarse to fine. Order matters: it is the render order and the fallback order. */
export const LEVELS: readonly Level[] = ['country', 'province', 'urban'] as const;

export interface LevelDef {
  level: Level;
  /** Style source id. */
  source: string;
  /** Layer name inside the PMTiles archive (set by `tippecanoe -l`). */
  sourceLayer: string;
  /**
   * PMTiles archive, relative to the app base.
   *
   * ⚠️ THE `.gz` SUFFIX IS A LIE, AND IT IS LOAD-BEARING. These files are
   * plain, UNCOMPRESSED PMTiles archives. The extension is there only because
   * GitHub Pages gzips any response whose content type it does not recognise
   * — `.pmtiles` is served as `application/octet-stream` and compressed — and
   * then answers byte-range requests by slicing the COMPRESSED copy. PMTiles
   * reads garbage past the first block and no tile ever decodes.
   *
   * `application/gzip` is not on that compression list, so ranges come back
   * from the real bytes. Do not gunzip these files; see PLAN.md section 8.
   */
  archive: string;
  /** Fill layer id — also what queryRenderedFeatures targets for snapping. */
  fillLayer: string;
  /** Zoom at or above which this becomes the automatic snap level. */
  activeFrom: number;
  /** Human label for the toolbar. */
  label: string;
  /** Plural, for messages like "3 provinces". */
  labelPlural: string;
}

export const LEVEL_DEFS: Record<Level, LevelDef> = {
  country: {
    level: 'country',
    source: 'countries',
    sourceLayer: 'countries',
    archive: 'tiles/countries.pmtiles.gz',
    fillLayer: 'country-fill',
    activeFrom: 0,
    label: 'Country',
    labelPlural: 'countries',
  },
  province: {
    level: 'province',
    source: 'provinces',
    sourceLayer: 'provinces',
    archive: 'tiles/provinces.pmtiles.gz',
    fillLayer: 'province-fill',
    activeFrom: 4.5,
    label: 'Province',
    labelPlural: 'provinces',
  },
  urban: {
    level: 'urban',
    source: 'urban',
    sourceLayer: 'urban',
    archive: 'tiles/urban.pmtiles.gz',
    fillLayer: 'urban-fill',
    activeFrom: 8,
    label: 'City',
    labelPlural: 'cities',
  },
};

// ── borders ─────────────────────────────────────────────────────────────────

/**
 * The levels whose borders are drawn as features of their own, and so can fade.
 *
 * ⚠️ A BORDER CANNOT FADE WHILE IT IS PART OF A POLYGON. MapLibre's opacity is
 * per feature, and a country polygon's outline is one feature carrying its coast
 * and every border it has; fading it takes the coastline with it. So the
 * outlines are cut apart at build time into shared borders and coastline — see
 * data/scripts/build-borders.mjs — and the region sources now draw fills only.
 *
 * Urban areas are not here: they are isolated blobs with rural land between
 * them, so no two of them share a border to fade.
 */
export const FADE_LEVELS = ['country', 'province'] as const;
export type FadeLevel = (typeof FADE_LEVELS)[number];

export interface BorderDef {
  source: string;
  sourceLayer: string;
  /**
   * PMTiles archive, relative to the app base. The `.gz` is a serving
   * workaround and the file is NOT gzipped — see LevelDef.archive above and
   * PLAN.md section 8.
   */
  archive: string;
  /** Style layer drawing the borders that can fade. */
  layer: string;
}

export const BORDER_DEFS: Record<FadeLevel, BorderDef> = {
  country: {
    source: 'borders',
    sourceLayer: 'borders',
    archive: 'tiles/borders.pmtiles.gz',
    layer: 'country-border',
  },
  province: {
    source: 'subborders',
    sourceLayer: 'subborders',
    archive: 'tiles/subborders.pmtiles.gz',
    layer: 'province-border',
  },
};

/**
 * The coastline, which never fades. It lives in the country border archive
 * alongside the country borders, told apart by the `kind` property; the
 * province archive has no coastline of its own because it would be the same
 * line, drawn underneath this one and never seen.
 */
export const COAST_LAYER = 'coast-line';

/**
 * The id a border feature carries: the two region ids, sorted.
 *
 * ⚠️ MUST MATCH `pairId` in data/scripts/build-borders.mjs. One border is
 * usually several disjoint chains — broken by a lake, a tripoint, an island —
 * and every chain carries this same id, so one setFeatureState call fades the
 * whole border at once. A disagreement about the order silently fades nothing.
 */
export function borderId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The finest level whose activation zoom has been reached. */
export function autoLevel(zoom: number): Level {
  let chosen: Level = 'country';
  for (const l of LEVELS) {
    if (zoom >= LEVEL_DEFS[l].activeFrom) chosen = l;
  }
  return chosen;
}

/**
 * Levels to try when resolving a point, finest first.
 *
 * ⚠️ Urban areas do NOT tile the plane — they are isolated blobs with rural land
 * between them. So resolving at the urban level must fall back to province and
 * then country, or there would be large patches of the map that simply cannot
 * be painted. Coarser levels always cover the ground.
 */
export function resolutionOrder(active: Level): Level[] {
  const i = LEVELS.indexOf(active);
  return LEVELS.slice(0, i + 1).reverse();
}

/** A region the user can paint. */
export interface Region {
  level: Level;
  id: string;
  name: string;
  /** Parent country's ADM0_A3, where the layer carries one. */
  country: string | null;
}

/**
 * The free-hand pen's style ids.
 *
 * `strokes` holds the marks already drawn and clipped; `stroke-preview` holds
 * the one under the nib. They are separate sources because the preview is
 * rewritten many times a second and the committed strokes almost never are.
 */
export const STROKE_SOURCE = 'strokes';
export const STROKE_LAYER = 'stroke-fill';
export const PREVIEW_SOURCE = 'stroke-preview';
export const PREVIEW_LAYER = 'stroke-preview-line';

/** A region id that cannot exist, so an outline filter matches nothing. */
export const NO_MATCH = '\u0000none';

/** Id of the outline layer that previews the snap target for a level. */
export function snapOutlineLayerFor(level: Level): string {
  return `snap-outline-${level}`;
}

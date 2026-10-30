import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';
import { LEVEL_DEFS, LEVELS, NO_MATCH, snapOutlineLayerFor } from './regions';
import { LABEL_FACES } from './fonts.generated';
// No cycle: hatch.ts does not import the style.
import { HATCH_NONE } from '../tools/hatch';

/**
 * The atlas style: white land, soft blue ocean, three stacked paintable layers.
 *
 * LAYER ORDER IS THE PAINT MODEL. Country fills sit beneath province fills
 * beneath city fills, so colouring a country can never destroy the provinces
 * already coloured inside it — the coarse colour simply shows through wherever
 * no finer colour has been set. Nothing special-cases this; it is just the
 * order the layers are declared in.
 *
 * Colour comes from `feature-state`, not from the style, so painting a region
 * is one setFeatureState call and never re-parses the style or re-uploads tile
 * geometry.
 *
 * LABELS NEED NO GLYPH PIPELINE. MapLibre v6 takes font FILES through the
 * style's `font-faces` property and rasterizes glyphs in the browser with
 * TinySDF, so the self-hosted woff2 the UI already uses draws the map as well.
 * There is no glyph server, no PBF ranges and no API key. See §9 of PLAN.md,
 * which previously planned a build-time pipeline for exactly this.
 */

export const DEM_MAPTERHORN = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const DEM_MAXZOOM = 13;

export const ATTRIBUTION_NE = 'Made with <a href="https://www.naturalearthdata.com/">Natural Earth</a>';
export const ATTRIBUTION_DEM = '© <a href="https://mapterhorn.com/attribution">Mapterhorn</a>';

export const OCEAN = '#B9D7EB';
export const LAND = '#FFFFFF';
/** Fully transparent, for levels that have no colour set. */
const NONE = 'rgba(0,0,0,0)';

/**
 * The one font name the symbol layers ask for. It is a key into `font-faces`
 * below, not a system font: MapLibre looks the name up there, downloads the
 * file and rasterizes from it.
 */
const LABEL_FONT = 'Instrument Sans';

/** A halo wide enough to keep a name readable over any of the 24 paint colours. */
const HALO = 'rgba(255,255,255,0.92)';

/**
 * Label layers, topmost last.
 *
 * ⚠️ THE ORDER IS THE COLLISION PRIORITY, AND IT IS BACK TO FRONT. MapLibre
 * places symbols starting from the TOP layer (`PauseablePlacement` walks the
 * layer order in reverse), so a label in a later layer wins the space. Country
 * names are therefore declared last: in a crowded view of Europe at zoom 4,
 * "Belgium" should survive and "Charleroi" should be the one to go.
 *
 * Within a layer, `symbol-sort-key` decides, and it is Natural Earth's own
 * label rank — see data/scripts/build-labels.mjs.
 */
export const LABEL_LAYERS = ['label-province', 'place-dot', 'label-place', 'label-country'] as const;

export interface StyleOptions {
  base: string;
  hillshade?: boolean;
  /** Draw the map's place names. Toggleable at runtime; see setLabelsVisible. */
  labels?: boolean;
}

export function atlasStyle({ base, hillshade = false, labels = true }: StyleOptions): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    // The three paintable region layers.
    ...Object.fromEntries(
      LEVELS.map((l) => {
        const d = LEVEL_DEFS[l];
        return [d.source, {
          type: 'vector' as const,
          url: `pmtiles://${base}${d.archive}`,
          // ⚠️ REQUIRED. The MVT spec only allows numeric feature ids, so
          // tippecanoe drops our string keys ("Can't represent non-numeric
          // feature ID") and feature-state would have nothing to key on.
          // promoteId lifts the `id` property back into the feature id.
          promoteId: { [d.sourceLayer]: 'id' },
          attribution: ATTRIBUTION_NE,
        }];
      }),
    ),
    // Free-hand strokes, clipped to their region. Written by the app (E4).
    strokes: { type: 'geojson', data: emptyFC() },

    // Label anchors: one point per country, province and populated place, at
    // Natural Earth's own cartographer-chosen label coordinates.
    //
    // ⚠️ LABELS ARE NOT DRAWN FROM THE PAINTABLE POLYGON LAYERS, deliberately.
    // MapLibre labels a polygon once PER TILE, so a country spanning several
    // tiles would be named several times over — "Russia" repeated across
    // Siberia, with nothing to dedupe it because the copies do not overlap.
    // See data/scripts/build-labels.mjs for the full reasoning.
    labels: { type: 'geojson', data: `${base}data/labels.json` },
  };

  const layers: LayerSpecification[] = [
    { id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } },

    // ── the paint stack, coarse to fine ──────────────────────────────────
    {
      id: LEVEL_DEFS.country.fillLayer,
      type: 'fill',
      source: LEVEL_DEFS.country.source,
      'source-layer': LEVEL_DEFS.country.sourceLayer,
      paint: {
        // Every country starts white — the base of the whole stack.
        'fill-color': ['coalesce', ['feature-state', 'color'], LAND],
      },
    },
    {
      id: LEVEL_DEFS.province.fillLayer,
      type: 'fill',
      source: LEVEL_DEFS.province.source,
      'source-layer': LEVEL_DEFS.province.sourceLayer,
      paint: {
        // Transparent unless painted, so the country colour shows through.
        'fill-color': ['coalesce', ['feature-state', 'color'], NONE],
      },
    },
    {
      id: LEVEL_DEFS.urban.fillLayer,
      type: 'fill',
      source: LEVEL_DEFS.urban.source,
      'source-layer': LEVEL_DEFS.urban.sourceLayer,
      paint: {
        'fill-color': ['coalesce', ['feature-state', 'color'], NONE],
      },
    },

    // Free-hand strokes sit above the region fills.
    {
      id: 'stroke-fill',
      type: 'fill',
      source: 'strokes',
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#F5A524'],
        'fill-opacity': 0.95,
      },
    },

  ];

  // Occupation hatching: one layer per level, above every paint fill because an
  // occupied country is hatched whether or not its provinces are coloured.
  // Coarse first, so finer hatching draws on top.
  //
  // The pattern is set by the app (src/tools/hatch.ts) as a match on the region
  // id. Declared hidden with no pattern: an undefined fill-pattern makes
  // MapLibre fall back to fill-color, which would paint solid blocks.
  for (const l of LEVELS) {
    const d = LEVEL_DEFS[l];
    layers.push({
      id: `hatch-${l}`,
      type: 'fill',
      source: d.source,
      'source-layer': d.sourceLayer,
      layout: { visibility: 'none' },
      paint: {
        'fill-pattern': HATCH_NONE,
        'fill-opacity': 0.92,
      },
    } as LayerSpecification);
  }

  if (hillshade) {
    sources.dem = {
      type: 'raster-dem',
      tiles: [DEM_MAPTERHORN],
      tileSize: 512,
      maxzoom: DEM_MAXZOOM,
      encoding: 'terrarium',
      attribution: ATTRIBUTION_DEM,
    };
    // Above the fills, as a physical atlas shades over political colour.
    layers.push({
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: {
        // There is no hillshade-opacity, so the fade rides on exaggeration.
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0, 5, 0.12, 8, 0.28],
        'hillshade-method': 'igor',
        'hillshade-shadow-color': '#5E7C90',
        'hillshade-highlight-color': '#FFFFFF',
      },
    } as LayerSpecification);
  }

  // ── boundaries, fine to coarse so country lines draw on top ────────────
  layers.push(
    {
      id: LEVEL_DEFS.urban.lineLayer,
      type: 'line',
      source: LEVEL_DEFS.urban.source,
      'source-layer': LEVEL_DEFS.urban.sourceLayer,
      paint: {
        'line-color': '#8C7B5E',
        'line-width': 0.8,
        // Fades in just before the city level becomes paintable.
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 0, 8, 0.8],
      },
    },
    {
      id: LEVEL_DEFS.province.lineLayer,
      type: 'line',
      source: LEVEL_DEFS.province.source,
      'source-layer': LEVEL_DEFS.province.sourceLayer,
      paint: {
        'line-color': '#9FB4C2',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 9, 1.0],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 3.5, 0, 5, 0.9],
      },
    },
    {
      id: LEVEL_DEFS.country.lineLayer,
      type: 'line',
      source: LEVEL_DEFS.country.source,
      'source-layer': LEVEL_DEFS.country.sourceLayer,
      paint: {
        'line-color': '#5E7C90',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 4, 1.1, 8, 1.6],
        // Per-feature, so the shared-border fade can drive it later.
        'line-opacity': ['coalesce', ['feature-state', 'borderOpacity'], 1],
      },
    },
  );

  // The region under the pointer, outlined so the snap target is obvious before
  // you commit to painting it. One layer per level, because the target can be a
  // country, a province or a city depending on zoom; all three are filtered to
  // match nothing until the snap engine sets an id.
  for (const l of LEVELS) {
    const d = LEVEL_DEFS[l];
    layers.push({
      id: snapOutlineLayerFor(l),
      type: 'line',
      source: d.source,
      'source-layer': d.sourceLayer,
      filter: ['==', ['get', 'id'], NO_MATCH],
      paint: {
        'line-color': '#2FA8E0',
        'line-width': 2.5,
        'line-opacity': 0.95,
      },
    } as LayerSpecification);
  }

  // ── place names, above everything ──────────────────────────────────────
  //
  // Declared last so a name is never hidden under a paint fill, a hatch or the
  // snap outline. See LABEL_LAYERS for why the order within this block is the
  // collision priority, back to front.
  const visibility = labels ? 'visible' : 'none';
  /** Natural Earth's label rank, lower being more important. */
  const rank: ExpressionSpecification = ['to-number', ['coalesce', ['get', 'rank'], 9]];

  /**
   * Size a label by that rank, so importance is visible and not just a
   * placement order you cannot see.
   *
   * Without this, Vatican City and Andorra draw at exactly the size Poland
   * does: they sit in empty space, so they win the collision outright and the
   * map reads as though they mattered equally. `best`/`worst` are the ranks the
   * two sizes belong to, since each level ranks on a different NE field.
   *
   * ⚠️ These go INSIDE the stops of a `['zoom']` interpolation, never outside
   * one. A zoom expression has to be the outermost expression of a property, so
   * multiplying one by a per-feature factor is rejected outright.
   */
  const byRank = (big: number, small: number, best: number, worst: number): ExpressionSpecification =>
    ['interpolate', ['linear'], rank, best, big, worst, small];

  /** A dot sized like its name, with a capital drawn a little larger. */
  const dotRadius = (big: number, small: number): ExpressionSpecification =>
    ['*', ['case', ['==', ['get', 'capital'], 1], 1.35, 1], byRank(big, small, 0, 8)];

  layers.push(
    {
      id: 'label-province',
      type: 'symbol',
      source: 'labels',
      filter: ['==', ['get', 'level'], 'province'],
      // Provinces become paintable at 4.5; the names arrive just before, so
      // they are already there to aim at.
      minzoom: 3.8,
      layout: {
        visibility,
        'text-field': ['get', 'name'],
        'text-font': [LABEL_FONT],
        // min_label runs 4 (Bavaria) to 11 (a rural district).
        'text-size': ['interpolate', ['linear'], ['zoom'],
          4, byRank(10.5, 8, 4, 11), 6, byRank(12.5, 9.5, 4, 11), 9, byRank(14.5, 11, 4, 11)],
        'text-max-width': 8,
        'text-padding': 3,
        'symbol-sort-key': rank,
      },
      paint: {
        'text-color': '#4F6B7A',
        'text-halo-color': HALO,
        'text-halo-width': 1.5,
        'text-halo-blur': 0.3,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 0, 4.6, 1],
      },
    },
    {
      // A name with nothing under it reads as a label for the whole area, so
      // every place gets a dot. Circles do not take part in symbol collision,
      // so a dot can outlive its own name at low zoom — which is what an atlas
      // does with a settlement too small to label.
      id: 'place-dot',
      type: 'circle',
      source: 'labels',
      filter: ['==', ['get', 'level'], 'place'],
      minzoom: 3,
      layout: { visibility },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          3, dotRadius(2.4, 1.1), 8, dotRadius(4.2, 2.2)],
        'circle-color': '#6B5B42',
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 3.6, 0.9],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 3.6, 0.9],
      },
    },
    {
      id: 'label-place',
      type: 'symbol',
      source: 'labels',
      filter: ['==', ['get', 'level'], 'place'],
      minzoom: 3,
      layout: {
        visibility,
        'text-field': ['get', 'name'],
        'text-font': [LABEL_FONT],
        // SCALERANK runs 0 (Tokyo, London) to 10 (a small town).
        'text-size': ['interpolate', ['linear'], ['zoom'],
          3, byRank(11, 8.5, 0, 8), 6, byRank(12.5, 9.5, 0, 8), 10, byRank(14.5, 11, 0, 8)],
        'text-max-width': 8,
        'text-padding': 3,
        // Offset clear of the dot rather than centred on it.
        'text-anchor': 'left',
        'text-offset': [0.6, 0],
        'symbol-sort-key': rank,
      },
      paint: {
        'text-color': '#5A4B33',
        'text-halo-color': HALO,
        'text-halo-width': 1.5,
        'text-halo-blur': 0.3,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 3.6, 1],
      },
    },
    {
      id: 'label-country',
      type: 'symbol',
      source: 'labels',
      filter: ['==', ['get', 'level'], 'country'],
      layout: {
        visibility,
        'text-field': ['get', 'name'],
        'text-font': [LABEL_FONT],
        // Spaced capitals, the way an atlas distinguishes a country from a
        // town. There is only one weight to draw with — Instrument Sans is a
        // variable font, but a font file handed to the CSS Font Loading API
        // renders at its own default instance — so case, tracking and size
        // carry the hierarchy instead of boldness.
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.13,
        // LABELRANK runs 2 (Brazil) to 10 (Vatican City).
        'text-size': ['interpolate', ['linear'], ['zoom'],
          0, byRank(10, 7, 2, 8), 2, byRank(11.5, 7.5, 2, 8),
          4, byRank(14, 9, 2, 8), 6, byRank(16, 10.5, 2, 8), 8, byRank(17, 11.5, 2, 8)],
        'text-max-width': 7,
        'text-padding': 4,
        'symbol-sort-key': rank,
      },
      paint: {
        'text-color': '#2A4452',
        'text-halo-color': HALO,
        'text-halo-width': 1.7,
        'text-halo-blur': 0.3,
        // Recedes once the work is happening inside one country, where a
        // country name spanning the screen is just in the way.
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 6, 1, 8, 0.55],
      },
    },
  );

  return {
    version: 8,
    // ⚠️ THIS IS WHY THERE IS NO `glyphs` URL AND NO GLYPH PIPELINE. MapLibre
    // v6 downloads these files, registers them with the CSS Font Loading API
    // under a private family and rasterizes each glyph with TinySDF. The names
    // on the left are what `text-font` asks for; they are not system fonts.
    //
    // ⚠️ ORDER MATTERS WITHIN A NAME. MapLibre takes the FIRST declared file
    // whose `unicode-range` covers a codepoint, so Instrument Sans must come
    // before the Noto Sans face or Noto would claim characters Instrument Sans
    // has. Noto is narrowed to U+1EA0-1EF9, the one block Instrument Sans does
    // not cover at all, which 15 characters of Natural Earth's Vietnamese
    // province names need. See data/scripts/fetch-fonts.sh.
    'font-faces': {
      [LABEL_FONT]: LABEL_FACES.map((f) => ({
        url: `${base}fonts/${f.file}`,
        'unicode-range': f.ranges,
      })),
    },
    sources,
    layers,
  };
}

/**
 * Show or hide the place names without rebuilding the style.
 *
 * Worth doing as a layout property rather than through atlasStyle: setStyle
 * throws away every feature-state, so the whole painting would have to be
 * re-applied just to turn labels off. The flag is still passed to atlasStyle so
 * that a style replacement — the relief toggle — comes back in the same state.
 */
export function setLabelsVisible(map: {
  getLayer(id: string): unknown;
  setLayoutProperty(id: string, name: string, value: unknown): unknown;
}, on: boolean): void {
  for (const id of LABEL_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import { LEVEL_DEFS, LEVELS, NO_MATCH, snapOutlineLayerFor } from './regions';
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
 * No labels yet: MapLibre cannot draw text without PBF glyph ranges, and with
 * no API key the only route is generating our own at build time from the
 * self-hosted fonts. Until then the UI names regions in the toolbar instead.
 */

export const DEM_MAPTERHORN = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const DEM_MAXZOOM = 13;

export const ATTRIBUTION_NE = 'Made with <a href="https://www.naturalearthdata.com/">Natural Earth</a>';
export const ATTRIBUTION_DEM = '© <a href="https://mapterhorn.com/attribution">Mapterhorn</a>';

export const OCEAN = '#B9D7EB';
export const LAND = '#FFFFFF';
/** Fully transparent, for levels that have no colour set. */
const NONE = 'rgba(0,0,0,0)';

export interface StyleOptions {
  base: string;
  hillshade?: boolean;
}

export function atlasStyle({ base, hillshade = false }: StyleOptions): StyleSpecification {
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

  return { version: 8, sources, layers };
}

export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

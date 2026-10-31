/**
 * The free-hand pen, and the strokes it leaves.
 *
 * Everything else in this editor paints whole REGIONS, which is what makes
 * "colour cannot leave the lines" true by construction: there is no way to
 * express a mark that crosses a border. The pen is the exception, so it has to
 * earn the same guarantee a different way — the drawn shape is INTERSECTED with
 * the region it started in, and whatever lies outside is thrown away before it
 * is ever stored.
 *
 * That also gives "paints on land only" for free. Regions are land; the sea is
 * the gap between them. A stroke begun over water resolves to no region and the
 * pen simply does not draw.
 *
 * ── Which region, though ───────────────────────────────────────────────────
 *
 * The one under the first point, at the editor's current snap level. So the pen
 * is bounded by a whole country when you are zoomed out and by a province or a
 * city when you are zoomed in, exactly as the brush is — the same rule, so
 * there is nothing extra to learn, and the hover outline already shows which
 * boundary is about to hold you.
 *
 * ── Why the path is recorded in longitude and latitude ─────────────────────
 *
 * Because a finger may pan or pinch the map WHILE the Pencil is drawing — that
 * is the whole point of the gesture model this app is built on. Screen
 * coordinates would smear the stroke across the map as it moved. Each sample is
 * unprojected the moment it arrives, so the ink stays on the ground it was laid
 * on, and the live preview reprojects itself for nothing because MapLibre is
 * already drawing it from a geographic source.
 */

import type { GeoJSONSource, Map as MlMap, Point } from 'maplibre-gl';
import { LEVEL_DEFS, PREVIEW_SOURCE, STROKE_SOURCE, type Level } from '../map/regions';
import type { ScenarioStore, Stroke } from '../state/scenario';
import { snapAt, type SnapResult } from './snap';
import {
  area, clipTo, fromWorld, outline, simplifyPath, simplifyShape, toWorld,
  type MultiPolygon, type PenPoint,
} from './stroke';

/** A screen-space box, in the shape queryRenderedFeatures wants. */
type ScreenBox = [[number, number], [number, number]];

/** Width of the nib on screen, in CSS pixels, at full pressure. */
const NIB_PX = 7;

/**
 * How far the pen must travel before a sample is worth keeping, in CSS pixels,
 * and the most samples a finished stroke may be built from.
 *
 * ⚠️ BOTH ARE IN SCREEN PIXELS AND MUST BE CONVERTED. A world unit is a pixel
 * at zoom 11 and nothing like a pixel anywhere else: at zoom 4 one screen pixel
 * is 128 world units, at zoom 15 it is a sixteenth of one. A tolerance left in
 * world units would thin a stroke drawn at the world view into a straight line
 * and leave one drawn at street level untouched.
 */
const TOLERANCE_PX = 1.1;
const MAX_POINTS = 200;

/** A stroke whose clipped remains are smaller than this is not a mark. */
const MIN_AREA_PX2 = 2;

const emptyFC = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

/**
 * The source by id, only if it is one we can write to. The style may be mid
 * replacement — the relief toggle rebuilds it — so this is checked every time
 * rather than resolved once and held.
 */
function geojsonSource(map: MlMap, id: string): GeoJSONSource | null {
  const source = map.getSource<GeoJSONSource>(id);
  return source && source.type === 'geojson' ? source : null;
}

export interface PenOptions {
  getColor: () => string;
  getLevel: () => Level;
  /** Called when a stroke lands or is rejected, for the toolbar readout. */
  onChanged?: () => void;
}

/**
 * Draws the strokes the scenario holds.
 *
 * Separate from PaintRenderer because strokes are GEOMETRY, not feature-state:
 * they have no tile to attach to, so they go into a GeoJSON source instead and
 * none of PaintRenderer's late-tile machinery applies.
 */
export class StrokeRenderer {
  constructor(private map: MlMap, private store: ScenarioStore) {
    store.onChange(() => this.sync());
  }

  sync(): void {
    const source = geojsonSource(this.map, STROKE_SOURCE);
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: this.store.current.strokes.map((s) => ({
        type: 'Feature' as const,
        // The id is a property, not the feature id: it has to survive into
        // queryRenderedFeatures so the eraser can name what it hit.
        properties: { id: s.id, color: s.color },
        geometry: { type: 'MultiPolygon' as const, coordinates: s.shape },
      })),
    });
  }
}

export class PenController {
  private drawing = false;
  /** Samples so far, in world units, in the order drawn. */
  private points: PenPoint[] = [];
  private region: SnapResult | null = null;
  private color = '#000000';
  /** Pending preview redraw, so a 240 Hz Pencil does not drive 240 updates. */
  private frame = 0;

  constructor(
    private map: MlMap,
    private store: ScenarioStore,
    private opts: PenOptions,
  ) {}

  get active(): boolean {
    return this.drawing;
  }

  /** World units per CSS pixel at the current zoom. */
  private scale(): number {
    return 2 ** (11 - this.map.getZoom());
  }

  /**
   * Start a stroke. Returns false when there is nothing to draw on, which is
   * the sea — the caller should then leave the gesture to the map.
   */
  begin(at: Point, pressure: number, fromPen: boolean): boolean {
    const hit = snapAt(this.map, at, this.opts.getLevel());
    if (!hit) return false;

    this.drawing = true;
    this.region = hit;
    this.color = this.opts.getColor();
    this.points = [];
    this.sample(at, pressure, fromPen);
    this.schedulePreview();
    return true;
  }

  extend(at: Point, pressure: number, fromPen: boolean): void {
    if (!this.drawing) return;
    this.sample(at, pressure, fromPen);
    this.schedulePreview();
  }

  private sample(at: Point, pressure: number, fromPen: boolean): void {
    const ll = this.map.unproject(at);
    const [x, y] = toWorld(ll.lng, ll.lat);
    // A mouse reports a constant 0.5 and a Pencil reports what it feels, so
    // only a real pen is allowed to vary the width — otherwise every mouse
    // stroke would be drawn at half weight.
    const weight = fromPen ? 0.45 + 0.55 * Math.min(1, Math.max(0, pressure)) : 1;
    this.points.push({ x, y, r: (NIB_PX / 2) * weight * this.scale() });
  }

  private schedulePreview(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawPreview();
    });
  }

  private drawPreview(): void {
    const source = geojsonSource(this.map, PREVIEW_SOURCE);
    if (!source) return;
    if (!this.drawing || this.points.length < 1) {
      source.setData(emptyFC());
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { color: this.color },
        geometry: {
          type: 'LineString',
          // Two identical points so a single tap still shows the nib.
          coordinates: this.points.length === 1
            ? [fromWorld(this.points[0].x, this.points[0].y), fromWorld(this.points[0].x, this.points[0].y)]
            : this.points.map((p) => fromWorld(p.x, p.y)),
        },
      }],
    });
  }

  private clearPreview(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    geojsonSource(this.map, PREVIEW_SOURCE)?.setData(emptyFC());
  }

  /** Abandon the stroke without storing it. */
  cancel(): void {
    this.drawing = false;
    this.points = [];
    this.region = null;
    this.clearPreview();
  }

  /**
   * Finish the stroke: build its outline, clip it to the region, store it.
   *
   * All the real work happens here rather than per sample, because building the
   * outline is a boolean union costing tens of milliseconds — fine once, on
   * release, and hopeless at 240 Hz.
   */
  end(): void {
    if (!this.drawing) return;
    const region = this.region;
    const raw = this.points;
    this.drawing = false;
    this.points = [];
    this.region = null;
    this.clearPreview();
    if (!region || !raw.length) return;

    const px = this.scale();
    const tolerance = TOLERANCE_PX * px;

    const bounds = this.screenBounds(raw);
    const path = simplifyPath(raw, tolerance, MAX_POINTS);
    const shape = outline(path, tolerance);
    const clip = bounds ? this.regionGeometry(region, bounds) : [];
    const clipped = clip.length ? clipTo(shape, clip) : [];
    // 0.6 of the drawing tolerance: enough to halve the saved vertices, fine
    // enough that the edge the user drew is still the edge they get.
    const kept = simplifyShape(clipped, tolerance * 0.6);

    if (area(kept) < MIN_AREA_PX2 * px * px) {
      // Everything landed outside the region, or the mark is too small to be
      // one. Silently dropping it is right: the preview already showed where
      // the boundary was.
      this.opts.onChanged?.();
      return;
    }

    const stroke: Stroke = {
      id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      color: this.color,
      shape: kept.map((poly) => poly.map((ring) => ring.map(([x, y]) => fromWorld(x, y)))),
      clippedTo: { level: region.level, id: region.id },
    };
    this.store.addStroke(stroke);
    this.opts.onChanged?.();
  }

  /**
   * The region's geometry to clip against, in world units.
   *
   * ⚠️ THIS IS NOT THE REGION'S FULL POLYGON, AND CANNOT BE. Tiles only ever
   * hold pieces of a feature, clipped to the tile — the reason PLAN.md gives up
   * on clipped vector hatching. It is enough HERE only because a stroke is
   * drawn by hand, on screen, in one gesture: whatever the pen could reach is
   * on screen, so the pieces on screen cover it.
   *
   * The query is bounded by the stroke's own box rather than the viewport, so
   * what comes back is the two or three tiles the stroke actually crosses
   * instead of every tile in view.
   */
  private regionGeometry(region: SnapResult, bounds: ScreenBox): MultiPolygon {
    const d = LEVEL_DEFS[region.level];
    if (!this.map.getLayer(d.fillLayer)) return [];

    const parts: MultiPolygon = [];
    for (const f of this.map.queryRenderedFeatures(bounds, {
      layers: [d.fillLayer],
      filter: ['==', ['get', 'id'], region.id],
    })) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates
          : [];
      for (const poly of polys) {
        parts.push(poly.map((ring) => ring.map(([lng, lat]) => toWorld(lng, lat))));
      }
    }
    return parts;
  }

  /**
   * Where the stroke sits on screen RIGHT NOW, padded by the nib.
   *
   * Projected fresh rather than remembered from when the samples were taken,
   * because a finger may have panned the map underneath the whole time.
   */
  private screenBounds(points: PenPoint[]): ScreenBox | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      const [lng, lat] = fromWorld(p.x, p.y);
      const s = this.map.project([lng, lat]);
      minX = Math.min(minX, s.x - p.r);
      minY = Math.min(minY, s.y - p.r);
      maxX = Math.max(maxX, s.x + p.r);
      maxY = Math.max(maxY, s.y + p.r);
    }
    if (!Number.isFinite(minX)) return null;
    return [[minX - NIB_PX, minY - NIB_PX], [maxX + NIB_PX, maxY + NIB_PX]];
  }
}

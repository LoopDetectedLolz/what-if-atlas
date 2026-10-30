/**
 * Painting regions, and keeping the map in sync with the scenario.
 *
 * Two halves:
 *
 *   PaintRenderer — pushes scenario colours into MapLibre feature-state. This
 *   has to cope with tiles arriving later than the paint: a country coloured at
 *   world zoom has no province tiles loaded, and when they load they must come
 *   up already coloured. So state is re-applied on every `sourcedata` event.
 *
 *   PaintController — turns taps and drags into transactions. A tap paints one
 *   region; a drag sweeps, painting every region it crosses; the fill tool
 *   floods outward across neighbours that share a colour.
 */

import type { Map as MlMap, Point } from 'maplibre-gl';
import { LEVEL_DEFS, LEVELS, type Level, type Region } from '../map/regions';
import type { ScenarioStore } from '../state/scenario';
import { snapAlong, snapAt, showSnapOutline, type SnapResult } from './snap';

export type Tool = 'brush' | 'fill' | 'hatch' | 'eraser';

// ── renderer ────────────────────────────────────────────────────────────────

export class PaintRenderer {
  /** Ids we have pushed into feature-state, per level, so we can clear them. */
  private applied: Record<Level, Set<string>> = {
    country: new Set(), province: new Set(), urban: new Set(),
  };

  constructor(private map: MlMap, private store: ScenarioStore) {
    store.onChange(() => this.syncAll());

    // Tiles load asynchronously and arrive with empty feature-state. Without
    // this, painting a country at z2 and then zooming to z6 would show
    // unpainted provinces over a painted country — or worse, a country whose
    // colour vanishes as new tiles replace old ones.
    map.on('sourcedata', (e) => {
      if (!e.isSourceLoaded) return;
      const level = LEVELS.find((l) => LEVEL_DEFS[l].source === e.sourceId);
      if (level) this.sync(level);
    });
  }

  syncAll(): void {
    for (const level of LEVELS) this.sync(level);
  }

  sync(level: Level): void {
    const d = LEVEL_DEFS[level];
    if (!this.map.getSource(d.source)) return;

    const paint = this.store.current.paint[level];
    const wanted = new Set(Object.keys(paint));

    // Clear anything no longer painted.
    for (const id of this.applied[level]) {
      if (!wanted.has(id)) {
        this.map.removeFeatureState({ source: d.source, sourceLayer: d.sourceLayer, id });
        this.applied[level].delete(id);
      }
    }

    for (const [id, color] of Object.entries(paint)) {
      this.map.setFeatureState(
        { source: d.source, sourceLayer: d.sourceLayer, id },
        { color },
      );
      this.applied[level].add(id);
    }
  }
}

// ── controller ──────────────────────────────────────────────────────────────

export interface PaintOptions {
  /** Current palette colour. */
  getColor: () => string;
  /** Snap level to paint at. */
  getLevel: () => Level;
  getTool: () => Tool;
  /** Called when the hovered region changes, for the toolbar readout. */
  onHover?: (r: SnapResult | null) => void;
  /** Called after any change, for stats/undo buttons. */
  onChanged?: () => void;
}

/**
 * Adjacency, plus the grouping a fill must not escape.
 * `country`/`province` map a region id to its neighbours; `continent` maps a
 * country id to its continent name.
 */
export type NeighbourTable = Partial<Record<Level, Record<string, string[]>>> & {
  continent?: Record<string, string>;
};

export class PaintController {
  private painting = false;
  private last: Point | null = null;
  /** Regions touched in the current sweep, so one drag records one transaction. */
  private sweepCount = 0;
  private neighbours: NeighbourTable | null = null;

  constructor(
    private map: MlMap,
    private store: ScenarioStore,
    private opts: PaintOptions,
  ) {}

  /** Adjacency for the fill tool. Until this is set, fill affects one region. */
  setNeighbours(table: NeighbourTable): void {
    this.neighbours = table;
  }

  /** region id -> parent country, learned from tiles as they render. */
  private parents = new Map<string, string>();

  /**
   * The country a sub-country region belongs to, read off the tile properties
   * and remembered. Tiles only carry what is on screen, so this fills in as the
   * user moves around; an unknown parent simply means the fill is not bounded
   * by it, which is the safe direction to fail.
   */
  private parentOf(level: Level, id: string): string | null {
    const cached = this.parents.get(id);
    if (cached) return cached;
    const d = LEVEL_DEFS[level];
    if (!this.map.getLayer(d.fillLayer)) return null;
    for (const f of this.map.queryRenderedFeatures({ layers: [d.fillLayer] })) {
      const fid = f.properties?.id;
      const country = f.properties?.country;
      if (typeof fid === 'string' && typeof country === 'string') {
        this.parents.set(fid, country);
      }
    }
    return this.parents.get(id) ?? null;
  }

  get hasNeighbours(): boolean {
    return this.neighbours !== null;
  }

  /** Preview the snap target without painting. */
  hover(point: Point): void {
    if (this.painting) return;
    const hit = snapAt(this.map, point, this.opts.getLevel());
    showSnapOutline(this.map, hit);
    this.opts.onHover?.(hit);
  }

  beginStroke(point: Point): void {
    const tool = this.opts.getTool();
    this.painting = true;
    this.last = point;
    this.sweepCount = 0;

    if (tool === 'fill') {
      const hit = snapAt(this.map, point, this.opts.getLevel());
      if (hit) this.floodFill(hit);
      this.painting = false;
      this.last = null;
      this.opts.onChanged?.();
      return;
    }

    this.store.begin(tool === 'eraser' ? 'erase' : 'paint');
    this.applyAt(point);
  }

  extendStroke(point: Point): void {
    if (!this.painting || !this.last) return;
    // Interpolate: a fast drag yields sparse samples and would skip narrow
    // countries entirely.
    const hits = snapAlong(this.map, this.last, point, this.opts.getLevel());
    for (const hit of hits) this.paintRegion(hit);
    this.last = point;
  }

  endStroke(): void {
    if (!this.painting) return;
    this.painting = false;
    this.last = null;
    this.store.commit();
    this.opts.onChanged?.();
  }

  cancelStroke(): void {
    // A cancelled gesture still commits what was already painted — losing it
    // would be worse than keeping it, and undo is one tap away.
    this.endStroke();
  }

  private applyAt(point: Point): void {
    const hit = snapAt(this.map, point, this.opts.getLevel());
    if (hit) this.paintRegion(hit);
  }

  private paintRegion(region: Region): void {
    const tool = this.opts.getTool();

    if (tool === 'eraser') {
      // Erase clears the colour AND any occupation mark. Leaving hatching
      // behind on a region erased back to white reads as a bug.
      const cleared = this.store.set('paint', region.level, region.id, null);
      const unhatched = this.store.set('hatch', region.level, region.id, null);
      if (cleared || unhatched) this.sweepCount++;
      return;
    }

    // Note there is deliberately no tap-to-toggle on the hatch tool: during a
    // sweep it would flip regions on and off as the pen passed back over them.
    // The eraser removes hatching.
    const kind = tool === 'hatch' ? 'hatch' : 'paint';
    if (this.store.set(kind, region.level, region.id, this.opts.getColor())) {
      this.sweepCount++;
    }
  }

  /**
   * Flood fill outward from a region across neighbours that currently share its
   * colour — so tapping one white country in a continent of white countries
   * fills the landmass, and tapping inside an already-coloured bloc recolours
   * just that bloc.
   *
   * Adjacency comes from the precomputed table in public/data/neighbours.json,
   * built from shared boundary vertices. Bounding-box overlap was tried first
   * and is far too loose: Chile's box covers half of South America and the
   * United Kingdom's touches France across the Channel, so a fill would hop
   * over water. Shared vertices give exact land borders — verified in the build
   * script, which asserts France has its 10 neighbours and that GBR and FRA are
   * NOT adjacent.
   *
   * Islands therefore have no neighbours and fill as a single region, which is
   * correct: there is no land route off Madagascar.
   */
  private floodFill(seed: SnapResult): void {
    const MAX_FILL = 600;
    const level = seed.level;
    const d = LEVEL_DEFS[level];
    const target = this.store.colorOf('paint', level, seed.id);
    const color = this.opts.getColor();
    if (target === color) return;

    const table = this.neighbours?.[level] ?? {};
    const sameColour = (id: string) =>
      (this.store.colorOf('paint', level, id) ?? null) === target;

    // Stop at the edge of the continent. Africa and Eurasia are land-connected
    // through Sinai, so an unconstrained fill from Chad reaches 112 countries —
    // geographically correct and completely useless as a tool. At province
    // level the equivalent bound is the parent country.
    const continents = this.neighbours?.continent ?? {};
    const groupOf = (id: string): string | null =>
      level === 'country' ? (continents[id] ?? null) : (this.parentOf(level, id) ?? null);
    const seedGroup = groupOf(seed.id);
    const sameGroup = (id: string) => seedGroup === null || groupOf(id) === seedGroup;

    const queue = [seed.id];
    const filled = new Set<string>([seed.id]);
    while (queue.length && filled.size < MAX_FILL) {
      const id = queue.shift()!;
      for (const other of table[id] ?? []) {
        if (filled.has(other) || !sameColour(other) || !sameGroup(other)) continue;
        filled.add(other);
        queue.push(other);
      }
    }

    this.store.transact(`fill ${filled.size} ${d.labelPlural}`, () => {
      for (const id of filled) this.store.set('paint', level, id, color);
    });

    if (filled.size >= MAX_FILL) {
      console.warn(`fill stopped at the ${MAX_FILL}-region safety limit`);
    }
  }
}

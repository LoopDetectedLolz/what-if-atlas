/**
 * The shared-border fade.
 *
 * Colour two neighbouring regions the same and the line between them fades
 * away over 300 ms, so the pair reads as one bloc. Colour one of them something
 * else and the line comes back. Coastlines never fade: there is nothing on the
 * other side of a coast to match.
 *
 * ── Why this is not a style expression ─────────────────────────────────────
 *
 * It cannot be. Deciding whether a border fades means comparing the colours of
 * the two regions on either side of it, and a MapLibre expression can only see
 * the feature it is drawing. The border feature knows the ids of its two
 * neighbours, but there is no expression that reads another feature's
 * feature-state. So the comparison happens here, in JavaScript, against the
 * scenario — and the answer is pushed into the border's own feature-state.
 *
 * ── What is animated, and what is not ──────────────────────────────────────
 *
 * MapLibre batches feature-state changes and applies them once per update cycle
 * (SourceFeatureState.coalesceChanges), and each tile rewrites its paint arrays
 * at most once per pass. So a frame costs one bucket update per TILE touched,
 * not one per setFeatureState call — the calls themselves are free, 2,000 of
 * them measuring 0.8 ms. What is worth bounding is the number of tiles.
 *
 * A tap moves a handful of borders in a handful of tiles, and eases. A flood
 * fill moves hundreds across every tile on screen, so past EASE_LIMIT the change
 * is simply applied — which is also what the user means by a bulk operation.
 *
 * ── The rule, stated plainly ───────────────────────────────────────────────
 *
 * A border fades when the regions on both sides are painted the same colour,
 * AT THAT BORDER'S OWN LEVEL. Three consequences worth knowing, all deliberate:
 *
 *   - White does not count. #FFFFFF is the reset swatch, and the map's resting
 *     state is white regions with every border drawn; a border vanishing
 *     between two deliberately-whitened regions would read as a bug rather than
 *     as a merge.
 *   - Painting a country does NOT dissolve the province lines inside it. Those
 *     provinces were not coloured, so nothing was merged; they are subdivisions
 *     of one coloured thing, and at the zooms where province lines are visible
 *     they should stay visible. Colour two provinces the same and THEIR border
 *     goes.
 *   - Colouring one French département and one German Land the same does not
 *     erase the France–Germany line. That is a country-level fact and it takes
 *     colouring both countries to merge it. The province border between the two
 *     does fade, which is the honest answer: those two provinces match, those
 *     two countries do not.
 *
 * Hatching is not considered. An occupied region is still a region with a
 * border; the stripes say who holds it, and nothing has merged.
 */

import type { Map as MlMap } from 'maplibre-gl';
import {
  BORDER_DEFS, FADE_LEVELS, borderId, type FadeLevel,
} from '../map/regions';
import type { ScenarioStore } from '../state/scenario';
import type { NeighbourTable } from './paint';
import { RESET } from './palette';

/** How long one border takes to fade, in milliseconds. */
const FADE_MS = 300;

/**
 * How many borders may move at once before the fade is skipped.
 *
 * Sized for the pen rather than for the fill: the widest a single sweep
 * plausibly gets is a few dozen borders, while a continent fill is hundreds.
 */
const EASE_LIMIT = 80;

/** Opacity of a faded border. Not quite zero, so a merge still has a seam. */
const FADED = 0.06;

interface Anim {
  level: FadeLevel;
  id: string;
  from: number;
  to: number;
  start: number;
}

/** Colours compare case-insensitively: an imported file need not match our casing. */
const same = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/** White is the resting colour, not a paint choice, so it never merges anything. */
const isColour = (c: string | undefined): c is string =>
  c !== undefined && c.toLowerCase() !== RESET.toLowerCase();

export class BorderFader {
  private neighbours: NeighbourTable | null = null;
  /** Borders that SHOULD be faded, per level — what the animation converges on. */
  private faded: Record<FadeLevel, Set<string>> = {
    country: new Set(), province: new Set(),
  };
  /** Opacity actually written, per `${level}:${id}`. Absent means 1. */
  private current = new Map<string, number>();
  private anims = new Map<string, Anim>();
  private frame = 0;
  private dirty = false;
  /** Set when the next retarget must apply at once rather than ease. */
  private snapNext = false;

  constructor(private map: MlMap, private store: ScenarioStore) {
    // Note there is no re-apply on `sourcedata`. MapLibre keeps feature-state
    // per source and pushes all of it into each tile as it loads
    // (SourceFeatureState.initializeTileState), so a border tile that arrives
    // after the paint comes up already faded.
    store.onChange(() => this.refresh());
  }

  /**
   * Adjacency, from public/data/neighbours.json. It arrives after the first
   * frame, so nothing fades until it does — including a scenario restored
   * before the fetch finished, which is why this refreshes rather than waiting.
   */
  setNeighbours(table: NeighbourTable): void {
    this.neighbours = table;
    this.refresh();
  }

  /**
   * Re-apply from scratch after the style was replaced.
   *
   * ⚠️ map.setStyle THROWS AWAY ALL FEATURE-STATE, so every fade written so far
   * is gone and the borders come back at full strength. Nothing has changed on
   * screen for the user — they toggled the relief — so the state is restored
   * without animating it back.
   */
  resync(): void {
    this.current.clear();
    this.anims.clear();
    for (const level of FADE_LEVELS) this.faded[level].clear();
    this.snapNext = true;
    this.refresh();
  }

  /** How many borders are faded right now. For the frame-rate probe and tests. */
  get fadedCount(): number {
    return FADE_LEVELS.reduce((n, l) => n + this.faded[l].size, 0);
  }

  private refresh(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    // Idle between fades: a loop left running would keep an iPad's GPU awake
    // for a map that is not moving.
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;

    // One retarget per frame however many edits arrived. A pen sweep calls
    // store.set() once per region crossed, and each would otherwise walk every
    // painted region's neighbours again.
    if (this.dirty) {
      this.dirty = false;
      this.retarget(now);
    }

    for (const [key, a] of this.anims) {
      const t = Math.min(1, (now - a.start) / FADE_MS);
      // Smoothstep: a linear fade reads as a hard switch at both ends.
      const eased = a.from + (a.to - a.from) * t * t * (3 - 2 * t);
      this.write(a.level, a.id, eased);
      if (t >= 1) this.anims.delete(key);
    }

    if (this.anims.size) this.schedule();
  };

  private retarget(now: number): void {
    const want = this.wanted();
    const changed: Array<{ level: FadeLevel; id: string; to: number }> = [];

    for (const level of FADE_LEVELS) {
      for (const id of want[level]) {
        if (!this.faded[level].has(id)) changed.push({ level, id, to: FADED });
      }
      for (const id of this.faded[level]) {
        if (!want[level].has(id)) changed.push({ level, id, to: 1 });
      }
      this.faded[level] = want[level];
    }

    if (!changed.length) return;

    const snap = this.snapNext || changed.length > EASE_LIMIT;
    this.snapNext = false;

    for (const { level, id, to } of changed) {
      const key = `${level}:${id}`;
      if (snap) {
        this.anims.delete(key);
        this.write(level, id, to);
        continue;
      }
      this.anims.set(key, { level, id, from: this.current.get(key) ?? 1, to, start: now });
    }
  }

  /**
   * Every border that should be faded right now.
   *
   * Walks the PAINTED regions rather than every border: a border can only fade
   * if at least one side is painted, so the work is bounded by what the user
   * has actually coloured and not by the 11,000 borders in the data. A pair
   * with both sides painted is reached twice and the set absorbs that.
   */
  private wanted(): Record<FadeLevel, Set<string>> {
    const out: Record<FadeLevel, Set<string>> = {
      country: new Set(), province: new Set(),
    };
    if (!this.neighbours) return out;

    for (const level of FADE_LEVELS) {
      const table = this.neighbours[level] ?? {};
      const painted = this.store.current.paint[level];
      for (const [id, colour] of Object.entries(painted)) {
        if (!isColour(colour)) continue;
        for (const other of table[id] ?? []) {
          if (same(colour, painted[other])) out[level].add(borderId(id, other));
        }
      }
    }
    return out;
  }

  private write(level: FadeLevel, id: string, opacity: number): void {
    const d = BORDER_DEFS[level];
    if (!this.map.getSource(d.source)) return;
    const key = `${level}:${id}`;

    if (opacity >= 1) {
      // Back to normal: drop the entry rather than storing a 1. Every stored
      // state is re-sent to every tile that loads, so a long session would
      // otherwise accumulate thousands of no-ops.
      this.current.delete(key);
      this.map.removeFeatureState({ source: d.source, sourceLayer: d.sourceLayer, id });
      return;
    }

    this.current.set(key, opacity);
    this.map.setFeatureState(
      { source: d.source, sourceLayer: d.sourceLayer, id },
      { op: opacity },
    );
  }
}

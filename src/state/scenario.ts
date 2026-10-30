/**
 * The scenario: everything the user has drawn, and the undo history.
 *
 * Paint is stored as one colour map PER LEVEL, keyed by region id. That single
 * decision is what makes "a coarse stroke never destroys fine work" true:
 * the country map and the province map are independent, and the renderer draws
 * country fills beneath province fills beneath city fills. Painting France at
 * country level writes one entry to `paint.country` and touches nothing else,
 * so the three provinces you coloured earlier still sit on top of it.
 *
 * Region ids come from the tile build and are stable across rebuilds:
 *   country   ADM0_A3     e.g. 'FRA'
 *   province  adm1_code   e.g. 'FRA-2345'
 *   urban     synthesised e.g. 'U0423'
 *
 * Undo works on TRANSACTIONS, not individual edits, because one pen sweep can
 * paint forty countries and undo should take all forty back at once.
 */

import { LEVELS, type Level } from '../map/regions';

export const SCENARIO_VERSION = 2;

export interface Stroke {
  id: string;
  color: string;
  /** Clipped to the region it started in; GeoJSON Polygon/MultiPolygon rings. */
  rings: number[][][];
  /** The region it was clipped to, for the record. */
  clippedTo: { level: Level; id: string } | null;
}

export interface Bookmark {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  /** data: URL of a small thumbnail. */
  thumb?: string;
}

export type PaintMap = Record<string, string>;

export interface Scenario {
  version: number;
  name: string;
  /** level -> region id -> colour */
  paint: Record<Level, PaintMap>;
  /** level -> region id -> the occupying faction's colour (renders as hatching) */
  hatch: Record<Level, PaintMap>;
  strokes: Stroke[];
  bookmarks: Bookmark[];
}

export function emptyScenario(name = 'Untitled'): Scenario {
  const blank = () => Object.fromEntries(LEVELS.map((l) => [l, {}])) as Record<Level, PaintMap>;
  return {
    version: SCENARIO_VERSION,
    name,
    paint: blank(),
    hatch: blank(),
    strokes: [],
    bookmarks: [],
  };
}

// ── edits ───────────────────────────────────────────────────────────────────

/** One reversible change. `to === null` means "clear". */
export interface Edit {
  kind: 'paint' | 'hatch';
  level: Level;
  id: string;
  from: string | null;
  to: string | null;
}

export interface StrokeEdit {
  kind: 'stroke';
  stroke: Stroke;
  /** true = added, false = removed (eraser). */
  added: boolean;
}

export type AnyEdit = Edit | StrokeEdit;

/** A group of edits applied and undone together — one sweep, one fill, one tap. */
export interface Transaction {
  label: string;
  edits: AnyEdit[];
}

type Listener = (s: Scenario, changed: AnyEdit[]) => void;

export class ScenarioStore {
  private scenario: Scenario;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private open: Transaction | null = null;
  private listeners = new Set<Listener>();

  /** Bound so the history cannot grow without limit on a long session. */
  readonly maxHistory = 200;

  constructor(scenario: Scenario = emptyScenario()) {
    this.scenario = scenario;
  }

  get current(): Scenario {
    return this.scenario;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: AnyEdit[]): void {
    for (const fn of this.listeners) fn(this.scenario, changed);
  }

  // ── transactions ──────────────────────────────────────────────────────────

  /** Open a transaction. Edits until commit() are undone as one step. */
  begin(label: string): void {
    if (this.open) this.commit();
    this.open = { label, edits: [] };
  }

  commit(): void {
    const t = this.open;
    this.open = null;
    if (!t || t.edits.length === 0) return;
    this.undoStack.push(t);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    // Any new edit invalidates the redo branch.
    this.redoStack = [];
  }

  /** Run `fn` inside a transaction. */
  transact(label: string, fn: () => void): void {
    this.begin(label);
    try {
      fn();
    } finally {
      this.commit();
    }
  }

  // ── applying edits ────────────────────────────────────────────────────────

  private mapFor(kind: 'paint' | 'hatch', level: Level): PaintMap {
    return kind === 'paint' ? this.scenario.paint[level] : this.scenario.hatch[level];
  }

  private applyEdit(e: AnyEdit): void {
    if (e.kind === 'stroke') {
      if (e.added) this.scenario.strokes.push(e.stroke);
      else this.scenario.strokes = this.scenario.strokes.filter((s) => s.id !== e.stroke.id);
      return;
    }
    const m = this.mapFor(e.kind, e.level);
    if (e.to === null) delete m[e.id];
    else m[e.id] = e.to;
  }

  private invert(e: AnyEdit): AnyEdit {
    return e.kind === 'stroke'
      ? { ...e, added: !e.added }
      : { ...e, from: e.to, to: e.from };
  }

  /**
   * Set a region's colour. Returns false when it would change nothing, so a
   * drag across the same region forty times records one edit, not forty.
   */
  set(kind: 'paint' | 'hatch', level: Level, id: string, to: string | null): boolean {
    const from = this.mapFor(kind, level)[id] ?? null;
    if (from === to) return false;
    const edit: Edit = { kind, level, id, from, to };
    this.applyEdit(edit);
    if (this.open) this.open.edits.push(edit);
    else this.undoStack.push({ label: kind, edits: [edit] }), (this.redoStack = []);
    this.emit([edit]);
    return true;
  }

  addStroke(stroke: Stroke): void {
    const edit: StrokeEdit = { kind: 'stroke', stroke, added: true };
    this.applyEdit(edit);
    if (this.open) this.open.edits.push(edit);
    else this.undoStack.push({ label: 'draw', edits: [edit] }), (this.redoStack = []);
    this.emit([edit]);
  }

  removeStroke(id: string): void {
    const stroke = this.scenario.strokes.find((s) => s.id === id);
    if (!stroke) return;
    const edit: StrokeEdit = { kind: 'stroke', stroke, added: false };
    this.applyEdit(edit);
    if (this.open) this.open.edits.push(edit);
    else this.undoStack.push({ label: 'erase', edits: [edit] }), (this.redoStack = []);
    this.emit([edit]);
  }

  colorOf(kind: 'paint' | 'hatch', level: Level, id: string): string | null {
    return this.mapFor(kind, level)[id] ?? null;
  }

  // ── history ───────────────────────────────────────────────────────────────

  undo(): boolean {
    const t = this.undoStack.pop();
    if (!t) return false;
    // Reverse order, so overlapping edits unwind correctly.
    const inverted = [...t.edits].reverse().map((e) => this.invert(e));
    for (const e of inverted) this.applyEdit(e);
    this.redoStack.push(t);
    this.emit(inverted);
    return true;
  }

  redo(): boolean {
    const t = this.redoStack.pop();
    if (!t) return false;
    for (const e of t.edits) this.applyEdit(e);
    this.undoStack.push(t);
    this.emit(t.edits);
    return true;
  }

  // ── whole-document operations ─────────────────────────────────────────────

  replace(scenario: Scenario): void {
    this.scenario = migrate(scenario);
    this.undoStack = [];
    this.redoStack = [];
    this.open = null;
    this.emit([]);
  }

  clearAll(): void {
    this.transact('clear all', () => {
      for (const level of LEVELS) {
        for (const kind of ['paint', 'hatch'] as const) {
          for (const id of Object.keys(this.mapFor(kind, level))) {
            this.set(kind, level, id, null);
          }
        }
      }
      for (const s of [...this.scenario.strokes]) this.removeStroke(s.id);
    });
  }

  /** Count of painted regions, for the UI. */
  stats(): { painted: number; hatched: number; strokes: number } {
    let painted = 0;
    let hatched = 0;
    for (const l of LEVELS) {
      painted += Object.keys(this.scenario.paint[l]).length;
      hatched += Object.keys(this.scenario.hatch[l]).length;
    }
    return { painted, hatched, strokes: this.scenario.strokes.length };
  }
}

// ── serialisation ───────────────────────────────────────────────────────────

/** Tolerate older/partial files rather than throwing on import. */
export function migrate(raw: unknown): Scenario {
  const base = emptyScenario();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<Scenario>;

  const mergeMaps = (src: unknown): Record<Level, PaintMap> => {
    const out = Object.fromEntries(LEVELS.map((l) => [l, {}])) as Record<Level, PaintMap>;
    if (src && typeof src === 'object') {
      for (const l of LEVELS) {
        const m = (src as Record<string, unknown>)[l];
        if (m && typeof m === 'object') {
          for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
            if (typeof v === 'string') out[l][k] = v;
          }
        }
      }
    }
    return out;
  };

  return {
    version: SCENARIO_VERSION,
    name: typeof s.name === 'string' ? s.name : base.name,
    paint: mergeMaps(s.paint),
    hatch: mergeMaps(s.hatch),
    strokes: Array.isArray(s.strokes) ? s.strokes.filter((x) => x && Array.isArray(x.rings)) : [],
    bookmarks: Array.isArray(s.bookmarks) ? s.bookmarks : [],
  };
}

export function serialise(s: Scenario): string {
  return JSON.stringify(s, null, 2);
}

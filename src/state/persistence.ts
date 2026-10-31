/**
 * Keeping the scenario across reloads.
 *
 * Until this existed the editor forgot everything the moment the tab reloaded.
 * Export has always been there, but export is a thing you have to REMEMBER to
 * do, and the people who most need the work kept are the least likely to think
 * of it. A twenty-minute drawing should survive a dropped tab.
 *
 * ── What this is honest about ──────────────────────────────────────────────
 *
 * ⚠️ IndexedDB ON IOS IS NOT STORAGE, IT IS A CACHE WITH GOOD MANNERS. WebKit's
 * tracking-prevention policy deletes IndexedDB after SEVEN DAYS without
 * interaction with the site — and the exemption is for apps added to the Home
 * Screen, not for tabs. So a child who uses the atlas from a Safari tab, then
 * goes on holiday, comes back to nothing.
 *
 * Three things follow, and all three are implemented rather than hoped for:
 *   - ask for `navigator.storage.persist()`, which exempts the origin where it
 *     is granted;
 *   - report what actually happened, so "Saved" never overstates its case;
 *   - keep Export as the real backup and say so in the interface.
 *
 * This saves the SCENARIO — kilobytes of paint, strokes and bookmarks. The
 * offline map tiles are a separate and much larger problem (PLAN.md §3).
 */

import { openDB, type IDBPDatabase } from 'idb';
import { migrate, type Scenario } from './scenario';

const DB_NAME = 'what-if-atlas';
const DB_VERSION = 1;
const STORE = 'scenario';
/** One autosaved document, as the brief describes. Named files are export's job. */
const KEY = 'current';
/** Where a record that will not parse is put, rather than over. */
const KEY_SALVAGE = 'unreadable';

/** Quiet after the pen stops before writing. A sweep emits once per region. */
const IDLE_MS = 700;
/** ...but never go longer than this while someone is still drawing. */
const MAX_WAIT_MS = 5000;

export interface LoadResult {
  scenario: Scenario | null;
  /** Why there is nothing to restore, when that is worth saying out loud. */
  problem: string | null;
}

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: number; durable: boolean }
  /** `reason` is a complete sentence: a read failure and a write failure read differently. */
  | { status: 'failed'; reason: string };

interface Record {
  version: number;
  savedAt: number;
  scenario: Scenario;
}

function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  });
}

/**
 * Ask the browser not to evict us.
 *
 * Granted, this exempts the origin from the seven-day rule. Denied is the
 * normal answer in a Safari tab and is not an error — it is the fact the
 * interface has to tell the truth about.
 */
async function requestDurable(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export class Persistence {
  private db: IDBPDatabase | null = null;
  private durable = false;
  /**
   * ⚠️ NOTHING IS WRITTEN UNTIL THE FIRST READ HAS FINISHED. Otherwise a slow
   * open followed by one tap would write a blank scenario straight over a
   * saved one — losing everything in order to save nothing.
   */
  private ready = false;
  private dirty = false;
  private timer: number | null = null;
  private firstDirtyAt = 0;
  private writing = false;
  private failed = false;

  constructor(private onState: (s: SaveState) => void) {}

  /**
   * Read whatever was left from last time.
   *
   * ⚠️ RETURNS A PROBLEM AS WELL AS A SCENARIO, and the caller must say so.
   * "There was nothing saved" and "there was something saved and it could not
   * be read" look identical from the outside — both start you on a blank map —
   * and the second one is the moment a child most needs to be told, because
   * the drawing they are about to start will sit on top of a failure they
   * never saw.
   */
  async load(): Promise<LoadResult> {
    try {
      this.db = await open();
      const raw = await this.db.get(STORE, KEY);
      this.durable = await requestDurable();

      if (raw === undefined) return { scenario: null, problem: null };

      const scenario = readRecord(raw);
      if (!scenario) {
        // Kept, not destroyed: an unreadable save may still be recoverable by
        // hand, and is certainly not improved by being replaced with a blank.
        await this.db.put(STORE, raw, KEY_SALVAGE).catch(() => {});
        await this.db.delete(STORE, KEY).catch(() => {});
        return { scenario: null, problem: 'The last drawing could not be read, so this one starts fresh.' };
      }
      return { scenario, problem: null };
    } catch (err) {
      // A browser with IndexedDB disabled, or private mode on some engines.
      return { scenario: null, problem: `Nothing could be opened: ${describe(err)}.` };
    } finally {
      this.ready = true;
    }
  }

  /** Call on every change. Writes happen on a timer, not on every edit. */
  schedule(getScenario: () => Scenario): void {
    if (!this.ready || !this.db) return;
    this.dirty = true;
    if (!this.firstDirtyAt) this.firstDirtyAt = Date.now();

    if (this.timer !== null) {
      // Let a continuous sweep push the write back, but only so far: someone
      // drawing without pause for a minute should not be one crash from
      // losing the lot.
      if (Date.now() - this.firstDirtyAt < MAX_WAIT_MS) {
        clearTimeout(this.timer);
      } else {
        return;
      }
    }
    this.timer = window.setTimeout(() => void this.flush(getScenario), IDLE_MS);
  }

  /**
   * Write now.
   *
   * Called on the timer, and on the way out: iOS kills a backgrounded tab
   * without warning and `visibilitychange` is the last reliable word we get.
   */
  async flush(getScenario: () => Scenario): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.ready || !this.db || !this.dirty || this.writing) return;

    this.writing = true;
    this.dirty = false;
    this.firstDirtyAt = 0;
    this.onState({ status: 'saving' });

    const scenario = getScenario();
    try {
      await this.write(scenario);
      this.failed = false;
      this.onState({ status: 'saved', at: Date.now(), durable: this.durable });
    } catch (err) {
      // Out of room: the bookmark thumbnails are almost all of the bulk, and a
      // drawing without its pictures is far better than no drawing.
      if (isQuota(err)) {
        try {
          await this.write(withoutThumbnails(scenario));
          this.failed = false;
          this.onState({ status: 'saved', at: Date.now(), durable: this.durable });
          return;
        } catch { /* fall through to the honest failure below */ }
      }
      this.failed = true;
      this.onState({ status: 'failed', reason: `Not saved: ${describe(err)}.` });
    } finally {
      this.writing = false;
    }
  }

  private async write(scenario: Scenario): Promise<void> {
    const record: Record = { version: DB_VERSION, savedAt: Date.now(), scenario };
    // One put, one transaction: there is no half-written record to guard
    // against, only a record that never landed.
    await this.db!.put(STORE, record, KEY);
  }

  /** Throw the saved document away, for a deliberate fresh start. */
  async clear(): Promise<void> {
    this.dirty = false;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    await this.db?.delete(STORE, KEY).catch(() => {});
  }

  get lastWriteFailed(): boolean {
    return this.failed;
  }
}

/** Accept what we wrote, and what an older build might have written. */
function readRecord(raw: unknown): Scenario | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record> & Partial<Scenario>;
  // Either a wrapped record, or a bare scenario from some earlier shape.
  const candidate = r.scenario ?? (r.paint ? (raw as Scenario) : null);
  if (!candidate || typeof candidate !== 'object') return null;
  const scenario = migrate(candidate);
  // migrate() never throws, so an unreadable blob comes back as an empty
  // scenario. Restoring that is indistinguishable from restoring nothing, and
  // would then be written back over the record it failed to read.
  const { painted, hatched } = count(scenario);
  if (painted + hatched + scenario.strokes.length + scenario.bookmarks.length === 0) return null;
  return scenario;
}

function count(s: Scenario): { painted: number; hatched: number } {
  let painted = 0;
  let hatched = 0;
  for (const level of Object.keys(s.paint) as Array<keyof typeof s.paint>) {
    painted += Object.keys(s.paint[level]).length;
    hatched += Object.keys(s.hatch[level]).length;
  }
  return { painted, hatched };
}

function withoutThumbnails(s: Scenario): Scenario {
  return { ...s, bookmarks: s.bookmarks.map(({ thumb, ...rest }) => (void thumb, rest)) };
}

function isQuota(err: unknown): boolean {
  return err instanceof DOMException
    && (err.name === 'QuotaExceededError' || err.code === 22);
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'there is no room left';
  if (err instanceof Error && err.message) return err.message;
  return 'the browser refused to store it';
}

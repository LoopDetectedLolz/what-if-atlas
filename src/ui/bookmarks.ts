/**
 * Saved views, in a collapsible panel, each with a picture of what it looks at.
 *
 * A bookmark is where the map was, not what was drawn on it: centre, zoom,
 * bearing, pitch. Tapping one flies back. They ride along in the scenario file
 * so a saved atlas remembers its own tour, and they sit outside the undo stack
 * on purpose — see ScenarioStore.addBookmark.
 */

import type { Map as MlMap } from 'maplibre-gl';
import { Point } from 'maplibre-gl';
import type { Level } from '../map/regions';
import type { Bookmark, ScenarioStore } from '../state/scenario';
import { snapAt } from '../tools/snap';

/** Thumbnail size, in CSS pixels. Kept small: these live inside the save file. */
const THUMB_W = 160;
const THUMB_H = 100;

/**
 * How the flight feels.
 *
 * `curve` is how high the arc rises on a long hop — 1.42 is MapLibre's default
 * and reads as businesslike; a little more makes the world fall away and come
 * back, which is the point of a bookmark in an atlas. `maxDuration` stops a
 * flight to the other side of the planet from becoming something you wait out,
 * and matters most when two bookmarks are used to compare places.
 */
const FLIGHT = { curve: 1.55, speed: 1.1, maxDuration: 2200, essential: true } as const;

/**
 * Capture what the map is showing, as a small data URL.
 *
 * ⚠️ THE DRAW HAS TO HAPPEN INSIDE MAPLIBRE'S `render` EVENT. The WebGL context
 * is created WITHOUT `preserveDrawingBuffer` — deliberately, because that flag
 * costs something on every frame of a map that must stay smooth under a pen —
 * so the drawing buffer is thrown away as soon as the browser composites it.
 * Read it a moment later and you get a blank rectangle, with no error at all.
 * Inside the render event the buffer is still intact.
 *
 * Only the downscale happens in that window. Encoding the full 1132x838 canvas
 * there would cost 445 KB and the time to make it; drawing it into a 160x100
 * canvas takes about 5 ms, and the encode can happen afterwards at leisure.
 *
 * Returns null rather than a broken picture if the trick does not work in this
 * browser — the bookmark is still worth saving without one.
 */
export function captureView(map: MlMap): Promise<string | null> {
  return new Promise((resolve) => {
    const canvas = map.getCanvas();
    const small = document.createElement('canvas');
    small.width = THUMB_W;
    small.height = THUMB_H;
    const ctx = small.getContext('2d');
    if (!ctx) return resolve(null);

    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      map.off('render', onRender);
      resolve(value);
    };

    function onRender() {
      try {
        // Cover-crop the middle, so a thumbnail is never letterboxed and always
        // shows the part of the view the eye went to.
        const scale = Math.max(THUMB_W / canvas.width, THUMB_H / canvas.height);
        const w = canvas.width * scale;
        const h = canvas.height * scale;
        ctx!.drawImage(canvas, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
      } catch {
        return finish(null);
      }
      // WebP is about a fifth smaller than JPEG here, but a browser that cannot
      // encode it silently hands back a PNG instead of failing — three times
      // the size under a name that looks right. Check what actually came back.
      let url = small.toDataURL('image/webp', 0.75);
      if (!url.startsWith('data:image/webp')) url = small.toDataURL('image/jpeg', 0.72);
      finish(looksLikeAPicture(ctx!) ? url : null);
    }

    map.on('render', onRender);
    map.triggerRepaint();
    // If no frame arrives, save the bookmark without a picture rather than hang.
    setTimeout(() => finish(null), 2000);
  });
}

/**
 * Is there an image here, or did the capture quietly produce a blank?
 *
 * The failure mode this guards against is silent: a browser that clears the
 * buffer first hands back a perfectly valid, perfectly empty PNG. Counting
 * distinct colours separates a map from a flat rectangle, and the ocean alone
 * is already several shades once it is antialiased against a coast.
 */
function looksLikeAPicture(ctx: CanvasRenderingContext2D): boolean {
  const { data } = ctx.getImageData(0, 0, THUMB_W, THUMB_H);
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue;
    seen.add(((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4));
    if (seen.size > 3) return true;
  }
  return false;
}

export interface BookmarkOptions {
  /** The snap level the editor is on, which decides how a view gets named. */
  getLevel: () => Level;
}

export class BookmarkPanel {
  private list: HTMLElement;
  private empty: HTMLElement;
  private count: HTMLElement;
  private head: HTMLButtonElement;
  private body: HTMLElement;
  private busy = false;

  constructor(
    private map: MlMap,
    private store: ScenarioStore,
    private opts: BookmarkOptions,
  ) {
    this.list = document.getElementById('marks-list')!;
    this.empty = document.getElementById('marks-empty')!;
    this.count = document.getElementById('marks-count')!;
    this.head = document.getElementById('marks-head') as HTMLButtonElement;
    this.body = document.getElementById('marks-body')!;

    this.head.addEventListener('click', () => this.toggle());
    document.getElementById('mark-add')!.addEventListener('click', () => void this.save());

    // One listener for the whole list: rows come and go, and a tap on a row
    // flies while a tap on its cross deletes.
    this.list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const del = target.closest<HTMLElement>('.mark-del');
      if (del) {
        this.store.removeBookmark(del.dataset.id!);
        return;
      }
      const go = target.closest<HTMLElement>('.mark-go');
      if (go) this.flyTo(go.dataset.id!);
    });

    store.onChange(() => this.render());
    this.render();
  }

  private toggle(): void {
    const open = this.head.getAttribute('aria-expanded') === 'true';
    this.head.setAttribute('aria-expanded', String(!open));
    this.body.hidden = open;
  }

  private open(): void {
    this.head.setAttribute('aria-expanded', 'true');
    this.body.hidden = false;
    // The panel is the last thing in a toolbar that scrolls, so on anything
    // shorter than a desktop a view saves itself out of sight. Show the user
    // what they just did.
    this.head.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Save the current view, named after whatever it is looking at. */
  private async save(): Promise<void> {
    // The capture waits for a frame; a second tap meanwhile would save twice.
    if (this.busy) return;
    this.busy = true;
    try {
      const centre = this.map.getCenter();
      const thumb = await captureView(this.map);
      const bookmark: Bookmark = {
        id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: this.nameForView(),
        center: [+centre.lng.toFixed(5), +centre.lat.toFixed(5)],
        zoom: +this.map.getZoom().toFixed(2),
        bearing: +this.map.getBearing().toFixed(1),
        pitch: +this.map.getPitch().toFixed(1),
        ...(thumb ? { thumb } : {}),
      };
      this.store.addBookmark(bookmark);
      this.open();
    } finally {
      this.busy = false;
    }
  }

  /**
   * A name for the view, taken from what is under the middle of it.
   *
   * Better than asking: a prompt on a tablet is a keyboard in the way of the
   * map, and the answer is nearly always the name of the place on screen. The
   * editor's own snap level decides how specific it gets, so a bookmark saved
   * while painting provinces is named after a province.
   */
  private nameForView(): string {
    const canvas = this.map.getCanvas();
    const middle = new Point(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const hit = snapAt(this.map, middle, this.opts.getLevel());
    const base = hit?.name ?? 'Open sea';

    // Two views of the same country are common — the second is "Spain 2".
    const taken = new Set(this.store.current.bookmarks.map((b) => b.name));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 999; n++) {
      if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
    }
    return base;
  }

  private flyTo(id: string): void {
    const b = this.store.current.bookmarks.find((x) => x.id === id);
    if (!b) return;
    const target = { center: b.center, zoom: b.zoom, bearing: b.bearing, pitch: b.pitch };
    // Someone who has asked the system for less motion does not want the world
    // to swoop; they still want to get there.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.map.jumpTo(target);
    } else {
      this.map.flyTo({ ...target, ...FLIGHT });
    }
  }

  private render(): void {
    const marks = this.store.current.bookmarks;
    this.count.textContent = String(marks.length);
    this.empty.hidden = marks.length > 0;

    this.list.innerHTML = marks.map((b) => {
      const name = escapeHtml(b.name);
      const thumb = b.thumb
        ? `<img class="mark-thumb" src="${escapeHtml(b.thumb)}" alt="" loading="lazy">`
        : '<span class="mark-thumb mark-thumb-none" aria-hidden="true"></span>';
      return `<li class="mark">
        <button class="mark-go" data-id="${escapeHtml(b.id)}" title="Fly to ${name}">
          ${thumb}
          <span class="mark-text">
            <span class="mark-name">${name}</span>
            <span class="mark-meta">z${b.zoom.toFixed(1)}</span>
          </span>
        </button>
        <button class="mark-del" data-id="${escapeHtml(b.id)}" aria-label="Delete ${name}">×</button>
      </li>`;
    }).join('');
  }
}

/**
 * ⚠️ Every bookmark field reaches the DOM as markup, and an imported scenario
 * is a file from anywhere. The name is the obvious one, but the id goes into an
 * attribute too and a stray quote there would be just as good a way in.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ));
}

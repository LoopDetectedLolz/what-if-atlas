/**
 * What-If Atlas — the editor.
 *
 * Painting works on REGIONS at a zoom-dependent granularity: zoomed out the
 * smallest paintable unit is a whole country, zoom in and it becomes a province,
 * then an urban area. Colour therefore cannot cross a border — not because
 * anything clamps it, but because there is no way to express it.
 *
 * Paint is layered, one map per level, drawn coarse beneath fine, so colouring
 * a country never destroys the provinces already coloured inside it.
 */

import { Map as MlMap, NavigationControl, ScaleControl, Point } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map/worker';
import { Protocol } from 'pmtiles';
import * as maplibregl from 'maplibre-gl';

import './ui/glass.css';
import './ui/layout.css';
import { atlasStyle, setLabelsVisible } from './map/style';
import { LEVEL_DEFS, LEVELS, autoLevel, type Level } from './map/regions';
import { ScenarioStore, emptyScenario, migrate, serialise } from './state/scenario';
import { PaintController, PaintRenderer, type NeighbourTable, type Tool } from './tools/paint';
import { BorderFader } from './tools/borders';
import { PenController, StrokeRenderer } from './tools/pen';
import { PALETTE, RESET } from './tools/palette';
import type { SnapResult } from './tools/snap';
import { ensureHatchNone, resetHatchImages, syncHatch } from './tools/hatch';

const BASE = import.meta.env.BASE_URL;

// PMTiles serves tiles over HTTP Range requests; the protocol must be
// registered before any style referencing pmtiles:// is loaded.
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// ── state ───────────────────────────────────────────────────────────────────

const store = new ScenarioStore(emptyScenario());
let color: string = PALETTE[10].hex;
let tool: Tool = 'brush';
/** null = follow the zoom. */
let pinnedLevel: Level | null = null;
let hillshadeOn = false;
let labelsOn = true;

const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const currentLevel = (): Level => pinnedLevel ?? autoLevel(map.getZoom());

// ── map ─────────────────────────────────────────────────────────────────────

let map: MlMap;
try {
  map = new MlMap({
    container: 'map',
    style: atlasStyle({ base: BASE, hillshade: hillshadeOn, labels: labelsOn }),
    center: [10, 42],
    zoom: 3.4,
    attributionControl: { compact: true },
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    // antialias moved into canvasContextAttributes in v6 and already defaults
    // to false; a partial object would clobber contextType: 'webgl2'.
    maxTileCacheSize: 160,
    // The pen gate needs to decide per gesture whether the map may pan, so
    // MapLibre's own double-click zoom is off — it fires on a two-tap paint.
    doubleClickZoom: false,
  });
} catch (err) {
  el('map').innerHTML =
    `<div style="display:grid;place-items:center;height:100%;padding:32px;text-align:center;color:#0A1721">
       <div><h2 style="margin:0 0 8px">This browser cannot run the map</h2>
       <p style="margin:0;max-width:34ch">MapLibre needs WebGL2 — on an iPad that means iPadOS 15 or newer.</p></div>
     </div>`;
  throw err;
}

(window as unknown as { __atlasMap?: MlMap }).__atlasMap = map;

map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

// Blur only while the map is still: a backdrop-filter over a canvas that
// repaints every frame re-blurs every frame.
map.on('movestart', () => document.body.classList.remove('is-idle'));
map.on('idle', () => document.body.classList.add('is-idle'));

/**
 * Replace the style, then put back everything that lives outside it.
 *
 * ⚠️ THIS COMMENT USED TO SAY setStyle DISCARDS THE REGISTERED IMAGES AND ALL
 * FEATURE-STATE. It does not. `map.setStyle(object)` defaults to the DIFF path
 * (Map._diffStyle -> Style.setState -> diffStyles), which leaves untouched
 * sources alone; measured on this style, a probe feature-state and a probe
 * registered image both survive the relief toggle.
 *
 * The re-application below stays anyway, and cheaply: the diff path is not
 * guaranteed — MapLibre forces a full rebuild if a style's sprite or glyphs
 * change, and `{diff: false}` asks for one — and everything re-applied here is
 * derived from the scenario, so doing it twice costs nothing and getting it
 * wrong would silently lose a child's work.
 */
function reloadStyle(): void {
  map.setStyle(atlasStyle({ base: BASE, hillshade: hillshadeOn, labels: labelsOn }));
  map.once('styledata', () => {
    resetHatchImages();
    ensureHatchNone(map);
    syncHatch(map, store);
    renderer.syncAll();
    fader.resync();
    strokes.sync();
  });
}

const renderer = new PaintRenderer(map, store);
const fader = new BorderFader(map, store);
const strokes = new StrokeRenderer(map, store);
const pen = new PenController(map, store, {
  getColor: () => color,
  getLevel: currentLevel,
  onChanged: refreshChrome,
});
const painter = new PaintController(map, store, {
  getColor: () => color,
  getLevel: currentLevel,
  getTool: () => tool,
  onHover: showReadout,
  onChanged: refreshChrome,
});

// Adjacency for the fill tool. Fill degrades to a single region until it loads.
fetch(`${BASE}data/neighbours.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((t: NeighbourTable | null) => {
    if (t) {
      painter.setNeighbours(t);
      // The same table decides which borders may fade, so one fetch feeds both.
      fader.setNeighbours(t);
    }
    refreshChrome();
  })
  .catch(() => { /* fill still works, one region at a time */ });

map.on('zoom', refreshLevelUI);
map.once('load', () => {
  renderer.syncAll();
  strokes.sync();
  ensureHatchNone(map);
  syncHatch(map, store);
  refreshLevelUI();
});

// Hatching is driven by a paint expression rather than feature-state, so it has
// to be rebuilt whenever the hatch set changes.
store.onChange(() => syncHatch(map, store));

// NOTE: do NOT re-sync on every `styledata`. setPaintProperty itself fires
// styledata, so a handler that calls syncHatch feeds back into itself and
// loops until the map is wedged. A style REPLACEMENT (setStyle) is handled
// explicitly at the call site instead — see reloadStyle().


// ── input: the pen gate from the milestone-0 probe ──────────────────────────

/**
 * MapLibre's gesture handlers listen to Touch events and never see Pointer
 * Events, so panning is gated on the Touch stream while painting is driven from
 * Pointer Events.
 *
 * Rule: a stylus paints and never pans. A finger always pans and never paints.
 * That makes "draw while a finger pans" fall out for free, and it means no mode
 * switch is needed on an iPad. With a mouse, the left button paints.
 */
const container = map.getCanvasContainer();

interface WebKitTouch extends Touch { touchType?: 'direct' | 'stylus'; }

map.on('touchstart', (e) => {
  const changed = Array.from(e.originalEvent.changedTouches) as WebKitTouch[];
  const allStylus = changed.length > 0 && changed.every((t) => t.touchType === 'stylus');
  // Suppresses DragPanHandler and TwoFingersTouchZoomRotateHandler for this
  // gesture, per maplibre-gl.d.ts.
  if (allStylus) e.preventDefault();
});

const pointAt = (e: PointerEvent): Point => {
  const r = map.getCanvas().getBoundingClientRect();
  return new Point(e.clientX - r.left, e.clientY - r.top);
};

/**
 * Does this pointer paint, rather than pan?
 *
 * ⚠️ `buttons` MATTERS FOR THE PENCIL TOO, not just the mouse. An Apple Pencil
 * reports pointermove while HOVERING above the glass, with buttons === 0, and
 * treating that as drawing meant hover() was never reached on the one device
 * this app is built for — so the outline showing which region is under the nib,
 * and the toolbar readout naming it, simply never appeared there. For the pen
 * tool that outline is the whole affordance: it is the boundary the stroke is
 * about to be cut at.
 */
const paints = (e: PointerEvent): boolean =>
  (e.pointerType === 'pen' || e.pointerType === 'mouse') && e.buttons === 1;

/**
 * The pointer that is currently drawing or painting.
 *
 * ⚠️ WITHOUT THIS, ANY FINGER ENDS THE PEN'S STROKE. pointerup, pointerleave
 * and pointercancel all fire for every pointer on the element, so lifting the
 * finger that was panning the map committed the Pencil's half-drawn stroke and
 * silently threw the rest of it away — which is precisely the gesture the whole
 * input model exists to support.
 */
let drawingPointer: number | null = null;

container.addEventListener('pointerdown', (e) => {
  if (!paints(e)) return;
  // One stroke at a time: a second pen or button goes nowhere rather than
  // interleaving its samples into the first stroke's path.
  if (drawingPointer !== null) return;

  // The pen is the one tool that can decline a gesture: it draws on land, and
  // over water there is no region to clip to. Ask BEFORE preventing the
  // default, so a stroke begun at sea is left to the map to pan with instead
  // of being swallowed.
  if (tool === 'pen') {
    if (!pen.begin(pointAt(e), e.pressure, e.pointerType === 'pen')) return;
    drawingPointer = e.pointerId;
    e.preventDefault();
    document.body.classList.add('painting');
    return;
  }

  drawingPointer = e.pointerId;
  e.preventDefault();
  document.body.classList.add('painting');
  painter.beginStroke(pointAt(e));
  refreshChrome();
});

container.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;      // fingers pan, never paint
  if (pen.active) {
    // Only the nib that started the stroke adds to it.
    if (e.pointerId === drawingPointer) pen.extend(pointAt(e), e.pressure, e.pointerType === 'pen');
    return;
  }
  if (paints(e)) painter.extendStroke(pointAt(e));
  // Hovering still outlines the region under the pointer with the pen tool
  // selected, and it is worth more there than anywhere else: that outline is
  // the edge the stroke will be cut at.
  else painter.hover(pointAt(e));
});

/** When a pointer-driven paint last ended, so the click path can stand down. */
let lastPointerPaint = 0;

const finish = (e: PointerEvent): void => {
  if (e.pointerId !== drawingPointer) return;
  drawingPointer = null;
  if (!document.body.classList.contains('painting')) return;
  document.body.classList.remove('painting');
  if (pen.active) pen.end();
  else painter.endStroke();
  lastPointerPaint = performance.now();
};
container.addEventListener('pointerup', finish);
container.addEventListener('pointerleave', finish);
// pointercancel fires when the browser takes the viewport, and may fire for
// palm rejection. Keep what was painted; undo is one tap away.
//
// ⚠️ A HALF-DRAWN STROKE IS KEPT TOO, and that is a guess, not a decision:
// probe.html exists to find out whether a resting palm cancels a Pencil stroke
// on iPadOS and it has still never been run on the device. Keeping matches
// what painting does, and a wrong mark can be undone, where a lost one has to
// be drawn again.
container.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== drawingPointer) return;
  drawingPointer = null;
  document.body.classList.remove('painting');
  if (pen.active) pen.end();
  else painter.cancelStroke();
});

// A plain tap on a touch screen should still paint one region, since the Pencil
// is not the only way in. Routed through MapLibre's own click event so it never
// competes with panning — MapLibre only fires click when the gesture did not
// turn into a drag.
//
// A mouse or pen click ALSO produces pointerdown/pointerup, which already
// painted, so this guards twice over: by pointer type, and by a short time
// window for browsers that report click as a plain MouseEvent. Without it one
// click paints twice and takes two undos to reverse.
map.on('click', (e) => {
  // Not for the pen: a finger is for panning, and a tap would otherwise leave
  // a dot wherever the map was steadied.
  if (tool === 'pen') return;
  const orig = e.originalEvent as MouseEvent & { pointerType?: string };
  if (orig.pointerType && orig.pointerType !== 'touch') return;
  if (performance.now() - lastPointerPaint < 500) return;
  if (document.body.classList.contains('painting')) return;
  painter.beginStroke(e.point);
  painter.endStroke();
});

// ── chrome ──────────────────────────────────────────────────────────────────

function buildSwatches(): void {
  const host = el('swatches');
  host.innerHTML = PALETTE.map(
    (s) =>
      `<button class="swatch" data-hex="${s.hex}" style="background:${s.hex}" ` +
      `title="${s.name}" aria-label="${s.name}" aria-pressed="${s.hex === color}"></button>`,
  ).join('');
  host.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
    if (!btn) return;
    color = btn.dataset.hex!;
    if (tool === 'eraser') setTool('brush');
    syncSwatches();
  });
}

function syncSwatches(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.swatch')) {
    b.setAttribute('aria-pressed', String(b.dataset.hex === color));
  }
  el('reset-swatch').setAttribute('aria-pressed', String(color === RESET));
}

const TOOL_NOTES: Record<Tool, string> = {
  brush: 'Drag to colour every region you cross.',
  fill: 'Tap to flood across touching regions of the same colour, stopping at the continent.',
  hatch: 'Tap or drag to mark regions as occupied, striped in the chosen colour.',
  pen: 'Draw by hand. The mark is cut to the region you start in, and the sea takes no ink.',
  eraser: 'Clears the colour, the occupation mark, and any drawing on top.',
};

function setTool(next: Tool): void {
  tool = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === next));
  }
  el('tool-note').textContent = TOOL_NOTES[next];
}

function refreshLevelUI(): void {
  const zoom = map.getZoom();
  const active = currentLevel();
  for (const b of document.querySelectorAll<HTMLButtonElement>('.lvl')) {
    const lv = b.dataset.level!;
    b.setAttribute('aria-pressed', String(lv === (pinnedLevel ?? 'auto')));
    if (lv !== 'auto') {
      b.dataset.reachable = String(zoom >= LEVEL_DEFS[lv as Level].activeFrom);
    }
  }
  const d = LEVEL_DEFS[active];
  const note = el('level-note');
  if (pinnedLevel) {
    note.textContent = `Pinned to ${d.label.toLowerCase()}. Tap Auto to follow the zoom.`;
  } else {
    const next = LEVELS[LEVELS.indexOf(active) + 1];
    note.textContent = next
      ? `Painting whole ${d.labelPlural}. Zoom to ${LEVEL_DEFS[next].activeFrom.toFixed(1)} for ${LEVEL_DEFS[next].labelPlural}.`
      : `Painting ${d.labelPlural} — the finest level.`;
  }
}

function showReadout(hit: SnapResult | null): void {
  const box = el('readout');
  if (!hit) {
    box.classList.remove('on');
    return;
  }
  box.classList.add('on');
  el('r-name').textContent = hit.name;
  const d = LEVEL_DEFS[hit.level];
  el('r-meta').textContent = hit.fellBack
    ? `${d.label} · no ${LEVEL_DEFS[hit.requested].label.toLowerCase()} here`
    : d.label;
}

function refreshChrome(): void {
  (el('undo') as HTMLButtonElement).disabled = !store.canUndo;
  (el('redo') as HTMLButtonElement).disabled = !store.canRedo;
}

// ── wiring ──────────────────────────────────────────────────────────────────

buildSwatches();

el('swatches');
el('reset-swatch').addEventListener('click', () => {
  color = RESET;
  setTool('brush');
  syncSwatches();
});

document.querySelector('.tb-tools')!.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tool');
  if (btn) setTool(btn.dataset.tool as Tool);
});

el('level-pills').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.lvl');
  if (!btn) return;
  const lv = btn.dataset.level!;
  pinnedLevel = lv === 'auto' ? null : (lv as Level);
  refreshLevelUI();
});

el('undo').addEventListener('click', () => { store.undo(); refreshChrome(); });
el('redo').addEventListener('click', () => { store.redo(); refreshChrome(); });
el('clear').addEventListener('click', () => {
  const { painted, hatched, strokes } = store.stats();
  if (painted + hatched + strokes === 0) return;
  if (confirm(`Clear ${painted} painted region${painted === 1 ? '' : 's'}? Undo can bring it back.`)) {
    store.clearAll();
    refreshChrome();
  }
});

el('export').addEventListener('click', () => {
  const blob = new Blob([serialise(store.current)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${store.current.name.replace(/\W+/g, '-').toLowerCase() || 'scenario'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

el('import').addEventListener('click', () => el<HTMLInputElement>('import-file').click());
el('import-file').addEventListener('change', async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    store.replace(migrate(JSON.parse(await file.text())));
    renderer.syncAll();
    refreshChrome();
  } catch {
    alert('That file could not be read as a scenario.');
  }
  (ev.target as HTMLInputElement).value = '';
});

// Names are a layout property, not a style rebuild: setStyle would discard
// every feature-state and the whole painting would have to be re-applied just
// to hide some text.
el('label-btn').addEventListener('click', (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  labelsOn = !labelsOn;
  btn.textContent = labelsOn ? 'Names on' : 'Names off';
  btn.setAttribute('aria-pressed', String(labelsOn));
  setLabelsVisible(map, labelsOn);
});

el('hill-btn').addEventListener('click', (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  hillshadeOn = !hillshadeOn;
  btn.textContent = hillshadeOn ? 'Relief on' : 'Relief off';
  btn.setAttribute('aria-pressed', String(hillshadeOn));
  reloadStyle();
});

const fold = el('fold');
fold.addEventListener('click', () => {
  el('toolbar').classList.remove('hidden');
  fold.classList.remove('on');
});
el('toolbar').addEventListener('dblclick', () => {
  el('toolbar').classList.add('hidden');
  fold.classList.add('on');
});

window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); refreshChrome(); }
  else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); store.redo(); refreshChrome(); }
});

setTool('brush');
syncSwatches();
refreshChrome();

// ── service worker ──────────────────────────────────────────────────────────

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE })
      .catch((err) => console.warn('service worker registration failed', err));
  });
}

/**
 * Milestone-0 device probe.
 *
 * Settles the one question the whole pen design rests on, and which no spec
 * answers: on iPad Safari, does WebKit keep delivering pen `pointermove`
 * events after you call `preventDefault()` on a stylus-only `touchstart`?
 *
 * Why it matters: MapLibre's gesture handlers listen to Touch events
 * (touchstart/touchmove/mousedown on map.getCanvasContainer()) and never see
 * Pointer Events at all. So the plan is:
 *
 *   - GATE panning on Touch events. MapTouchEvent.preventDefault() is
 *     documented in maplibre-gl.d.ts to suppress exactly DragPanHandler and
 *     TwoFingersTouchZoomRotateHandler on a touchstart. Call it when every
 *     changed touch is a stylus, so the Pencil never pans the map while
 *     fingers still pan and pinch normally.
 *   - DRAW from Pointer Events, filtered to pointerType === 'pen'.
 *
 * The Pointer Events spec explicitly declines to define how Pointer and Touch
 * events interleave on a user agent that supports both, so the gate might also
 * kill the pen's pointer stream. If it does, the fallback is a pen/pan mode
 * toggle, which removes the whole problem. Test 1 below decides which.
 *
 * This page must run on the real iPad to mean anything. It is readable and
 * reportable on-device because there is no usable console there.
 */

// maplibre-gl v6 is ESM-only and has NO default export. Named imports only.
import { Map as MlMap, type MapTouchEvent, type LngLat } from 'maplibre-gl';
// Must run before any Map is constructed — see the file for why.
import './map/worker';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui/glass.css';
import { atlasStyle } from './map/style';
import { FpsProbe, deviceContext } from './dev/fps';

/**
 * WebKit exposes Touch.touchType, which is how a stylus contact is told apart
 * from a finger. It is the one property here that the standard DOM typings
 * genuinely lack.
 *
 * Deliberately NOT declared: altitudeAngle, azimuthAngle, force and
 * getPredictedEvents. TypeScript's lib.dom already types all four as REQUIRED
 * members, so shimming them as optional is a type error. They are still probed
 * with `in` / typeof at runtime, because being typed is not the same as being
 * implemented — which is the entire point of this page.
 */
interface WebKitTouch extends Touch {
  touchType?: 'direct' | 'stylus';
}

const BASE = import.meta.env.BASE_URL;

// ── state ────────────────────────────────────────────────────────────────────

type TestId = 'pen-only' | 'finger-only' | 'both' | 'palm';
type TestState = 'waiting' | 'pass' | 'fail' | 'done';

interface TestDef {
  id: TestId;
  title: string;
  instruction: string;
  why: string;
}

const TESTS: TestDef[] = [
  {
    id: 'pen-only',
    title: '1 · Pencil alone',
    instruction: 'Press the Pencil on the map and drag it a few centimetres.',
    why: 'The decisive one. The gate should fire, the map should NOT pan, and pen pointermove events should keep arriving after preventDefault(). If they stop, simultaneous draw-and-pan is off the table and we ship a mode toggle instead.',
  },
  {
    id: 'finger-only',
    title: '2 · One finger alone',
    instruction: 'Lift the Pencil away. Drag the map with one finger.',
    why: 'Confirms the gate is selective — a finger must still pan normally.',
  },
  {
    id: 'both',
    title: '3 · Pencil and finger together',
    instruction: 'Hold the Pencil down and draw, and at the same time drag the map with a finger.',
    why: 'The feature as specified: draw while the map pans underneath.',
  },
  {
    id: 'palm',
    title: '4 · Palm / second contact',
    instruction: 'Start a Pencil stroke, then rest a finger or palm on the screen mid-stroke.',
    why: 'pointercancel MUST fire when the browser takes the viewport, and MAY fire for palm rejection. Either outcome is useful — it tells us whether strokes have to commit incrementally.',
  },
];

const results = new Map<TestId, { state: TestState; detail: string }>();
TESTS.forEach((t) => results.set(t.id, { state: 'waiting', detail: '' }));

/** Capability facts, filled in on first pen contact. */
const caps: Record<string, string> = {
  'Touch.touchType': 'not seen yet',
  'pointerType': 'not seen yet',
  'pressure (varying?)': 'not seen yet',
  'altitudeAngle': 'not seen yet',
  'azimuthAngle': 'not seen yet',
  'tiltX / tiltY': 'not seen yet',
  'getCoalescedEvents()': 'not seen yet',
  'getPredictedEvents()': 'not seen yet',
  'maxTouchPoints': String(navigator.maxTouchPoints ?? 0),
};

const pressures = new Set<string>();
let sawAnyTouch = false;

// Per-gesture bookkeeping. A gesture runs from the first touch down to the
// last touch up.
interface Gesture {
  startedAt: number;
  gateFired: boolean;
  types: Set<string>;
  penMovesTotal: number;
  penMovesAfterGate: number;
  coalescedMax: number;
  cancels: number;
  centerAtStart: LngLat | null;
  panned: boolean;
  /** True once a stylus and a finger were down simultaneously. */
  concurrent: boolean;
  /** True if a finger arrived while a stylus was already down. */
  fingerAfterPen: boolean;
}

let gesture: Gesture | null = null;
const downTouches = new Map<number, string>();

function newGesture(): Gesture {
  return {
    startedAt: performance.now(),
    gateFired: false,
    types: new Set(),
    penMovesTotal: 0,
    penMovesAfterGate: 0,
    coalescedMax: 0,
    cancels: 0,
    centerAtStart: map ? map.getCenter() : null,
    panned: false,
    concurrent: false,
    fingerAfterPen: false,
  };
}

// ── logging ──────────────────────────────────────────────────────────────────

const logLines: string[] = [];
const logEl = document.getElementById('log')!;

function log(msg: string): void {
  const t = (performance.now() / 1000).toFixed(2).padStart(7);
  logLines.push(`${t}  ${msg}`);
  // Keep the log bounded; this runs during drags.
  if (logLines.length > 220) logLines.shift();
  logEl.textContent = logLines.slice(-60).join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

// ── map ──────────────────────────────────────────────────────────────────────

let hillshadeOn = false;
let map: MlMap | null = null;

function buildMap(): MlMap {
  const m = new MlMap({
    container: 'map',
    style: atlasStyle({ base: BASE, hillshade: hillshadeOn }),
    center: [10, 30],
    zoom: 2.2,
    attributionControl: { compact: true },
    // Explicit rather than relying on MapLibre silently clamping once the
    // canvas would exceed maxCanvasSize [4096, 4096].
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    // antialias is NOT a MapOptions key in v6 — it moved into
    // canvasContextAttributes, whose documented defaults are already
    // antialias: false, powerPreference: 'high-performance',
    // contextType: 'webgl2'. Passing a partial object risks clobbering the
    // siblings (notably contextType), so the defaults are left alone.
    // Keep the tile cache bounded; memory is the real iPad risk (issue #7667).
    maxTileCacheSize: 120,
  });

  m.on('error', (e) => log(`map error: ${e.error?.message ?? 'unknown'}`));

  // Blur on the glass panels is enabled only while the map is still.
  m.on('movestart', () => document.body.classList.remove('is-idle'));
  m.on('idle', () => document.body.classList.add('is-idle'));

  // ── THE GATE ──
  m.on('touchstart', (e: MapTouchEvent) => {
    const changed = Array.from(e.originalEvent.changedTouches) as WebKitTouch[];
    const types = changed.map((t) => t.touchType ?? 'unknown');
    const allStylus = changed.length > 0 && types.every((t) => t === 'stylus');

    if (allStylus) {
      // Suppresses DragPanHandler + TwoFingersTouchZoomRotateHandler for this
      // gesture, per maplibre-gl.d.ts.
      e.preventDefault();
      if (gesture) gesture.gateFired = true;
      log(`GATE fired — ${changed.length} stylus contact(s), preventDefault() called`);
    } else {
      log(`no gate — contacts: [${types.join(', ')}]`);
    }
  });

  return m;
}

// Observe raw touch state independently of MapLibre, so concurrency is tracked
// even when the gate suppresses the map's own handling. Passive + capture:
// observation only, never interferes.
function attachTouchObservers(el: HTMLElement): void {
  el.addEventListener('touchstart', (ev) => {
    sawAnyTouch = true;
    const te = ev as TouchEvent;
    if (downTouches.size === 0) gesture = newGesture();
    const hadStylus = [...downTouches.values()].includes('stylus');
    for (const t of Array.from(te.changedTouches) as WebKitTouch[]) {
      const kind = t.touchType ?? 'unknown';
      downTouches.set(t.identifier, kind);
      gesture?.types.add(kind);
      if (caps['Touch.touchType'] === 'not seen yet' || !caps['Touch.touchType'].includes(kind)) {
        const seen = new Set(caps['Touch.touchType'].split(/,\s*/).filter((s) => s && !s.includes('not seen')));
        seen.add(kind);
        caps['Touch.touchType'] = [...seen].join(', ');
      }
      if (hadStylus && kind !== 'stylus' && gesture) gesture.fingerAfterPen = true;
    }
    const kinds = new Set(downTouches.values());
    if (gesture && kinds.has('stylus') && [...kinds].some((k) => k !== 'stylus')) {
      gesture.concurrent = true;
    }
    renderAll();
  }, { passive: true, capture: true });

  const end = (ev: Event): void => {
    const te = ev as TouchEvent;
    for (const t of Array.from(te.changedTouches)) downTouches.delete(t.identifier);
    if (downTouches.size === 0 && gesture) {
      finishGesture(gesture);
      gesture = null;
    }
    renderAll();
  };
  el.addEventListener('touchend', end, { passive: true, capture: true });
  el.addEventListener('touchcancel', end, { passive: true, capture: true });
}

// ── drawing ──────────────────────────────────────────────────────────────────

const ink = document.getElementById('ink') as HTMLCanvasElement;
const ctx = ink.getContext('2d')!;
let strokes: { x: number; y: number; w: number }[][] = [];
let current: { x: number; y: number; w: number }[] | null = null;

function sizeInk(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ink.width = Math.round(window.innerWidth * dpr);
  ink.height = Math.round(window.innerHeight * dpr);
  ink.style.width = `${window.innerWidth}px`;
  ink.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function redraw(): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ink.width, ink.height);
  ctx.restore();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#F5A524';
  for (const s of [...strokes, current].filter(Boolean) as typeof strokes) {
    for (let i = 1; i < s.length; i++) {
      ctx.beginPath();
      ctx.lineWidth = s[i].w;
      ctx.moveTo(s[i - 1].x, s[i - 1].y);
      ctx.lineTo(s[i].x, s[i].y);
      ctx.stroke();
    }
  }
}

/** Pressure drives width so a Pencil Pro / 2nd gen is visibly different from
 *  a USB-C Pencil, which reports a constant 0.5 while down. */
function widthFor(e: PointerEvent): number {
  const p = e.pressure;
  if (p === 0 || p === undefined) return 2.5;
  return 1 + p * 9;
}

function attachPointerObservers(el: HTMLElement): void {
  el.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    caps['pointerType'] = e.pointerType;
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    current = [{ x: e.clientX, y: e.clientY, w: widthFor(e) }];
    recordPointerCaps(e);
    log(`pointerdown  type=${e.pointerType} pressure=${e.pressure.toFixed(3)}`);
    renderAll();
  });

  el.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    recordPointerCaps(e);

    if (e.pointerType === 'pen' && gesture) {
      gesture.penMovesTotal++;
      if (gesture.gateFired) gesture.penMovesAfterGate++;
    }

    // Sub-frame samples, where Safari supports them (18.2+).
    let samples: PointerEvent[] = [e];
    if (typeof e.getCoalescedEvents === 'function') {
      const c = e.getCoalescedEvents();
      if (c.length > 0) {
        samples = c;
        if (gesture) gesture.coalescedMax = Math.max(gesture.coalescedMax, c.length);
      }
    }
    if (current) {
      for (const s of samples) current.push({ x: s.clientX, y: s.clientY, w: widthFor(s) });
      redraw();
    }
  });

  const up = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
    if (current && current.length > 1) strokes.push(current);
    current = null;
    redraw();
  };
  el.addEventListener('pointerup', up);

  el.addEventListener('pointercancel', (ev) => {
    const e = ev as PointerEvent;
    if (gesture) gesture.cancels++;
    log(`POINTERCANCEL  type=${e.pointerType} — stroke interrupted`);
    // Commit what we have rather than losing the stroke.
    if (current && current.length > 1) strokes.push(current);
    current = null;
    redraw();
    renderAll();
  });
}

function recordPointerCaps(e: PointerEvent): void {
  if (e.pointerType !== 'pen') return;
  pressures.add(e.pressure.toFixed(3));
  caps['pressure (varying?)'] =
    pressures.size > 2
      ? `yes — ${pressures.size} distinct values seen`
      : `only ${[...pressures].join(', ')} so far`;
  caps['altitudeAngle'] =
    'altitudeAngle' in e && e.altitudeAngle !== undefined
      ? `supported (${e.altitudeAngle.toFixed(2)} rad)`
      : 'NOT supported';
  caps['azimuthAngle'] =
    'azimuthAngle' in e && e.azimuthAngle !== undefined
      ? `supported (${e.azimuthAngle.toFixed(2)} rad)`
      : 'NOT supported';
  caps['tiltX / tiltY'] = `${e.tiltX ?? 'n/a'} / ${e.tiltY ?? 'n/a'}`;
  caps['getCoalescedEvents()'] =
    typeof e.getCoalescedEvents === 'function'
      ? `supported (max ${gesture?.coalescedMax ?? 0} samples/event)`
      : 'NOT supported';
  caps['getPredictedEvents()'] =
    typeof e.getPredictedEvents === 'function' ? 'supported' : 'NOT supported';
}

// ── verdicts ─────────────────────────────────────────────────────────────────

function finishGesture(g: Gesture): void {
  // Did the map move during the gesture?
  if (map && g.centerAtStart) {
    const now = map.getCenter();
    const moved =
      Math.abs(now.lng - g.centerAtStart.lng) > 1e-6 ||
      Math.abs(now.lat - g.centerAtStart.lat) > 1e-6;
    g.panned = moved;
  }

  const onlyStylus = g.types.has('stylus') && [...g.types].every((t) => t === 'stylus');
  const onlyFinger = g.types.size > 0 && !g.types.has('stylus');

  if (g.concurrent) {
    const ok = g.penMovesTotal > 0 && g.panned;
    set('both', ok ? 'pass' : 'fail',
      `pen pointermove: ${g.penMovesTotal}\nmap panned: ${g.panned ? 'yes' : 'no'}\n` +
      (ok
        ? 'Drawing and panning worked at the same time.'
        : 'Did not get both at once. Try again with a clearly separate finger drag.'));
  }

  if (g.fingerAfterPen) {
    set('palm', 'done',
      `pointercancel fired: ${g.cancels > 0 ? `yes (${g.cancels}x)` : 'no'}\n` +
      (g.cancels > 0
        ? 'Strokes MUST commit incrementally — a second contact kills them.'
        : 'The stroke survived a second contact on this device.'));
  }

  if (onlyStylus) {
    const ok = g.gateFired && g.penMovesAfterGate > 0 && !g.panned;
    set('pen-only', ok ? 'pass' : 'fail',
      `gate fired: ${g.gateFired ? 'yes' : 'NO'}\n` +
      `pen pointermove after gate: ${g.penMovesAfterGate}\n` +
      `map panned: ${g.panned ? 'YES — gate did not hold' : 'no'}\n` +
      (ok
        ? 'Pointer events SURVIVE the gate. Simultaneous draw-and-pan is viable.'
        : g.gateFired && g.penMovesAfterGate === 0
          ? 'Gate fired but the pen pointer stream STOPPED. Ship the pen/pan mode toggle.'
          : !g.gateFired
            ? 'Gate never fired — touchType was not reported as "stylus". Check the Pencil is paired.'
            : 'The map panned despite the gate.'));
  }

  if (onlyFinger) {
    const ok = !g.gateFired && g.panned;
    set('finger-only', ok ? 'pass' : 'fail',
      `gate fired: ${g.gateFired ? 'YES — should not have' : 'no'}\n` +
      `map panned: ${g.panned ? 'yes' : 'NO'}\n` +
      (ok ? 'Finger panning is unaffected by the gate.' : 'Unexpected — see the values above.'));
  }

  log(`gesture end — types=[${[...g.types].join(',')}] gate=${g.gateFired} penMoves=${g.penMovesTotal} panned=${g.panned}`);
}

function set(id: TestId, state: TestState, detail: string): void {
  results.set(id, { state, detail });
}

// ── rendering the readout ────────────────────────────────────────────────────

const el = {
  tests: document.getElementById('tests')!,
  caps: document.getElementById('caps')!,
  device: document.getElementById('device')!,
  fps: document.getElementById('fps')!,
  verdict: document.getElementById('verdict-line')!,
  hint: document.getElementById('desktop-hint')!,
};

function rows(obj: Record<string, string | number | boolean>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      const s = String(v);
      const cls = /^yes|supported|^true/i.test(s) ? 'yes'
        : /NOT supported|^no$|^false|unavailable/i.test(s) ? 'no'
        : /not seen yet|so far/i.test(s) ? 'unk' : '';
      return `<div class="row"><span class="k">${k}</span><span class="v ${cls}">${escapeHtml(s)}</span></div>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const BADGE: Record<TestState, string> = {
  waiting: 'waiting', pass: 'pass', fail: 'fail', done: 'recorded',
};

function renderAll(): void {
  el.tests.innerHTML = TESTS.map((t) => {
    const r = results.get(t.id)!;
    return `<div class="test" data-state="${r.state}">
      <div class="t-head"><b>${t.title}</b><span class="badge">${BADGE[r.state]}</span></div>
      <div class="t-do">${escapeHtml(t.instruction)}</div>
      ${r.detail ? `<div class="t-result">${escapeHtml(r.detail)}</div>` : ''}
      <div class="t-why">${escapeHtml(t.why)}</div>
    </div>`;
  }).join('');

  el.caps.innerHTML = rows(caps);
  el.hint.hidden = sawAnyTouch;

  const penOnly = results.get('pen-only')!;
  el.verdict.textContent =
    penOnly.state === 'pass' ? 'Pen pointer events survive the gate — draw-and-pan is viable.'
    : penOnly.state === 'fail' ? 'Gate breaks the pen stream — the mode toggle is the answer.'
    : sawAnyTouch ? 'Touch seen. Run test 1 with the Pencil.'
    : 'Waiting for input…';
}

// ── fps ──────────────────────────────────────────────────────────────────────

const probe = new FpsProbe();
let lastFps = '';
let fpsTimer = 0;

function renderFps(): void {
  el.fps.innerHTML = rows({
    'last run': lastFps || 'not run yet',
    hillshade: hillshadeOn ? 'on' : 'off',
  });
}

document.getElementById('fps-toggle')!.addEventListener('click', (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  if (probe.isRunning) {
    clearTimeout(fpsTimer);
    lastFps = FpsProbe.format(probe.stop());
    btn.textContent = 'Start 10s measure';
  } else {
    probe.start();
    btn.textContent = 'Measuring… pinch now';
    fpsTimer = window.setTimeout(() => {
      lastFps = FpsProbe.format(probe.stop());
      btn.textContent = 'Start 10s measure';
      renderFps();
      log(`fps: ${lastFps}`);
    }, 10_000);
  }
  renderFps();
});

document.getElementById('hillshade-toggle')!.addEventListener('click', (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  hillshadeOn = !hillshadeOn;
  btn.textContent = hillshadeOn ? 'Hillshade off' : 'Hillshade on';
  // setStyle rather than a new Map: exactly one Map for the page's lifetime.
  map?.setStyle(atlasStyle({ base: BASE, hillshade: hillshadeOn }));
  log(`hillshade ${hillshadeOn ? 'ON' : 'OFF'}`);
  renderFps();
});

// ── buttons ──────────────────────────────────────────────────────────────────

document.getElementById('fold')!.addEventListener('click', (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  const panel = document.getElementById('readout')!;
  const collapsed = panel.classList.toggle('collapsed');
  btn.textContent = collapsed ? 'show' : 'hide';
});

document.getElementById('reset')!.addEventListener('click', () => {
  TESTS.forEach((t) => results.set(t.id, { state: 'waiting', detail: '' }));
  logLines.length = 0;
  logEl.textContent = '';
  renderAll();
});

document.getElementById('clear-ink')!.addEventListener('click', () => {
  strokes = [];
  current = null;
  redraw();
});

document.getElementById('copy')!.addEventListener('click', async (ev) => {
  const btn = ev.currentTarget as HTMLButtonElement;
  const report = buildReport();
  try {
    await navigator.clipboard.writeText(report);
    btn.textContent = 'Copied ✓';
  } catch {
    // iOS can refuse the async clipboard; fall back to a selectable textarea.
    const ta = document.createElement('textarea');
    ta.value = report;
    ta.style.cssText = 'position:fixed;top:10px;left:10px;width:90vw;height:70vh;z-index:99;font-size:12px';
    document.body.appendChild(ta);
    ta.select();
    btn.textContent = 'Select & copy ↑';
  }
  setTimeout(() => { btn.textContent = 'Copy report'; }, 2500);
});

function buildReport(): string {
  const L: string[] = [];
  L.push('WHAT-IF ATLAS — MILESTONE 0 DEVICE PROBE');
  L.push(new Date().toISOString());
  L.push('');
  L.push('--- VERDICT ---');
  L.push(el.verdict.textContent ?? '');
  L.push('');
  L.push('--- TESTS ---');
  for (const t of TESTS) {
    const r = results.get(t.id)!;
    L.push(`${t.title}: ${r.state.toUpperCase()}`);
    if (r.detail) L.push(r.detail.split('\n').map((s) => '    ' + s).join('\n'));
  }
  L.push('');
  L.push('--- PENCIL CAPABILITIES ---');
  for (const [k, v] of Object.entries(caps)) L.push(`  ${k}: ${v}`);
  L.push('');
  L.push('--- DEVICE ---');
  for (const [k, v] of Object.entries(deviceContext())) L.push(`  ${k}: ${v}`);
  L.push('');
  L.push('--- FRAME RATE ---');
  L.push(`  ${lastFps || 'not run'}   (hillshade ${hillshadeOn ? 'on' : 'off'})`);
  L.push('');
  L.push('--- LOG (last 80) ---');
  L.push(logLines.slice(-80).join('\n'));
  return L.join('\n');
}

// ── boot ─────────────────────────────────────────────────────────────────────

function boot(): void {
  // v6 throws GPUInitializationError from the constructor when WebGL2 is
  // missing, so construction is wrapped rather than version-sniffing iOS.
  try {
    map = buildMap();
  } catch (err) {
    document.getElementById('map')!.innerHTML =
      `<div style="padding:40px;font-family:var(--sans);color:#061019;background:#B9D7EB;height:100%">
         <h2>This browser cannot run the map</h2>
         <p>MapLibre v6 needs WebGL2. ${escapeHtml(String(err))}</p>
       </div>`;
    el.verdict.textContent = 'WebGL2 unavailable — the map could not start.';
    renderAll();
    return;
  }

  const container = map.getCanvasContainer();
  attachTouchObservers(container);
  attachPointerObservers(container);

  sizeInk();
  window.addEventListener('resize', sizeInk);
  // iPadOS 26 can resize the window at any time, and the visual viewport moves
  // independently as the address bar collapses.
  window.visualViewport?.addEventListener('resize', sizeInk);

  el.device.innerHTML = rows(deviceContext());
  renderFps();
  renderAll();
  log('probe ready');
}

boot();

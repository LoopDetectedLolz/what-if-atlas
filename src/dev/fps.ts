/**
 * Frame-rate probe.
 *
 * Safari has no Long Animation Frames API, so sampling the rAF timestamp in
 * page is the only way to get real numbers off an iPad. Desktop device
 * emulation is NOT a usable proxy: Chrome DevTools device mode runs Blink on
 * the Mac's GPU, while iPad Safari is WebKit with a different compositor,
 * a different tiling strategy and a thermally limited GPU. Layout can be
 * checked in an emulator; frame rate cannot.
 *
 * Reports p50 / p95 / worst frame time and the count of frames over 20 ms
 * (a dropped frame at 60 Hz). Those four numbers are the milestone gate.
 *
 * Usage:
 *   const probe = new FpsProbe();
 *   probe.start();                 // begins sampling
 *   const r = probe.stop();        // returns the summary
 */

export interface FpsSummary {
  /** Samples collected. */
  frames: number;
  /** Wall-clock duration of the run, ms. */
  durationMs: number;
  /** Mean frames per second over the run. */
  fps: number;
  p50: number;
  p95: number;
  worst: number;
  /** Frames longer than 20 ms — i.e. dropped at 60 Hz. */
  over20: number;
  /** Frames longer than 50 ms — visible stutter. */
  over50: number;
}

export class FpsProbe {
  private deltas: number[] = [];
  private last = 0;
  private raf = 0;
  private startedAt = 0;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.deltas = [];
    this.last = 0;
    this.running = true;
    this.startedAt = performance.now();

    const tick = (t: number): void => {
      // Skip the first callback: there is no previous timestamp to diff
      // against, and including it would record one absurd delta.
      if (this.last !== 0) this.deltas.push(t - this.last);
      this.last = t;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): FpsSummary {
    if (this.running) {
      cancelAnimationFrame(this.raf);
      this.running = false;
    }
    return this.summary();
  }

  summary(): FpsSummary {
    const d = [...this.deltas].sort((a, b) => a - b);
    const durationMs = performance.now() - this.startedAt;
    if (d.length === 0) {
      return { frames: 0, durationMs, fps: 0, p50: 0, p95: 0, worst: 0, over20: 0, over50: 0 };
    }
    // Nearest-rank percentile: index = ceil(p * n) - 1, clamped.
    const pct = (p: number): number => d[Math.min(d.length - 1, Math.max(0, Math.ceil(p * d.length) - 1))];
    const total = d.reduce((a, b) => a + b, 0);
    return {
      frames: d.length,
      durationMs,
      // Derive fps from the sampled frame times, not from frames/duration —
      // the two differ if rAF was throttled while the tab was backgrounded.
      fps: total > 0 ? (d.length / total) * 1000 : 0,
      p50: pct(0.5),
      p95: pct(0.95),
      worst: d[d.length - 1],
      over20: d.filter((x) => x > 20).length,
      over50: d.filter((x) => x > 50).length,
    };
  }

  static format(s: FpsSummary): string {
    if (s.frames === 0) return 'no frames sampled';
    return [
      `${s.fps.toFixed(1)} fps mean over ${(s.durationMs / 1000).toFixed(1)}s`,
      `p50 ${s.p50.toFixed(1)}ms`,
      `p95 ${s.p95.toFixed(1)}ms`,
      `worst ${s.worst.toFixed(1)}ms`,
      `${s.over20} frames >20ms`,
      `${s.over50} >50ms`,
    ].join('  ·  ');
  }
}

/**
 * Device facts worth recording alongside any measurement. Thermal state is
 * not exposed to the web, so warm-up has to be controlled by procedure
 * (see PLAN.md §6) rather than detected here.
 */
export function deviceContext(): Record<string, string | number | boolean> {
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    ua: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    webgl2: !!gl,
    renderer: dbg ? String(gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
    maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? 0,
    // Hardware concurrency hints at the core count MapLibre can use for tile work.
    cores: navigator.hardwareConcurrency ?? 0,
    touchPoints: navigator.maxTouchPoints ?? 0,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
  };
}

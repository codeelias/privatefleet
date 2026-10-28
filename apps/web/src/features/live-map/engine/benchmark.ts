/**
 * Browser performance instrumentation for the map quality gate (docs/17.5).
 * Enabled only with ?benchmark=1; otherwise every call is a no-op.
 *
 * Measures the operational contract: accepted GPS telemetry -> marker
 * visible in the DOM (p95), plus render frame times while the fleet moves.
 */
export interface BenchmarkSnapshot {
  enabled: boolean;
  /** Measurement basis: after-paint means the frame containing the draw. */
  basis: "after-paint";
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  frames: { count: number; p50Ms: number; p95Ms: number; maxMs: number; fps: number };
}

interface BenchWindow extends Window {
  __fleetBench?: { snapshot: () => BenchmarkSnapshot };
}

const enabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "1";

const receivedAt = new Map<string, number>();
const latencies: number[] = [];
const frameTimes: number[] = [];
let samplerStop: (() => void) | null = null;

export function benchEnabled(): boolean {
  return enabled;
}

/** Called when a telemetry sample is accepted (not when rejected). */
export function markTelemetry(vehicleId: string): void {
  if (!enabled) {
    return;
  }
  receivedAt.set(vehicleId, performance.now());
}

/** Called after a marker has rendered at its new position. */
export function markVisible(vehicleId: string): void {
  if (!enabled) {
    return;
  }
  const start = receivedAt.get(vehicleId);
  if (start === undefined) {
    return;
  }
  receivedAt.delete(vehicleId);
  const latency = performance.now() - start;
  if (latency >= 0 && latency < 60_000) {
    latencies.push(latency);
    if (latencies.length > 5_000) {
      latencies.shift();
    }
  }
}

/**
 * Ends latency measurement after the browser has painted the frame that
 * contains the canvas draw. rAF runs before paint; a task scheduled after
 * it runs after paint, which is the user-visible moment.
 */
export function markPainted(vehicleIds: string[]): void {
  if (!enabled || vehicleIds.length === 0 || typeof window === "undefined") {
    return;
  }
  requestAnimationFrame(() => {
    setTimeout(() => {
      for (const vehicleId of vehicleIds) {
        markVisible(vehicleId);
      }
    }, 0);
  });
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[index] ?? 0;
}

function snapshot(): BenchmarkSnapshot {
  const frameCount = frameTimes.length;
  const totalFrameMs = frameTimes.reduce((sum, value) => sum + value, 0);
  return {
    enabled,
    basis: "after-paint",
    samples: latencies.length,
    p50Ms: Number(quantile(latencies, 0.5).toFixed(1)),
    p95Ms: Number(quantile(latencies, 0.95).toFixed(1)),
    p99Ms: Number(quantile(latencies, 0.99).toFixed(1)),
    maxMs: Number(Math.max(0, ...latencies).toFixed(1)),
    frames: {
      count: frameCount,
      p50Ms: Number(quantile(frameTimes, 0.5).toFixed(1)),
      p95Ms: Number(quantile(frameTimes, 0.95).toFixed(1)),
      maxMs: Number(Math.max(0, ...frameTimes).toFixed(1)),
      fps: totalFrameMs > 0 ? Number(((frameCount * 1000) / totalFrameMs).toFixed(1)) : 0,
    },
  };
}

if (enabled && typeof window !== "undefined") {
  (window as BenchWindow).__fleetBench = { snapshot };
}

/** Starts the rAF frame sampler; returns a stop function. Idempotent. */
export function startBenchSampler(): () => void {
  if (!enabled || typeof window === "undefined") {
    return () => {};
  }
  if (samplerStop) {
    return samplerStop;
  }
  let last = performance.now();
  let handle = 0;
  const loop = (now: number): void => {
    frameTimes.push(now - last);
    if (frameTimes.length > 3_000) {
      frameTimes.shift();
    }
    last = now;
    handle = requestAnimationFrame(loop);
  };
  handle = requestAnimationFrame(loop);
  samplerStop = () => {
    cancelAnimationFrame(handle);
    samplerStop = null;
  };
  return samplerStop;
}

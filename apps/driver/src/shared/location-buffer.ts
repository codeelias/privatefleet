/**
 * Device location buffering (docs/09.6): keep a bounded window of samples,
 * drain the oldest in order, and merge failed batches back without
 * dropping location truth.
 */
export interface LocationSample {
  latitude: number;
  longitude: number;
  capturedAt: string;
  accuracyMetres?: number;
  headingDeg?: number;
  speedMps?: number;
}

export const LOCATION_BUFFER_CAP = 50;

export function pushSample(
  buffer: LocationSample[],
  sample: LocationSample,
  cap = LOCATION_BUFFER_CAP,
): LocationSample[] {
  const next = [...buffer, sample];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function takeBatch(
  buffer: LocationSample[],
  size = 20,
): { batch: LocationSample[]; rest: LocationSample[] } {
  return { batch: buffer.slice(0, size), rest: buffer.slice(size) };
}

export function mergeFailed(
  buffer: LocationSample[],
  failed: LocationSample[],
): LocationSample[] {
  // Failed samples keep priority over the steady-state cap: dropping the
  // very batch we are retrying would lose location truth.
  return [...failed, ...buffer];
}


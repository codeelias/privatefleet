/**
 * Telemetry ordering and staleness for the map engine (docs/17).
 * Out-of-order or duplicate samples must never move a marker backwards;
 * absence of fresh samples must surface as an honest stale state.
 */
export interface TelemetrySample {
  vehicleId: string;
  latitude: number;
  longitude: number;
  capturedAt: string;
  sequenceNo: number;
}

export interface VehicleTrack {
  latitude: number;
  longitude: number;
  capturedAtMs: number;
  sequenceNo: number;
  acceptedAtMs: number;
}

export type TrackMap = Record<string, VehicleTrack>;

export type RejectReason = "invalid_coordinates" | "stale_time" | "stale_sequence";

export interface AcceptResult {
  track: TrackMap;
  accepted: boolean;
  reason?: RejectReason;
}

function isValidSample(sample: TelemetrySample): boolean {
  return (
    Number.isFinite(sample.latitude) &&
    Number.isFinite(sample.longitude) &&
    sample.latitude >= -90 &&
    sample.latitude <= 90 &&
    sample.longitude >= -180 &&
    sample.longitude <= 180
  );
}

/**
 * Accept a sample only if it is newer than the last accepted sample for
 * that vehicle (by capture time and sequence). Older data is dropped.
 */
export function acceptTelemetry(
  track: TrackMap,
  sample: TelemetrySample,
  now: number,
): AcceptResult {
  if (!isValidSample(sample)) {
    return { track, accepted: false, reason: "invalid_coordinates" };
  }
  const existing = track[sample.vehicleId];
  const capturedAtMs = Date.parse(sample.capturedAt);
  if (!Number.isFinite(capturedAtMs)) {
    return { track, accepted: false, reason: "stale_time" };
  }
  if (existing) {
    if (sample.sequenceNo <= existing.sequenceNo) {
      return { track, accepted: false, reason: "stale_sequence" };
    }
    if (capturedAtMs < existing.capturedAtMs) {
      return { track, accepted: false, reason: "stale_time" };
    }
  }
  return {
    track: {
      ...track,
      [sample.vehicleId]: {
        latitude: sample.latitude,
        longitude: sample.longitude,
        capturedAtMs,
        sequenceNo: sample.sequenceNo,
        acceptedAtMs: now,
      },
    },
    accepted: true,
  };
}

/** Vehicles without an accepted sample within the threshold are stale. */
export function staleVehicleIds(
  track: TrackMap,
  now: number,
  staleAfterMs: number,
): Set<string> {
  const stale = new Set<string>();
  for (const [vehicleId, entry] of Object.entries(track)) {
    if (now - entry.capturedAtMs > staleAfterMs) {
      stale.add(vehicleId);
    }
  }
  return stale;
}

/**
 * Coalesce queued samples to the newest per vehicle (used when the
 * client is under load). Business events must never use this path.
 */
export function coalesceSamples(samples: TelemetrySample[]): TelemetrySample[] {
  const latest = new Map<string, TelemetrySample>();
  for (const sample of samples) {
    const current = latest.get(sample.vehicleId);
    if (!current) {
      latest.set(sample.vehicleId, sample);
      continue;
    }
    const sampleMs = Date.parse(sample.capturedAt);
    const currentMs = Date.parse(current.capturedAt);
    if (sample.sequenceNo > current.sequenceNo || sampleMs > currentMs) {
      latest.set(sample.vehicleId, sample);
    }
  }
  return [...latest.values()];
}

/**
 * PF-TIDE Core (Stage 1 shadow estimator).
 *
 * Pure TypeScript, server-authoritative. Processes observations in event-time
 * order, adaptive measurement covariance, statistical innovation testing
 * (NIS), stationary zero-velocity evidence and bounded current-time
 * prediction. Never mutates the original observation and never drives
 * production: it is a shadow mirroring the production feed.
 */

export interface PositionObservation {
  capturedAtMs: number;
  receivedAtMs: number;
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  speedMps?: number;
  headingDeg?: number;
  satellitesUsed?: number;
  source?: string;
  movementState?: "unknown" | "stationary" | "moving";
}

export type MotionMode = "STOPPED" | "STRAIGHT" | "TURNING" | "UNKNOWN";
export type FixStatus = "FRESH" | "DEGRADED" | "COASTING";

export interface PfTideSnapshot {
  corrected: { latitude: number; longitude: number };
  predicted: { latitude: number; longitude: number };
  correctedSigmaM: number;
  predictedSigmaM: number;
  motionMode: MotionMode;
  fixStatus: FixStatus;
  ageMs: number;
  nis: number | null;
  accepted: boolean;
  rejectionReason?: string;
  validUntilMs: number;
}

export const NIS_WARN = 5.99;
export const NIS_REJECT = 9.21;
const REPLAY_WINDOW_MS = 60_000;
const PREDICT_MAX_MS = 30_000;
const METRES_PER_DEG = 111_320;

interface FilterState {
  east: number;
  north: number;
  vEast: number;
  vNorth: number;
  p00: number;
  p11: number;
  p22: number;
  p33: number;
  anchorLat: number;
  anchorLng: number;
  mode: MotionMode;
  lastUpdateMs: number;
  lastAcceptMs: number;
}

function sigmaFromAccuracy(accuracyMetres: number): number {
  return Math.max(1.5, accuracyMetres / 1.51);
}

/** Adaptive measurement variance: worse evidence moves the estimate less. */
function adaptiveVariance(obs: PositionObservation): number {
  let sigma = sigmaFromAccuracy(obs.accuracyMetres);
  const sats = obs.satellitesUsed ?? 0;
  if (sats === 0) sigma *= 1.6;
  else if (sats < 6) sigma *= 1.25;
  else if (sats >= 12) sigma *= 0.9;
  if (obs.source === "network") sigma *= 1.5;
  if (obs.movementState === "stationary" && obs.speedMps !== undefined && obs.speedMps > 1.5) {
    sigma *= 1.3;
  }
  return sigma * sigma;
}

function processNoise(state: FilterState, dtSec: number): [number, number] {
  const posBase = state.mode === "STOPPED" ? 0.01 : state.mode === "UNKNOWN" ? 2.0 : 0.35;
  const velBase = state.mode === "STOPPED" ? 0.02 : 1.0;
  return [posBase * dtSec * dtSec, velBase * dtSec];
}

function toGeo(state: FilterState, east: number, north: number): { latitude: number; longitude: number } {
  const cosLat = Math.cos((state.anchorLat * Math.PI) / 180);
  return {
    latitude: state.anchorLat + north / 110_540,
    longitude: state.anchorLng + east / (METRES_PER_DEG * cosLat),
  };
}

export class PfTideEstimator {
  private state: FilterState | null = null;
  private buffer: PositionObservation[] = [];
  private lastOutput: PfTideSnapshot | null = null;

  process(obs: PositionObservation, nowMs: number): PfTideSnapshot {
    this.insertBuffer(obs);
    return this.recompute(nowMs);
  }

  private insertBuffer(obs: PositionObservation): void {
    const index = this.buffer.findIndex((entry) => entry.capturedAtMs > obs.capturedAtMs);
    if (index === -1) this.buffer.push(obs);
    else this.buffer.splice(index, 0, obs);
    const newest = this.buffer[this.buffer.length - 1]!.capturedAtMs;
    this.buffer = this.buffer.filter((entry) => entry.capturedAtMs >= newest - REPLAY_WINDOW_MS);
    if (this.buffer.length > 240) this.buffer = this.buffer.slice(-240);
  }

  private recompute(nowMs: number): PfTideSnapshot {
    this.state = null;
    let snapshot: PfTideSnapshot | null = null;
    for (const obs of this.buffer) {
      snapshot = this.applyObservation(obs, nowMs);
    }
    this.lastOutput = snapshot ?? this.coastSnapshot(nowMs);
    return this.lastOutput;
  }

  private applyObservation(obs: PositionObservation, nowMs: number): PfTideSnapshot {
    if (!this.state) {
      const variance = adaptiveVariance(obs);
      this.state = {
        east: 0,
        north: 0,
        vEast: 0,
        vNorth: 0,
        p00: variance,
        p11: variance,
        p22: 4,
        p33: 4,
        anchorLat: obs.latitude,
        anchorLng: obs.longitude,
        mode: "UNKNOWN",
        lastUpdateMs: obs.capturedAtMs,
        lastAcceptMs: obs.capturedAtMs,
      };
      return this.buildSnapshot(obs, nowMs, null, true);
    }

    const dtSec = Math.max(0, (obs.capturedAtMs - this.state.lastUpdateMs) / 1000);
    this.predict(dtSec);

    const cosLat = Math.cos((this.state.anchorLat * Math.PI) / 180);
    const east = (obs.longitude - this.state.anchorLng) * METRES_PER_DEG * cosLat;
    const north = (obs.latitude - this.state.anchorLat) * 110_540;

    const r = adaptiveVariance(obs);
    const s00 = this.state.p00 + r;
    const s11 = this.state.p11 + r;
    const innovation = Math.hypot(east - this.state.east, north - this.state.north);
    const nis = Math.hypot(
      (east - this.state.east) / Math.sqrt(Math.max(1e-6, s00)),
      (north - this.state.north) / Math.sqrt(Math.max(1e-6, s11)),
    );

    let accepted = true;
    let rejectionReason: string | undefined;
    if (nis > NIS_REJECT) {
      accepted = false;
      rejectionReason = "NIS reject";
    } else if (nis > NIS_WARN) {
      this.update(east, north, r * 3, dtSec); // cautious down-weight
    } else {
      this.update(east, north, r, dtSec);
    }

    this.updateMode(obs, innovation);

    const snapshot = this.buildSnapshot(obs, nowMs, nis, accepted);
    if (rejectionReason) snapshot.rejectionReason = rejectionReason;
    if (accepted) {
      this.state.lastUpdateMs = obs.capturedAtMs;
      this.state.lastAcceptMs = obs.capturedAtMs;
    }
    return snapshot;
  }

  private predict(dtSec: number): void {
    const state = this.state!;
    if (dtSec <= 0) return;
    const [qPos, qVel] = processNoise(state, dtSec);
    state.east += state.vEast * dtSec;
    state.north += state.vNorth * dtSec;
    state.p00 = state.p00 + dtSec * dtSec * state.p22 + qPos;
    state.p11 = state.p11 + dtSec * dtSec * state.p33 + qPos;
    state.p22 = state.p22 + qVel;
    state.p33 = state.p33 + qVel;
  }

  private update(east: number, north: number, r: number, dtSec: number): void {
    const state = this.state!;
    const kE = state.p00 / (state.p00 + r);
    const kN = state.p11 / (state.p11 + r);
    const step = Math.max(0.5, dtSec);
    const dvE = (east - state.east) / step;
    const dvN = (north - state.north) / step;
    state.vEast = 0.7 * state.vEast + 0.3 * Math.max(-40, Math.min(40, dvE));
    state.vNorth = 0.7 * state.vNorth + 0.3 * Math.max(-40, Math.min(40, dvN));
    state.east += kE * (east - state.east);
    state.north += kN * (north - state.north);
    state.p00 *= 1 - kE;
    state.p11 *= 1 - kN;
  }

  private updateMode(obs: PositionObservation, innovation: number): void {
    const state = this.state!;
    const speed = obs.speedMps;
    if (obs.movementState === "stationary" || (speed !== undefined && speed <= 1.0 && innovation <= Math.max(10, obs.accuracyMetres))) {
      state.mode = "STOPPED";
      state.vEast = 0;
      state.vNorth = 0;
      return;
    }
    if (speed !== undefined && speed >= 2.5) {
      state.mode = "STRAIGHT";
      return;
    }
    if (innovation > Math.max(2 * obs.accuracyMetres, 25)) {
      state.mode = "UNKNOWN";
      return;
    }
    if (state.mode === "UNKNOWN") state.mode = "STRAIGHT";
  }

  private buildSnapshot(
    obs: PositionObservation,
    nowMs: number,
    nis: number | null,
    accepted: boolean,
  ): PfTideSnapshot {
    const state = this.state!;
    const geo = toGeo(state, state.east, state.north);
    const ageMs = Math.max(0, nowMs - obs.capturedAtMs);
    const sigmaNow = Math.sqrt(Math.max(state.p00, state.p11));
    const horizonMs = Math.min(PREDICT_MAX_MS, 5000 + Math.round(Math.min(sigmaNow, 100) * 1000));
    const ahead = this.predictAhead(horizonMs);
    const fixStatus: FixStatus =
      ageMs > horizonMs ? "COASTING" : sigmaNow > 25 ? "DEGRADED" : "FRESH";
    return {
      corrected: geo,
      predicted: ahead.geo,
      correctedSigmaM: sigmaNow,
      predictedSigmaM: ahead.sigma,
      motionMode: state.mode,
      fixStatus,
      ageMs,
      nis,
      accepted,
      validUntilMs: obs.capturedAtMs + horizonMs,
    };
  }

  private predictAhead(horizonMs: number): { geo: { latitude: number; longitude: number }; sigma: number } {
    const state = this.state!;
    const dtSec = horizonMs / 1000;
    const [qPos] = processNoise(state, dtSec);
    const east = state.east + state.vEast * dtSec;
    const north = state.north + state.vNorth * dtSec;
    const sigma = Math.sqrt(Math.max(state.p00, state.p11) + qPos);
    return { geo: toGeo(state, east, north), sigma };
  }

  private coastSnapshot(nowMs: number): PfTideSnapshot {
    if (this.lastOutput) return { ...this.lastOutput, fixStatus: "COASTING" as FixStatus };
    return {
      corrected: { latitude: 0, longitude: 0 },
      predicted: { latitude: 0, longitude: 0 },
      correctedSigmaM: Number.POSITIVE_INFINITY,
      predictedSigmaM: Number.POSITIVE_INFINITY,
      motionMode: "UNKNOWN",
      fixStatus: "COASTING",
      ageMs: nowMs,
      nis: null,
      accepted: false,
      rejectionReason: "no observations",
      validUntilMs: nowMs,
    };
  }
}

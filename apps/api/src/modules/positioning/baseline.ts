/**
 * Stage 0: baseline metrics over stored observations (pure, replayable).
 * Category A only - stability/consistency, never claims of absolute accuracy.
 */
import type { PositionObservation } from "./pf-tide";

export interface BaselineMetrics {
  count: number;
  medianDisplacementM: number;
  p95DisplacementM: number;
  medianAccuracyM: number;
  medianAgeMs: number;
  sourceChanges: number;
  stationarySpreadM: number;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index]!;
}

export function computeBaselineMetrics(points: PositionObservation[]): BaselineMetrics {
  const ordered = [...points].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  const displacements: number[] = [];
  let sourceChanges = 0;
  const stationary: PositionObservation[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const a = ordered[index - 1]!;
    const b = ordered[index]!;
    const dLat = (b.latitude - a.latitude) * 110_540;
    const dLng = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180);
    displacements.push(Math.hypot(dLat, dLng));
    if (a.source && b.source && a.source !== b.source) sourceChanges += 1;
    if (a.movementState === "stationary") stationary.push(a);
    if (index === ordered.length - 1 && b.movementState === "stationary") stationary.push(b);
  }
  const sortedDisplacements = [...displacements].sort((a, b) => a - b);
  const accuracies = ordered.map((p) => p.accuracyMetres).sort((a, b) => a - b);
  const ages = ordered.map((p) => p.receivedAtMs - p.capturedAtMs).sort((a, b) => a - b);

  let stationarySpread = 0;
  if (stationary.length >= 2) {
    const meanLat = stationary.reduce((sum, p) => sum + p.latitude, 0) / stationary.length;
    const meanLng = stationary.reduce((sum, p) => sum + p.longitude, 0) / stationary.length;
    stationarySpread = Math.max(
      ...stationary.map((p) =>
        Math.hypot(
          (p.latitude - meanLat) * 110_540,
          (p.longitude - meanLng) * 111_320 * Math.cos((meanLat * Math.PI) / 180),
        ),
      ),
    );
  }

  return {
    count: ordered.length,
    medianDisplacementM: percentile(sortedDisplacements, 0.5),
    p95DisplacementM: percentile(sortedDisplacements, 0.95),
    medianAccuracyM: percentile(accuracies, 0.5),
    medianAgeMs: percentile(ages, 0.5),
    sourceChanges,
    stationarySpreadM: stationarySpread,
  };
}

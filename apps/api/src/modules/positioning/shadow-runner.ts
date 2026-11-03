/**
 * Stage 2: run the PF-TIDE shadow estimator alongside production ingestion.
 * Purely observational: production responses never read this state.
 */
import { PfTideEstimator, type PfTideSnapshot, type PositionObservation } from "./pf-tide";
import { computeBaselineMetrics, type BaselineMetrics } from "./baseline";

interface VehicleRunner {
  estimator: PfTideEstimator;
  history: PositionObservation[];
  last: PfTideSnapshot | null;
}

const MAX_HISTORY = 500;
const runners = new Map<string, VehicleRunner>();

function runnerFor(vehicleId: string): VehicleRunner {
  let runner = runners.get(vehicleId);
  if (!runner) {
    runner = { estimator: new PfTideEstimator(), history: [], last: null };
    runners.set(vehicleId, runner);
  }
  return runner;
}

export function observeVehiclePosition(vehicleId: string, obs: PositionObservation): void {
  const runner = runnerFor(vehicleId);
  runner.last = runner.estimator.process(obs, obs.receivedAtMs);
  runner.history.push(obs);
  if (runner.history.length > MAX_HISTORY) runner.history.shift();
}

export interface ShadowReport {
  vehicleId: string;
  snapshot: PfTideSnapshot | null;
  baseline: BaselineMetrics;
}

export function shadowReports(): ShadowReport[] {
  const reports: ShadowReport[] = [];
  for (const [vehicleId, runner] of runners) {
    reports.push({
      vehicleId,
      snapshot: runner.last,
      baseline: computeBaselineMetrics(runner.history),
    });
  }
  return reports.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
}

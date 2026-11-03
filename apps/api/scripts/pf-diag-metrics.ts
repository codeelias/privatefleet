/**
 * Parse pf-diag logcat lines into observations and compute Category A metrics.
 * usage: tsx scripts/pf-diag-metrics.ts <logfile>
 */
import { readFileSync } from "node:fs";
import { computeBaselineMetrics } from "../src/modules/positioning/baseline";
import type { PositionObservation } from "../src/modules/positioning/pf-tide";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/pf-diag-metrics.ts <logfile>");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
const observations: PositionObservation[] = [];
const rawCount = (text.match(/pf-raw\s+:/g) ?? []).length;
let rejected = 0;

for (const line of text.split("\n")) {
  const match = /pf-diag\s+:\s+provider=(\S+)\s+acc=([\d.]+)\s+ageMs=(-?[\d.]+)\s+lat=([\d.-]+)\s+lng=([\d.-]+)\s+wallClock=(\d+)\s+elapsed=(\d+)\s+speed=(\S+)\s+speedAcc=(\S+)\s+bearing=(\S+)\s+bearingAcc=(\S+)\s+dist=([\d.-]+)\s+decision=([a-z\- ]+?)\s+state=(\S+)/.exec(
    line,
  );
  if (!match) continue;
  const [, provider, acc, ageMs, lat, lng, wallClock, elapsed, speed, speedAcc, bearing, bearingAcc, dist, decision, state] = match;
  if (decision !== "accepted pass-through" && decision !== "accepted held") {
    rejected += 1;
    continue;
  }
  const capturedMs = Number(wallClock);
  const num = (v: string): number | undefined => (v === "n/a" ? undefined : Number(v));
  observations.push({
    capturedAtMs: capturedMs,
    receivedAtMs: capturedMs + Math.max(0, Number(ageMs)),
    latitude: Number(lat),
    longitude: Number(lng),
    accuracyMetres: Number(acc),
    ...(num(speed) !== undefined ? { speedMps: num(speed) } : {}),
    source: provider === "gps" ? "gnss" : "network",
    ...(state && state !== "unknown"
      ? { movementState: state as PositionObservation["movementState"] }
      : {}),
  });
}

const metrics = computeBaselineMetrics(observations);
console.log(
  `obs=${metrics.count} rejected=${rejected} rawLines=${rawCount}`,
);
console.log(
  `medianDisp=${metrics.medianDisplacementM.toFixed(1)}m p95Disp=${metrics.p95DisplacementM.toFixed(1)}m ` +
    `medianAcc=${metrics.medianAccuracyM.toFixed(1)}m medianAge=${(metrics.medianAgeMs / 1000).toFixed(1)}s ` +
    `sourceChanges=${metrics.sourceChanges} stationarySpread=${metrics.stationarySpreadM.toFixed(1)}m`,
);

/**
 * Stage 0 CLI: compute Category A baseline metrics from an exported CSV of
 * location_points. Run with tsx; reads CSV path from argv[2].
 */
import { readFileSync } from "node:fs";
import { computeBaselineMetrics } from "../src/modules/positioning/baseline";
import type { PositionObservation } from "../src/modules/positioning/pf-tide";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/baseline-cli.ts <baseline.csv>");
  process.exit(1);
}

const lines = readFileSync(path, "utf8").trim().split("\n");
if (lines.length < 2) {
  console.error("empty CSV");
  process.exit(1);
}
const header = lines[0]!.split(",").map((h) => h.trim());

const byVehicle = new Map<string, PositionObservation[]>();
for (const line of lines.slice(1)) {
  const cols = line.split(",");
  const row: Record<string, string> = {};
  header.forEach((name, index) => (row[name] = cols[index] ?? ""));
  const vehicleId = row["vehicle_id"] ?? "unknown";
  const points = byVehicle.get(vehicleId) ?? [];
  const movement = row["movement_state"];
  points.push({
    capturedAtMs: new Date(row["captured_at"]!).getTime(),
    receivedAtMs: new Date(row["received_at"]!).getTime(),
    latitude: Number(row["latitude"]),
    longitude: Number(row["longitude"]),
    accuracyMetres: Number(row["accuracy_metres"] ?? 0),
    ...(row["speed_mps"] ? { speedMps: Number(row["speed_mps"]) } : {}),
    ...(row["source"] ? { source: row["source"] } : {}),
    ...(row["satellites_used"] ? { satellitesUsed: Number(row["satellites_used"]) } : {}),
    ...(movement && movement !== "null"
      ? { movementState: movement as PositionObservation["movementState"] }
      : {}),
  });
  byVehicle.set(vehicleId, points);
}

for (const [vehicleId, points] of byVehicle) {
  const metrics = computeBaselineMetrics(points);
  console.log(
    `${vehicleId}: n=${metrics.count} medianDisp=${metrics.medianDisplacementM.toFixed(1)}m ` +
      `p95Disp=${metrics.p95DisplacementM.toFixed(1)}m medianAcc=${metrics.medianAccuracyM.toFixed(1)}m ` +
      `medianAge=${(metrics.medianAgeMs / 1000).toFixed(1)}s sourceChanges=${metrics.sourceChanges} ` +
      `stationarySpread=${metrics.stationarySpreadM.toFixed(1)}m`,
  );
}

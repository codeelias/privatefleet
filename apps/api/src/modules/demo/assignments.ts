/**
 * Assignment truth for the demo scenarios (docs/14.2, docs/16.5).
 *
 * One source used by the in-memory store AND the route-geometry fixture
 * generator, so rendered routes, board assignments and simulator paths
 * cannot drift apart. Driver indexes refer to DRIVER_SEEDS.
 */
import type { ScenarioName } from "@privatefleet/contracts";

export interface Assignment {
  ref: string;
  driver: number;
  /** Proof of Service starts with the first stop already arrived. */
  started?: boolean;
}

const MORNING_RUSH: Assignment[] = [
  { ref: "J-196", driver: 0 },
  { ref: "J-201", driver: 0 },
  { ref: "J-182", driver: 0 },
  { ref: "J-202", driver: 1 },
  { ref: "J-205", driver: 1 },
  { ref: "J-191", driver: 1 },
  { ref: "J-214", driver: 2 },
  { ref: "J-219", driver: 2 },
];

export const SCENARIO_ASSIGNMENTS: Record<ScenarioName, Assignment[]> = {
  "morning-rush": MORNING_RUSH,
  // Emergency keeps the operational assignments and adds the STAT job
  // (unassigned) plus a stale-GPS driver; geometry is the same circuit.
  emergency: MORNING_RUSH,
  proof: [
    { ref: "J-198", driver: 0, started: true },
    { ref: "J-202", driver: 1 },
    { ref: "J-205", driver: 1 },
    { ref: "J-191", driver: 1 },
    { ref: "J-214", driver: 2 },
    { ref: "J-219", driver: 2 },
  ],
};

export function assignmentsForDriver(
  scenario: ScenarioName,
  driver: number,
): Assignment[] {
  return SCENARIO_ASSIGNMENTS[scenario].filter((assignment) => assignment.driver === driver);
}

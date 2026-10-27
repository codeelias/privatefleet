/**
 * Demo GPS simulator (docs/09.8): moves demo vehicles along seeded
 * polylines and publishes through the same telemetry path real devices
 * will use. DEMO_MODE only.
 */
import type { RealtimeBus } from "../../lib/realtime.js";
import type { DemoStore } from "./store.js";

export function startSimulator(
  store: DemoStore,
  bus: RealtimeBus,
  intervalMs = 2000,
): () => void {
  const timer = setInterval(() => {
    for (const vehicleId of store.vehicleIds()) {
      const position = store.advanceVehicle(vehicleId);
      if (position) {
        bus.publishTelemetry(position);
      }
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

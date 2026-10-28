import { describe, expect, it } from "vitest";
import { DemoStore } from "./store.js";

describe("authoritative route versions", () => {
  it("stamps every route, bumps on publish and rejects stale publishes", () => {
    const store = new DemoStore("morning-rush");
    const before = store.fleetState();
    expect(before.routeVersion).toBeGreaterThanOrEqual(1);
    expect(before.routes.length).toBeGreaterThan(0);
    for (const route of before.routes) {
      expect(route.version).toBe(before.routeVersion);
    }

    const driverId = before.drivers[0]?.id;
    expect(driverId).toBeTruthy();
    const run = store.runOptimization(driverId!);
    const published = store.approve(run.runId, before.routeVersion);
    expect(published.published).toBe(true);

    const after = store.fleetState();
    expect(after.routeVersion).toBe(before.routeVersion + 1);
    expect(after.routes.every((route) => route.version === after.routeVersion)).toBe(true);

    // A client that saw the previous version must not overwrite the plan.
    expect(() => store.approve(run.runId, before.routeVersion)).toThrow(
      "ROUTE_VERSION_STALE",
    );
    expect(store.fleetState().routeVersion).toBe(after.routeVersion);
  });
});

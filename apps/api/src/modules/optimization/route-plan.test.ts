import { describe, expect, it } from "vitest";
import { buildRoutePlan, RoutePlanError } from "./route-plan.js";

const p = (latitude: number, longitude: number) => ({ latitude, longitude });

function legsFor(points: Array<{ latitude: number; longitude: number }>) {
  return points.slice(0, -1).map((from, index) => ({
    points: [from, points[index + 1]!],
    distanceMetres: 100,
    durationSeconds: 20,
  }));
}

describe("route plan builder", () => {
  it("creates N-1 version-scoped legs for N waypoints in stop order", () => {
    const geometry = [p(51.5, -0.12), p(51.51, -0.11), p(51.52, -0.1)];
    const plan = buildRoutePlan({
      routeId: "route-a",
      geometry,
      legs: legsFor(geometry),
      stops: [
        { stopId: "stop-1", jobId: "job-1", stopType: "pickup" },
        { stopId: "stop-2", jobId: "job-1", stopType: "dropoff" },
      ],
      stopArrivals: [1_760_000_000, undefined],
    });
    expect(plan.waypoints).toHaveLength(3);
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[0]).toMatchObject({
      fromWaypointId: "route-a:waypoint:0",
      toWaypointId: "route-a:waypoint:1",
      sequence: 0,
    });
    expect(plan.waypoints[1]?.plannedArrivalAt).toBe("2025-10-09T08:53:20.000Z");
    expect(plan.waypoints[2]?.plannedArrivalAt).toBeNull();
  });

  it("rejects incomplete router legs without inventing geometry", () => {
    const geometry = [p(51.5, -0.12), p(51.51, -0.11)];
    expect(() =>
      buildRoutePlan({
        routeId: "route-b",
        geometry,
        legs: [],
        stops: [{ stopId: "stop-1" }],
      }),
    ).toThrow(RoutePlanError);
  });

  it("keeps leg identities version-scoped and deterministic for the same route", () => {
    const geometry = [p(51.5, -0.12), p(51.51, -0.11)];
    const base = {
      geometry,
      legs: legsFor(geometry),
      stops: [{ stopId: "stop-1" }],
    };
    const first = buildRoutePlan({ ...base, routeId: "route-v1" });
    const again = buildRoutePlan({ ...base, routeId: "route-v1" });
    const nextVersion = buildRoutePlan({ ...base, routeId: "route-v2" });
    expect(again.legs.map((leg) => leg.id)).toEqual(first.legs.map((leg) => leg.id));
    expect(nextVersion.legs.map((leg) => leg.id)).not.toEqual(first.legs.map((leg) => leg.id));
    expect(first.legs[0]!.id).toContain("route-v1");
    expect(nextVersion.legs[0]!.id).toContain("route-v2");
  });

  it("handles a revisited road/loop without borrowing geometry", () => {
    const geometry = [p(51.5, -0.12), p(51.51, -0.11), p(51.5, -0.12), p(51.52, -0.1)];
    const plan = buildRoutePlan({
      routeId: "route-loop",
      geometry,
      legs: legsFor(geometry),
      stops: [{ stopId: "a" }, { stopId: "b" }, { stopId: "c" }],
    });
    expect(plan.legs).toHaveLength(3);
    expect(plan.legs[1]!.fromWaypointId).toBe(plan.waypoints[1]!.id);
    expect(plan.legs[1]!.toWaypointId).toBe(plan.waypoints[2]!.id);
  });

  it("supports co-located stops and keeps distinct leg identities", () => {
    const geometry = [p(51.5, -0.12), p(51.5, -0.12), p(51.5, -0.12)];
    const plan = buildRoutePlan({
      routeId: "route-c",
      geometry,
      legs: legsFor(geometry),
      stops: [{ stopId: "stop-1" }, { stopId: "stop-2" }],
    });
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[0]!.id).not.toBe(plan.legs[1]!.id);
  });
});




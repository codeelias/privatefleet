import { describe, expect, it } from "vitest";
import {
  buildRecommendations,
  routeCostPence,
  type RouteCandidate,
  type UnassignedJobCandidate,
} from "./recommendations.js";

const depot = { latitude: 51.5, longitude: -0.1 };
const route: RouteCandidate = {
  driverId: "d1",
  driverName: "Mo Khan",
  vehicleId: "v1",
  registration: "VAN-01",
  stops: [depot, { latitude: 51.51, longitude: -0.1 }],
  distanceMetres: 20_000,
  durationSeconds: 3600,
  stopCount: 2,
  limits: {
    maxDistanceM: 120_000,
    maxTravelTimeS: 18_000,
    maxWorkingDurationS: 25_200,
    maxVisits: 30,
  },
};

const nearJob: UnassignedJobCandidate = {
  jobId: "j1",
  reference: "G-NEAR",
  priority: "standard",
  pickup: { latitude: 51.505, longitude: -0.1 },
  dropoff: { latitude: 51.512, longitude: -0.101 },
};

const farJob: UnassignedJobCandidate = {
  jobId: "j2",
  reference: "G-FAR",
  priority: "standard",
  pickup: { latitude: 51.9, longitude: 0.2 },
  dropoff: { latitude: 51.91, longitude: 0.21 },
};

const economics = {
  fuelPencePerKm: 12,
  vehiclePencePerKm: 8,
  driverPencePerHour: 1500,
  maxDetourKm: 4,
};

describe("cost-aware recommendations", () => {
  it("prices running cost and wage separately", () => {
    expect(
      routeCostPence(10_000, 3600, {
        fuelPencePerKm: 10,
        vehiclePencePerKm: 5,
        driverPencePerHour: 1200,
        maxDetourKm: 4,
      }),
    ).toBe(150 + 1200);
  });

  it("recommends a job near the route with a reason and cost", () => {
    const [result] = buildRecommendations(route, [nearJob], economics);
    expect(result?.jobId).toBe("j1");
    expect(result?.detourKm).toBeGreaterThan(0);
    expect(result?.addedMinutes).toBeGreaterThan(0);
    expect(result?.addedCostPence).toBeGreaterThan(0);
    expect(result?.reason).toContain("pickup");
  });

  it("rejects jobs outside the detour threshold", () => {
    expect(buildRecommendations(route, [farJob], economics)).toHaveLength(0);
  });

  it("rejects a job that would exceed the route visit limit", () => {
    const limited: RouteCandidate = {
      ...route,
      stopCount: 29,
      limits: { ...route.limits, maxVisits: 30 },
    };
    expect(buildRecommendations(limited, [nearJob], economics)).toHaveLength(0);
  });
});

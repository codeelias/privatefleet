import { describe, expect, it } from "vitest";
import type { FleetState } from "@privatefleet/contracts";
import { buildHeadsUp } from "./heads-up";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const point = (latitude: number, longitude: number) => ({ latitude, longitude });

function baseState(overrides: Record<string, unknown> = {}): FleetState {
  return {
    tenantId: "tenant-1",
    demoMode: true,
    serverTime: new Date(NOW).toISOString(),
    routeVersion: 1,
    drivers: [{ id: "driver-1", fullName: "Mo Khan", status: "on_route" }],
    vehicles: [
      {
        id: "vehicle-1",
        registration: "VAN-01",
        vehicleType: "van",
        status: "on_route",
        driverId: "driver-1",
        location: point(51.5, -0.12),
        stale: false,
        locationStatus: "live",
        lastSeenAt: new Date(NOW - 2_000).toISOString(),
        accuracyMetres: 8,
      },
    ],
    routes: [
      {
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        version: 1,
        points: [point(51.5, -0.12), point(51.5, -0.11)],
        waypoints: [
          { id: "w0", sequence: 0, kind: "origin", location: point(51.5, -0.12) },
          {
            id: "w1",
            sequence: 1,
            kind: "job_stop",
            jobStopId: "stop-1",
            jobId: "job-1",
            stopType: "pickup",
            location: point(51.5, -0.11),
          },
        ],
        legs: [
          {
            id: "leg-1",
            sequence: 0,
            fromWaypointId: "w0",
            toWaypointId: "w1",
            points: [point(51.5, -0.12), point(51.5, -0.11)],
            distanceM: 690,
            estimatedDurationS: 600,
          },
        ],
      },
    ],
    jobs: [
      {
        id: "job-1",
        reference: "B01-001",
        serviceType: "delivery",
        priority: "standard",
        status: "in_progress",
        assignedDriverId: "driver-1",
        assignedVehicleId: "vehicle-1",
        version: 1,
        stops: [
          {
            id: "stop-1",
            jobId: "job-1",
            sequenceNo: 1,
            stopType: "pickup",
            address: "Buckingham Palace, London",
            location: point(51.5, -0.11),
            status: "pending",
            windowStart: new Date(NOW - 15 * 60_000).toISOString(),
            windowEnd: new Date(NOW - 10 * 60_000).toISOString(),
          },
        ],
      },
    ],
    alerts: [],
    serviceZones: [],
    ...overrides,
  } as unknown as FleetState;
}

describe("heads-up risk model", () => {
  it("projects a late stop from remaining published-leg duration", () => {
    const result = buildHeadsUp(baseState(), NOW);
    const late = result.items.find((item) => item.kind === "late");
    expect(late).toBeDefined();
    expect(late!.severity).toBe("critical");
    expect(late!.minutesLate).toBeGreaterThanOrEqual(15);
  });

  it("does not flag a stop whose window is comfortably ahead", () => {
    const state = baseState();
    state.jobs[0]!.stops[0]!.windowEnd = new Date(NOW + 60 * 60_000).toISOString();
    expect(buildHeadsUp(state, NOW).items.some((item) => item.kind === "late")).toBe(false);
  });

  it("flags an unassigned job whose window opens within an hour", () => {
    const state = baseState({
      routes: [],
      jobs: [
        {
          id: "job-2",
          reference: "B02-001",
          serviceType: "delivery",
          priority: "urgent",
          status: "unassigned",
          version: 1,
          stops: [
            {
              id: "stop-2",
              jobId: "job-2",
              sequenceNo: 1,
              stopType: "pickup",
              address: "Tate Modern, London",
              location: point(51.5, -0.1),
              status: "pending",
              windowStart: new Date(NOW + 30 * 60_000).toISOString(),
              windowEnd: new Date(NOW + 120 * 60_000).toISOString(),
            },
          ],
        },
      ],
    });
    const result = buildHeadsUp(state, NOW);
    expect(result.items.some((item) => item.kind === "unassigned")).toBe(true);
  });

  it("flags stale tracking and an off-route vehicle", () => {
    const state = baseState();
    state.vehicles[0]!.stale = true;
    state.vehicles[0]!.locationStatus = "stale";
    const stale = buildHeadsUp(state, NOW);
    expect(stale.items.some((item) => item.kind === "stale_gps")).toBe(true);

    state.vehicles[0]!.stale = false;
    state.vehicles[0]!.locationStatus = "live";
    state.vehicles[0]!.location = point(51.55, -0.05);
    const offRoute = buildHeadsUp(state, NOW);
    expect(offRoute.items.some((item) => item.kind === "off_route")).toBe(true);
  });

  it("flags an assigned job with no active route", () => {
    const state = baseState({ routes: [] });
    expect(buildHeadsUp(state, NOW).items.some((item) => item.kind === "no_route")).toBe(true);
  });
});

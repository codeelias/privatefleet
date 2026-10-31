/**
 * Regression: VROOM can interleave shipments (pickup A, pickup B,
 * delivery A, delivery B). The planner must keep that exact visit order
 * through geometry, legs and stop arrivals instead of pairing each
 * shipment's pickup and drop-off together.
 */
import { describe, expect, it } from "vitest";
import type { GeoPoint } from "@privatefleet/contracts";
import { planFleet } from "./plan.js";
import type { RoutingClients, VroomSolution, VroomVisitRef } from "./types.js";

const depot: GeoPoint = { latitude: 51.5, longitude: -0.1 };
const aPickup: GeoPoint = { latitude: 51.51, longitude: -0.11 };
const bPickup: GeoPoint = { latitude: 51.52, longitude: -0.12 };
const aDrop: GeoPoint = { latitude: 51.53, longitude: -0.13 };
const bDrop: GeoPoint = { latitude: 51.54, longitude: -0.14 };

const visits: VroomVisitRef[] = [
  { kind: "shipment", id: "A", role: "pickup" },
  { kind: "shipment", id: "B", role: "pickup" },
  { kind: "shipment", id: "A", role: "delivery" },
  { kind: "shipment", id: "B", role: "delivery" },
];

function matrix(points: GeoPoint[]) {
  return {
    durations: points.map(() => points.map(() => 60)),
    distances: points.map(() => points.map(() => 600)),
  };
}

describe("planner visit ordering", () => {
  it("preserves interleaved pickup/delivery order in geometry and arrivals", async () => {
    const geometryCalls: GeoPoint[][] = [];
    const solution: VroomSolution = {
      orderByVehicle: new Map([[0, ["A", "B"]]]),
      ordersByVehicle: new Map([
        [
          0,
          [
            { kind: "shipment" as const, id: "A" },
            { kind: "shipment" as const, id: "B" },
          ],
        ],
      ]),
      visitsByVehicle: new Map([[0, visits]]),
      arrivalsByVehicle: new Map([
        [
          0,
          new Map([
            ["shipment:A:pickup", 100],
            ["shipment:B:pickup", 200],
            ["shipment:A:delivery", 300],
            ["shipment:B:delivery", 400],
          ]),
        ],
      ]),
      unassigned: [],
      unassignedReasons: new Map(),
      routes: [{ vehicleId: 0, distanceMetres: 2400, durationSeconds: 240 }],
    };

    const clients: RoutingClients = {
      matrix: async (points) => matrix(points),
      route: async (points) => {
        geometryCalls.push(points);
        return {
          points: [...points, points[0]!],
          distanceMetres: 2400,
          durationSeconds: 240,
        };
      },
      solve: async () => solution,
    };

    const result = await planFleet(clients, {
      vehicles: [{ id: 0, depot }],
      shipments: [
        { id: "A", pickup: aPickup, dropoff: aDrop },
        { id: "B", pickup: bPickup, dropoff: bDrop },
      ],
    });

    const planned = result.vehicles[0]!;
    expect(planned.orderedVisits?.map((visit) => `${visit.id}:${visit.role}`)).toEqual([
      "A:pickup",
      "B:pickup",
      "A:delivery",
      "B:delivery",
    ]);
    expect(planned.stopArrivals).toEqual([100, 200, 300, 400]);
    expect(geometryCalls[0]?.map((point) => point.latitude)).toEqual([
      depot.latitude,
      aPickup.latitude,
      bPickup.latitude,
      aDrop.latitude,
      bDrop.latitude,
    ]);
  });
});

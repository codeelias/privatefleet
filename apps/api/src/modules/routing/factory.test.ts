import { describe, expect, it } from "vitest";
import { createRoutingClients } from "./factory.js";
import { RoutingError } from "./types.js";

describe("routing client factory", () => {
  it("refuses to create live clients when either endpoint is missing", () => {
    expect(() => createRoutingClients({})).toThrow(RoutingError);
    expect(() => createRoutingClients({ osrmBaseUrl: "http://osrm.local" })).toThrow(
      /VROOM_BASE_URL/,
    );
    expect(() => createRoutingClients({ vroomBaseUrl: "http://vroom.local" })).toThrow(
      /OSRM_BASE_URL/,
    );
  });

  it("forwards single-stop jobs through the app routing client to VROOM", async () => {
    let captured: { jobs?: unknown[]; shipments?: unknown[] } = {};
    const fakeFetch = (async (_url: string, init?: { body?: string }) => {
      captured = JSON.parse(init?.body ?? "{}") as {
        jobs?: unknown[];
        shipments?: unknown[];
      };
      return new Response(
        JSON.stringify({
          code: 0,
          unassigned: [],
          routes: [
            {
              vehicle: 0,
              distance: 100,
              duration: 60,
              steps: [
                { type: "pickup", id: 1, arrival: 10 },
                { type: "delivery", id: 2, arrival: 20 },
                { type: "job", id: 3, arrival: 40 },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const clients = createRoutingClients(
      { osrmBaseUrl: "http://osrm.local", vroomBaseUrl: "http://vroom.local" },
      fakeFetch,
    );
    const matrices = {
      durations: [
        [0, 1, 2],
        [1, 0, 1],
        [2, 1, 0],
      ],
      distances: [
        [0, 1, 2],
        [1, 0, 1],
        [2, 1, 0],
      ],
    };
    const result = await clients.solve(
      [{ id: 0, startIndex: 0, endIndex: 0 }],
      [{ id: "shipment", pickupIndex: 1, deliveryIndex: 2 }],
      matrices,
      3,
      [{ id: "single", locationIndex: 2 }],
    );
    expect(captured.jobs).toHaveLength(1);
    expect(captured.shipments).toHaveLength(1);
    expect(result.ordersByVehicle.get(0)).toEqual([
      { kind: "shipment", id: "shipment" },
      { kind: "job", id: "single" },
    ]);
  });

  it("creates the validated provider pair when both are configured", () => {
    const clients = createRoutingClients({
      osrmBaseUrl: "http://osrm.local",
      vroomBaseUrl: "http://vroom.local",
    });
    expect(typeof clients.matrix).toBe("function");
    expect(typeof clients.route).toBe("function");
    expect(typeof clients.solve).toBe("function");
  });
});


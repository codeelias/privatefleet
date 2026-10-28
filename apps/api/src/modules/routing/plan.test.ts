/**
 * Planner contract tests with fake OSRM/VROOM services: the real HTTP
 * adapters are exercised without Docker or network access.
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { GeoPoint } from "@privatefleet/contracts";
import { OsrmClient } from "./osrm.js";
import { VroomClient } from "./vroom.js";
import { planShipments } from "./plan.js";
import { RoutingError } from "./types.js";

type Mode = "ok" | "infeasible" | "bad-geometry";

interface Fake {
  url: string;
  close: () => Promise<void>;
}

const servers: Fake[] = [];

function startFake(mode: Mode = "ok"): Promise<Fake> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as {
          shipments?: Array<{ pickup?: { id?: string }; delivery?: { id?: string } }>;
        };
        const ids = (body.shipments ?? []).map((shipment) =>
          String(shipment.pickup?.id ?? "").replace("::pickup", ""),
        );
        const steps =
          mode === "infeasible"
            ? []
            : [
                { type: "start", id: 0 },
                ...ids.flatMap((id) => [
                  { type: "pickup", id: `${id}::pickup` },
                  { type: "delivery", id: `${id}::delivery` },
                ]),
                { type: "end", id: 0 },
              ];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            code: 0,
            unassigned:
              mode === "infeasible" ? ids.map((id) => ({ id: `${id}::pickup` })) : [],
            routes:
              mode === "infeasible"
                ? []
                : [{ vehicle: 0, distance: 1234, duration: 567, steps }],
          }),
        );
      });
      return;
    }
    const match = url.pathname.match(/\/driving\/(.+)$/);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const coords = decodeURIComponent(match[1] ?? "")
      .split(";")
      .map((pair) => pair.split(",").map(Number) as [number, number]);
    if (url.pathname.startsWith("/table")) {
      const n = coords.length;
      const durations = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => Math.abs(i - j) * 60),
      );
      const distances = durations.map((row) => row.map((seconds) => seconds * 10));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "Ok", durations, distances }));
      return;
    }
    if (url.pathname.startsWith("/route")) {
      const coordinates =
        mode === "bad-geometry" ? coords.slice(0, 1) : coords;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: coords.length * 100,
              duration: coords.length * 20,
              geometry: { coordinates },
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("no port");
      }
      const fake: Fake = {
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      };
      servers.push(fake);
      resolve(fake);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const depot: GeoPoint = { latitude: 51.515, longitude: -0.132 };
const shipmentA = {
  id: "shipment-a",
  pickup: { latitude: 51.52, longitude: -0.12 },
  dropoff: { latitude: 51.53, longitude: -0.1 },
};
const shipmentB = {
  id: "shipment-b",
  pickup: { latitude: 51.51, longitude: -0.11 },
  dropoff: { latitude: 51.5, longitude: -0.09 },
};

describe("planShipments", () => {
  it("produces a validated road geometry in the solved stop order", async () => {
    const fake = await startFake();
    const result = await planShipments(
      {
        matrix: (points) => new OsrmClient(fake.url).matrix(points),
        route: (points) => new OsrmClient(fake.url).route(points),
        solve: (vehicles, shipments, matrices, count) =>
          new VroomClient(fake.url).solve(vehicles, shipments, matrices, count),
      },
      { vehicle: { id: 0, depot }, shipments: [shipmentA, shipmentB] },
    );

    expect(result.matrixSize).toBe(5);
    expect(result.unassigned).toEqual([]);
    expect(result.vehicles).toHaveLength(1);
    const planned = result.vehicles[0]!;
    expect(planned.orderedShipmentIds).toEqual(["shipment-a", "shipment-b"]);
    expect(planned.geometry.length).toBeGreaterThanOrEqual(2);
    expect(planned.geometry[0]?.latitude).toBeCloseTo(depot.latitude, 5);
    expect(planned.distanceMetres).toBeGreaterThan(0);
  });

  it("surfaces unassigned work instead of silently dropping it", async () => {
    const fake = await startFake("infeasible");
    const result = await planShipments(
      {
        matrix: (points) => new OsrmClient(fake.url).matrix(points),
        route: (points) => new OsrmClient(fake.url).route(points),
        solve: (vehicles, shipments, matrices, count) =>
          new VroomClient(fake.url).solve(vehicles, shipments, matrices, count),
      },
      { vehicle: { id: 0, depot }, shipments: [shipmentA, shipmentB] },
    );
    expect(result.vehicles).toEqual([]);
    expect(result.unassigned.sort()).toEqual(["shipment-a", "shipment-b"]);
  });

  it("rejects a geometry that does not cover the plan", async () => {
    const fake = await startFake("bad-geometry");
    await expect(
      planShipments(
        {
          matrix: (points) => new OsrmClient(fake.url).matrix(points),
          route: (points) => new OsrmClient(fake.url).route(points),
          solve: (vehicles, shipments, matrices, count) =>
            new VroomClient(fake.url).solve(vehicles, shipments, matrices, count),
        },
        { vehicle: { id: 0, depot }, shipments: [shipmentA] },
      ),
    ).rejects.toMatchObject({ code: "ROUTING_INVALID_RESPONSE" });
  });

  it("fails with a typed error when OSRM or VROOM is unreachable", async () => {
    const fake = await startFake();
    await expect(
      planShipments(
        {
          matrix: (points) => new OsrmClient("http://127.0.0.1:1").matrix(points),
          route: (points) => new OsrmClient(fake.url).route(points),
          solve: (vehicles, shipments, matrices, count) =>
            new VroomClient(fake.url).solve(vehicles, shipments, matrices, count),
        },
        { vehicle: { id: 0, depot }, shipments: [shipmentA] },
      ),
    ).rejects.toBeInstanceOf(RoutingError);

    await expect(
      planShipments(
        {
          matrix: (points) => new OsrmClient(fake.url).matrix(points),
          route: (points) => new OsrmClient(fake.url).route(points),
          solve: (vehicles, shipments, matrices, count) =>
            new VroomClient("http://127.0.0.1:1").solve(vehicles, shipments, matrices, count),
        },
        { vehicle: { id: 0, depot }, shipments: [shipmentA] },
      ),
    ).rejects.toMatchObject({ code: "VROOM_UNAVAILABLE" });
  });
});

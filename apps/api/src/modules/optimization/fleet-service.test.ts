/**
 * Fleet-wide optimisation gate (docs/10): joint solve over multiple
 * vehicles/shipments, explicit unassigned work, atomic publication,
 * stale and concurrent approvals, rollback, cache invalidation and
 * tenant isolation. Deterministic fake routing clients here; the real
 * container gate runs separately.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { seedTenant } from "../../db/seed.js";
import { approveFleetProposal, createFleetProposal } from "./fleet-service.js";
import type { RoutingClients } from "../routing/types.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const testEnv = { ...process.env };
delete testEnv.OSRM_BASE_URL;
delete testEnv.VROOM_BASE_URL;
const config = loadConfig({
  ...testEnv,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "test-secret-at-least-16-characters-long",
  LOG_LEVEL: "error",
});

const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const runtime: DbHandle = createDb(APP_DATABASE_URL, { max: 2 });
const createdTenants: string[] = [];

/** Distributes shipments round-robin across vehicles. */
const fakeClients: RoutingClients = {
  matrix: async (points) => ({
    durations: points.map((_, row) => points.map((_, column) => Math.abs(row - column) * 60)),
    distances: points.map((_, row) => points.map((_, column) => Math.abs(row - column) * 600)),
  }),
  route: async (points) => ({
    points: [points[0]!, points[1] ?? points[0]!],
    distanceMetres: 1_000,
    durationSeconds: 300,
  }),
  solve: async (vehicles, shipments, _matrices, _count, jobs = []) => {
    const orderByVehicle = new Map<number, string[]>();
    const ordersByVehicle = new Map<
      number,
      Array<{ kind: "shipment" | "job"; id: string }>
    >();
    const units = [
      ...shipments.map((shipment) => ({ kind: "shipment" as const, id: shipment.id })),
      ...jobs.map((job) => ({ kind: "job" as const, id: job.id })),
    ];
    units.forEach((unit, index) => {
      const vehicle = vehicles[index % vehicles.length]!;
      const orders = ordersByVehicle.get(vehicle.id) ?? [];
      orders.push(unit);
      ordersByVehicle.set(vehicle.id, orders);
      if (unit.kind === "shipment") {
        const list = orderByVehicle.get(vehicle.id) ?? [];
        list.push(unit.id);
        orderByVehicle.set(vehicle.id, list);
      }
    });
    return {
      orderByVehicle,
      ordersByVehicle,
      arrivalsByVehicle: new Map(),
      unassigned: [],
      unassignedReasons: new Map(),
      routes: [...ordersByVehicle.keys()].map((vehicleId) => ({
        vehicleId,
        distanceMetres: 1_000,
        durationSeconds: 300,
      })),
    };
  },
};

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  if (createdTenants.length > 0) {
    for (const tenantId of createdTenants) {
      await migrator.sql`DELETE FROM tenants WHERE id = ${tenantId}`;
    }
  }
  await app.close();
  await closeDb(runtime);
  await closeDb(migrator);
});

async function setup(): Promise<{
  tenantId: string;
  ownerToken: string;
  driverId: string;
}> {
  const seeded = await seedTenant(migrator, {
    tenantName: "Fleet Optimisation Co",
    email: `fleet-${randomUUID().slice(0, 6)}@optimization.test`,
    password: "demo-password-123",
    slug: `fleet-${randomUUID().slice(0, 8)}`,
  });
  createdTenants.push(seeded.tenantId);
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { tenantSlug: seeded.tenantSlug, email: seeded.email, password: seeded.password },
  });
  expect(login.statusCode).toBe(200);
  const ownerToken = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const state = await app.inject({
    method: "GET",
    url: "/v1/fleet/state",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const fleet = state.json() as { jobs: Array<{ assignedDriverId?: string }> };
  const driverId = fleet.jobs.find((job) => job.assignedDriverId)?.assignedDriverId;
  expect(driverId).toBeTruthy();
  return { tenantId: seeded.tenantId, ownerToken, driverId: driverId! };
}

async function expectedVersion(tenantId: string): Promise<number> {
  const rows = await migrator.sql`
    SELECT coalesce(max(version), 1) AS current FROM routes
    WHERE tenant_id = ${tenantId} AND status IN ('published','in_progress')
  `;
  return Number((rows[0] as { current: number }).current);
}

describe("fleet optimisation", () => {
  it("solves across multiple vehicles, surfaces unassigned work and publishes atomically", async () => {
    const { tenantId, ownerToken } = await setup();
    const proposal = await createFleetProposal(runtime, fakeClients, tenantId);
    expect(proposal.scope).toBe("fleet");
    expect(proposal.vehicleCount).toBeGreaterThanOrEqual(2);
    expect(proposal.shipmentCount).toBeGreaterThanOrEqual(4);
    expect(proposal.vehicles.length).toBeGreaterThanOrEqual(2);
    // Single-stop seed fixtures are optimised as VROOM jobs now.
    expect(proposal.singleStopJobCount).toBeGreaterThanOrEqual(1);
    expect(proposal.unassigned).toHaveLength(0);
    for (const route of proposal.vehicles) {
      expect(route.geometry.length).toBeGreaterThanOrEqual(2);
      // Paired shipment: pickup then dropoff for the same job. Single
      // stop jobs appear as one service stop.
      for (let index = 0; index < route.stops.length; ) {
        const stop = route.stops[index]!;
        if (stop.stopType === "service") {
          index += 1;
          continue;
        }
        expect(stop.stopType).toBe("pickup");
        expect(route.stops[index + 1]?.stopType).toBe("dropoff");
        expect(route.stops[index + 1]?.jobId).toBe(stop.jobId);
        index += 2;
      }
    }

    const approval = await approveFleetProposal(
      runtime,
      tenantId,
      proposal.runId,
      proposal.expectedRouteVersion,
    );
    expect(approval.version).toBe(proposal.expectedRouteVersion + 1);
    expect(approval.routeIds).toHaveLength(proposal.vehicles.length);

    const state = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const fleet = state.json() as {
      routeVersion: number;
      routes: Array<{ vehicleId: string; version: number; points: unknown[] }>;
    };
    expect(fleet.routeVersion).toBe(approval.version);
    expect(fleet.routes).toHaveLength(proposal.vehicles.length);
    for (const route of fleet.routes) {
      expect(route.version).toBe(approval.version);
      expect(route.points.length).toBeGreaterThanOrEqual(2);
    }

    const stopCount = proposal.vehicles.reduce((sum, route) => sum + route.stops.length, 0);
    let storedStops = 0;
    for (const routeId of approval.routeIds) {
      const rows = await migrator.sql`
        SELECT count(*)::int AS count FROM route_stops WHERE route_id = ${routeId}
      `;
      storedStops += (rows[0] as { count: number }).count;
    }
    expect(storedStops).toBe(stopCount);
    const events = await migrator.sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE tenant_id = ${tenantId} AND event_type = 'route.published'
    `;
    expect((events[0] as { count: number }).count).toBe(approval.routeIds.length);

    // Re-approval is idempotent.
    const again = await approveFleetProposal(runtime, tenantId, proposal.runId);
    expect(again.version).toBe(approval.version);
    expect(again.routeIds).toEqual(approval.routeIds);
  });

  it("rejects a stale fleet version and does not publish twice under concurrency", async () => {
    const { tenantId } = await setup();
    const proposal = await createFleetProposal(runtime, fakeClients, tenantId);
    await expect(
      approveFleetProposal(runtime, tenantId, proposal.runId, proposal.expectedRouteVersion - 1),
    ).rejects.toMatchObject({ code: "ROUTE_VERSION_STALE" });

    const [first, second] = await Promise.all([
      approveFleetProposal(runtime, tenantId, proposal.runId, proposal.expectedRouteVersion),
      approveFleetProposal(runtime, tenantId, proposal.runId, proposal.expectedRouteVersion),
    ]);
    expect(first.version).toBe(second.version);
    const routes = await migrator.sql`
      SELECT count(*)::int AS count FROM routes
      WHERE tenant_id = ${tenantId} AND status = 'published'
    `;
    expect((routes[0] as { count: number }).count).toBe(proposal.vehicles.length);
  });

  it("rolls back the whole publication when one route cannot be stored", async () => {
    const { tenantId } = await setup();
    const proposal = await createFleetProposal(runtime, fakeClients, tenantId);
    const firstStop = proposal.vehicles[0]?.stops[0];
    expect(firstStop).toBeTruthy();
    // Remove a stop the route would reference: the transaction must fail
    // and leave no route, stop or event behind.
    await migrator.sql`DELETE FROM job_stops WHERE id = ${firstStop!.stopId}`;
    await expect(
      approveFleetProposal(runtime, tenantId, proposal.runId, proposal.expectedRouteVersion),
    ).rejects.toBeTruthy();
    const routes = await migrator.sql`
      SELECT count(*)::int AS count FROM routes WHERE tenant_id = ${tenantId}
    `;
    const stops = await migrator.sql`
      SELECT count(*)::int AS count FROM route_stops rs
      JOIN routes r ON r.id = rs.route_id WHERE r.tenant_id = ${tenantId}
    `;
    const events = await migrator.sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE tenant_id = ${tenantId} AND event_type = 'route.published'
    `;
    expect((routes[0] as { count: number }).count).toBe(0);
    expect((stops[0] as { count: number }).count).toBe(0);
    expect((events[0] as { count: number }).count).toBe(0);
  });

  it("reuses cache for identical state and invalidates it after assignment changes", async () => {
    const { tenantId } = await setup();
    const first = await createFleetProposal(runtime, fakeClients, tenantId);
    const second = await createFleetProposal(runtime, fakeClients, tenantId);
    expect(second.runId).toBe(first.runId);

    const pairedRows = await migrator.sql`
      SELECT j.id, j.assigned_driver_id FROM jobs j
      JOIN job_stops p ON p.job_id = j.id AND p.stop_type = 'pickup' AND p.status = 'pending'
      JOIN job_stops d ON d.job_id = j.id AND d.stop_type = 'dropoff' AND d.status = 'pending'
      WHERE j.tenant_id = ${tenantId} AND j.status = 'assigned'
      LIMIT 1
    `;
    const jobId = (pairedRows[0] as { id: string }).id;
    const currentDriver = (
      pairedRows[0] as { assigned_driver_id: string | null }
    ).assigned_driver_id;
    expect(jobId).toBeTruthy();
    const drivers = await migrator.sql`
      SELECT id FROM drivers WHERE tenant_id = ${tenantId} ORDER BY id
    `;
    const otherDriver = (drivers as Array<{ id: string }>).find(
      (driver) => driver.id !== currentDriver,
    )?.id;
    expect(otherDriver).toBeTruthy();
    await migrator.sql`
      UPDATE jobs SET assigned_driver_id = ${otherDriver!} WHERE id = ${jobId!}
    `;
    const third = await createFleetProposal(runtime, fakeClients, tenantId);
    expect(third.runId).not.toBe(first.runId);
    expect(await expectedVersion(tenantId)).toBe(1);
  });


  it("reports a structured MISSING_SKILL reason when no vehicle has the capability", async () => {
    const { tenantId } = await setup();
    const jobRows = await migrator.sql`
      SELECT j.id FROM jobs j
      JOIN job_stops s ON s.job_id = j.id AND s.stop_type = 'pickup'
      WHERE j.tenant_id = ${tenantId} AND j.status = 'assigned'
      LIMIT 1
    `;
    const jobId = (jobRows[0] as { id: string }).id;
    await migrator.sql`
      UPDATE jobs SET required_capabilities = ARRAY['refrigerated']
      WHERE id = ${jobId}
    `;
    const proposal = await createFleetProposal(runtime, fakeClients, tenantId);
    const unassigned = proposal.unassigned.find((entry) => entry.jobId === jobId);
    expect(unassigned?.reason).toBe("MISSING_SKILL");
    // Other work still plans and publishes.
    const approval = await approveFleetProposal(
      runtime,
      tenantId,
      proposal.runId,
      proposal.expectedRouteVersion,
    );
    expect(approval.version).toBe(2);
  });

  it("reports CAPACITY_EXCEEDED for paired work when capacity is zero", async () => {
    const { tenantId } = await setup();
    const jobRows = await migrator.sql`
      SELECT j.id FROM jobs j
      JOIN job_stops s ON s.job_id = j.id AND s.stop_type = 'pickup'
      WHERE j.tenant_id = ${tenantId} AND j.status = 'assigned'
      LIMIT 1
    `;
    const jobId = (jobRows[0] as { id: string }).id;
    await migrator.sql`
      UPDATE vehicles SET capacity_units = 0 WHERE tenant_id = ${tenantId}
    `;
    const proposal = await createFleetProposal(runtime, fakeClients, tenantId);
    const unassigned = proposal.unassigned.find((entry) => entry.jobId === jobId);
    expect(unassigned?.reason).toBe("CAPACITY_EXCEEDED");
  });

  it("never exposes another tenant's proposal or publication", async () => {
    const tenantA = await setup();
    const tenantB = await setup();
    const proposalA = await createFleetProposal(runtime, fakeClients, tenantA.tenantId);
    await expect(
      approveFleetProposal(runtime, tenantB.tenantId, proposalA.runId, proposalA.expectedRouteVersion),
    ).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });

    const stateB = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: { authorization: `Bearer ${tenantB.ownerToken}` },
    });
    const fleetB = stateB.json() as { routeVersion: number; routes: unknown[] };
    expect(fleetB.routeVersion).toBe(1);
    expect(fleetB.routes).toHaveLength(0);
  });
});








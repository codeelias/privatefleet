/**
 * Phase 5 gate (docs/10, docs/14): a proposal is persisted and traceable,
 * identical inputs reuse the stored run, approval publishes an immutable
 * route version, and a stale version is rejected.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { seedTenant } from "../../db/seed.js";
import { approveProposal, createProposal } from "./service.js";
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

const fakeClients: RoutingClients = {
  matrix: async (points) => ({
    durations: points.map((_, row) => points.map((_, column) => Math.abs(row - column) * 60)),
    distances: points.map((_, row) => points.map((_, column) => Math.abs(row - column) * 600)),
  }),
  route: async (points) => ({
    points: [points[0]!, points[1] ?? points[0]!],
    distanceMetres: 5_000,
    durationSeconds: 600,
  }),
  solve: async (_vehicles, shipments) => {
    const orders = shipments.map((shipment) => ({
      kind: "shipment" as const,
      id: shipment.id,
    }));
    return {
      orderByVehicle: new Map([[1, shipments.map((shipment) => shipment.id)]]),
      ordersByVehicle: new Map([[1, orders]]),
      arrivalsByVehicle: new Map(),
      unassigned: [],
      unassignedReasons: new Map(),
      routes: [{ vehicleId: 1, distanceMetres: 5_000, durationSeconds: 600 }],
    };
  },
};

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  if (createdTenants.length > 0) {
    await migrator.sql`DELETE FROM tenants WHERE id = ANY(${createdTenants}::uuid[])`;
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
    tenantName: "Optimization Co",
    email: `owner-${randomUUID().slice(0, 6)}@optimization.test`,
    password: "demo-password-123",
    slug: `opt-${randomUUID().slice(0, 6)}`,
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
  const fleet = state.json() as {
    jobs: Array<{ assignedDriverId?: string; status: string }>;
  };
  const driverId = fleet.jobs.find((job) => job.assignedDriverId)?.assignedDriverId;
  expect(driverId).toBeTruthy();
  return { tenantId: seeded.tenantId, ownerToken, driverId: driverId! };
}

describe("live route proposals", () => {
  it("persists a validated proposal and reuses it for identical inputs", async () => {
    const { tenantId, driverId } = await setup();
    const proposal = await createProposal(runtime, fakeClients, tenantId, driverId);
    expect(proposal.engine).toBe("osrm+vroom");
    expect(proposal.demoMode).toBe(false);
    expect(proposal.proposal.stops.length).toBeGreaterThanOrEqual(2);
    expect(proposal.proposal.geometry.length).toBeGreaterThanOrEqual(2);
    expect(proposal.proposal.distanceMetres).toBe(5_000);

    const cached = await createProposal(runtime, fakeClients, tenantId, driverId);
    expect(cached.runId).toBe(proposal.runId);

    const runs = await migrator.sql`
      SELECT count(*)::int AS count FROM optimization_runs WHERE tenant_id = ${tenantId}
    `;
    expect((runs[0] as { count: number }).count).toBe(1);
  });

  it("publishes an approved version and rejects a stale approval", async () => {
    const { tenantId, ownerToken, driverId } = await setup();
    const proposal = await createProposal(runtime, fakeClients, tenantId, driverId);

    await expect(approveProposal(runtime, tenantId, proposal.runId, 0)).rejects.toMatchObject({
      code: "ROUTE_VERSION_STALE",
    });

    const approval = await approveProposal(runtime, tenantId, proposal.runId, 1);
    expect(approval.version).toBe(2);
    expect(approval.publishedAt).toBeTruthy();

    const state = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const fleet = state.json() as {
      routeVersion: number;
      routes: Array<{ vehicleId: string; version: number; points: unknown[] }>;
    };
    expect(fleet.routeVersion).toBe(2);
    expect(fleet.routes).toHaveLength(1);
    expect(fleet.routes[0]?.version).toBe(2);
    expect((fleet.routes[0]?.points.length ?? 0)).toBeGreaterThanOrEqual(2);

    const stops = await migrator.sql`
      SELECT count(*)::int AS count FROM route_stops WHERE route_id = ${approval.routeId}
    `;
    expect((stops[0] as { count: number }).count).toBe(proposal.proposal.stops.length);

    // Re-approving the published run is idempotent.
    const again = await approveProposal(runtime, tenantId, proposal.runId, 1);
    expect(again.version).toBe(2);
  });

  it("refuses live optimization when routing is not configured", async () => {
    const { ownerToken, driverId } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/optimization/run",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { driverId },
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { code: string }).code).toBe("ROUTING_NOT_CONFIGURED");
  });
});


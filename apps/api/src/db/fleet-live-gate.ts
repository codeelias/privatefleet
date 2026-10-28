/**
 * Real OSRM/VROOM fleet gate (docs/10): one joint solve over multiple
 * vehicles/shipments, explicit unassigned work, atomic publication and
 * authenticated snapshot verification. Run with real service URLs:
 *
 *   OSRM_BASE_URL=http://127.0.0.1:5000 VROOM_BASE_URL=http://127.0.0.1:3000 \
 *   DATABASE_URL=<app> MIGRATION_DATABASE_URL=<owner> AUTH_JWT_SECRET=<secret> \
 *   pnpm --filter @privatefleet/api exec tsx src/db/fleet-live-gate.ts
 */
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { loadConfig, migrationDatabaseUrl } from "../config.js";
import { closeDb, createDb, type DbHandle } from "../db/client.js";
import { seedTenant } from "../db/seed.js";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev",
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET ?? "gate-secret-at-least-16-chars-long",
  LOG_LEVEL: "warn",
});
const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
let exitCode = 0;
const startedAt = Date.now();

try {
  await app.ready();
  const seeded = await seedTenant(migrator, {
    tenantName: "Fleet Deployment Gate Co",
    email: `fleet-gate-${randomUUID().slice(0, 6)}@privatefleet.test`,
    password: "demo-password-123",
    slug: `fleet-gate-${randomUUID().slice(0, 8)}`,
  });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { tenantSlug: seeded.tenantSlug, email: seeded.email, password: seeded.password },
    });
    if (login.statusCode !== 200) {
      throw new Error(`owner login ${login.statusCode}: ${login.body}`);
    }
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const auth = { authorization: `Bearer ${token}` };

    const proposeStarted = Date.now();
    const propose = await app.inject({
      method: "POST",
      url: "/v1/optimization/fleet-run",
      headers: auth,
      payload: {},
    });
    const proposeMs = Date.now() - proposeStarted;
    if (propose.statusCode !== 200) {
      throw new Error(`fleet propose ${propose.statusCode}: ${propose.body}`);
    }
    const proposal = propose.json() as {
      runId: string;
      engine: string;
      scope: string;
      vehicleCount: number;
      shipmentCount: number;
      singleStopJobCount: number;
      matrixSize: number;
      expectedRouteVersion: number;
      datasetVersion: string;
      vehicles: Array<{
        driverId: string;
        vehicleId: string;
        stops: Array<{ jobId: string; stopType: string; stopId: string }>;
        geometry: Array<{ latitude: number; longitude: number }>;
        distanceMetres: number;
        durationSeconds: number;
      }>;
      unassigned: Array<{ jobId: string; reason?: string }>;
    };
    if (proposal.scope !== "fleet") {
      throw new Error(`unexpected scope ${proposal.scope}`);
    }
    if (proposal.vehicles.length < 2) {
      throw new Error(`expected multiple vehicles, got ${proposal.vehicles.length}`);
    }
    if (proposal.shipmentCount < 4) {
      throw new Error(`expected several shipments, got ${proposal.shipmentCount}`);
    }
    for (const route of proposal.vehicles) {
      if (route.geometry.length < 2) {
        throw new Error("route geometry too short");
      }
      for (let index = 0; index < route.stops.length; ) {
        const stop = route.stops[index]!;
        if (stop.stopType === "service") {
          index += 1;
          continue;
        }
        if (
          stop.stopType !== "pickup" ||
          route.stops[index + 1]?.stopType !== "dropoff" ||
          route.stops[index + 1]?.jobId !== stop.jobId
        ) {
          throw new Error("pickup/dropoff pairing or precedence violated");
        }
        index += 2;
      }
    }

    const approve = await app.inject({
      method: "POST",
      url: `/v1/optimization/fleet/${proposal.runId}/approve`,
      headers: auth,
      payload: { expectedRouteVersion: proposal.expectedRouteVersion },
    });
    if (approve.statusCode !== 200) {
      throw new Error(`fleet approve ${approve.statusCode}: ${approve.body}`);
    }
    const approval = approve.json() as {
      version: number;
      routeIds: string[];
      publishedAt: string;
    };
    if (approval.routeIds.length !== proposal.vehicles.length) {
      throw new Error("published route count does not match proposal");
    }

    const snapshot = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: auth,
    });
    const fleet = snapshot.json() as {
      routeVersion: number;
      routes: Array<{ vehicleId: string; version: number; points: unknown[] }>;
    };
    if (fleet.routeVersion !== approval.version) {
      throw new Error(`snapshot version ${fleet.routeVersion} != ${approval.version}`);
    }
    const published = fleet.routes.filter((route) => route.version === approval.version);
    if (published.length !== approval.routeIds.length) {
      throw new Error(`snapshot has ${published.length} published routes`);
    }

    const persisted = (await migrator.sql`
      SELECT r.vehicle_id, rs.sequence_no, rs.job_stop_id, js.job_id, js.stop_type
      FROM route_stops rs
      JOIN routes r ON r.id = rs.route_id
      JOIN job_stops js ON js.id = rs.job_stop_id
      WHERE r.tenant_id = ${seeded.tenantId} AND r.version = ${approval.version}
      ORDER BY r.vehicle_id, rs.sequence_no
    `) as unknown as Array<{
      vehicle_id: string;
      sequence_no: number;
      job_stop_id: string;
      job_id: string;
      stop_type: string;
    }>;

    const expectedByVehicle = new Map(
      proposal.vehicles.map((route) => [route.vehicleId, route.stops.map((stop) => stop.stopId)]),
    );
    const actualByVehicle = new Map<string, string[]>();
    for (const row of persisted) {
      const list = actualByVehicle.get(row.vehicle_id) ?? [];
      list.push(row.job_stop_id);
      actualByVehicle.set(row.vehicle_id, list);
    }
    for (const [vehicleId, expected] of expectedByVehicle) {
      const actual = actualByVehicle.get(vehicleId) ?? [];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `persisted stop identities for vehicle ${vehicleId} do not match the approved proposal`,
        );
      }
    }
    const proposalServiceStops = proposal.vehicles.flatMap((route) =>
      route.stops.filter((stop) => stop.stopType === "service"),
    );
    if (proposalServiceStops.length !== proposal.singleStopJobCount) {
      throw new Error("proposal service stop count does not match single-stop job count");
    }
    const persistedServiceStopIds = new Set(
      persisted
        .filter((row) => proposalServiceStops.some((stop) => stop.stopId === row.job_stop_id))
        .map((row) => row.job_stop_id),
    );
    if (persistedServiceStopIds.size !== proposalServiceStops.length) {
      throw new Error("persisted service stop identities do not match the proposal");
    }
    const submitted = new Set<string>();
    for (const route of proposal.vehicles) {
      for (const stop of route.stops) {
        submitted.add(stop.jobId);
      }
    }
    for (const entry of proposal.unassigned) {
      submitted.add(entry.jobId);
    }
    if (submitted.size !== proposal.shipmentCount + proposal.singleStopJobCount) {
      throw new Error("submitted business units are not fully accounted for");
    }

    const routeJobs = new Map<string, string | null>();
    for (const route of proposal.vehicles) {
      for (const stop of route.stops) {
        routeJobs.set(stop.jobId, route.driverId);
      }
    }
    for (const [jobId, driverId] of routeJobs) {
      const rows = (await migrator.sql`
        SELECT assigned_driver_id FROM jobs WHERE tenant_id = ${seeded.tenantId} AND id = ${jobId}
      `) as unknown as Array<{ assigned_driver_id: string | null }>;
      const stored = rows[0]?.assigned_driver_id ?? null;
      if (stored !== driverId) {
        throw new Error("persisted job assignment does not match the approved proposal");
      }
    }

    const stops = await migrator.sql`
      SELECT count(*)::int AS count FROM route_stops rs
      JOIN routes r ON r.id = rs.route_id
      WHERE r.tenant_id = ${seeded.tenantId} AND r.version = ${approval.version}
    `;
    const events = await migrator.sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE tenant_id = ${seeded.tenantId} AND event_type = 'route.published'
    `;

    console.log(
      JSON.stringify(
        {
          mode: "real-fleet",
          osrm: process.env.OSRM_BASE_URL,
          vroom: process.env.VROOM_BASE_URL,
          engine: `${proposal.engine} v${proposal.datasetVersion}`,
          proposeMs,
          vehicleCount: proposal.vehicleCount,
          shipmentCount: proposal.shipmentCount,
          matrixSize: proposal.matrixSize,
          unassigned: proposal.unassigned.length,
          unassignedReasons: proposal.unassigned.map((entry) => entry.reason ?? "unassigned"),
          proposedRoutes: proposal.vehicles.length,
          routeShipmentCounts: proposal.vehicles.map(
            (route) => route.stops.filter((stop) => stop.stopType === "pickup").length,
          ),
          routeStopCounts: proposal.vehicles.map((route) => route.stops.length),
          totalDistanceMetres: Math.round(
            proposal.vehicles.reduce((sum, route) => sum + route.distanceMetres, 0),
          ),
          totalDurationSeconds: Math.round(
            proposal.vehicles.reduce((sum, route) => sum + route.durationSeconds, 0),
          ),
          publishedVersion: approval.version,
          snapshotVersion: fleet.routeVersion,
          publishedRoutes: published.length,
          routeStops: (stops[0] as { count: number }).count,
          persistedServiceStops: persistedServiceStopIds.size,
          persistedStopIdentitiesMatch: true,
          submittedUnitsAccountedFor: submitted.size,
          assignmentsMatchProposal: true,
          outboxEvents: (events[0] as { count: number }).count,
          totalMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
  } finally {
    await migrator.sql`DELETE FROM tenants WHERE id = ${seeded.tenantId}`;
  }
} catch (err) {
  exitCode = 1;
  console.error("FLEET GATE FAILED:", err instanceof Error ? err.message : err);
} finally {
  await app.close();
  await closeDb(migrator);
}
process.exit(exitCode);




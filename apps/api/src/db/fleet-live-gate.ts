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
      matrixSize: number;
      expectedRouteVersion: number;
      datasetVersion: string;
      vehicles: Array<{
        driverId: string;
        vehicleId: string;
        stops: Array<{ jobId: string; stopType: string }>;
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
      for (let index = 0; index < route.stops.length; index += 2) {
        if (
          route.stops[index]?.stopType !== "pickup" ||
          route.stops[index + 1]?.stopType !== "dropoff" ||
          route.stops[index]?.jobId !== route.stops[index + 1]?.jobId
        ) {
          throw new Error("pickup/dropoff pairing or precedence violated");
        }
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
          routeShipmentCounts: proposal.vehicles.map((route) =>
            Math.round(route.stops.length / 2),
          ),
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


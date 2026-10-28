/**
 * Real-service preservation gate (directive evidence A): publish a fleet
 * plan, then verify - with VROOM unavailable - that the published routes
 * are unchanged and manual dispatch still works.
 *
 * Two-phase because the caller must stop/start the real VROOM container
 * between phases:
 *   tsx src/db/routing-preservation-gate.ts --prepare <state.json>
 *   # stop VROOM container here
 *   tsx src/db/routing-preservation-gate.ts --verify <state.json>
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildApp } from "../app.js";
import { loadConfig, migrationDatabaseUrl } from "../config.js";
import { closeDb, createDb, type DbHandle } from "../db/client.js";
import { seedTenant } from "../db/seed.js";

const prepareIndex = process.argv.indexOf("--prepare");
const verifyIndex = process.argv.indexOf("--verify");
const mode = prepareIndex >= 0 ? "prepare" : verifyIndex >= 0 ? "verify" : "";
const statePath =
  prepareIndex >= 0
    ? process.argv[prepareIndex + 1]
    : verifyIndex >= 0
      ? process.argv[verifyIndex + 1]
      : undefined;
if (!mode || !statePath) {
  console.error("usage: --prepare <state.json> | --verify <state.json>");
  process.exit(2);
}

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

interface RouteSnapshot {
  vehicleId: string;
  version: number;
  pointCount: number;
  checksum: string;
}

interface PreservationState {
  tenantId: string;
  tenantSlug: string;
  email: string;
  password: string;
  routeVersion: number;
  routes: RouteSnapshot[];
  routeStops: number;
  jobId: string;
  driverIds: string[];
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

let exitCode = 0;
try {
  await app.ready();

  if (mode === "prepare") {
    const seeded = await seedTenant(migrator, {
      tenantName: "Preservation Gate Co",
      email: `preserve-${randomUUID().slice(0, 6)}@privatefleet.test`,
      password: "demo-password-123",
      slug: `preserve-${randomUUID().slice(0, 8)}`,
    });
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { tenantSlug: seeded.tenantSlug, email: seeded.email, password: seeded.password },
    });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const auth = { authorization: `Bearer ${token}` };

    const propose = await app.inject({
      method: "POST",
      url: "/v1/optimization/fleet-run",
      headers: auth,
      payload: {},
    });
    if (propose.statusCode !== 200) {
      throw new Error(`propose ${propose.statusCode}: ${propose.body}`);
    }
    const proposal = propose.json() as {
      runId: string;
      expectedRouteVersion: number;
      vehicles: Array<{ driverId: string }>;
    };
    const approve = await app.inject({
      method: "POST",
      url: `/v1/optimization/fleet/${proposal.runId}/approve`,
      headers: auth,
      payload: { expectedRouteVersion: proposal.expectedRouteVersion },
    });
    if (approve.statusCode !== 200) {
      throw new Error(`approve ${approve.statusCode}: ${approve.body}`);
    }
    const approval = approve.json() as { version: number };

    const state = await app.inject({ method: "GET", url: "/v1/fleet/state", headers: auth });
    const fleet = state.json() as {
      routeVersion: number;
      routes: Array<{
        vehicleId: string;
        version: number;
        points: Array<{ latitude: number; longitude: number }>;
      }>;
      jobs: Array<{ id: string; status: string; assignedDriverId?: string }>;
    };
    const routes: RouteSnapshot[] = fleet.routes
      .filter((route) => route.version === approval.version)
      .map((route) => ({
        vehicleId: route.vehicleId,
        version: route.version,
        pointCount: route.points.length,
        checksum: checksum(route.points),
      }));
    if (routes.length === 0) {
      throw new Error("no published routes in snapshot");
    }
    const stops = await migrator.sql`
      SELECT count(*)::int AS count FROM route_stops rs
      JOIN routes r ON r.id = rs.route_id
      WHERE r.tenant_id = ${seeded.tenantId} AND r.version = ${approval.version}
    `;
    // A new job arrives after publication: manual dispatch must work even
    // while the routing engine is down.
    const jobRows = await migrator.sql`
      INSERT INTO jobs (tenant_id, reference, service_type, priority, status)
      VALUES (${seeded.tenantId}, ${"GATE-" + randomUUID().slice(0, 8)}, 'Pickup', 'standard', 'unassigned')
      RETURNING id
    `;
    const jobId = (jobRows[0] as { id: string }).id;
    for (const [stopType, sequence] of [["pickup", 1], ["dropoff", 2]] as const) {
      await migrator.sql`
        INSERT INTO job_stops
          (tenant_id, job_id, sequence, stop_type, address, latitude, longitude,
           window_start, window_end, status)
        VALUES
          (${seeded.tenantId}, ${jobId}, ${sequence}, ${stopType},
           ${stopType === "pickup" ? "Gate pickup, London" : "Gate dropoff, London"},
           51.51, -0.12, now(), now() + interval '4 hours', 'pending')
      `;
    }
    const driverIds = proposal.vehicles.map((vehicle) => vehicle.driverId);
    if (driverIds.length === 0) {
      throw new Error("proposal has no vehicle driver");
    }
    const record: PreservationState = {
      tenantId: seeded.tenantId,
      tenantSlug: seeded.tenantSlug,
      email: seeded.email,
      password: seeded.password,
      routeVersion: fleet.routeVersion,
      routes,
      routeStops: (stops[0] as { count: number }).count,
      jobId,
      driverIds,
    };
    writeFileSync(statePath, JSON.stringify(record, null, 2), "utf8");
    console.log(
      JSON.stringify({
        mode: "prepare",
        routeVersion: record.routeVersion,
        routes: record.routes.length,
        routeStops: record.routeStops,
        jobId: record.jobId,
      }),
    );
  } else {
    const saved = JSON.parse(readFileSync(statePath, "utf8")) as PreservationState;
    try {
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { tenantSlug: saved.tenantSlug, email: saved.email, password: saved.password },
      });
      if (login.statusCode !== 200) {
        throw new Error(`login ${login.statusCode}`);
      }
      const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
      const auth = { authorization: `Bearer ${token}` };

      const before = (await app.inject({
        method: "GET",
        url: "/v1/fleet/state",
        headers: auth,
      })).json() as {
        routeVersion: number;
        routes: Array<{
          vehicleId: string;
          version: number;
          points: Array<{ latitude: number; longitude: number }>;
        }>;
      };
      const current = before.routes
        .filter((route) => route.version === saved.routeVersion)
        .map((route) => ({
          vehicleId: route.vehicleId,
          version: route.version,
          pointCount: route.points.length,
          checksum: checksum(route.points),
        }));
      if (before.routeVersion !== saved.routeVersion) {
        throw new Error(`routeVersion changed: ${before.routeVersion} != ${saved.routeVersion}`);
      }
      if (JSON.stringify(current) !== JSON.stringify(saved.routes)) {
        throw new Error("published route geometry changed during the outage");
      }
      const stops = await migrator.sql`
        SELECT count(*)::int AS count FROM route_stops rs
        JOIN routes r ON r.id = rs.route_id
        WHERE r.tenant_id = ${saved.tenantId} AND r.version = ${saved.routeVersion}
      `;
      if ((stops[0] as { count: number }).count !== saved.routeStops) {
        throw new Error("route_stops changed during the outage");
      }

      const propose = await app.inject({
        method: "POST",
        url: "/v1/optimization/fleet-run",
        headers: auth,
        payload: {},
      });
      const proposetCode = (propose.json() as { code?: string }).code;
      if (propose.statusCode !== 502 || proposetCode !== "VROOM_UNAVAILABLE") {
        throw new Error(`expected typed 502, got ${propose.statusCode} ${propose.body}`);
      }

      let assignStatus = 0;
      let assignBody = "";
      for (const driverId of saved.driverIds) {
        const assign = await app.inject({
          method: "POST",
          url: `/v1/jobs/${saved.jobId}/assign`,
          headers: auth,
          payload: { driverId },
        });
        assignStatus = assign.statusCode;
        assignBody = assign.body;
        if (assign.statusCode === 200) {
          break;
        }
      }
      if (assignStatus !== 200) {
        throw new Error(`manual dispatch failed: ${assignStatus} ${assignBody}`);
      }

      const after = (await app.inject({
        method: "GET",
        url: "/v1/fleet/state",
        headers: auth,
      })).json() as {
        routeVersion: number;
        routes: Array<{
          vehicleId: string;
          version: number;
          points: Array<{ latitude: number; longitude: number }>;
        }>;
      };
      const afterRoutes = after.routes
        .filter((route) => route.version === saved.routeVersion)
        .map((route) => ({
          vehicleId: route.vehicleId,
          version: route.version,
          pointCount: route.points.length,
          checksum: checksum(route.points),
        }));
      if (after.routeVersion !== saved.routeVersion) {
        throw new Error("manual dispatch mutated the published route version");
      }
      if (JSON.stringify(afterRoutes) !== JSON.stringify(saved.routes)) {
        throw new Error("manual dispatch mutated published geometry");
      }

      console.log(
        JSON.stringify(
          {
            mode: "verify",
            routeVersion: after.routeVersion,
            routesPreserved: afterRoutes.length,
            routeStopsPreserved: saved.routeStops,
            proposeStatus: propose.statusCode,
            proposeCode: proposetCode,
            manualAssignStatus: assignStatus,
          },
          null,
          2,
        ),
      );
    } finally {
      await migrator.sql`DELETE FROM tenants WHERE id = ${saved.tenantId}`;
    }
  }
} catch (err) {
  exitCode = 1;
  console.error("PRESERVATION GATE FAILED:", err instanceof Error ? err.message : err);
} finally {
  await app.close();
  await closeDb(migrator);
}
process.exit(exitCode);



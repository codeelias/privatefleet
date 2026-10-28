/**
 * Real-routing deployment gate (docs/10, runbook 16b): exercises the
 * production HTTP path against real OSRM/VROOM services - propose,
 * validate, persist, stale-reject, approve, snapshot. Run with:
 *
 *   OSRM_BASE_URL=http://127.0.0.1:5000 \
 *   VROOM_BASE_URL=http://127.0.0.1:3000 \
 *   DATABASE_URL=... MIGRATION_DATABASE_URL=... AUTH_JWT_SECRET=... \
 *   pnpm --filter @privatefleet/api exec tsx src/db/routing-live-gate.ts
 *
 * `--expect-unavailable` instead asserts a typed 503 when routing is down.
 */
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { loadConfig, migrationDatabaseUrl } from "../config.js";
import { closeDb, createDb, type DbHandle } from "../db/client.js";
import { seedTenant } from "../db/seed.js";

const expectUnavailable = process.argv.includes("--expect-unavailable");
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
    tenantName: "Deployment Gate Co",
    email: `gate-${randomUUID().slice(0, 6)}@privatefleet.test`,
    password: "demo-password-123",
    slug: `gate-${randomUUID().slice(0, 8)}`,
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

    const stateRes = await app.inject({ method: "GET", url: "/v1/fleet/state", headers: auth });
    const fleet = stateRes.json() as {
      routeVersion: number;
      jobs: Array<{
        assignedDriverId?: string;
        status: string;
        stops: Array<{ id: string; status: string; stopType: string }>;
      }>;
      vehicles: Array<{ id: string; driverId?: string; location?: { latitude: number } }>;
    };
    const job = fleet.jobs.find(
      (candidate) =>
        candidate.assignedDriverId &&
        candidate.stops.length >= 2 &&
        candidate.stops.every((stop) => stop.status === "pending"),
    );
    if (!job?.assignedDriverId) {
      throw new Error("no assigned job with pending stops in seeded tenant");
    }

    if (expectUnavailable) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/optimization/run",
        headers: auth,
        payload: { driverId: job.assignedDriverId },
      });
      const code = (response.json() as { code?: string }).code;
      const snapshot = await app.inject({ method: "GET", url: "/v1/fleet/state", headers: auth });
      const after = snapshot.json() as { routeVersion: number; routes: unknown[] };
      console.log(
        JSON.stringify({
          mode: "expect-unavailable",
          status: response.statusCode,
          code,
          snapshotStatus: snapshot.statusCode,
          routeVersion: after.routeVersion,
          routes: after.routes.length,
        }),
      );
      const typedFailure =
        (response.statusCode === 502 || response.statusCode === 503) &&
        ["VROOM_UNAVAILABLE", "OSRM_UNAVAILABLE", "ROUTING_NOT_CONFIGURED"].includes(code ?? "");
      exitCode = typedFailure && snapshot.statusCode === 200 && after.routeVersion === fleet.routeVersion ? 0 : 1;
    } else {
      const proposeStarted = Date.now();
      const propose = await app.inject({
        method: "POST",
        url: "/v1/optimization/run",
        headers: auth,
        payload: { driverId: job.assignedDriverId },
      });
      const proposeMs = Date.now() - proposeStarted;
      if (propose.statusCode !== 200) {
        throw new Error(`propose ${propose.statusCode}: ${propose.body}`);
      }
      const proposal = propose.json() as {
        runId: string;
        engine: string;
        engineVersion: string;
        matrixSize: number;
        proposal: {
          distanceMetres: number;
          durationSeconds: number;
          geometry: Array<{ latitude: number; longitude: number }>;
          stops: Array<{ jobId: string; stopId: string; stopType: string }>;
          unassigned: string[];
        };
      };
      if (proposal.engine !== "osrm+vroom") {
        throw new Error(`unexpected engine ${proposal.engine}`);
      }
      if (proposal.proposal.geometry.length < 2) {
        throw new Error("geometry too short");
      }
      for (const point of proposal.proposal.geometry) {
        if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
          throw new Error("non-finite geometry");
        }
      }
      if (proposal.proposal.distanceMetres <= 0 || proposal.proposal.durationSeconds <= 0) {
        throw new Error("non-positive route metrics");
      }
      // Pairing: every job appears once as pickup then once as dropoff.
      const seen = new Set<string>();
      let currentJob: string | null = null;
      for (const stop of proposal.proposal.stops) {
        if (stop.stopType === "pickup") {
          if (seen.has(stop.jobId)) {
            throw new Error("duplicate pickup for shipment");
          }
          seen.add(stop.jobId);
          currentJob = stop.jobId;
        } else {
          if (currentJob !== stop.jobId) {
            throw new Error("dropoff precedence violated");
          }
          currentJob = null;
        }
      }

      const stale = await app.inject({
        method: "POST",
        url: `/v1/optimization/${proposal.runId}/approve`,
        headers: auth,
        payload: { expectedRouteVersion: fleet.routeVersion - 1 },
      });
      if (stale.statusCode !== 409) {
        throw new Error(`stale approval expected 409, got ${stale.statusCode}: ${stale.body}`);
      }
      const staleCode = (stale.json() as { code?: string }).code;

      const approve = await app.inject({
        method: "POST",
        url: `/v1/optimization/${proposal.runId}/approve`,
        headers: auth,
        payload: { expectedRouteVersion: fleet.routeVersion },
      });
      if (approve.statusCode !== 200) {
        throw new Error(`approve ${approve.statusCode}: ${approve.body}`);
      }
      const approval = approve.json() as { routeId: string; version: number; publishedAt: string };

      const after = await app.inject({ method: "GET", url: "/v1/fleet/state", headers: auth });
      const snapshot = after.json() as {
        routeVersion: number;
        routes: Array<{ vehicleId: string; version: number; points: unknown[] }>;
      };
      if (snapshot.routeVersion !== approval.version) {
        throw new Error(`routeVersion ${snapshot.routeVersion} != ${approval.version}`);
      }
      const published = snapshot.routes.find((route) => route.version === approval.version);
      if (!published || published.points.length < 2) {
        throw new Error("published route missing from snapshot");
      }

      const runs = await migrator.sql`
        SELECT count(*)::int AS count FROM optimization_runs WHERE tenant_id = ${seeded.tenantId}
      `;
      const stops = await migrator.sql`
        SELECT count(*)::int AS count FROM route_stops WHERE route_id = ${approval.routeId}
      `;
      const outbox = await migrator.sql`
        SELECT count(*)::int AS count FROM outbox
        WHERE tenant_id = ${seeded.tenantId} AND event_type = 'route.published'
      `;

      console.log(
        JSON.stringify(
          {
            mode: "real-services",
            osrm: process.env.OSRM_BASE_URL,
            vroom: process.env.VROOM_BASE_URL,
            engine: `${proposal.engine} v${proposal.engineVersion}`,
            proposeMs,
            matrixSize: proposal.matrixSize,
            stops: proposal.proposal.stops.length,
            unassigned: proposal.proposal.unassigned.length,
            distanceMetres: Math.round(proposal.proposal.distanceMetres),
            durationSeconds: Math.round(proposal.proposal.durationSeconds),
            geometryPoints: proposal.proposal.geometry.length,
            staleStatus: stale.statusCode,
            staleCode,
            publishedVersion: approval.version,
            snapshotVersion: snapshot.routeVersion,
            snapshotRoutePoints: published.points.length,
            runs: (runs[0] as { count: number }).count,
            routeStops: (stops[0] as { count: number }).count,
            outboxEvents: (outbox[0] as { count: number }).count,
            totalMs: Date.now() - startedAt,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await migrator.sql`DELETE FROM tenants WHERE id = ${seeded.tenantId}`;
  }
} catch (err) {
  exitCode = 1;
  console.error("GATE FAILED:", err instanceof Error ? err.message : err);
} finally {
  await app.close();
  await closeDb(migrator);
}
process.exit(exitCode);


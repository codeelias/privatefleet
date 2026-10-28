/**
 * Postgres-mode smoke: boots the real app, logs in with the seeded
 * owner, reads the fleet snapshot and performs an idempotent assign.
 * Usage (after `pnpm db:seed`):
 *   REPOSITORY_MODE=postgres DATABASE_URL=... AUTH_JWT_SECRET=... \
 *   pnpm --filter @privatefleet/api db:smoke -- <tenantSlug>
 */
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const slug = process.argv[2] ?? process.env.SMOKE_TENANT_SLUG ?? "";
if (!slug) {
  console.error("usage: tsx src/db/smoke.ts <tenantSlug>");
  process.exit(1);
}

const config = loadConfig({ ...process.env, REPOSITORY_MODE: "postgres", PORT: "4011" });
const { app } = buildApp(config);
await app.listen({ port: config.port, host: "127.0.0.1" });

const base = `http://127.0.0.1:${config.port}`;
try {
  const loginRes = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantSlug: slug,
      email: process.env.SMOKE_EMAIL ?? "owner@northstar.demo",
      password: process.env.SMOKE_PASSWORD ?? "demo-password-123",
    }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const session = (await loginRes.json()) as {
    tenant: { slug: string };
    tokens: { accessToken: string };
  };
  console.log("login: ok tenant =", session.tenant.slug);

  const auth = { authorization: `Bearer ${session.tokens.accessToken}` };
  const stateRes = await fetch(`${base}/v1/fleet/state`, { headers: auth });
  const state = (await stateRes.json()) as {
    jobs: Array<{ id: string; status: string }>;
    drivers: Array<{ id: string; status: string }>;
    vehicles: unknown[];
  };
  console.log(
    `snapshot: jobs=${state.jobs.length} drivers=${state.drivers.length} vehicles=${state.vehicles.length}`,
  );

  const job = state.jobs.find((j) => j.status === "unassigned");
  const driver = state.drivers.find((d) => d.status !== "off_duty");
  if (!job || !driver) {
    throw new Error("no unassigned job or available driver in the seed");
  }
  const idempotencyKey = crypto.randomUUID();
  const body = JSON.stringify({ jobId: job.id, driverId: driver.id });
  const assign = async (): Promise<{ status: string; etaImpactMinutes: number }> =>
    (await (
      await fetch(`${base}/v1/jobs/${job.id}/assign`, {
        method: "POST",
        headers: { ...auth, "idempotency-key": idempotencyKey, "content-type": "application/json" },
        body,
      })
    ).json()) as { status: string; etaImpactMinutes: number };
  const first = await assign();
  const replay = await assign();
  console.log(
    `assign: status=${first.status} eta=${first.etaImpactMinutes} replayEqual=${first.status === replay.status && first.etaImpactMinutes === replay.etaImpactMinutes}`,
  );
  const after = (await (await fetch(`${base}/v1/fleet/state`, { headers: auth })).json()) as {
    jobs: Array<{ id: string; status: string }>;
  };
  console.log("after: jobStatus =", after.jobs.find((j) => j.id === job.id)?.status);
  await app.close();
  process.exit(0);
} catch (err) {
  console.error("smoke failed:", err);
  await app.close();
  process.exit(1);
}


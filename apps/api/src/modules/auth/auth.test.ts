/**
 * Phase 2 gate tests: auth lifecycle and cross-tenant isolation.
 * Runs against the local Postgres with the non-owner app role so RLS
 * is actually exercised (docs/12, Phase 2 exit gate).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, withTenant, type DbHandle } from "../../db/client.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "test-secret-at-least-16-characters-long",
  AUTH_ATTEMPT_WINDOW_SECONDS: "1",
  AUTH_MAX_ATTEMPTS_ACCOUNT: "5",
  LOG_LEVEL: "error",
});

const { app, postgres } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });

interface Session {
  tenant: { id: string; slug: string; name: string };
  user: { id: string; email: string; role: string };
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; tokenType: string };
}

async function register(tenantName: string): Promise<Session> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName,
      email: `owner-${randomUUID().slice(0, 8)}@example.test`,
      password: "correct horse battery staple",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`register failed (${res.statusCode}): ${res.body}`);
  }
  return res.json() as Session;
}

const createdTenants: string[] = [];

beforeAll(async () => {
  // Fail fast with a clear message when the dev database is not running.
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (createdTenants.length > 0) {
    await migrator.sql`DELETE FROM tenants WHERE id = ANY(${createdTenants}::uuid[])`;
  }
  await closeDb(migrator);
});

describe("auth lifecycle", () => {
  it("registers a tenant with owner credentials and JWT claims", async () => {
    const session = await register("Northstar Test Couriers");
    createdTenants.push(session.tenant.id);
    expect(session.tenant.slug).toMatch(/northstar-test-couriers-[a-f0-9]{6}/);
    expect(session.tokens.tokenType).toBe("Bearer");
    expect(session.tokens.expiresIn).toBe(900);

    const claims = await postgres?.auth.verifyAccess(session.tokens.accessToken);
    expect(claims?.tenantId).toBe(session.tenant.id);
    expect(claims?.role).toBe("owner");
  });

  it("rejects a wrong password without revealing which field failed", async () => {
    const session = await register("Wrong Password Co");
    createdTenants.push(session.tenant.id);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: session.tenant.slug,
        email: session.user.email,
        password: "not-the-password",
      },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe("INVALID_CREDENTIALS");
  });

  it("serialises concurrent refreshes: exactly one winner, no token branch", async () => {
    const session = await register("Refresh Race Ltd");
    createdTenants.push(session.tenant.id);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: session.tenant.slug,
        email: session.user.email,
        password: "correct horse battery staple",
      },
    });
    const tokens = (login.json() as Session).tokens;

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: tokens.refreshToken },
      }),
      app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: tokens.refreshToken },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 401]);

    const winner = (first.statusCode === 200 ? first : second).json() as Session["tokens"];
    const firstUse = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: winner.refreshToken },
    });
    expect(firstUse.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: winner.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("logs in, then rotates refresh tokens (replay is rejected)", async () => {
    const session = await register("Rotation Test Ltd");
    createdTenants.push(session.tenant.id);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: session.tenant.slug,
        email: session.user.email,
        password: "correct horse battery staple",
      },
    });
    expect(login.statusCode).toBe(200);
    const first = (login.json() as Session).tokens;

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json() as Session["tokens"];
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    expect((replay.json() as { code: string }).code).toBe("REFRESH_INVALID");
  });

  it("protects /v1/auth/me behind a bearer token", async () => {
    const session = await register("Me Endpoint Co");
    createdTenants.push(session.tenant.id);

    const anonymous = await app.inject({ method: "GET", url: "/v1/auth/me" });
    expect(anonymous.statusCode).toBe(401);

    const authed = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${session.tokens.accessToken}` },
    });
    expect(authed.statusCode).toBe(200);
    expect((authed.json() as { auth: { tenantId: string } }).auth.tenantId).toBe(
      session.tenant.id,
    );
  });

  it("throttles every account behind a source IP once the IP aggregate limit is reached", async () => {
    const victim = await register("Depot IP Victim Logistics");
    createdTenants.push(victim.tenant.id);

    // Dedicated limiter app with the production defaults (5/account, 50/IP,
    // 60 s window) but a fast unknown-tenant path so no argon work is needed.
    const local = buildApp(
      loadConfig({
        ...process.env,
        REPOSITORY_MODE: "postgres",
        DATABASE_URL: APP_DATABASE_URL,
        AUTH_JWT_SECRET: "test-secret-at-least-16-characters-long",
        AUTH_ATTEMPT_WINDOW_SECONDS: "60",
        AUTH_MAX_ATTEMPTS_ACCOUNT: "5",
        AUTH_MAX_ATTEMPTS_IP: "50",
        LOG_LEVEL: "error",
      }),
    );
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await local.app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: {
            tenantSlug: `missing-depot-${attempt}`,
            email: "ghost@example.test",
            password: "not-the-password",
          },
        });
        expect([401, 404]).toContain(response.statusCode);
      }

      // The victim account itself has no failures, but every account behind
      // this IP is now deliberately throttled until the window expires.
      const blocked = await local.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: victim.tenant.slug,
          email: victim.user.email,
          password: "correct horse battery staple",
        },
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers["retry-after"]).toBeDefined();
      expect((blocked.json() as { code: string }).code).toBe("AUTH_RATE_LIMITED");
    } finally {
      await local.app.close();
    }
  });
});

describe("row level security (cross-tenant probes)", () => {
  it("hides other tenants rows and blocks foreign inserts at the database layer", async () => {
    const a = await register("Tenant Alpha Logistics");
    const b = await register("Tenant Beta Logistics");
    createdTenants.push(a.tenant.id, b.tenant.id);
    const handle = postgres?.db;
    if (!handle) {
      throw new Error("postgres context missing");
    }

    await withTenant(postgres.db, a.tenant.id, async (tx) => {
      await tx.execute(sql`
        INSERT INTO alerts (tenant_id, severity, status, title, entity, location, freshness, recommended_action)
        VALUES (${a.tenant.id}, 'info', 'open', 'alpha only', 'Test', 'London', 'now', 'none')
      `);
    });

    const visibleToA = await withTenant(postgres.db, a.tenant.id, async (tx) => {
      const rows = await tx.execute(sql`SELECT tenant_id, title FROM alerts`);
      return rows as unknown as Array<{ tenant_id: string; title: string }>;
    });
    expect(visibleToA.length).toBeGreaterThan(0);
    expect(visibleToA.every((row) => row.tenant_id === a.tenant.id)).toBe(true);

    const visibleToB = await withTenant(postgres.db, b.tenant.id, async (tx) => {
      const rows = await tx.execute(sql`SELECT tenant_id FROM alerts`);
      return rows as unknown as Array<{ tenant_id: string }>;
    });
    expect(visibleToB.every((row) => row.tenant_id === b.tenant.id)).toBe(true);

    // WITH CHECK must reject a row claiming another tenant.
    let blocked = false;
    try {
      await withTenant(postgres.db, b.tenant.id, async (tx) => {
        await tx.execute(sql`
          INSERT INTO alerts (tenant_id, severity, status, title, entity, location, freshness, recommended_action)
          VALUES (${a.tenant.id}, 'info', 'open', 'smuggled', 'Test', 'London', 'now', 'none')
        `);
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it("throttles repeated login failures, keeps shared IPs usable, and recovers", async () => {
    const alpha = await register("Throttle Alpha Logistics");
    const beta = await register("Throttle Beta Logistics");
    createdTenants.push(alpha.tenant.id, beta.tenant.id);

    const wrong = () =>
      app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          tenantSlug: alpha.tenant.slug,
          email: alpha.user.email,
          password: "definitely-the-wrong-password",
        },
      });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await wrong()).statusCode).toBe(401);
    }
    const blocked = await wrong();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect((blocked.json() as { code: string }).code).toBe("AUTH_RATE_LIMITED");

    // Correct credentials are still throttled during the cooldown (no oracle).
    const correctDuringCooldown = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: alpha.tenant.slug,
        email: alpha.user.email,
        password: "correct horse battery staple",
      },
    });
    expect(correctDuringCooldown.statusCode).toBe(429);

    // A different account on the same source IP is not blocked.
    const betaLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: beta.tenant.slug,
        email: beta.user.email,
        password: "correct horse battery staple",
      },
    });
    expect(betaLogin.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const recovered = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: alpha.tenant.slug,
        email: alpha.user.email,
        password: "correct horse battery staple",
      },
    });
    expect(recovered.statusCode).toBe(200);
  });});







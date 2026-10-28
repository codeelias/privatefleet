/**
 * Auth service (Phase 2): tenant registration, login, rotating refresh
 * tokens and access JWTs. Runs as the non-owner runtime role; identity
 * bootstrap uses SECURITY DEFINER functions so RLS stays enforced on
 * every operational table (docs/11, ADR-0005).
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { jwtVerify, SignJWT } from "jose";
import { sql } from "drizzle-orm";
import type { AuthSession, AuthTokens } from "@privatefleet/contracts";
import type { AppConfig } from "../../config.js";
import { withTenant, type DbHandle } from "../../db/client.js";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: "owner" | "dispatcher" | "admin";
}

interface RefreshRow {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export class AuthError extends Error {
  constructor(
    readonly code: "INVALID_CREDENTIALS" | "TENANT_NOT_FOUND" | "REFRESH_INVALID",
    message?: string,
  ) {
    super(message ?? code);
  }
}

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly config: AppConfig,
    private readonly handle: DbHandle,
  ) {
    this.secret = new TextEncoder().encode(config.jwtSecret);
  }

  async register(input: {
    tenantName: string;
    email: string;
    password: string;
  }): Promise<AuthSession> {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const slug = `${slugify(input.tenantName)}-${randomBytes(3).toString("hex")}`;
    const passwordHash = await argonHash(input.password);

    await withTenant(this.handle, tenantId, async (db) => {
      await db.execute(sql`
        INSERT INTO tenants (id, name, slug, theme)
        VALUES (${tenantId}, ${input.tenantName}, ${slug}, '{}'::jsonb)
      `);
      await db.execute(sql`
        INSERT INTO users (id, tenant_id, email, password_hash, role)
        VALUES (${userId}, ${tenantId}, ${input.email.toLowerCase()}, ${passwordHash}, 'owner')
      `);
    });

    const tokens = await this.issueTokens(tenantId, userId, "owner");
    return {
      tenant: { id: tenantId, slug, name: input.tenantName },
      user: { id: userId, email: input.email.toLowerCase(), role: "owner" },
      tokens,
    };
  }

  async login(input: { tenantSlug: string; email: string; password: string }): Promise<AuthSession> {
    const tenantRows = (await this.handle.sql`
      SELECT id, name, slug FROM auth_tenant_by_slug(${input.tenantSlug})
    `) as unknown as TenantRow[];
    const tenant = tenantRows[0];
    if (!tenant) {
      throw new AuthError("TENANT_NOT_FOUND", "Unknown workspace");
    }
    const userRows = (await this.handle.sql`
      SELECT id, tenant_id, email, password_hash, role
      FROM auth_user_by_email(${tenant.id}::uuid, ${input.email.toLowerCase()})
    `) as unknown as UserRow[];
    const user = userRows[0];
    if (!user || !(await argonVerify(user.password_hash, input.password))) {
      throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
    }
    const tokens = await this.issueTokens(user.tenant_id, user.id, user.role);
    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      user: { id: user.id, email: user.email, role: user.role },
      tokens,
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = sha256(refreshToken);
    const rows = (await this.handle.sql`
      SELECT id, tenant_id, user_id, expires_at, revoked_at
      FROM auth_refresh_lookup(${tokenHash})
    `) as unknown as RefreshRow[];
    const row = rows[0];
    if (!row || row.revoked_at !== null || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AuthError("REFRESH_INVALID", "Refresh token is no longer valid");
    }
    const userRows = (await this.handle.sql`
      SELECT id, tenant_id, email, password_hash, role
      FROM auth_user_by_id(${row.user_id}::uuid)
    `) as unknown as UserRow[];
    const user = userRows[0];
    if (!user) {
      throw new AuthError("REFRESH_INVALID", "Refresh token is no longer valid");
    }

    const next = randomBytes(32).toString("base64url");
    const nextHash = sha256(next);
    const nextId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.refreshTtlDays * 86_400_000);

    await withTenant(this.handle, row.tenant_id, async (db) => {
      await db.execute(sql`
        UPDATE refresh_tokens SET revoked_at = now(), replaced_by = ${nextId}
        WHERE id = ${row.id} AND revoked_at IS NULL
      `);
      await db.execute(sql`
        INSERT INTO refresh_tokens (id, tenant_id, user_id, token_hash, expires_at)
        VALUES (${nextId}, ${row.tenant_id}, ${row.user_id}, ${nextHash}, ${expiresAt.toISOString()})
      `);
    });

    return {
      accessToken: await this.signAccess(row.tenant_id, row.user_id, user.role),
      refreshToken: next,
      expiresIn: this.config.accessTtlSeconds,
      tokenType: "Bearer",
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = sha256(refreshToken);
    const rows = (await this.handle.sql`
      SELECT tenant_id FROM auth_refresh_lookup(${tokenHash})
    `) as unknown as Array<{ tenant_id: string }>;
    const row = rows[0];
    if (!row) {
      return;
    }
    await withTenant(this.handle, row.tenant_id, async (db) => {
      await db.execute(sql`
        UPDATE refresh_tokens SET revoked_at = now()
        WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      `);
    });
  }

  /** Verifies a bearer access token and returns its claims. */
  async verifyAccess(token: string): Promise<{ tenantId: string; userId: string; role: string }> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: "privatefleet" });
      const tenantId = typeof payload.tid === "string" ? payload.tid : "";
      const userId = typeof payload.sub === "string" ? payload.sub : "";
      const role = typeof payload.role === "string" ? payload.role : "dispatcher";
      if (!tenantId || !userId) {
        throw new Error("INVALID_TOKEN");
      }
      return { tenantId, userId, role };
    } catch {
      throw new AuthError("INVALID_CREDENTIALS", "Access token is invalid or expired");
    }
  }

  private async issueTokens(
    tenantId: string,
    userId: string,
    role: "owner" | "dispatcher" | "admin",
  ): Promise<AuthTokens> {
    const refreshToken = randomBytes(32).toString("base64url");
    const tokenHash = sha256(refreshToken);
    const expiresAt = new Date(Date.now() + this.config.refreshTtlDays * 86_400_000);
    await withTenant(this.handle, tenantId, async (db) => {
      await db.execute(sql`
        INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at)
        VALUES (${tenantId}, ${userId}, ${tokenHash}, ${expiresAt.toISOString()})
      `);
    });
    return {
      accessToken: await this.signAccess(tenantId, userId, role),
      refreshToken,
      expiresIn: this.config.accessTtlSeconds,
      tokenType: "Bearer",
    };
  }

  private async signAccess(
    tenantId: string,
    userId: string,
    role: "owner" | "dispatcher" | "admin",
  ): Promise<string> {
    return new SignJWT({ tid: tenantId, role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("privatefleet")
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.secret);
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}


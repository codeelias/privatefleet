/**
 * Environment configuration (docs/04.7): zod-parsed, fail fast at boot.
 *
 * Phase 2 adds the Postgres backend seam:
 * - REPOSITORY_MODE=demo       -> in-memory DemoStore (Phase 1 demo)
 * - REPOSITORY_MODE=postgres   -> Drizzle repositories with RLS
 * DEMO_MODE=false is treated as REPOSITORY_MODE=postgres for
 * backward compatibility.
 */
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  REPOSITORY_MODE: z.enum(["demo", "postgres"]).optional(),
  DATABASE_URL: z.string().url().optional(),
  AUTH_JWT_SECRET: z.string().min(16).optional(),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const DEMO_SECRET = "dev-only-insecure-jwt-secret-change-me";

export interface AppConfig {
  port: number;
  host: string;
  demoMode: boolean;
  repositoryMode: "demo" | "postgres";
  databaseUrl: string | undefined;
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  name: string;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const data = parsed.data;
  const repositoryMode =
    data.REPOSITORY_MODE ?? (data.DEMO_MODE ? "demo" : "postgres");
  if (repositoryMode === "postgres" && !data.DATABASE_URL) {
    throw new Error("REPOSITORY_MODE=postgres requires DATABASE_URL");
  }
  if (repositoryMode === "postgres" && !data.AUTH_JWT_SECRET) {
    throw new Error("REPOSITORY_MODE=postgres requires AUTH_JWT_SECRET");
  }
  return {
    port: data.PORT,
    host: data.HOST,
    demoMode: repositoryMode === "demo",
    repositoryMode,
    databaseUrl: data.DATABASE_URL,
    jwtSecret: data.AUTH_JWT_SECRET ?? DEMO_SECRET,
    accessTtlSeconds: data.AUTH_ACCESS_TTL_SECONDS,
    refreshTtlDays: data.AUTH_REFRESH_TTL_DAYS,
    logLevel: data.LOG_LEVEL,
    name: "privatefleet-api",
    version: "0.2.0",
  };
}

/** Connection used by tests/scripts for DDL, seeding and cross-tenant probes. */
export function migrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.MIGRATION_DATABASE_URL ??
    "postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev"
  );
}

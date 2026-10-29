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
  AUTH_JWT_SECRET: z.string().min(32).optional(),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_ATTEMPT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  AUTH_MAX_ATTEMPTS_ACCOUNT: z.coerce.number().int().positive().default(5),
  AUTH_MAX_ATTEMPTS_IP: z.coerce.number().int().positive().default(50),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGINS: z.string().optional(),
  OSRM_BASE_URL: z.string().url().optional(),
  VROOM_BASE_URL: z.string().url().optional(),
  EVIDENCE_DIR: z.string().optional(),
  IMPORT_SERVICE_CENTER_LAT: z.coerce.number().min(-90).max(90).default(51.5074),
  IMPORT_SERVICE_CENTER_LNG: z.coerce.number().min(-180).max(180).default(-0.1278),
  IMPORT_SERVICE_RADIUS_METERS: z.coerce.number().int().positive().default(80_000),
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
  authAttemptWindowSeconds: number;
  authMaxAttemptsAccount: number;
  authMaxAttemptsIp: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  corsOrigins: string[];
  osrmBaseUrl: string | undefined;
  vroomBaseUrl: string | undefined;
  evidenceDir: string;
  importServiceArea: { latitude: number; longitude: number; radiusMeters: number };
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
    authAttemptWindowSeconds: data.AUTH_ATTEMPT_WINDOW_SECONDS,
    authMaxAttemptsAccount: data.AUTH_MAX_ATTEMPTS_ACCOUNT,
    authMaxAttemptsIp: data.AUTH_MAX_ATTEMPTS_IP,
    logLevel: data.LOG_LEVEL,
    osrmBaseUrl: data.OSRM_BASE_URL,
    vroomBaseUrl: data.VROOM_BASE_URL,
    evidenceDir: data.EVIDENCE_DIR ?? `${process.cwd()}/.data/evidence`,
    importServiceArea: {
      latitude: data.IMPORT_SERVICE_CENTER_LAT,
      longitude: data.IMPORT_SERVICE_CENTER_LNG,
      radiusMeters: data.IMPORT_SERVICE_RADIUS_METERS,
    },
    corsOrigins: (data.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
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








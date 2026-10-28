import { defineConfig, devices } from "@playwright/test";

/**
 * Browser authentication acceptance tests (Phase 2 gate follow-up):
 * real Fastify API in POSTGRES mode + the web app. Uses dedicated ports
 * (4002 / 5176) so the demo stack can keep running untouched.
 *
 * Access tokens expire after 3 seconds on purpose, so refresh-on-expiry
 * is exercised by the tests rather than mocked.
 */
const APP_DB = "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";
const MIGRATOR_DB = "postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev";
const JWT_SECRET = "auth-e2e-secret-at-least-16-characters";

export default defineConfig({
  testDir: "./tests-auth",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5176",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "auth",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @privatefleet/api exec tsx src/db/serve-auth-e2e.ts",
      cwd: "../..",
      url: "http://127.0.0.1:4002/healthz",
      reuseExistingServer: false,
      timeout: 150_000,
      env: {
        DATABASE_URL: APP_DB,
        MIGRATION_DATABASE_URL: MIGRATOR_DB,
        AUTH_JWT_SECRET: JWT_SECRET,
        AUTH_ACCESS_TTL_SECONDS: "3",
        AUTH_REFRESH_TTL_DAYS: "1",
        REPOSITORY_MODE: "postgres",
        PORT: "4002",
        LOG_LEVEL: "warn",
        CORS_ORIGINS: "http://127.0.0.1:8080",
      },
    },
    {
      command: "pnpm --filter @privatefleet/web dev --host 127.0.0.1 --port 5176",
      cwd: "../..",
      url: "http://127.0.0.1:5176",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:4002",
      },
    },
    {
      command: "pnpm export:web && node scripts/serve-dist.mjs",
      cwd: "../driver-expo",
      url: "http://127.0.0.1:8080",
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        EXPO_PUBLIC_API_URL: "http://127.0.0.1:4002",
        PORT: "8080",
      },
    },
    {
      command: "pnpm --filter @privatefleet/driver dev --host 127.0.0.1 --port 5177",
      cwd: "../..",
      url: "http://127.0.0.1:5177",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:4002",
      },
    },
  ],
});





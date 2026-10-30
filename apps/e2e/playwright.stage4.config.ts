import { defineConfig, devices } from "@playwright/test";

/**
 * Stage 4 release-closure E2E: the real Fastify API in POSTGRES mode plus
 * the dispatcher web app, on dedicated ports (4003 / 5178) so the demo and
 * auth stacks stay untouched.
 */
const APP_DB = "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";
const MIGRATOR_DB = "postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev";
const JWT_SECRET = "stage4-e2e-secret-at-least-16-characters";

export default defineConfig({
  testDir: "./tests-stage4",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "stage4",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @privatefleet/api exec tsx src/db/serve-stage4-e2e.ts",
      cwd: "../..",
      url: "http://127.0.0.1:4003/healthz",
      reuseExistingServer: false,
      timeout: 150_000,
      env: {
        DATABASE_URL: APP_DB,
        MIGRATION_DATABASE_URL: MIGRATOR_DB,
        AUTH_JWT_SECRET: JWT_SECRET,
        REPOSITORY_MODE: "postgres",
        PORT: "4003",
        LOG_LEVEL: "warn",
        CORS_ORIGINS: "http://127.0.0.1:5178",
      },
    },
    {
      command: "pnpm --filter @privatefleet/web dev --host 127.0.0.1 --port 5178",
      cwd: "../..",
      url: "http://127.0.0.1:5178",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:4003",
      },
    },
  ],
});

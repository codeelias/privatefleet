import { defineConfig, devices } from "@playwright/test";

/**
 * E2E for the three demo scenarios (docs/12.2) against the real
 * DEMO_MODE stack: Fastify API + dispatcher web + driver web.
 * Chromium is the only browser target; the driver project uses an
 * iPhone-sized viewport. Servers are reused when already running.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  workers: 1, // one shared demo store - serialize scenarios
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "dispatcher",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "driver",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @privatefleet/api dev",
      cwd: "../..",
      url: "http://127.0.0.1:4000/healthz",
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      command: "pnpm --filter @privatefleet/web dev --host 127.0.0.1 --port 5173",
      cwd: "../..",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      command: "pnpm --filter @privatefleet/driver dev --host 127.0.0.1 --port 5174",
      cwd: "../..",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
});

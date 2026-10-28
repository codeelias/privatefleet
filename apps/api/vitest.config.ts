import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./vitest.global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ["src/**/*.test.ts"],
  },
});

import { describe, expect, it } from "vitest";
import { TelemetryRateLimiter } from "./rate-limit.js";

describe("telemetry rate limiter", () => {
  it("allows the burst, rejects beyond it, and recovers after the window", () => {
    const limiter = new TelemetryRateLimiter(10_000, 3);
    const start = 1_000_000;
    expect(limiter.check("driver-a", start).allowed).toBe(true);
    expect(limiter.check("driver-a", start + 100).allowed).toBe(true);
    expect(limiter.check("driver-a", start + 200).allowed).toBe(true);
    const blocked = limiter.check("driver-a", start + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // Other devices are unaffected by one driver's burst.
    expect(limiter.check("driver-b", start + 300).allowed).toBe(true);

    // Window elapsed: allowed again.
    expect(limiter.check("driver-a", start + 10_301).allowed).toBe(true);
  });
});

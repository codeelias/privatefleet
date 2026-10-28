/**
 * Auth attempt limiter unit coverage: sliding-window thresholds, recovery,
 * independent account/IP dimensions, success reset and bounded memory.
 */
import { describe, expect, it } from "vitest";
import { AuthAttemptLimiter } from "./rate-limit.js";

function limiter(now: { value: number }, overrides = {}) {
  return new AuthAttemptLimiter({
    windowMs: 60_000,
    maxAccountFailures: 3,
    maxIpFailures: 10,
    maxEntries: 5,
    now: () => now.value,
    ...overrides,
  });
}

describe("auth attempt limiter", () => {
  it("throttles after the account threshold and reports a retry delay", () => {
    const now = { value: 1_000_000 };
    const l = limiter(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(l.check("account:a", "ip:1").allowed).toBe(true);
      l.recordFailure("account:a", "ip:1");
    }
    const blocked = l.check("account:a", "ip:1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("recovers after the window without permanent lockout", () => {
    const now = { value: 0 };
    const l = limiter(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      l.recordFailure("account:a", "ip:1");
    }
    expect(l.check("account:a", "ip:1").allowed).toBe(false);
    now.value = 60_001;
    expect(l.check("account:a", "ip:1").allowed).toBe(true);
  });

  it("does not let one account exhaust a shared IP bucket", () => {
    const now = { value: 0 };
    const l = limiter(now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      l.recordFailure("account:a", "ip:shared");
    }
    expect(l.check("account:a", "ip:shared").allowed).toBe(false);
    // A different account from the same depot IP is unaffected.
    expect(l.check("account:b", "ip:shared").allowed).toBe(true);
    l.recordFailure("account:b", "ip:shared");
    expect(l.check("account:b", "ip:shared").allowed).toBe(true);
  });

  it("success clears the account bucket but not the shared IP history", () => {
    const now = { value: 0 };
    const l = limiter(now);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      l.recordFailure("account:a", "ip:shared");
    }
    l.recordSuccess("account:a");
    expect(l.check("account:a", "ip:shared").allowed).toBe(true);
    // IP still holds two failures (below limit) for spraying awareness.
    expect(l.check("account:b", "ip:shared").allowed).toBe(true);
  });

  it("bounds memory by evicting least-recently-used buckets", () => {
    const now = { value: 0 };
    const l = limiter(now, { maxEntries: 2, maxIpFailures: 100 });
    l.recordFailure("account:a", "ip:1");
    now.value += 1;
    l.recordFailure("account:b", "ip:2");
    now.value += 1;
    l.recordFailure("account:c", "ip:3");
    expect(l.size()).toBeLessThanOrEqual(2);
  });
});

/**
 * Per-device telemetry rate limiting (docs/09.6). In-memory by design for
 * a single API instance; replace with a shared store when the API scales
 * horizontally.
 */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class TelemetryRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 10_000,
    private readonly max = 10,
  ) {}

  check(key: string, now = Date.now()): RateLimitDecision {
    if (this.buckets.size > 10_000) {
      this.prune(now);
    }
    const cutoff = now - this.windowMs;
    const hits = (this.buckets.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (hits.length >= this.max) {
      this.buckets.set(key, hits);
      const oldest = hits[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    hits.push(now);
    this.buckets.set(key, hits);
    return { allowed: true };
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, hits] of this.buckets) {
      const live = hits.filter((stamp) => stamp > cutoff);
      if (live.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, live);
      }
    }
  }
}

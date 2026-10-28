/**
 * In-memory authentication attempt limiter (pilot scope).
 *
 * Two independent dimensions are enforced:
 * - account/device key: stops guessing one credential;
 * - source-IP key: stops spraying many accounts from one source.
 *
 * Buckets are sliding windows of failures. A successful authentication
 * clears only that account bucket, never the IP bucket (so a compromised
 * account cannot reset a spray). There is no permanent lockout: the window
 * expires and the legitimate user can retry. State is bounded by maxEntries
 * and expired buckets are pruned on use.
 *
 * Single-instance limitation: this is process-local memory, not shared
 * across API replicas. A pilot with multiple instances needs a shared
 * limiter (e.g. Redis) or sticky routing.
 */
export interface AttemptDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AuthAttemptLimiterOptions {
  windowMs: number;
  maxAccountFailures: number;
  maxIpFailures: number;
  maxEntries: number;
  now?: () => number;
}

export class AuthAttemptLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: AuthAttemptLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  check(accountKey: string, ipKey: string): AttemptDecision {
    const now = this.now();
    const accountRetry = this.retryAfter(accountKey, this.options.maxAccountFailures, now);
    const ipRetry = this.retryAfter(ipKey, this.options.maxIpFailures, now);
    const retryAfterSeconds = Math.max(accountRetry, ipRetry);
    return {
      allowed: retryAfterSeconds === 0,
      retryAfterSeconds,
    };
  }

  recordFailure(accountKey: string, ipKey: string): void {
    const now = this.now();
    this.push(accountKey, now);
    this.push(ipKey, now);
    this.evictIfNeeded(now);
  }

  recordSuccess(accountKey: string): void {
    this.buckets.delete(accountKey);
  }

  /** Test/observability accessor. */
  size(): number {
    return this.buckets.size;
  }

  private push(key: string, now: number): void {
    const entries = this.buckets.get(key) ?? [];
    entries.push(now);
    this.buckets.set(key, entries);
    this.prune(key, now);
  }

  private retryAfter(key: string, limit: number, now: number): number {
    const entries = this.buckets.get(key);
    if (!entries || entries.length === 0) {
      return 0;
    }
    const cutoff = now - this.options.windowMs;
    const active = entries.filter((timestamp) => timestamp > cutoff);
    if (active.length === 0) {
      this.buckets.delete(key);
      return 0;
    }
    if (active.length < limit) {
      return 0;
    }
    const oldest = active[0]!;
    return Math.max(1, Math.ceil((oldest + this.options.windowMs - now) / 1000));
  }

  private prune(key: string, now: number): void {
    const entries = this.buckets.get(key);
    if (!entries) {
      return;
    }
    const cutoff = now - this.options.windowMs;
    const active = entries.filter((timestamp) => timestamp > cutoff);
    if (active.length === 0) {
      this.buckets.delete(key);
      return;
    }
    if (active.length !== entries.length) {
      this.buckets.set(key, active);
    }
  }

  private evictIfNeeded(now: number): void {
    if (this.buckets.size <= this.options.maxEntries) {
      return;
    }
    // Drop expired buckets first, then the least-recently-used ones until
    // the hard cap is respected. This guarantees bounded memory.
    for (const key of [...this.buckets.keys()]) {
      this.prune(key, now);
    }
    if (this.buckets.size <= this.options.maxEntries) {
      return;
    }
    const ordered = [...this.buckets.entries()]
      .map(([key, entries]) => ({ key, last: entries[entries.length - 1] ?? 0 }))
      .sort((a, b) => a.last - b.last);
    const excess = this.buckets.size - this.options.maxEntries;
    for (let index = 0; index < excess; index += 1) {
      const entry = ordered[index];
      if (entry) {
        this.buckets.delete(entry.key);
      }
    }
  }
}

/**
 * Offline queue contract tests (docs/06.4): offline stays pending, a 4xx
 * becomes an explicit conflict with the server's uiMessage, idempotency
 * keys are stable across retries, and only one flush runs at a time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClientModule from "./client";

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const baseCommand = {
  commandId: "cmd-1",
  kind: "arrive" as const,
  jobId: "job-1",
  stopId: "stop-1",
  driverId: "driver-1",
  capturedAt: new Date().toISOString(),
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
  fetchMock = vi.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function client(): Promise<typeof ClientModule> {
  return await import("./client");
}

describe("driver offline queue", () => {
  it("keeps a command pending offline and retries with the same idempotency key", async () => {
    const { enqueue, flush, pendingCount, loadQueue } = await client();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const first = await enqueue(baseCommand);
    expect(first.ok).toBe(false);
    expect(first.message).toMatch(/Offline/);
    expect(pendingCount()).toBe(1);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stopId: "stop-1", status: "arrived" }));
    const retry = await flush();
    expect(retry.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = secondCall[1].headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("cmd-1");
    expect(loadQueue()).toHaveLength(0);
  });

  it("marks a 4xx as an explicit conflict and surfaces the server uiMessage", async () => {
    const { enqueue, pendingCount, conflictCount } = await client();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        uiMessage: "Wait - this stop already changed state. Refresh your queue.",
      }),
    );

    const result = await enqueue(baseCommand);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.message).toContain("already changed state");
    expect(pendingCount()).toBe(0);
    expect(conflictCount()).toBe(1);
  });

  it("runs a single flush for concurrent calls", async () => {
    const { flush } = await client();
    const deferred: { resolve?: (response: Response) => void } = {};
    let callCount = 0;
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem(
      "privatefleet.driver.queue",
      JSON.stringify([{ ...baseCommand, status: "pending" }]),
    );
    fetchMock.mockImplementation(() => {
      callCount += 1;
      return new Promise<Response>((resolve) => {
        deferred.resolve = resolve;
      });
    });

    const first = flush();
    const second = flush();
    await Promise.resolve();
    expect(deferred.resolve).toBeDefined();
    deferred.resolve?.(jsonResponse(200, { stopId: "stop-1", status: "arrived" }));
    await Promise.all([first, second]);

    expect(callCount).toBe(1);
  });
});

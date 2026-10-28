/**
 * Expo offline queue contract tests: AsyncStorage-backed durability,
 * offline stays pending, 4xx conflict with uiMessage, stable idempotency
 * keys across retries, single-flight flush.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string): Promise<string | null> => memory.get(key) ?? null,
    setItem: async (key: string, value: string): Promise<void> => {
      memory.set(key, value);
    },
    removeItem: async (key: string): Promise<void> => {
      memory.delete(key);
    },
  },
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const baseCommand = {
  commandId: "expo-cmd-1",
  kind: "arrive" as const,
  jobId: "job-1",
  stopId: "stop-1",
  driverId: "driver-1",
  capturedAt: new Date().toISOString(),
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  memory.clear();
  fetchMock = vi.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function queue(): Promise<typeof import("./queue")> {
  return await import("./queue");
}

describe("expo driver offline queue", () => {
  it("persists a command offline and retries with the same idempotency key", async () => {
    const { enqueue, flush, pendingCount, loadQueue } = await queue();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const first = await enqueue(baseCommand);
    expect(first.ok).toBe(false);
    expect(first.message).toMatch(/Offline/);
    expect(await pendingCount()).toBe(1);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { stopId: "stop-1", status: "arrived" }));
    const retry = await flush();
    expect(retry.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = secondCall[1].headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("expo-cmd-1");
    expect(await loadQueue()).toHaveLength(0);
  });

  it("turns a 4xx into an explicit conflict with the server message", async () => {
    const { enqueue, loadQueue } = await queue();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        uiMessage: "Wait - this stop already changed state. Refresh your queue.",
      }),
    );

    const result = await enqueue(baseCommand);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.message).toContain("already changed state");
    const stored = await loadQueue();
    expect(stored[0]?.status).toBe("conflict");
  });

  it("runs a single flush for concurrent calls", async () => {
    const { flush } = await queue();
    memory.set(
      "privatefleet.expo.queue.v1",
      JSON.stringify([{ ...baseCommand, status: "pending" }]),
    );
    const deferred: { resolve?: (response: Response) => void } = {};
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount += 1;
      return new Promise<Response>((resolve) => {
        deferred.resolve = resolve;
      });
    });

    const first = flush();
    const second = flush();
    await vi.waitFor(() => {
      expect(deferred.resolve).toBeDefined();
    });
    deferred.resolve?.(jsonResponse(200, { stopId: "stop-1", status: "arrived" }));
    await Promise.all([first, second]);

    expect(callCount).toBe(1);
  });
});


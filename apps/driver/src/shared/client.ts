/**
 * Driver client: typed API access and the offline command queue
 * (docs/06.4). Every user action is a queued command with a stable
 * idempotency key; the server decides accepted state. Local persistence
 * uses localStorage on the web demo; expo-sqlite replaces it in the
 * native pilot (Phase 3).
 */
import type {
  DriverDto,
  FleetState,
  JobDto,
  JobStopDto,
} from "@privatefleet/contracts";
import { io } from "socket.io-client";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { uiMessage?: string } | null;
    throw new Error(body?.uiMessage ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export interface DriverQueue {
  driver: DriverDto;
  jobs: JobDto[];
}

export const api = {
  fleetState: () => request<FleetState>("/v1/fleet/state"),
  startShift: (driverId: string) =>
    request<DriverDto>("/v1/driver/shift/start", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  queue: (driverId: string) =>
    request<DriverQueue>(`/v1/driver/${driverId}/queue`),
  arrive: (jobId: string, stopId: string, driverId: string, commandId: string) =>
    request<JobDto>(`/v1/jobs/${jobId}/stops/${stopId}/arrive`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId }),
    }),
  complete: (
    jobId: string,
    stopId: string,
    driverId: string,
    payload: { recipientName?: string | undefined; notes?: string | undefined },
    commandId: string,
  ) =>
    request<JobDto>(`/v1/jobs/${jobId}/stops/${stopId}/complete`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId, ...payload }),
    }),
  skip: (jobId: string, stopId: string, driverId: string, reason: string, commandId: string) =>
    request<JobDto>(`/v1/jobs/${jobId}/stops/${stopId}/skip`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId, reason }),
    }),
};

export function createFleetSocket() {
  return io({ path: "/socket.io" });
}

export interface QueuedCommand {
  commandId: string;
  kind: "arrive" | "complete" | "skip";
  jobId: string;
  stopId: string;
  driverId: string;
  payload?: { recipientName?: string; notes?: string; reason?: string } | undefined;
  capturedAt: string;
  status: "pending" | "accepted" | "conflict";
}

const STORAGE_KEY = "privatefleet.driver.queue";

export function loadQueue(): QueuedCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedCommand[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedCommand[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function pendingCount(): number {
  return loadQueue().filter((c) => c.status === "pending").length;
}

export async function enqueue(command: Omit<QueuedCommand, "status">): Promise<void> {
  const queue = loadQueue();
  queue.push({ ...command, status: "pending" });
  saveQueue(queue);
  const result = await flush();
  // Conflicts surface to the driver explicitly - never silent (docs/06.4).
  if (!result.ok) {
    throw new Error(result.message ?? "Sync failed");
  }
}

/** Submit pending commands in order; conflicts surface, never overwrite. */
export async function flush(): Promise<{ ok: boolean; message?: string }> {
  const queue = loadQueue();
  for (const command of queue) {
    if (command.status !== "pending") {
      continue;
    }
    try {
      if (command.kind === "arrive") {
        await api.arrive(command.jobId, command.stopId, command.driverId, command.commandId);
      } else if (command.kind === "complete") {
        await api.complete(
          command.jobId,
          command.stopId,
          command.driverId,
          {
            recipientName: command.payload?.recipientName,
            notes: command.payload?.notes,
          },
          command.commandId,
        );
      } else {
        await api.skip(
          command.jobId,
          command.stopId,
          command.driverId,
          command.payload?.reason ?? "No reason given",
          command.commandId,
        );
      }
      command.status = "accepted";
    } catch (err) {
      command.status = "conflict";
      saveQueue(queue);
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Sync failed",
      };
    }
  }
  saveQueue(queue.filter((c) => c.status !== "accepted"));
  return { ok: true };
}

export function nextStops(queue: DriverQueue): { job: JobDto; stop: JobStopDto }[] {
  return queue.jobs.flatMap((job) =>
    job.stops
      .filter((s) => s.status === "pending" || s.status === "arrived")
      .map((stop) => ({ job, stop })),
  );
}

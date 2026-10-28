/**
 * Durable offline command queue for the Expo driver app (AsyncStorage on
 * device, localStorage-backed on web). Commands carry stable idempotency
 * keys; 4xx responses surface as explicit conflicts, network failures
 * stay pending for retry, and a single flush runs at a time.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, HttpError } from "./api";

type CommandKind = "arrive" | "complete" | "skip";

export interface QueuedCommand {
  commandId: string;
  kind: CommandKind;
  jobId: string;
  stopId: string;
  driverId: string;
  recipientName?: string;
  reason?: string;
  capturedAt: string;
  status: "pending" | "accepted" | "conflict";
}

const QUEUE_KEY = "privatefleet.expo.queue.v1";

let flushInFlight: Promise<{ ok: boolean; message?: string; conflict?: boolean }> | null = null;

export async function loadQueue(): Promise<QueuedCommand[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedCommand[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedCommand[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function pendingCount(): Promise<number> {
  return (await loadQueue()).filter((command) => command.status === "pending").length;
}

export async function enqueue(
  command: Omit<QueuedCommand, "status">,
): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  const queue = await loadQueue();
  queue.push({ ...command, status: "pending" });
  await saveQueue(queue);
  return flush();
}

export async function flush(): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  if (flushInFlight) {
    return flushInFlight;
  }
  flushInFlight = flushOnce().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function flushOnce(): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  const queue = await loadQueue();
  for (const command of queue) {
    if (command.status !== "pending") {
      continue;
    }
    try {
      await dispatch(command);
      command.status = "accepted";
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        command.status = "conflict";
        await saveQueue(queue);
        return { ok: false, conflict: true, message: err.message };
      }
      await saveQueue(queue);
      return {
        ok: false,
        message: "Offline - your action is saved and will sync automatically.",
      };
    }
  }
  await saveQueue(queue.filter((command) => command.status !== "accepted"));
  return { ok: true };
}

async function dispatch(command: QueuedCommand): Promise<void> {
  if (command.kind === "arrive") {
    await api.arrive(command.jobId, command.stopId, command.driverId, command.commandId);
  } else if (command.kind === "complete") {
    await api.complete(
      command.jobId,
      command.stopId,
      command.driverId,
      command.recipientName ?? "",
      command.commandId,
    );
  } else {
    await api.skip(
      command.jobId,
      command.stopId,
      command.driverId,
      command.reason ?? "No reason given",
      command.commandId,
    );
  }
}

/**
 * Durable offline command queue for the Expo driver app (AsyncStorage on
 * device, localStorage-backed on web). Commands carry stable idempotency
 * keys; 4xx responses surface as explicit conflicts, network failures
 * stay pending for retry, and a single flush runs at a time.
 *
 * Evidence is uploaded before a completion/skip is finalised. Signature
 * vectors are small text; photographs remain in app-private file storage
 * and only their URI is queued. Local media is deleted only after the
 * server accepts the command.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { api, HttpError } from "./api";

type CommandKind = "arrive" | "complete" | "skip";

export interface QueuedCommand {
  commandId: string;
  kind: CommandKind;
  jobId: string;
  stopId: string;
  driverId: string;
  recipientName?: string;
  notes?: string;
  signaturePath?: string;
  photoUri?: string;
  failureCode?: string;
  failureNote?: string;
  failurePhotoUri?: string;
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

async function readPhotoBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

async function removeLocalPhoto(uri: string | undefined): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // The queue already has the accepted server record; cleanup can retry.
  }
}

async function uploadEvidence(command: QueuedCommand): Promise<void> {
  const capturedAt = command.capturedAt;
  if (command.signaturePath) {
    await api.uploadEvidence(command.jobId, command.stopId, {
      kind: "signature",
      pathData: command.signaturePath,
      capturedAt,
    });
  }
  if (command.photoUri) {
    const dataBase64 = await readPhotoBase64(command.photoUri);
    await api.uploadEvidence(command.jobId, command.stopId, {
      kind: "photo",
      dataBase64,
      capturedAt,
    });
  }
  if (command.failurePhotoUri) {
    const dataBase64 = await readPhotoBase64(command.failurePhotoUri);
    await api.uploadEvidence(command.jobId, command.stopId, {
      kind: "failure_photo",
      dataBase64,
      capturedAt,
    });
  }
}

async function flushOnce(): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  const queue = await loadQueue();
  for (const command of queue) {
    if (command.status !== "pending") {
      continue;
    }
    try {
      if (command.kind === "complete" || command.kind === "skip") {
        await uploadEvidence(command);
      }
      await dispatch(command);
      command.status = "accepted";
      // Persist acceptance before deleting local media: a crash after this
      // point leaves either an accepted command or an orphan local file,
      // never a pending command whose evidence has disappeared.
      await saveQueue(queue);
      await removeLocalPhoto(command.photoUri);
      await removeLocalPhoto(command.failurePhotoUri);
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        command.status = "conflict";
        await saveQueue(queue);
        return { ok: false, conflict: true, message: err.message };
      }
      await saveQueue(queue);
      return {
        ok: false,
        message: "Offline - your action and evidence are saved and will sync automatically.",
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
      command.failureCode ?? "OTHER",
      command.failureNote,
      command.commandId,
    );
  }
}



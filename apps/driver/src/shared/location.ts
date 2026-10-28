/**
 * Foreground location reporting for the driver device (docs/06, docs/09.6):
 * browser/Expo geolocation -> bounded buffer -> batched authenticated
 * telemetry posts. Failed batches are merged back and retried; the UI is
 * told the truthful state.
 */
import { api } from "./client";
import {
  mergeFailed,
  pushSample,
  takeBatch,
  type LocationSample,
} from "./location-buffer";

export type LocationStatus = "idle" | "sharing" | "error";

export interface LocationReporter {
  start: () => void;
  stop: () => void;
  flush: () => Promise<void>;
  bufferSize: () => number;
}

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 20;

export function createLocationReporter(callbacks: {
  onStatus: (status: LocationStatus, message?: string) => void;
}): LocationReporter {
  let watchId: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let buffer: LocationSample[] = [];
  let flushing = false;

  const flush = async (): Promise<void> => {
    if (flushing || buffer.length === 0) {
      return;
    }
    flushing = true;
    const { batch, rest } = takeBatch(buffer, BATCH_SIZE);
    buffer = rest;
    try {
      await api.telemetry(batch);
      callbacks.onStatus("sharing");
    } catch (err) {
      buffer = mergeFailed(buffer, batch);
      callbacks.onStatus(
        "error",
        err instanceof Error ? err.message : "Location could not be sent",
      );
    } finally {
      flushing = false;
    }
  };

  const onPosition = (position: GeolocationPosition): void => {
    buffer = pushSample(buffer, {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
      ...(position.coords.accuracy !== undefined
        ? { accuracyMetres: position.coords.accuracy }
        : {}),
      ...(position.coords.heading !== null && Number.isFinite(position.coords.heading)
        ? { headingDeg: position.coords.heading }
        : {}),
      ...(position.coords.speed !== null && Number.isFinite(position.coords.speed)
        ? { speedMps: position.coords.speed }
        : {}),
    });
    callbacks.onStatus("sharing");
  };

  return {
    start() {
      if (watchId !== null) {
        return;
      }
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        callbacks.onStatus("error", "This device does not provide location.");
        return;
      }
      callbacks.onStatus("sharing");
      watchId = navigator.geolocation.watchPosition(
        onPosition,
        (error) => {
          callbacks.onStatus("error", error.message || "Location permission failed.");
        },
        { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 },
      );
      timer = setInterval(() => {
        void flush();
      }, FLUSH_INTERVAL_MS);
    },
    stop() {
      if (watchId !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchId);
      }
      watchId = null;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      void flush();
      callbacks.onStatus("idle");
    },
    flush,
    bufferSize: () => buffer.length,
  };
}

/**
 * Foreground GPS reporting for the Expo driver app: expo-location watch ->
 * bounded buffer -> batched authenticated /v1/telemetry posts. Failed
 * batches are merged back and retried. This is foreground only; background
 * tracking belongs to the native Kotlin module.
 */
import * as Location from "expo-location";
import { api } from "./api";

interface TelemetrySample {
  latitude: number;
  longitude: number;
  capturedAt: string;
  accuracyMetres?: number;
  headingDeg?: number;
  speedMps?: number;
}

let watch: Location.LocationSubscription | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let buffer: TelemetrySample[] = [];
let flushing = false;

async function flush(): Promise<void> {
  if (flushing || buffer.length === 0) {
    return;
  }
  flushing = true;
  const batch = buffer.splice(0, 20);
  try {
    await api.telemetry(batch);
  } catch (err) {
    buffer.unshift(...batch);
    console.warn("[pf-location] telemetry flush failed", err);
  } finally {
    flushing = false;
  }
}

export async function startLocationTracking(): Promise<void> {
  if (watch) {
    return;
  }
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    console.warn("[pf-location] permission denied:", status);
    return;
  }
  watch = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5_000,
      distanceInterval: 5,
    },
    (location) => {
      buffer.push({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        capturedAt: new Date(location.timestamp).toISOString(),
        ...(location.coords.accuracy !== null && location.coords.accuracy !== undefined
          ? { accuracyMetres: location.coords.accuracy }
          : {}),
        ...(location.coords.heading !== null && location.coords.heading !== undefined
          ? { headingDeg: location.coords.heading }
          : {}),
        ...(location.coords.speed !== null && location.coords.speed !== undefined && location.coords.speed >= 0
          ? { speedMps: location.coords.speed }
          : {}),
      });
    },
  );
  flushTimer = setInterval(() => void flush(), 5_000);
  console.log("[pf-location] foreground tracking started");
}

export function stopLocationTracking(): void {
  watch?.remove();
  watch = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  void flush();
  console.log("[pf-location] foreground tracking stopped");
}

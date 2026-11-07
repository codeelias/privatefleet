/**
 * Public customer tracking page (/track/:token). Polls the scoped public
 * endpoint and renders the branded portal with a live vehicle position on
 * the same PrivateFleet Night vector style as the dispatcher. No tenant
 * Socket.IO, no dispatcher chrome, no personal data.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PublicTrackingResponse } from "@privatefleet/contracts";

const POLL_MS = 5_000;

export function PublicTracking({ token }: { token: string }) {
  const [data, setData] = useState<PublicTrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    const position = data?.position;
    if (!position || !mapContainerRef.current) {
      return;
    }
    if (!mapRef.current) {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: "/map-style-night.json",
        center: [position.longitude, position.latitude],
        zoom: 14,
        interactive: false,
        attributionControl: false,
      });
      const element = document.createElement("div");
      element.className =
        "h-4 w-4 rounded-full border-2 border-white bg-[#276EF1] shadow-[0_0_0_6px_rgba(39,110,241,0.25)]";
      markerRef.current = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([position.longitude, position.latitude])
        .addTo(map);
      mapRef.current = map;
      map.setPadding({ top: 0, bottom: 300, left: 0, right: 0 });
      return;
    }
    markerRef.current?.setLngLat([position.longitude, position.latitude]);
    mapRef.current.panTo([position.longitude, position.latitude], { duration: 600 });
  }, [data?.position]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const res = await fetch(`/v1/public/tracking/${encodeURIComponent(token)}`);
        if (res.status === 429) {
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError("This tracking link is no longer available.");
          return;
        }
        const next = (await res.json()) as PublicTrackingResponse;
        if (!cancelled) setData(next);
      } catch {
        // Network failure keeps the last known state; no error splash.
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2EEE4] px-5 text-[#171816]">
        <p className="text-sm">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2EEE4] px-5 text-[#171816]">
        <p className="text-sm">Loading your delivery...</p>
      </div>
    );
  }

  const done = data.stops.filter((stop) => stop.status === "completed").length;
  const progress = Math.round((done / Math.max(data.stops.length, 1)) * 100);
  const etaMinutes = data.eta
    ? Math.max(0, Math.round((Date.parse(data.eta) - Date.now()) / 60_000))
    : null;
  const initials =
    data.driverName
      ?.split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2) ?? "PF";
  const nextStop = data.stops.find((stop) => stop.status !== "completed");

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#09090B] text-[#E4E4E7]">
      <div className="absolute inset-0">
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-[#27272A]/70 bg-[#09090B]/75 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#276EF1] text-sm font-black text-white">
            P
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">
              PRIVATE FLEET
            </p>
            <p className="text-sm font-bold">Live delivery</p>
          </div>
        </div>
        <span className="text-xs text-[#A1A1AA]">Job {data.jobReference}</span>
      </header>

      <section className="absolute inset-x-0 bottom-0 z-10 max-h-[62%] overflow-y-auto rounded-t-[28px] border-t border-[#27272A] bg-[#18181B] px-5 pb-6 pt-3 shadow-[0_-18px_50px_rgba(0,0,0,0.55)]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#3F3F46]" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#276EF1] text-sm font-bold text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {data.driverName ?? "Your driver"}
            </p>
            <p className="text-xs text-[#A1A1AA]">
              {data.vehicleRegistration ?? "Vehicle assigned"}
              {" · "}
              {data.status.replace("_", " ")}
            </p>
          </div>
          <span className="rounded-full border border-[#27272A] px-2.5 py-1 text-[10px] font-semibold text-[#A1A1AA]">
            {data.position?.stale ? "Signal lost" : "Live"}
          </span>
        </div>

        {data.liveProgress && (
          <p className="mt-3 inline-flex rounded-full bg-[#276EF1]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#93C5FD]">
            {data.liveProgress.stopsAway > 0
              ? `${data.liveProgress.stopsAway} stop${data.liveProgress.stopsAway === 1 ? "" : "s"} before you`
              : "You are next"}
          </p>
        )}
        <p className="mt-4 text-[64px] font-bold leading-[0.95] tracking-[-0.04em] text-white">
          {data.liveProgress
            ? `~${data.liveProgress.etaMinutes} min`
            : etaMinutes !== null
              ? `${etaMinutes} min`
              : data.status.replace("_", " ")}
        </p>
        <p className="mt-1 text-sm text-[#A1A1AA]">
          {data.deliveryWindow
            ? `${data.deliveryWindow.stage === "arriving" ? "Arriving" : "Expected"} ${new Date(
                data.deliveryWindow.from,
              ).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} - ${new Date(
                data.deliveryWindow.to,
              ).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : data.eta
              ? `${data.liveProgress ? "Live estimate" : "Estimated"} arrival ${new Date(data.eta).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Estimated arrival unavailable"}
        </p>
        {data.deliveryWindow && (
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#71717A]">
            {data.deliveryWindow.stage === "scheduled"
              ? "Confirmed window"
              : data.deliveryWindow.stage === "enroute"
                ? "Window updated - driver on the way"
                : "Window updated - you are next"}
          </p>
        )}
        {data.inCustomerZone && (
          <p className="mt-2 inline-flex rounded-full bg-[#1E3A8A]/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#93C5FD]">
            {data.customerZoneName ? `In your area - ${data.customerZoneName}` : "In your area"}
          </p>
        )}
        {data.delayStatus && data.delayStatus !== "unknown" && (
          <p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${data.delayStatus === "late" ? "bg-[#7F1D1D]/40 text-[#FCA5A5]" : "bg-[#14532D]/40 text-[#86EFAC]"}`}>
            {data.delayStatus === "late" ? "Running late" : "On time"}
          </p>
        )}

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#27272A]">
          <div
            className="h-full rounded-full bg-[#276EF1] transition-[width] duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-[#A1A1AA]">
          <span>
            {done} of {data.stops.length} stops completed
            {typeof data.remainingStops === "number" ? ` - ${data.remainingStops} to go` : ""}
          </span>
          <span>{progress}%</span>
        </div>

        {nextStop && (
          <div className="mt-4 rounded-2xl border border-[#27272A] bg-[#111113] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#71717A]">
              Next stop
            </p>
            <p className="mt-1 truncate text-sm font-medium text-[#E4E4E7]">
              {nextStop.address}
            </p>
          </div>
        )}

        {data.proof && (
          <div className="mt-4 rounded-2xl border border-[#27272A] bg-[#111113] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#71717A]">Proof of service</p>
            <p className="mt-1 text-xs text-[#A1A1AA]">
              {data.proof.photos > 0 ? `${data.proof.photos} photo${data.proof.photos === 1 ? "" : "s"} recorded` : "No photo"}
              {" · "}
              {data.proof.signatures > 0 ? `${data.proof.signatures} signature${data.proof.signatures === 1 ? "" : "s"} recorded` : "no signature"}
              {data.proof.lastRecordedAt ? ` · ${new Date(data.proof.lastRecordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
            {data.proof.photoIds.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {data.proof.photoIds.map((photo) => (
                  <img
                    key={photo.id}
                    src={`/v1/public/tracking/${encodeURIComponent(token)}/proof/${photo.id}`}
                    alt={`Delivery photo ${new Date(photo.capturedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
                    className="h-20 w-20 shrink-0 rounded-lg border border-[#27272A] object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-[10px] leading-relaxed text-[#71717A]">
          {data.lastUpdateAt
            ? `Last update ${Math.max(1, Math.round((Date.now() - Date.parse(data.lastUpdateAt)) / 1000))}s ago - `
            : ""}
          This page shows live delivery progress and never shares personal contact
          details. Map &copy; OpenStreetMap contributors &copy; OpenFreeMap.
        </p>
      </section>
    </div>
  );
}

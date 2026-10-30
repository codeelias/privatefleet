/**
 * Public customer tracking page (/track/:token). Polls the scoped public
 * endpoint and renders the branded portal with a live vehicle position on a
 * raster map. No tenant Socket.IO, no dispatcher chrome, no personal data.
 */
import { useEffect, useState } from "react";
import type { PublicTrackingResponse } from "@privatefleet/contracts";

const POLL_MS = 5_000;

function tilePosition(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

export function PublicTracking({ token }: { token: string }) {
  const [data, setData] = useState<PublicTrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const zoom = 14;
  const mapSize = 256;
  const center = data.position
    ? tilePosition(data.position.latitude, data.position.longitude, zoom)
    : null;
  const tiles = center
    ? [
        { x: Math.floor(center.x / mapSize), y: Math.floor(center.y / mapSize) },
      ]
    : [];

  const done = data.stops.filter((stop) => stop.status === "completed").length;
  const progress = Math.round((done / Math.max(data.stops.length, 1)) * 100);

  return (
    <div className="min-h-screen bg-[#F2EEE4] text-[#171816]">
      <header className="flex items-center justify-between border-b border-[#D8CFBD] bg-[#FBF8F1] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB] text-sm font-black text-white">
            P
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#756E61]">
              PRIVATE FLEET
            </p>
            <p className="text-sm font-bold">Customer tracking page</p>
          </div>
        </div>
        <span className="text-xs text-[#756E61]">Tracking / Job {data.jobReference}</span>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 py-6">
        <h1 className="text-xl font-bold">Your delivery is on the way</h1>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#FBF8F1] p-4 shadow-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2563EB] text-[10px] font-black text-white">
            {data.jobReference}
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {data.status.replace("_", " ")}
            </p>
            <p className="text-xs text-[#756E61]">
              {data.eta
                ? `Estimated arrival ${new Date(data.eta).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "Estimated arrival unavailable"}
              {data.vehicleRegistration ? ` · ${data.vehicleRegistration}` : ""}
            </p>
          </div>
        </div>

        {center && (
          <div className="relative mt-4 h-56 overflow-hidden rounded-xl border border-[#D8CFBD] bg-[#E4DCCB]">
            <div className="absolute inset-0">
              {tiles.map((tile) => (
                <img
                  key={`${tile.x}-${tile.y}`}
                  alt=""
                  src={`https://tiles.openfreemap.org/planet/${zoom}/${tile.x}/${tile.y}.png`}
                  className="absolute h-[256px] w-[256px]"
                  style={{
                    left: center.x - tile.x * mapSize,
                    top: center.y - tile.y * mapSize,
                    transform: "translate(-128px, -128px)",
                  }}
                />
              ))}
            </div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span className="block h-4 w-4 rounded-full border-2 border-white bg-[#2563EB] shadow" />
            </div>
            {data.position?.stale && (
              <p className="absolute left-2 top-2 rounded bg-[#171816]/80 px-2 py-0.5 text-[10px] text-white">
                Position unavailable right now
              </p>
            )}
          </div>
        )}

        <div className="mt-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#756E61]">
            Delivery progress
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E4DCCB]">
            <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <ol className="mt-4 space-y-2">
          {data.stops.map((stop) => {
            const state = stop.status === "completed" ? "done" : stop.status === "arrived" ? "current" : "pending";
            return (
              <li key={stop.sequence} className="flex items-center gap-3 text-sm">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    state === "done"
                      ? "bg-[#16A34A]"
                      : state === "current"
                        ? "bg-[#2563EB]"
                        : "bg-[#C9BFA8]"
                  }`}
                />
                <span className={state === "pending" ? "text-[#756E61]" : "font-semibold"}>
                  {stop.address}
                </span>
                <span className="ml-auto text-xs text-[#756E61]">
                  {state === "done" ? "Delivered" : state === "current" ? "In progress" : "Pending"}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-6 text-[10px] leading-relaxed text-[#756E61]">
          {data.driverName ? `Your driver today is ${data.driverName}. ` : ""}
          This page shows live delivery progress and never shares personal contact details.
        </p>
      </main>
    </div>
  );
}

/**
 * Live map canvas (docs/05.6, ADR-0010).
 *
 * Two rendering engines, one contract:
 * - Primary: MapLibre GL vector tiles (OpenFreeMap dark). Requires WebGL.
 * - Fallback: Leaflet DOM raster tiles - works in every browser,
 *   including remote-desktop / GPU-less / hardware-acceleration-off
 *   sessions where WebGL is unavailable. Engaged automatically when
 *   MapLibre fails to initialise or load its style, and manually via
 *   the query flag `?map=leaflet` for diagnosis.
 *
 * Vehicle pins and job markers stay as HTML overlays in both modes, so
 * the ghost-pin/status semantics and drag targets never change.
 */
import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetState, VehicleDto } from "@privatefleet/contracts";

const LONDON = { lng: -0.107, lat: 51.517 };
const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";
const RASTER_DARK = "https://tiles.openfreemap.org/styles/dark/{z}/{x}/{y}.png";
const RASTER_LIBERTY = "https://tiles.openfreemap.org/styles/liberty/{z}/{x}/{y}.png";

const BOUNDS = {
  minLat: 51.49,
  maxLat: 51.55,
  minLng: -0.15,
  maxLng: -0.07,
};

function forceLeaflet(): boolean {
  return new URLSearchParams(window.location.search).get("map") === "leaflet";
}

function project(latitude: number, longitude: number): { x: number; y: number } {
  const x = ((longitude - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100;
  const y = ((BOUNDS.maxLat - latitude) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100;
  return { x, y };
}

function colourFor(vehicle: VehicleDto): string {
  if (vehicle.stale) {
    return "bg-text-secondary";
  }
  if (vehicle.status === "on_route") {
    return "bg-status-success";
  }
  if (vehicle.status === "maintenance") {
    return "bg-status-warning";
  }
  return "bg-brand-primary";
}

function VehiclePin({
  vehicle,
  driverName,
  x,
  y,
}: {
  vehicle: VehicleDto;
  driverName: string;
  x: number;
  y: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `pin-${vehicle.id}`,
    data: { driverId: vehicle.driverId, vehicleId: vehicle.id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${
        vehicle.stale ? "stale-ghost" : ""
      } ${isOver ? "scale-125" : ""}`}
      style={{ left: `${x}%`, top: `${y}%`, transition: "transform 120ms ease" }}
      title={`${driverName} - ${vehicle.registration} - ${
        vehicle.stale ? "last known" : vehicle.status
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold text-command-bg ${colourFor(
          vehicle,
        )} ${isOver ? "border-brand-primary" : "border-command-bg"} ${
          vehicle.status === "on_route" && !vehicle.stale ? "animate-pulse" : ""
        }`}
      >
        {driverName
          .split(" ")
          .map((part) => part[0])
          .join("") ?? "?"}
      </span>
    </div>
  );
}

export function MapCanvas({ state }: { state: FleetState }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const [mapFailed, setMapFailed] = useState(forceLeaflet());
  const [failReason, setFailReason] = useState(
    forceLeaflet() ? "WebGL-free raster mode" : "",
  );
  const [mapStatus, setMapStatus] = useState("loading tiles");
  const useLeaflet = mapFailed;

  // Leaflet raster layer: mounts when MapLibre is unavailable or the
  // ?map=leaflet flag is set. DOM rendering - no WebGL required.
  useEffect(() => {
    if (!useLeaflet || !containerRef.current || leafletRef.current) {
      return;
    }
    const container = containerRef.current;
    const map = L.map(container, {
      center: [LONDON.lat, LONDON.lng],
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });
    let swapped = false;
    const layer = L.tileLayer(RASTER_DARK, { maxZoom: 19 });
    layer.on("tileerror", () => {
      if (!swapped) {
        swapped = true;
        L.tileLayer(RASTER_LIBERTY, { maxZoom: 19 }).addTo(map);
      }
    });
    layer.addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    leafletRef.current = map;
    setMapStatus("raster tiles (no WebGL needed)");
    return () => {
      map.remove();
      leafletRef.current = null;
    };
  }, [useLeaflet]);

  // MapLibre vector layer: the primary engine when WebGL is available.
  useEffect(() => {
    if (useLeaflet || !containerRef.current || mapRef.current) {
      return;
    }
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: TILE_STYLE,
        center: [LONDON.lng, LONDON.lat],
        zoom: 11.5,
        attributionControl: false,
      });
    } catch (err) {
      console.error("MapLibre init failed - switching to raster fallback", err);
      setFailReason("WebGL unavailable - raster fallback active");
      setMapFailed(true);
      return;
    }
    map.on("error", (event) => {
      const message = event.error?.message ?? String(event.error);
      console.warn("MapLibre error event:", message);
      if (!map.isStyleLoaded()) {
        setFailReason("tile service unreachable - raster fallback active");
        setMapFailed(true);
      }
    });
    map.on("load", () => {
      setMapStatus("tiles loaded");
    });
    map.on("idle", () => {
      const canvas = map.getCanvas();
      setMapStatus(`tiles rendering (${canvas.width}x${canvas.height})`);
    });
    const raf = requestAnimationFrame(() => map.resize());
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    map.on("styleimagemissing", (event) => {
      const placeholder = document.createElement("canvas");
      placeholder.width = 2;
      placeholder.height = 2;
      const context = placeholder.getContext("2d");
      if (context) {
        context.fillStyle = "#334155";
        context.fillRect(0, 0, 2, 2);
        map.addImage(event.id, context.getImageData(0, 0, 2, 2));
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [useLeaflet]);

  const jobs = state.jobs.filter((j) => j.status === "unassigned");
  return (
    <section className="relative flex-1 bg-command-bg">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-[92%] w-[94%] overflow-hidden rounded-2xl border border-command-border bg-command-surface/60">
          {/* Schematic fallback layer - visible only while nothing renders. */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(var(--color-command-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-command-border) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
            aria-hidden="true"
          />
          <div ref={containerRef} className="absolute inset-0 bg-[#0B1220]" />
          {jobs.map((job) => {
            const pickup = job.stops.find((s) => s.stopType === "pickup");
            if (!pickup) {
              return null;
            }
            const { x, y } = project(pickup.location.latitude, pickup.location.longitude);
            return (
              <div
                key={job.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${x}%`, top: `${y}%` }}
                title={`${job.reference} - ${job.serviceType}`}
              >
                <span
                  className={`block h-2.5 w-2.5 rounded-full border border-command-bg ${
                    job.priority === "stat" || job.priority === "urgent"
                      ? "bg-status-danger"
                      : "bg-status-warning"
                  }`}
                />
              </div>
            );
          })}
          {state.vehicles.map((vehicle) => {
            if (!vehicle.location) {
              return null;
            }
            const { x, y } = project(vehicle.location.latitude, vehicle.location.longitude);
            const driver = state.drivers.find((d) => d.id === vehicle.driverId);
            return (
              <VehiclePin
                key={vehicle.id}
                vehicle={vehicle}
                driverName={driver?.fullName ?? "Driver"}
                x={x}
                y={y}
              />
            );
          })}
          <p className="absolute bottom-2 right-3 z-10 text-[10px] text-text-secondary">
            Grey ghost pins show last known position - never imply a fresh GPS fix.
          </p>
          {mapFailed ? (
            <p className="absolute bottom-2 left-3 z-10 rounded-md border border-brand-primary/50 bg-brand-primary/10 px-2 py-1 text-[10px] text-brand-primary">
              Map: {failReason} - dispatch stays fully usable.
            </p>
          ) : (
            <p className="absolute bottom-2 left-3 z-10 text-[10px] text-text-secondary">
              {mapStatus}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

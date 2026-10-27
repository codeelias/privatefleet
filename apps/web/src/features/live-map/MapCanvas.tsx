/**
 * Live map canvas (docs/05.6, ADR-0010).
 *
 * Phase 1 demo default: Leaflet raster tiles (CARTO Dark Matter) - no
 * WebGL required, works in every browser including remote-desktop and
 * hardware-acceleration-off sessions. MapLibre vector (OpenFreeMap) is
 * available for later phases via the `?map=vector` flag and falls back
 * to the raster engine automatically if it cannot initialise.
 *
 * CSS for both engines is imported here at module top (missing engine
 * CSS is the classic cause of a collapsed/blank map).
 */
import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetState, VehicleDto } from "@privatefleet/contracts";

const LONDON = { lng: -0.107, lat: 51.517 };
const VECTOR_STYLE = "https://tiles.openfreemap.org/styles/dark";
const RASTER_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const RASTER_ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO";

const BOUNDS = {
  minLat: 51.49,
  maxLat: 51.55,
  minLng: -0.15,
  maxLng: -0.07,
};

function forceVector(): boolean {
  return new URLSearchParams(window.location.search).get("map") === "vector";
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
      className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 ${
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
  const vectorRef = useRef<maplibregl.Map | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const [vectorFailed, setVectorFailed] = useState(false);
  const [tileCount, setTileCount] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const useVector = forceVector() && !vectorFailed;

  // Raster engine (default): Leaflet + CARTO Dark Matter. DOM images,
  // no WebGL, works on any browser/session.
  useEffect(() => {
    if (useVector || !containerRef.current || leafletRef.current) {
      return;
    }
    const container = containerRef.current;
    const map = L.map(container, {
      center: [LONDON.lat, LONDON.lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      // Leaflet fades tiles in from opacity 0; screenshots and slow GPUs
      // can catch the map mid-fade (measured 0.115 opacity = invisible).
      // The demo needs tiles at full opacity immediately.
      fadeAnimation: false,
      zoomAnimation: false,
    });
    map.attributionControl.setPrefix(false);
    const layer = L.tileLayer(RASTER_URL, {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: RASTER_ATTRIBUTION,
      crossOrigin: true,
    });
    let loaded = 0;
    layer.on("tileload", () => {
      loaded += 1;
      setTileCount(loaded);
      setTilesFailed(false);
    });
    layer.on("tileerror", () => {
      if (loaded === 0) {
        setTilesFailed(true);
      }
    });
    layer.addTo(map);
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    leafletRef.current = map;
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      leafletRef.current = null;
    };
  }, [useVector]);

  // Vector engine (optional): MapLibre GL + OpenFreeMap dark.
  useEffect(() => {
    if (!useVector || !containerRef.current || vectorRef.current) {
      return;
    }
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: VECTOR_STYLE,
        center: [LONDON.lng, LONDON.lat],
        zoom: 11.5,
        attributionControl: false,
      });
    } catch (err) {
      console.error("MapLibre init failed - raster fallback engaged", err);
      setVectorFailed(true);
      return;
    }
    map.on("error", (event) => {
      const message = event.error?.message ?? String(event.error);
      console.warn("MapLibre error event:", message);
      if (!map.isStyleLoaded()) {
        setVectorFailed(true);
      }
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
    vectorRef.current = map;
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      vectorRef.current = null;
    };
  }, [useVector]);

  const jobs = state.jobs.filter((j) => j.status === "unassigned");
  const status = useVector
    ? "vector tiles (OpenFreeMap)"
    : tilesFailed
      ? "Tiles failed to load - check network"
      : tileCount > 0
        ? `raster tiles loaded (${tileCount} tiles, CARTO dark)`
        : "loading raster tiles";

  return (
    <section data-testid="map-canvas" className="relative flex-1 bg-command-bg">
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          data-testid="map-card"
          className="relative h-[92%] w-[94%] overflow-hidden rounded-2xl border border-command-border bg-command-surface/60"
        >
          {/* Schematic fallback layer - visible only until tiles paint. */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(var(--color-command-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-command-border) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
            aria-hidden="true"
          />
          <div ref={containerRef} className="absolute inset-0 z-10 bg-[#0B1220]" />
          {jobs.map((job) => {
            const pickup = job.stops.find((s) => s.stopType === "pickup");
            if (!pickup) {
              return null;
            }
            const { x, y } = project(pickup.location.latitude, pickup.location.longitude);
            return (
              <div
                key={job.id}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
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
          <p className="absolute bottom-2 right-3 z-30 text-[10px] text-text-secondary">
            Grey ghost pins show last known position - never imply a fresh GPS fix.
          </p>
          {tilesFailed ? (
            <p className="absolute bottom-2 left-3 z-30 rounded-md border border-status-warning/50 bg-status-warning/10 px-2 py-1 text-[10px] text-status-warning">
              {status}
            </p>
          ) : (
            <p className="absolute bottom-2 left-3 z-30 text-[10px] text-text-secondary">
              {status}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

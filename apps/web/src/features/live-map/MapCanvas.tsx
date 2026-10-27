/**
 * Live map canvas (docs/05.6, ADR-0010): MapLibre GL renders real
 * OpenFreeMap tiles (dark style for the command center); vehicle pins
 * and job markers stay as HTML overlays so the ghost-pin/status
 * semantics and the drag targets are untouched. If tiles cannot load
 * (offline pitch), the schematic grid underneath keeps the demo usable.
 */
import { useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FleetState, VehicleDto } from "@privatefleet/contracts";

const LONDON = { lng: -0.107, lat: 51.517 };
const TILE_STYLE = "https://tiles.openfreemap.org/styles/dark";

const BOUNDS = {
  minLat: 51.49,
  maxLat: 51.55,
  minLng: -0.15,
  maxLng: -0.07,
};

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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TILE_STYLE,
      center: [LONDON.lng, LONDON.lat],
      zoom: 11.5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const jobs = state.jobs.filter((j) => j.status === "unassigned");
  return (
    <section className="relative flex-1 bg-command-bg">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-[92%] w-[94%] overflow-hidden rounded-2xl border border-command-border bg-command-surface/60">
          {/* Schematic fallback layer - visible only while tiles load or offline. */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(var(--color-command-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-command-border) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
            aria-hidden="true"
          />
          <div ref={containerRef} className="absolute inset-0" />
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
        </div>
      </div>
    </section>
  );
}

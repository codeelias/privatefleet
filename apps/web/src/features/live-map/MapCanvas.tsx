/**
 * Live map canvas (docs/05.6, ADR-0010).
 *
 * Geographic rendering: vehicles and job markers are placed by their real
 * latitude/longitude projected through the active engine, never by
 * schematic percentages. Route polylines come from FleetState.routes so
 * vehicle movement visibly follows the simulated route.
 *
 * Engines:
 * - Vector (MapLibre GL): OpenFreeMap "bright" style (no key), with a
 *   liberty retry, then automatic raster fallback.
 * - Raster (Leaflet): OpenStreetMap standard tiles (no key) - works
 *   without WebGL, including remote-desktop sessions.
 */
import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetState, GeoPoint, VehicleDto } from "@privatefleet/contracts";

const LONDON = { lng: -0.107, lat: 51.517 };
// Key-free providers only (see ADR-0010).
const VECTOR_STYLES = [
  { url: "https://tiles.openfreemap.org/styles/bright", name: "OpenFreeMap bright" },
  { url: "https://tiles.openfreemap.org/styles/liberty", name: "OpenFreeMap liberty" },
] as const;
const RASTER_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const RASTER_ATTRIBUTION = "&copy; OpenStreetMap contributors";

// Panning is restricted to Greater London (south-west / north-east).
const LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.32, 51.4],
  [0.08, 51.62],
];

function forceVector(): boolean {
  return new URLSearchParams(window.location.search).get("map") === "vector";
}

function routeGeoJson(state: FleetState): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: state.routes.map((route) => ({
      type: "Feature",
      properties: { vehicleId: route.vehicleId },
      geometry: {
        type: "LineString",
        coordinates: route.points.map((p) => [p.longitude, p.latitude]),
      },
    })),
  };
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
      style={{ left: `${x}px`, top: `${y}px`, transition: "left 1.8s linear, top 1.8s linear" }}
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
  const polylinesRef = useRef<L.Polyline[]>([]);
  const [vectorFailed, setVectorFailed] = useState(false);
  const [vectorProvider, setVectorProvider] = useState<string>(VECTOR_STYLES[0].name);
  const [tileCount, setTileCount] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const styleIndexRef = useRef(0);
  const useVector = forceVector() && !vectorFailed;

  // --- Raster engine (Leaflet, default) ---------------------------------
  useEffect(() => {
    if (useVector || !containerRef.current || leafletRef.current) {
      return;
    }
    const container = containerRef.current;
    const map = L.map(container, {
      center: [LONDON.lat, LONDON.lng],
      zoom: 12.5,
      zoomControl: false,
      attributionControl: true,
      fadeAnimation: false,
      zoomAnimation: false,
      maxBounds: L.latLngBounds(
        [LONDON_BOUNDS[0][1], LONDON_BOUNDS[0][0]],
        [LONDON_BOUNDS[1][1], LONDON_BOUNDS[1][0]],
      ),
      maxBoundsViscosity: 0.8,
    });
    map.attributionControl.setPrefix(false);
    const layer = L.tileLayer(RASTER_URL, {
      maxZoom: 19,
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
    map.on("move zoom", () => setRevision((r) => r + 1));
    map.whenReady(() => setReady(true));
    L.control.zoom({ position: "bottomright" }).addTo(map);
    leafletRef.current = map;
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      polylinesRef.current = [];
      map.remove();
      leafletRef.current = null;
      setReady(false);
    };
  }, [useVector]);

  // Route polylines for the raster engine.
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || useVector) {
      return;
    }
    polylinesRef.current.forEach((line) => line.remove());
    polylinesRef.current = state.routes.map((route) =>
      L.polyline(
        route.points.map((p) => [p.latitude, p.longitude] as [number, number]),
        { color: "#4F8CFF", weight: 3, opacity: 0.55 },
      ).addTo(map),
    );
  }, [state.routes, useVector, ready]);

  // --- Vector engine (MapLibre) ----------------------------------------
  useEffect(() => {
    if (!useVector || !containerRef.current || vectorRef.current) {
      return;
    }
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: VECTOR_STYLES[0].url,
        center: [LONDON.lng, LONDON.lat],
        zoom: 12,
        maxBounds: LONDON_BOUNDS,
        attributionControl: { compact: true },
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
        if (styleIndexRef.current === 0) {
          styleIndexRef.current = 1;
          map.setStyle(VECTOR_STYLES[1].url);
        } else {
          setVectorFailed(true);
        }
      }
    });
    map.on("load", () => {
      const current = VECTOR_STYLES[styleIndexRef.current] ?? VECTOR_STYLES[0];
      setVectorProvider(current.name);
      map.addSource("vehicle-routes", {
        type: "geojson",
        data: routeGeoJson(state),
      });
      map.addLayer({
        id: "vehicle-routes-line",
        type: "line",
        source: "vehicle-routes",
        paint: {
          "line-color": "#4F8CFF",
          "line-width": 3,
          "line-opacity": 0.55,
        },
      });
      setReady(true);
    });
    map.on("move zoom", () => setRevision((r) => r + 1));
    const raf = requestAnimationFrame(() => map.resize());
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    vectorRef.current = map;
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      vectorRef.current = null;
      setReady(false);
    };
  }, [useVector]);

  // Update vector route data when the fleet state changes.
  useEffect(() => {
    const map = vectorRef.current;
    if (!map || !ready) {
      return;
    }
    const source = map.getSource("vehicle-routes") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(routeGeoJson(state));
    }
  }, [state, ready]);

  // Project geo points to container pixels for the overlay layer.
  function project(point: GeoPoint | undefined): { x: number; y: number } | null {
    if (!point) {
      return null;
    }
    if (useVector) {
      const map = vectorRef.current;
      if (!map) {
        return null;
      }
      const p = map.project([point.longitude, point.latitude]);
      return { x: p.x, y: p.y };
    }
    const map = leafletRef.current;
    if (!map) {
      return null;
    }
    const p = map.latLngToContainerPoint([point.latitude, point.longitude]);
    return { x: p.x, y: p.y };
  }

  // revision forces a re-projection after pan/zoom; ready gates overlays.
  void revision;
  const jobs = state.jobs.filter((j) => j.status === "unassigned");
  const status = useVector
    ? `vector map (${vectorProvider})`
    : tilesFailed
      ? "Tiles failed to load - check network"
      : tileCount > 0
        ? `raster tiles loaded (${tileCount} tiles, OSM)`
        : "loading raster tiles";

  return (
    <section data-testid="map-canvas" className="relative flex-1 bg-command-bg">
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          data-testid="map-card"
          className="relative h-[92%] w-[94%] overflow-hidden rounded-2xl border border-command-border bg-command-surface/60"
        >
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
            const pos = project(pickup?.location);
            if (!pos) {
              return null;
            }
            return (
              <div
                key={job.id}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
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
            const pos = project(vehicle.location);
            if (!pos) {
              return null;
            }
            const driver = state.drivers.find((d) => d.id === vehicle.driverId);
            return (
              <VehiclePin
                key={vehicle.id}
                vehicle={vehicle}
                driverName={driver?.fullName ?? "Driver"}
                x={pos.x}
                y={pos.y}
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

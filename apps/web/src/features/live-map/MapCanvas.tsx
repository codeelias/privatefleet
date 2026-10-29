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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetState, GeoPoint, VehicleDto } from "@privatefleet/contracts";
import { reconcileRoutes, routesChanged } from "./engine/routes";
import { toGeoJsonCoordinates, toLeafletLatLngs } from "./engine/projection";
import { markPainted } from "./engine/benchmark";
import {
  isActive,
  positionAt,
  prefersReducedMotion,
  startTween,
  type Tween,
} from "./engine/interpolation";
import {
  drawVehicleLayer,
  hitTest,
  type CanvasVehicle,
} from "./engine/markers";
import type { RoutePathLike } from "./engine/geo";
import {
  DEFAULT_ENGINE,
  needsKeyPreflight,
  PRIMARY_RASTER,
  RASTER_FALLBACK,
  VECTOR_STYLES,
} from "./map-config";

const LONDON = { lng: -0.107, lat: 51.517 };

// Panning is restricted to Greater London (south-west / north-east).
const LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.32, 51.4],
  [0.08, 51.62],
];

/** Engine selection: `?map=vector|raster` overrides the configured default. */
function useVectorEngine(): boolean {
  const param = new URLSearchParams(window.location.search).get("map");
  if (param === "vector") {
    return true;
  }
  if (param === "raster") {
    return false;
  }
  return DEFAULT_ENGINE === "vector";
}

const DEBUG_MAP =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("debug") === "map";

/** 10 m-class geographic grid for visual route/basemap alignment checks. */
function drawDebugGrid(
  ctx: CanvasRenderingContext2D,
  project: (lat: number, lon: number) => { x: number; y: number } | null,
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const metresPerPixel =
    (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoom);
  const sizes = [10, 25, 50, 100, 250, 500, 1000];
  const metres = sizes.find((size) => size / metresPerPixel >= 24) ?? 1000;
  const dLat = metres / 110_540;
  const dLon = metres / (111_320 * Math.cos((centerLat * Math.PI) / 180));
  const lat0 = Math.round(centerLat / dLat) * dLat;
  const lon0 = Math.round(centerLon / dLon) * dLon;
  ctx.strokeStyle = "rgba(56,189,248,0.45)";
  ctx.lineWidth = 1;
  for (let index = -120; index <= 120; index += 1) {
    const lat = lat0 + index * dLat;
    const a = project(lat, centerLon - 0.5);
    const b = project(lat, centerLon + 0.5);
    if (a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const lon = lon0 + index * dLon;
    const c = project(centerLat - 0.4, lon);
    const d = project(centerLat + 0.4, lon);
    if (c && d) {
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#38BDF8";
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.fillText(`${metres} m grid - debug alignment`, 10, 18);
}

function routeGeoJson(routes: RoutePathLike[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => ({
      type: "Feature",
      properties: { vehicleId: route.vehicleId, driverId: route.driverId ?? "" },
      geometry: {
        type: "LineString",
        coordinates: toGeoJsonCoordinates(route.points),
      },
    })),
  };
}

function colourFor(vehicle: VehicleDto): string {
  if (vehicle.stale) {
    return "bg-text-secondary";
  }
  if (vehicle.status === "on_route") {
    return "bg-brand-primary";
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
  selected,
  onSelect,
}: {
  vehicle: VehicleDto;
  driverName: string;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `pin-${vehicle.id}`,
    data: { driverId: vehicle.driverId, vehicleId: vehicle.id },
  });
  // Benchmark hook: fires after the marker commits at its new position.
  useEffect(() => {
    markPainted([vehicle.id]);
  }, [vehicle.id, x, y]);
  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Select ${driverName} to highlight their route`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer ${
        vehicle.stale ? "stale-ghost" : ""
      } ${isOver ? "scale-125" : ""} ${selected ? "ring-2 ring-brand-primary ring-offset-2 ring-offset-command-bg rounded-full" : ""}`}
      style={{ left: `${x}px`, top: `${y}px`, transition: "left 1.8s linear, top 1.8s linear" }}
      title={`${driverName} - ${vehicle.registration} - ${
        vehicle.stale ? "last known" : vehicle.status
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border-[3px] text-[10px] font-bold text-command-surface shadow-[0_4px_14px_rgba(0,0,0,0.35)] ${colourFor(
          vehicle,
        )} ${isOver ? "border-brand-primary" : "border-command-surface"} ${
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
  const [vectorProvider, setVectorProvider] = useState<string>(
    VECTOR_STYLES[0]?.name ?? "vector",
  );
  const [rasterProvider, setRasterProvider] = useState<string>(PRIMARY_RASTER.name);
  const [providerStatus, setProviderStatus] = useState<number | null>(null);
  const providerStatusRef = useRef<number | null>(null);
  const [tileCount, setTileCount] = useState(0);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const styleIndexRef = useRef(0);
  const useVector = useVectorEngine() && !vectorFailed;
  // Large fleets render on one canvas layer; small demo fleets keep the
  // rich DOM pins (initials, drag-and-drop, tooltips).
  const useCanvasPins = !useVector && state.vehicles.length > 40;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasHitsRef = useRef<CanvasVehicle[]>([]);
  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerTweensRef = useRef<Map<string, Tween>>(new Map());
  const canvasTargetsRef = useRef<
    Array<{
      id: string;
      driverId: string | null;
      label: string;
      status: string;
      stale: boolean;
      selected: boolean;
    }>
  >([]);
  const driversById = useMemo(
    () => new Map(state.drivers.map((driver) => [driver.id, driver])),
    [state.drivers],
  );
  // Vehicles without a GPS fix still need a visible, honestly ghosted marker:
  // use the start of their published route rather than dropping them.
  const routeStartByVehicle = useMemo(
    () =>
      new Map(
        state.routes
          .filter((route) => route.points.length >= 2)
          .map((route) => [route.vehicleId, route.points[0]!]),
      ),
    [state.routes],
  );
  const toggleSelect = useCallback((driverId: string | null) => {
    setSelectedDriverId((previous) => (previous === driverId ? null : driverId));
  }, []);

  // Validated, retained route set: invalid updates never erase the last
  // verified geometry (docs/17). Static geometry is only pushed to the map
  // source when its signature changes, not on every GPS update.
  const lastValidRoutesRef = useRef<RoutePathLike[]>([]);
  const routeSet = useMemo(
    () => reconcileRoutes(lastValidRoutesRef.current, state.routes),
    [state.routes],
  );
  const lastRouteSignatureRef = useRef("");
  useEffect(() => {
    if (routeSet.routes.length > 0 && !routeSet.usedFallback) {
      lastValidRoutesRef.current = routeSet.routes;
    }
  }, [routeSet]);

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
    let loaded = 0;
    let swapped = false;
    let cancelled = false;
    let active: L.TileLayer | undefined;

    const attach = (provider: { url: string; attribution: string; name: string }, primary: boolean): void => {
      if (cancelled) {
        return;
      }
      const layer = L.tileLayer(provider.url, {
        maxZoom: 19,
        attribution: provider.attribution,
        crossOrigin: true,
      });
      layer.on("tileload", () => {
        loaded += 1;
        setTileCount(loaded);
        setTilesFailed(false);
        setRasterProvider(provider.name);
      });
      layer.on("tileerror", () => {
        if (primary && !swapped) {
          swapped = true;
          layer.remove();
          loaded = 0;
          setRasterProvider(`${RASTER_FALLBACK.name} fallback`);
          attach(RASTER_FALLBACK, false);
        } else if (loaded === 0) {
          setTilesFailed(true);
        }
      });
      layer.addTo(map);
      active = layer;
    };

    // Some providers answer a rejected key with a 403 placeholder PNG
    // that <img> still decodes (a watermark on the map). Validate the
    // configured primary source before attaching it.
    if (needsKeyPreflight(PRIMARY_RASTER)) {
      const probe = PRIMARY_RASTER.url
        .replace("{z}", "0")
        .replace("{x}", "0")
        .replace("{y}", "0")
        .replace("{s}", "a");
      fetch(probe)
        .then((res) => {
          providerStatusRef.current = res.status;
          setProviderStatus(res.status);
        })
        .catch(() => {
          providerStatusRef.current = 0;
          setProviderStatus(0);
        })
        .finally(() => {
          const usable = providerStatusRef.current === 200;
          attach(usable ? PRIMARY_RASTER : RASTER_FALLBACK, usable);
        });
    } else {
      attach(PRIMARY_RASTER, false);
    }
    void active;
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    map.on("move zoom", () => setRevision((r) => r + 1));
    map.whenReady(() => setReady(true));
    L.control.zoom({ position: "bottomright" }).addTo(map);
    leafletRef.current = map;
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      polylinesRef.current = [];
      map.remove();
      leafletRef.current = null;
      setReady(false);
    };
  }, [useVector]);

  // Route polylines for the raster engine; the selected driver's route
  // is highlighted while the others stay dimmed.
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || useVector) {
      return;
    }
    polylinesRef.current.forEach((line) => line.remove());
    polylinesRef.current = routeSet.routes.map((route) => {
      const selected = selectedDriverId !== null && route.driverId === selectedDriverId;
      return L.polyline(
        toLeafletLatLngs(route.points),
        {
          color: selected ? "#FFD2A8" : "#EF842F",
          weight: selected ? 5 : 3,
          opacity: selected ? 0.95 : 0.72,
        },
      ).addTo(map);
    });
  }, [routeSet, useVector, ready, selectedDriverId]);

  // --- Vector engine (MapLibre) ----------------------------------------
  useEffect(() => {
    if (!useVector || !containerRef.current || vectorRef.current) {
      return;
    }
    let map: maplibregl.Map;
    const firstStyle = VECTOR_STYLES[0];
    if (!firstStyle) {
      setVectorFailed(true);
      return;
    }
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: firstStyle.url,
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
        if (styleIndexRef.current < VECTOR_STYLES.length - 1) {
          styleIndexRef.current += 1;
          const next = VECTOR_STYLES[styleIndexRef.current];
          if (next) {
            map.setStyle(next.url);
          }
        } else {
          setVectorFailed(true);
        }
      }
    });
    map.on("load", () => {
      const current = VECTOR_STYLES[styleIndexRef.current] ?? firstStyle;
      setVectorProvider(current.name);
      lastRouteSignatureRef.current = routeSet.signature;
      map.addSource("vehicle-routes", {
        type: "geojson",
        data: routeGeoJson(routeSet.routes),
      });
      map.addLayer({
        id: "vehicle-routes-line",
        type: "line",
        source: "vehicle-routes",
        paint: {
          "line-color": "#EF842F",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "vehicle-routes-selected",
        type: "line",
        source: "vehicle-routes",
        filter: ["==", ["get", "driverId"], ""],
        paint: {
          "line-color": "#FFD2A8",
          "line-width": 5,
          "line-opacity": 0.95,
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

  // Update vector route data only when the geometry actually changed, and
  // keep the selection filter current (docs/17: static geometry must not be
  // re-serialised on every telemetry update).
  useEffect(() => {
    const map = vectorRef.current;
    if (!map || !ready) {
      return;
    }
    if (routesChanged(lastRouteSignatureRef.current, routeSet.signature)) {
      lastRouteSignatureRef.current = routeSet.signature;
      const source = map.getSource("vehicle-routes") as maplibregl.GeoJSONSource | undefined;
      source?.setData(routeGeoJson(routeSet.routes));
    }
    const selectedLayer = map.getLayer("vehicle-routes-selected");
    if (selectedLayer) {
      map.setFilter("vehicle-routes-selected", [
        "==",
        ["get", "driverId"],
        selectedDriverId ?? "",
      ]);
    }
  }, [routeSet, ready, selectedDriverId]);

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

  // Debug alignment grid: geographic 10 m-class lattice at the current
  // zoom, so route segments can be compared with the rendered road.
  useEffect(() => {
    if (!DEBUG_MAP || !ready) {
      return;
    }
    const canvas = debugCanvasRef.current;
    if (!canvas) {
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const leaflet = leafletRef.current;
    const vector = vectorRef.current;
    const project = (lat: number, lon: number): { x: number; y: number } | null => {
      if (useVector && vector) {
        const point = vector.project([lon, lat]);
        return { x: point.x, y: point.y };
      }
      if (!useVector && leaflet) {
        const point = leaflet.latLngToContainerPoint([lat, lon]);
        return { x: point.x, y: point.y };
      }
      return null;
    };
    let centerLat = 51.5074;
    let centerLon = -0.1278;
    let zoom = 14;
    if (useVector && vector) {
      const center = vector.getCenter();
      centerLat = center.lat;
      centerLon = center.lng;
      zoom = vector.getZoom();
    } else if (leaflet) {
      const center = leaflet.getCenter();
      centerLat = center.lat;
      centerLon = center.lng;
      zoom = leaflet.getZoom();
    }
    drawDebugGrid(ctx, project, centerLat, centerLon, zoom, width, height);
  }, [ready, revision, useVector, state.vehicles]);

  // Canvas marker layer for large fleets: timestamped interpolation on a
  // monotonic clock between accepted telemetry positions, with a single
  // continuous rAF loop that stops once every marker has settled.
  useEffect(() => {
    if (!useCanvasPins || !ready) {
      return;
    }
    const map = leafletRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) {
      return;
    }
    const duration = prefersReducedMotion() ? 0 : 1_800;
    const startedAt = performance.now();
    const vehiclesById = new Map(state.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const targets: Array<{
      id: string;
      driverId: string | null;
      label: string;
      status: string;
      stale: boolean;
      selected: boolean;
    }> = [];

    for (const vehicle of state.vehicles) {
      const point = vehicle.location ?? routeStartByVehicle.get(vehicle.id);
      if (!point) {
        continue;
      }
      const container = map.latLngToContainerPoint([point.latitude, point.longitude]);
      const driver = vehicle.driverId ? driversById.get(vehicle.driverId) : undefined;
      const previous = markerTweensRef.current.get(vehicle.id);
      markerTweensRef.current.set(
        vehicle.id,
        startTween(previous, { x: container.x, y: container.y }, startedAt, previous ? duration : 0),
      );
      targets.push({
        id: vehicle.id,
        driverId: vehicle.driverId ?? null,
        label: driver?.fullName ?? vehicle.registration,
        status: vehicle.status,
        stale: Boolean(vehicle.stale),
        selected: selectedDriverId !== null && vehicle.driverId === selectedDriverId,
      });
    }
    for (const id of [...markerTweensRef.current.keys()]) {
      if (!targets.some((target) => target.id === id)) {
        markerTweensRef.current.delete(id);
      }
    }
    canvasTargetsRef.current = targets;

    let frame = 0;
    const render = (time: number): void => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) {
        return;
      }
      // Device-fidelity backing store: up to 2x for sharp markers on
      // retina displays, 1.5x above 150 vehicles to bound fill cost.
      const dprCap = 2;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      const drawn: CanvasVehicle[] = [];
      for (const target of canvasTargetsRef.current) {
        const tween = markerTweensRef.current.get(target.id);
        if (!tween) {
          continue;
        }
        const position = positionAt(tween, time);
        drawn.push({ ...target, x: position.x, y: position.y });
      }
      drawVehicleLayer(ctx, drawn, { width, height, devicePixelRatio: dpr });
      canvasHitsRef.current = drawn;
      markPainted(drawn.map((entry) => entry.id));
    };
    const step = (time: number): void => {
      frame = 0;
      render(time);
      const moving = [...markerTweensRef.current.values()].some((tween) => isActive(tween, time));
      if (moving) {
        frame = requestAnimationFrame(step);
      }
    };
    const ensure = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(step);
      }
    };
    ensure();

    // Pan/zoom: re-project instantly, no interpolation between frames.
    const reposition = (): void => {
      const time = performance.now();
      for (const target of canvasTargetsRef.current) {
        const vehicle = vehiclesById.get(target.id);
        const point = vehicle?.location ?? routeStartByVehicle.get(target.id);
        if (!point) {
          continue;
        }
        const container = map.latLngToContainerPoint([point.latitude, point.longitude]);
        markerTweensRef.current.set(
          target.id,
          startTween(undefined, { x: container.x, y: container.y }, time, 0),
        );
      }
      ensure();
    };
    map.on("move zoom resize", reposition);
    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      map.off("move zoom resize", reposition);
    };
  }, [state.vehicles, state.routes, selectedDriverId, ready, useCanvasPins, useVector, driversById, routeStartByVehicle]);

  // revision forces a re-projection after pan/zoom; ready gates overlays.
  void revision;
  const jobs = state.jobs.filter((j) => j.status === "unassigned");
  const selectedRouteMissing =
    selectedDriverId !== null &&
    !routeSet.routes.some((r) => r.driverId === selectedDriverId && r.points.length >= 2);
  const routeGeometryMissing = routeSet.routes.length === 0 || selectedRouteMissing;
  const routeQualityWarning = routeSet.usedFallback
    ? "Routing update unavailable - showing the last verified route."
    : routeSet.invalidCount > 0
      ? `${routeSet.invalidCount} route(s) hidden - invalid geometry.`
      : null;
  const status = useVector
    ? `vector map (${vectorProvider})`
    : tilesFailed
      ? "Tiles failed to load - check network"
      : tileCount > 0
        ? `raster tiles loaded (${tileCount} tiles, ${rasterProvider})`
        : "loading raster tiles";

  return (
    <section data-testid="map-canvas" className="relative flex-1 bg-command-bg" data-map-shell="true">
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          data-testid="map-card"
          className="pf-map-card relative h-[94%] w-[97%] overflow-hidden rounded-[26px] border border-command-border/80 bg-[#171816] shadow-[0_18px_50px_rgba(20,19,16,0.14)]"
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
          <div ref={containerRef} className="absolute inset-0 z-10 bg-[#171816]" />
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
          {DEBUG_MAP && (
            <canvas
              ref={debugCanvasRef}
              data-testid="map-debug-grid"
              className="pointer-events-none absolute inset-0 z-30"
            />
          )}
          {useCanvasPins && (
            <canvas
              ref={canvasRef}
              data-testid="vehicle-canvas"
              className="absolute inset-0 z-20"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const id = hitTest(
                  canvasHitsRef.current,
                  event.clientX - rect.left,
                  event.clientY - rect.top,
                );
                const hit = canvasHitsRef.current.find((entry) => entry.id === id);
                if (hit) {
                  toggleSelect(hit.driverId ?? null);
                }
              }}
            />
          )}
          {!useCanvasPins && state.vehicles.map((vehicle) => {
            const pos = project(vehicle.location ?? routeStartByVehicle.get(vehicle.id));
            if (!pos) {
              return null;
            }
            const driver = state.drivers.find((d) => d.id === vehicle.driverId);
            const markerVehicle = vehicle.location
              ? vehicle
              : { ...vehicle, stale: true };
            return (
              <VehiclePin
                key={vehicle.id}
                vehicle={markerVehicle}
                driverName={driver?.fullName ?? "Driver"}
                x={pos.x}
                y={pos.y}
                selected={selectedDriverId !== null && vehicle.driverId === selectedDriverId}
                onSelect={() =>
                  setSelectedDriverId((prev) =>
                    prev === vehicle.driverId ? null : (vehicle.driverId ?? null),
                  )
                }
              />
            );
          })}
          <p className="absolute bottom-2 right-3 z-30 rounded-full bg-command-surface/90 px-2 py-1 text-[10px] text-text-secondary">
            Grey ghost pins show last known position - never imply a fresh GPS fix.
          </p>
          {routeGeometryMissing && (
            <p className="absolute bottom-9 left-3 z-30 rounded-md border border-status-warning/50 bg-status-warning/10 px-2 py-1 text-[10px] text-status-warning">
              Route geometry unavailable - showing vehicle positions only. Demo
              routes require the seeded scenario.
            </p>
          )}
          {routeQualityWarning && (
            <p
              data-testid="route-quality-warning"
              className="absolute bottom-16 left-3 z-30 rounded-md border border-status-warning/50 bg-status-warning/10 px-2 py-1 text-[10px] text-status-warning"
            >
              {routeQualityWarning}
            </p>
          )}
          {tilesFailed ? (
            <p className="absolute bottom-2 left-3 z-30 rounded-md border border-status-warning/50 bg-status-warning/10 px-2 py-1 text-[10px] text-status-warning">
              {status}
            </p>
          ) : (
            <p className="absolute bottom-2 left-3 z-30 rounded-full bg-command-surface/90 px-2 py-1 text-[10px] text-text-secondary">
              {status}
            </p>
          )}
          {import.meta.env.DEV && providerStatus !== null && providerStatus !== 200 && (
            <p className="absolute top-2 left-3 z-30 rounded-md border border-status-warning/50 bg-status-warning/10 px-2 py-1 text-[10px] text-status-warning">
              Tile provider rejected the configured key ({providerStatus}) -
              fallback tiles in use. Check the key's allowed origins.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}











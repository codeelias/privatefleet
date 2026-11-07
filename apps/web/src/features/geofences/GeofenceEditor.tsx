/**
 * Visual geofence editor on the OpenFreeMap vector basemap (MapLibre).
 * Draw on the map, drag vertices, insert/remove vertices, undo/redo,
 * validate geometry, and scope the fence to drivers. No volunteer OSM
 * tile requests are made; attribution comes from the vector style.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FleetState, GeofenceDto } from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { VECTOR_STYLES } from "../live-map/map-config";
import {
  geojsonToVertices,
  midpoint,
  pointInPolygon,
  ringToGeoJSON,
  validateRing,
  type GeoLatLng,
} from "./engine/geofence-geometry";

const DRAFT_LINE_COLOR = "#EF842F";
const DRAFT_FILL_COLOR = "#F28C28";

function featureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function GeofenceEditor({
  state,
  onPublished,
}: {
  state: FleetState;
  onPublished?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const draftMarkersRef = useRef<maplibregl.Marker[]>([]);
  const fenceMarkersRef = useRef<maplibregl.Marker[]>([]);
  const verticesRef = useRef<GeoLatLng[]>([]);
  const interactiveRef = useRef(false);
  const undoRef = useRef<GeoLatLng[][]>([]);
  const redoRef = useRef<GeoLatLng[][]>([]);

  const [geofences, setGeofences] = useState<GeofenceDto[]>([]);
  const [vertices, setVertices] = useState<GeoLatLng[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => validateRing(vertices), [vertices]);
  const driverById = useMemo(
    () => new Map(state.drivers.map((driver) => [driver.id, driver])),
    [state.drivers],
  );
  const vehicleByDriver = useMemo(
    () => new Map(state.vehicles.filter((v) => v.driverId).map((v) => [v.driverId!, v])),
    [state.vehicles],
  );

  useEffect(() => {
    verticesRef.current = vertices;
    interactiveRef.current = drawing || editingId !== null;
  }, [vertices, drawing, editingId]);

  const commit = useCallback((next: GeoLatLng[]) => {
    undoRef.current.push(verticesRef.current);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    setVertices(next);
  }, []);

  async function load(): Promise<void> {
    try {
      setGeofences((await api.listGeofences()).geofences);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Geofences unavailable");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Map lifecycle: vector basemap, draft source and fence source.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const style = VECTOR_STYLES[0]?.url ?? "/map-style-night.json";
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [-0.1278, 51.5074],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addSource("geo-draft", { type: "geojson", data: featureCollection() });
      map.addSource("geo-fences", { type: "geojson", data: featureCollection() });
      map.addLayer({
        id: "geo-draft-fill",
        type: "fill",
        source: "geo-draft",
        paint: { "fill-color": DRAFT_FILL_COLOR, "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "geo-draft-line",
        type: "line",
        source: "geo-draft",
        paint: { "line-color": DRAFT_LINE_COLOR, "line-width": 2.5, "line-dasharray": [2, 1] },
      });
      map.addLayer({
        id: "geo-fences-fill",
        type: "fill",
        source: "geo-fences",
        paint: { "fill-color": "#276EF1", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "geo-fences-line",
        type: "line",
        source: "geo-fences",
        paint: { "line-color": "#276EF1", "line-width": 2 },
      });
    });
    map.on("click", (event: maplibregl.MapMouseEvent) => {
      if (!interactiveRef.current) return;
      commit([
        ...verticesRef.current,
        { lat: event.lngLat.lat, lng: event.lngLat.lng },
      ]);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      draftMarkersRef.current = [];
      fenceMarkersRef.current = [];
    };
  }, [commit]);

  function setDraftData(verticesList: GeoLatLng[]): void {
    const map = mapRef.current;
    if (!map || !map.getSource("geo-draft")) return;
    const source = map.getSource("geo-draft") as maplibregl.GeoJSONSource;
    if (verticesList.length === 0) {
      source.setData(featureCollection());
      return;
    }
    const closed = [...verticesList, verticesList[0]!];
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [closed.map((point) => [point.lng, point.lat])],
          },
        },
      ],
    });
  }

  // Draft overlay: polygon data + vertex and midpoint handles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    draftMarkersRef.current.forEach((marker) => marker.remove());
    draftMarkersRef.current = [];
    const active = drawing || editingId !== null;
    setDraftData(active ? vertices : []);
    if (!active || vertices.length === 0) return;

    const vertexElement = (): HTMLElement => {
      const element = document.createElement("div");
      element.className = "pf-geo-vertex";
      element.style.width = "14px";
      element.style.height = "14px";
      element.style.background = "#FFFFFF";
      element.style.border = "2px solid #EF842F";
      element.style.borderRadius = "50%";
      element.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
      element.style.cursor = "move";
      return element;
    };
    const midpointElement = (): HTMLElement => {
      const element = document.createElement("div");
      element.className = "pf-geo-midpoint";
      element.style.width = "10px";
      element.style.height = "10px";
      element.style.background = "#FFFFFF";
      element.style.border = "2px solid #276EF1";
      element.style.transform = "rotate(45deg)";
      element.style.boxShadow = "0 1px 3px rgba(0,0,0,0.35)";
      element.style.cursor = "crosshair";
      return element;
    };

    vertices.forEach((point, index) => {
      const marker = new maplibregl.Marker({ element: vertexElement(), draggable: true, anchor: "center" })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const moved = marker.getLngLat();
        const next = [...verticesRef.current];
        next[index] = { lat: moved.lat, lng: moved.lng };
        commit(next);
      });
      marker.getElement().addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (verticesRef.current.length > 3) {
          const next = verticesRef.current.filter((_, position) => position !== index);
          commit(next);
        }
      });
      draftMarkersRef.current.push(marker);
    });

    const count = vertices.length;
    for (let index = 0; index < count; index += 1) {
      const nextIndex = (index + 1) % count;
      if (count < 3 && index === count - 1) continue;
      const mid = midpoint(vertices[index]!, vertices[nextIndex]!);
      const marker = new maplibregl.Marker({ element: midpointElement(), anchor: "center" })
        .setLngLat([mid.lng, mid.lat])
        .addTo(map);
      marker.getElement().addEventListener("click", () => {
        const next = [...verticesRef.current];
        next.splice(nextIndex, 0, { lat: mid.lat, lng: mid.lng });
        commit(next);
      });
      draftMarkersRef.current.push(marker);
    }
  }, [vertices, drawing, editingId, commit]);

  // Existing fences and vehicle markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    fenceMarkersRef.current.forEach((marker) => marker.remove());
    fenceMarkersRef.current = [];

    const features: GeoJSON.Feature[] = geofences.flatMap((fence) => {
      const points = geojsonToVertices(fence.geojson);
      if (points.length < 3) return [];
      return [
        {
          type: "Feature" as const,
          id: fence.id,
          properties: { id: fence.id, name: fence.name, enabled: fence.enabled },
          geometry: {
            type: "Polygon" as const,
            coordinates: [[...points, points[0]!].map((point) => [point.lng, point.lat])],
          },
        },
      ];
    });
    const source = map.getSource("geo-fences") as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features });

    for (const vehicle of state.vehicles) {
      if (!vehicle.location) continue;
      const driver = vehicle.driverId ? driverById.get(vehicle.driverId) : undefined;
      const selected = vehicle.driverId ? driverIds.includes(vehicle.driverId) : false;
      const vehiclePoint = { lat: vehicle.location.latitude, lng: vehicle.location.longitude };
      const inside = vertices.length >= 3 ? pointInPolygon(vehiclePoint, vertices) : false;
      const element = document.createElement("div");
      element.style.width = `${selected ? 16 : 12}px`;
      element.style.height = `${selected ? 16 : 12}px`;
      element.style.borderRadius = "50%";
      element.style.border = "2px solid #FFFFFF";
      element.style.background = inside ? "#16A34A" : selected ? "#F28C28" : "#276EF1";
      element.style.boxShadow = "0 1px 4px rgba(0,0,0,0.45)";
      element.style.cursor = "pointer";
      const marker = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([vehicle.location.longitude, vehicle.location.latitude])
        .addTo(map);
      marker.getElement().addEventListener("click", () => {
        if (!vehicle.driverId) return;
        setDriverIds((current) =>
          current.includes(vehicle.driverId!)
            ? current.filter((id) => id !== vehicle.driverId)
            : [...current, vehicle.driverId!],
        );
      });
      marker.getElement().title = `${driver?.fullName ?? "Unassigned"} · ${vehicle.registration}`;
      fenceMarkersRef.current.push(marker);
    }
  }, [geofences, state.vehicles, state.drivers, driverIds, vertices, driverById]);

  // Fence polygon click opens editing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const id = feature.properties?.id as string | undefined;
      const fence = geofences.find((candidate) => candidate.id === id);
      if (fence) editFence(fence);
    };
    map.on("click", "geo-fences-fill", onClick);
    return () => {
      map.off("click", "geo-fences-fill", onClick);
    };
  }, [geofences]);

  function editFence(fence: GeofenceDto): void {
    setVertices(geojsonToVertices(fence.geojson));
    setName(fence.name);
    setDriverIds(fence.driverIds ?? []);
    setJobId(fence.jobId ?? "");
    setEditingId(fence.id);
    setDrawing(false);
    setError(null);
    const points = geojsonToVertices(fence.geojson);
    if (points.length > 0 && mapRef.current) {
      const lngs = points.map((point) => point.lng);
      const lats = points.map((point) => point.lat);
      mapRef.current.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ] as [[number, number], [number, number]],
        { padding: 60, maxZoom: 16 },
      );
    }
  }

  function startDraw(): void {
    setVertices([]);
    setName("");
    setDriverIds([]);
    setJobId("");
    setEditingId(null);
    setDrawing(true);
    setError(null);
    undoRef.current = [];
    redoRef.current = [];
  }

  function cancel(): void {
    setVertices([]);
    setDrawing(false);
    setEditingId(null);
    setError(null);
    undoRef.current = [];
    redoRef.current = [];
  }

  function undo(): void {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(verticesRef.current);
    setVertices(previous);
  }

  function redo(): void {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(verticesRef.current);
    setVertices(next);
  }

  function selectDriversInside(): void {
    if (vertices.length < 3) return;
    const inside = state.vehicles
      .filter((vehicle) => {
        if (!vehicle.location || !vehicle.driverId) return false;
        return pointInPolygon(
          { lat: vehicle.location.latitude, lng: vehicle.location.longitude },
          vertices,
        );
      })
      .map((vehicle) => vehicle.driverId!);
    setDriverIds([...new Set(inside)]);
  }

  async function save(): Promise<void> {
    if (!name.trim()) {
      setError("Name the fence before saving.");
      return;
    }
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const geojson = ringToGeoJSON(vertices);
      if (editingId) {
        await api.updateGeofence(editingId, { name: name.trim(), geojson, driverIds });
      } else {
        await api.createGeofence(name.trim(), geojson, true, jobId || undefined, driverIds);
      }
      await load();
      onPublished?.();
      cancel();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Fence could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(fence: GeofenceDto): Promise<void> {
    setBusy(true);
    try {
      await api.updateGeofence(fence.id, { enabled: !fence.enabled });
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not update fence");
    } finally {
      setBusy(false);
    }
  }

  async function removeFence(fence: GeofenceDto): Promise<void> {
    if (!window.confirm(`Delete geofence "${fence.name}"?`)) return;
    setBusy(true);
    try {
      await api.deleteGeofence(fence.id);
      if (editingId === fence.id) cancel();
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete fence");
    } finally {
      setBusy(false);
    }
  }

  const formActive = drawing || editingId !== null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-command-border/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-text-secondary">Geofencing</p>
            <h1 className="mt-0.5 text-[20px] font-semibold tracking-[-0.02em] text-text-primary">Draw the fence, not the coordinates</h1>
            <p className="mt-0.5 text-[11px] text-text-secondary">Click to add vertices, drag to reshape, right-click a vertex to remove it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={startDraw} className="min-h-9 rounded-lg bg-brand-primary px-3 text-[11px] font-bold text-on-brand">Draw new fence</button>
            {formActive && (
              <>
                <button type="button" onClick={undo} disabled={undoRef.current.length === 0} className="min-h-9 rounded-lg border border-command-border px-2.5 text-[11px] font-semibold text-text-primary disabled:opacity-35">Undo</button>
                <button type="button" onClick={redo} disabled={redoRef.current.length === 0} className="min-h-9 rounded-lg border border-command-border px-2.5 text-[11px] font-semibold text-text-primary disabled:opacity-35">Redo</button>
                <button type="button" onClick={cancel} className="min-h-9 rounded-lg border border-command-border px-2.5 text-[11px] font-semibold text-text-primary">Cancel</button>
                <button type="button" onClick={() => void save()} disabled={busy || !formActive} className="min-h-9 rounded-lg bg-status-success px-3 text-[11px] font-bold text-white disabled:opacity-40">Save fence</button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-[420px] overflow-hidden rounded-xl border border-command-border bg-command-surface">
          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{ position: "absolute", inset: 0 }}
            data-testid="geofence-map"
          />
          {vertices.length >= 3 && (
            <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg bg-command-surface/95 px-2 py-1 text-[10px] text-text-secondary">
              {validation.valid
                ? `Area ${Math.round(validation.areaM2).toLocaleString()} m²`
                : validation.errors.join(" ")}
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <section className="rounded-xl border border-command-border bg-command-surface p-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">
              {editingId ? "Edit fence" : "New fence"}
            </p>
            <label className="mt-2 block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Depot perimeter"
                className="mt-1 h-9 w-full rounded-lg border border-command-border bg-command-surface px-2 text-xs text-text-primary"
              />
            </label>

            <div className="mt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">Driver scope</p>
                <button type="button" onClick={selectDriversInside} disabled={vertices.length < 3} className="rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-brand-ink disabled:opacity-35">
                  Select drivers inside
                </button>
              </div>
              <p className="mt-1 text-[10px] text-text-secondary">
                {driverIds.length === 0
                  ? "All vehicles are evaluated against this fence."
                  : `${driverIds.length} driver${driverIds.length === 1 ? "" : "s"} scoped to this fence.`}
              </p>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {state.drivers.map((driver) => {
                  const vehicle = vehicleByDriver.get(driver.id);
                  return (
                    <label key={driver.id} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[11px] hover:bg-command-raised">
                      <input
                        type="checkbox"
                        checked={driverIds.includes(driver.id)}
                        onChange={(event) =>
                          setDriverIds((current) =>
                            event.target.checked
                              ? [...current, driver.id]
                              : current.filter((id) => id !== driver.id),
                          )
                        }
                        className="h-3.5 w-3.5 accent-[#EF842F]"
                      />
                      <span className="min-w-0 flex-1 truncate">{driver.fullName}</span>
                      <span className="text-[9px] text-text-secondary">{vehicle?.registration ?? "-"}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {!editingId && (
              <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
                Linked job (optional, powers the customer "in your area" signal)
                <select
                  value={jobId}
                  onChange={(event) => setJobId(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-command-border bg-command-surface px-2 text-xs text-text-primary"
                >
                  <option value="">No job</option>
                  {state.jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.reference} · {job.status.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
            )}

            {error && <p className="mt-2 text-[11px] text-status-danger">{error}</p>}
            <p className="mt-3 text-[10px] leading-relaxed text-text-secondary">
              {vertices.length === 0
                ? "Click the map to start the fence. A fence needs at least three vertices."
                : `${vertices.length} vertices · right-click a vertex to remove it · click the small midpoints to insert.`}
            </p>
          </section>

          <section className="rounded-xl border border-command-border bg-command-surface p-3">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">Fences ({geofences.length})</p>
              <button type="button" onClick={() => void load()} disabled={busy} className="rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-text-primary disabled:opacity-35">Refresh</button>
            </div>
            {geofences.length === 0 ? (
              <p className="mt-2 text-[11px] text-text-secondary">No fences yet. Draw the first one on the map.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {geofences.map((fence) => (
                  <li key={fence.id} className="rounded-lg border border-command-border px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => editFence(fence)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-[11px] font-semibold text-text-primary">{fence.name}</p>
                        <p className="text-[9px] text-text-secondary">
                          {fence.driverIds.length === 0 ? "All vehicles" : `${fence.driverIds.length} driver${fence.driverIds.length === 1 ? "" : "s"}`}
                          {fence.jobId ? " · linked job" : ""}
                        </p>
                      </button>
                      <label className="flex items-center gap-1 text-[9px] font-semibold text-text-secondary">
                        <input type="checkbox" checked={fence.enabled} disabled={busy} onChange={() => void toggleEnabled(fence)} className="h-3.5 w-3.5 accent-[#EF842F]" />
                        Active
                      </label>
                      <button type="button" onClick={() => void removeFence(fence)} disabled={busy} className="rounded-md border border-command-border px-1.5 py-0.5 text-[9px] font-semibold text-text-primary disabled:opacity-35">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

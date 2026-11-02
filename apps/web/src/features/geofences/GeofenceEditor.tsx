/**
 * Visual geofence editor: draw on the map, drag vertices, insert/remove
 * vertices, undo/redo, validate geometry, and scope the fence to drivers.
 * Leaflet raster keeps the editor usable without WebGL; geometry stays pure.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetState, GeofenceDto } from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import {
  geojsonToVertices,
  midpoint,
  pointInPolygon,
  ringToGeoJSON,
  validateRing,
  type GeoLatLng,
} from "./engine/geofence-geometry";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function GeofenceEditor({
  state,
  onPublished,
}: {
  state: FleetState;
  onPublished?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const draftRef = useRef<L.LayerGroup | null>(null);
  const fencesRef = useRef<L.LayerGroup | null>(null);
  const vehiclesRef = useRef<L.LayerGroup | null>(null);
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [51.5074, -0.1278],
      zoom: 12,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    draftRef.current = L.layerGroup().addTo(map);
    fencesRef.current = L.layerGroup().addTo(map);
    vehiclesRef.current = L.layerGroup().addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => {
      if (!interactiveRef.current) return;
      commit([...verticesRef.current, { lat: event.latlng.lat, lng: event.latlng.lng }]);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      draftRef.current = null;
      fencesRef.current = null;
      vehiclesRef.current = null;
    };
  }, [commit]);

  // Draft overlay: polygon, vertex handles and midpoint insertion handles.
  useEffect(() => {
    const group = draftRef.current;
    if (!group) return;
    group.clearLayers();
    if (vertices.length === 0) return;
    const active = drawing || editingId !== null;
    if (!active) return;

    if (vertices.length >= 2) {
      L.polyline(vertices as L.LatLngExpression[], {
        color: "#EF842F",
        weight: 2.5,
        dashArray: "6 5",
      }).addTo(group);
    }
    if (vertices.length >= 3) {
      L.polygon(vertices as L.LatLngExpression[], {
        color: "#EF842F",
        weight: 2.5,
        fillColor: "#F28C28",
        fillOpacity: 0.14,
      }).addTo(group);
    }

    const vertexIcon = L.divIcon({ className: "pf-geo-vertex-wrap", html: '<span class="pf-geo-vertex"></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
    vertices.forEach((point, index) => {
      const marker = L.marker(point as L.LatLngExpression, {
        draggable: true,
        icon: vertexIcon,
        keyboard: false,
      }).addTo(group);
      marker.on("dragend", (event: L.DragEndEvent) => {
        const moved = event.target.getLatLng() as L.LatLng;
        const next = [...verticesRef.current];
        next[index] = { lat: moved.lat, lng: moved.lng };
        commit(next);
      });
      marker.on("contextmenu", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        if (verticesRef.current.length > 3) {
          const next = verticesRef.current.filter((_, position) => position !== index);
          commit(next);
        }
      });
      marker.on("click", (event: L.LeafletMouseEvent) => L.DomEvent.stop(event));
    });

    const midpointIcon = L.divIcon({ className: "pf-geo-midpoint-wrap", html: '<span class="pf-geo-midpoint"></span>', iconSize: [12, 12], iconAnchor: [6, 6] });
    const count = vertices.length;
    for (let index = 0; index < count; index += 1) {
      const nextIndex = (index + 1) % count;
      if (count < 3 && index === count - 1) continue;
      const mid = midpoint(vertices[index]!, vertices[nextIndex]!);
      const marker = L.marker(mid as L.LatLngExpression, {
        icon: midpointIcon,
        keyboard: false,
      }).addTo(group);
      marker.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        const next = [...verticesRef.current];
        next.splice(nextIndex, 0, { lat: mid.lat, lng: mid.lng });
        commit(next);
      });
    }
  }, [vertices, drawing, editingId, commit]);

  // Existing fences + vehicle markers.
  useEffect(() => {
    const fences = fencesRef.current;
    const vehicles = vehiclesRef.current;
    if (!fences || !vehicles) return;
    fences.clearLayers();
    vehicles.clearLayers();

    for (const fence of geofences) {
      const points = geojsonToVertices(fence.geojson);
      if (points.length < 3) continue;
      const polygon = L.polygon(points as L.LatLngExpression[], {
        color: fence.enabled ? "#276EF1" : "#94A3B8",
        weight: 2,
        fillColor: fence.enabled ? "#276EF1" : "#94A3B8",
        fillOpacity: 0.1,
      }).addTo(fences);
      polygon.bindTooltip(fence.name, { sticky: true });
      polygon.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        editFence(fence);
      });
    }

    for (const vehicle of state.vehicles) {
      if (!vehicle.location) continue;
      const driver = vehicle.driverId ? driverById.get(vehicle.driverId) : undefined;
      const selected = vehicle.driverId ? driverIds.includes(vehicle.driverId) : false;
      const vehiclePoint = { lat: vehicle.location.latitude, lng: vehicle.location.longitude };
      const inside = vertices.length >= 3 ? pointInPolygon(vehiclePoint, vertices) : false;
      const marker = L.circleMarker(
        [vehicle.location.latitude, vehicle.location.longitude] as [number, number],
        {
          radius: selected ? 9 : 6,
          color: "#FFFFFF",
          weight: 2,
          fillColor: inside ? "#16A34A" : selected ? "#F28C28" : "#276EF1",
          fillOpacity: 0.95,
        },
      ).addTo(vehicles);
      marker.bindPopup(`${driver?.fullName ?? "Unassigned"} · ${vehicle.registration}`);
      marker.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        if (!vehicle.driverId) return;
        setDriverIds((current) =>
          current.includes(vehicle.driverId!)
            ? current.filter((id) => id !== vehicle.driverId)
            : [...current, vehicle.driverId!],
        );
      });
    }
  }, [geofences, state.vehicles, state.drivers, driverIds, vertices, driverById]);

  function editFence(fence: GeofenceDto): void {
    setVertices(geojsonToVertices(fence.geojson));
    setName(fence.name);
    setDriverIds(fence.driverIds ?? []);
    setJobId(fence.jobId ?? "");
    setEditingId(fence.id);
    setDrawing(false);
    setError(null);
    if (mapRef.current) {
      const points = geojsonToVertices(fence.geojson);
      if (points.length > 0) {
        mapRef.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 16 });
      }
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
          <div ref={containerRef} className="absolute inset-0" data-testid="geofence-map" />
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
                : `${vertices.length} vertices · right-click a vertex to remove it · drag the small midpoints to insert.`}
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

/**
 * Geofencing administration (operator surface). Evaluation runs during
 * telemetry ingestion and raises enter/exit alerts; this panel owns the zone
 * lifecycle: create, enable/disable and delete.
 */
import { useEffect, useState } from "react";
import type { FleetState, GeofenceDto } from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { Panel } from "../../shared/ui/Panel";
import { StatusChip } from "../../shared/ui/StatusChip";

function geojsonSummary(geojson: string): string {
  try {
    const parsed = JSON.parse(geojson) as { type?: string; coordinates?: unknown[] };
    if (parsed.type === "Polygon" && Array.isArray(parsed.coordinates)) {
      const ring = parsed.coordinates[0];
      return Array.isArray(ring) ? `Polygon - ${ring.length} vertices` : "Polygon";
    }
    if (parsed.type === "Point" && Array.isArray(parsed.coordinates)) {
      return `Point - ${parsed.coordinates[0]}, ${parsed.coordinates[1]}`;
    }
    return parsed.type ?? "GeoJSON";
  } catch {
    return "Invalid GeoJSON";
  }
}

export function GeofencesPanel({ jobs }: { jobs: FleetState["jobs"] }) {
  const [geofences, setGeofences] = useState<GeofenceDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [geojson, setGeojson] = useState("");
  const [jobId, setJobId] = useState("");

  async function load(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setGeofences((await api.listGeofences()).geofences);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Geofences unavailable");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(): Promise<void> {
    if (!name.trim() || !geojson.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createGeofence(name.trim(), geojson.trim(), true, jobId || undefined);
      setName("");
      setGeojson("");
      setJobId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Geofence could not be created");
      setBusy(false);
    }
  }

  async function toggle(zone: GeofenceDto): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.updateGeofence(zone.id, { enabled: !zone.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Geofence could not be updated");
      setBusy(false);
    }
  }

  async function remove(zone: GeofenceDto): Promise<void> {
    if (!window.confirm(`Delete geofence "${zone.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGeofence(zone.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Geofence could not be deleted");
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Geofencing"
      action={
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-text-primary disabled:opacity-40"
        >
          Refresh
        </button>
      }
    >
      <p className="text-xs text-text-secondary">
        Enter and exit events are evaluated on every telemetry sample and appear as alerts. Geofences are tenant-scoped and evaluated for every vehicle.
      </p>
      {error && <p className="mt-2 text-xs text-status-danger">{error}</p>}

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
            Zone name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Depot perimeter"
              className="mt-1 h-9 w-full rounded-lg border border-command-border bg-command-surface px-2 text-xs text-text-primary"
            />
          </label>
          <label className="min-w-[280px] flex-[2] text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
            GeoJSON (Polygon)
            <input
              value={geojson}
              onChange={(event) => setGeojson(event.target.value)}
              placeholder='{"type":"Polygon","coordinates":[[[-0.13,51.51],[-0.11,51.51],[-0.11,51.52],[-0.13,51.52],[-0.13,51.51]]]}'
              className="mt-1 h-9 w-full rounded-lg border border-command-border bg-command-surface px-2 text-xs text-text-primary"
            />
          </label>
          <label className="min-w-40 flex-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
            Linked job (optional)
            <select
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-command-border bg-command-surface px-2 text-xs text-text-primary"
            >
              <option value="">No job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>{job.reference} · {job.status.replace("_", " ")}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !name.trim() || !geojson.trim()}
            className="min-h-9 rounded-lg bg-brand-primary px-3 text-xs font-bold text-white disabled:opacity-40"
          >
            Create
          </button>
        </div>
        <div className="rounded-lg border border-command-border bg-command-raised px-3 py-2 text-[11px] text-text-secondary">
          Coordinates are longitude, latitude. Invalid GeoJSON is rejected by the API, never stored silently.
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {geofences.length === 0 && !busy && (
          <li className="text-xs text-text-secondary">No geofences configured for this workspace.</li>
        )}
        {geofences.map((zone) => (
          <li key={zone.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-command-border bg-command-surface px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-xs font-semibold text-text-primary">{zone.name}</p>
                <StatusChip tone={zone.enabled ? "success" : "neutral"} label={zone.enabled ? "active" : "disabled"} />
              </div>
              <p className="mt-0.5 text-[10px] text-text-secondary">
                {geojsonSummary(zone.geojson)}
                {zone.jobId ? ` · linked to ${jobs.find((job) => job.id === zone.jobId)?.reference ?? "job"}` : ""}
                {" · "}created {new Date(zone.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary">
              <input
                type="checkbox"
                checked={zone.enabled}
                onChange={() => void toggle(zone)}
                disabled={busy}
                className="h-4 w-4 accent-[#EF842F]"
              />
              Enabled
            </label>
            <button
              type="button"
              onClick={() => void remove(zone)}
              disabled={busy}
              className="rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-text-primary disabled:opacity-40"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

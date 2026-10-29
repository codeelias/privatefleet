/**
 * Jobs & Work Orders, including CSV bulk ingestion. The preview is
 * server-authoritative: address/PostGIS validation, duplicate detection and
 * counts come from the API; commit sends only the validated preview payload.
 */
import { useMemo, useRef, useState } from "react";
import type { FleetState, JobImportPreview } from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { StatusChip } from "../../shared/ui/StatusChip";

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "warning";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "assigned") return "warning";
  return "neutral";
}

export function JobsScreen({
  state,
  onImported,
}: {
  state: FleetState;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const jobs = useMemo(
    () => [...state.jobs].sort((a, b) => a.reference.localeCompare(b.reference)),
    [state.jobs],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-command-border/70 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
            Dispatch workspace
          </p>
          <h1 className="mt-1 text-lg font-bold text-text-primary">Jobs &amp; work orders</h1>
          <p className="mt-1 text-xs text-text-secondary">
            {jobs.length} jobs - {jobs.reduce((sum, job) => sum + job.stops.length, 0)} stops
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-9 rounded-lg bg-brand-primary px-4 text-xs font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Bulk Import
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-command-border bg-command-surface p-6 text-sm text-text-secondary">
            No jobs yet. Use Bulk Import to ingest a CSV batch.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-command-border bg-command-surface">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-command-border/70 text-[10px] uppercase tracking-[0.12em] text-text-secondary">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Reference</th>
                  <th className="px-3 py-2.5 font-semibold">Service</th>
                  <th className="px-3 py-2.5 font-semibold">Stops</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Driver</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-command-border/50 last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-text-primary">{job.reference}</td>
                    <td className="px-3 py-2.5 text-text-secondary">{job.serviceType}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-text-secondary">
                        {job.stops.map((stop) => stop.address).join(" -> ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusChip
                        tone={statusTone(job.status)}
                        label={job.status.replace("_", " ")}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">
                      {state.drivers.find((driver) => driver.id === job.assignedDriverId)?.fullName ??
                        "Unassigned"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <BulkImportModal
          onClose={() => setOpen(false)}
          onImported={() => {
            onImported();
          }}
        />
      )}
    </div>
  );
}

function BulkImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<JobImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ count: number; references: string[] } | null>(
    null,
  );

  async function loadFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setImported(null);
    setFileName(file.name);
    try {
      const csv = await file.text();
      setPreview(await api.importPreview(csv));
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV could not be read.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (!preview?.canCommit || preview.jobs.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importCommit(preview.jobs);
      setImported({ count: result.imported, references: result.references });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const issueCount = preview ? preview.invalid + preview.duplicates : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-import-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-command-border bg-command-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-command-border/70 px-5 py-4">
          <div>
            <h2 id="bulk-import-title" className="text-base font-bold text-text-primary">
              Bulk import jobs
            </h2>
            <p className="mt-1 text-xs text-text-secondary">
              CSV rows sharing a job_ref become one job. Addresses are checked against the
              tenant service area with PostGIS.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk import"
            className="min-h-8 rounded-md border border-command-border px-2 text-xs text-text-secondary"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void loadFile(file);
            }}
            className="rounded-xl border border-dashed border-command-border bg-command-bg/50 px-4 py-5 text-center"
          >
            <p className="text-sm font-semibold text-text-primary">
              Drag and drop a CSV here
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Required columns: job_ref, address, latitude, longitude. Optional: service_type,
              priority, stop_type, window_start, window_end.
            </p>
            <input
              ref={inputRef}
              aria-label="CSV file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-3 min-h-8 rounded-lg border border-command-border bg-command-surface px-3 text-xs font-semibold text-text-primary"
            >
              Choose CSV file
            </button>
            {fileName && <p className="mt-2 text-[11px] text-text-secondary">{fileName}</p>}
            <p className="mt-3 text-[10px] leading-relaxed text-text-secondary">
              Validation checks coordinates against the operating region. Ensure your CSV
              includes accurate Latitude and Longitude columns.
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {error}
            </p>
          )}
          {busy && <p className="mt-3 text-xs text-text-secondary">Validating...</p>}

          {preview && (
            <>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-status-success/15 px-2.5 py-1 font-semibold text-status-success">
                  {preview.valid} valid
                </span>
                <span className="rounded-full bg-status-danger/15 px-2.5 py-1 font-semibold text-status-danger">
                  {preview.invalid} invalid
                </span>
                <span className="rounded-full bg-status-warning/15 px-2.5 py-1 font-semibold text-status-warning">
                  {preview.duplicates} duplicates
                </span>
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl border border-command-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-command-border/70 text-[10px] uppercase tracking-[0.12em] text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">Job ref</th>
                      <th className="px-3 py-2 font-semibold">Stops</th>
                      <th className="px-3 py-2 font-semibold">Address</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row) => (
                      <tr
                        key={row.jobRef}
                        className={
                          row.status === "valid"
                            ? "border-b border-command-border/50 last:border-0"
                            : "border-b border-command-border/50 bg-status-danger/5 last:border-0"
                        }
                      >
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{row.row}</td>
                        <td className="px-3 py-2 font-semibold text-text-primary">{row.jobRef}</td>
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{row.stopCount}</td>
                        <td className="px-3 py-2 text-text-secondary">{row.address}</td>
                        <td className="px-3 py-2">
                          <StatusChip
                            tone={
                              row.status === "valid"
                                ? "success"
                                : row.status === "duplicate"
                                  ? "warning"
                                  : "danger"
                            }
                            label={row.status}
                          />
                        </td>
                        <td className="px-3 py-2 text-status-danger">{row.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {issueCount > 0 && (
                <p className="mt-3 text-xs text-status-danger">
                  Fix the highlighted rows and upload the corrected CSV. Commit is disabled
                  until every row is valid and unique.
                </p>
              )}
            </>
          )}

          {imported && (
            <div role="status" className="mt-4 rounded-lg bg-status-success/10 px-3 py-2 text-xs text-status-success">
              {imported.count} jobs imported: {imported.references.join(", ")}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-command-border/70 px-5 py-3">
          <p className="text-[11px] text-text-secondary">
            The commit is one database transaction; any insert failure rolls back the batch.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 rounded-lg border border-command-border px-3 text-xs font-semibold text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={!preview?.canCommit || busy || Boolean(imported)}
              className="min-h-9 rounded-lg bg-brand-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? "Working..."
                : preview
                  ? `Commit ${preview.valid} Jobs`
                  : "Commit Jobs"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}





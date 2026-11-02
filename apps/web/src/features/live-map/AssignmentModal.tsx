/**
 * Assignment modal (the Honey Pot interaction, docs/05.5): dry-run
 * preview with ETA impact and cascade, then one authoritative commit
 * with an idempotency key. Keyboard operable throughout. When opened
 * from a drag drop, the target driver is preselected.
 */
import { useEffect, useRef, useState } from "react";
import type { AssignmentPreview, DriverDto, FleetState } from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { StatusChip } from "../../shared/ui/StatusChip";

export function AssignmentModal({
  state,
  jobId,
  initialDriverId,
  onClose,
  onAssigned,
}: {
  state: FleetState;
  jobId: string;
  initialDriverId?: string | undefined;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const job = state.jobs.find((j) => j.id === jobId);
  const [selectedDriver, setSelectedDriver] = useState<DriverDto | null>(null);
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    setSelectedDriver(null);
    setPreview(null);
    setError(null);
    if (initialDriverId) {
      const driver = state.drivers.find((d) => d.id === initialDriverId);
      if (driver) {
        void chooseDriver(driver);
      }
    }
  }, [jobId, initialDriverId]);

  async function chooseDriver(driver: DriverDto) {
    setSelectedDriver(driver);
    setError(null);
    setPreview(null);
    try {
      const result = await api.previewAssignment(jobId, driver.id);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  async function confirm() {
    if (!preview) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.assignJob(jobId, preview.driverId, crypto.randomUUID());
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
      setBusy(false);
    }
  }

  const eligible = state.drivers.filter(
    (d) => d.status === "available" || d.status === "on_route",
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Assign ${job?.reference ?? "job"}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div ref={dialogRef} tabIndex={-1} className="pf-modal-sheet outline-none">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-command-border px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">
              Dispatch assignment
            </p>
            <h2 className="mt-0.5 truncate text-[17px] font-bold leading-tight">
              {job?.reference ?? "Job"}
              {job ? <span className="font-medium text-text-secondary"> Ã‚Â· {job.serviceType}</span> : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assignment"
            className="pf-icon-button -mr-1 mt-0.5 shrink-0 text-command-border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          >
            <svg viewBox="0 0 12 12" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m3 3 6 6M9 3 3 9" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="pf-modal-sheet__body px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-secondary">
              Choose a driver
            </p>
            <span className="text-[10px] text-text-secondary">{eligible.length} eligible</span>
          </div>
          <div className="mt-2 space-y-2">
            {eligible.map((driver) => (
              <button
                key={driver.id}
                type="button"
                onClick={() => void chooseDriver(driver)}
                aria-pressed={selectedDriver?.id === driver.id}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm transition-colors ${
                  selectedDriver?.id === driver.id
                    ? "border-brand-primary bg-brand-primary/10"
                    : "border-command-border bg-command-raised hover:border-brand-primary/50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{driver.fullName}</span>
                  <span className="mt-0.5 block text-[10px] text-text-secondary">
                    {driver.status === "on_route" ? "On route Ã‚Â· impact preview" : "Available now"}
                  </span>
                </span>
                <StatusChip
                  tone={driver.status === "on_route" ? "success" : "neutral"}
                  label={driver.status === "on_route" ? "en route" : "available"}
                />
              </button>
            ))}
            {eligible.length === 0 && (
              <p className="rounded-xl border border-command-border bg-command-raised px-3 py-2 text-sm text-text-secondary">
                No available or on-route drivers. Release a route or add a driver first.
              </p>
            )}
          </div>

          {preview && (
            <div className="mt-4 rounded-xl border border-command-border bg-command-bg p-3.5">
              <p className="text-[13px] leading-snug text-text-primary">{preview.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusChip tone="warning" label={`+${preview.etaImpactMinutes} min`} />
                {preview.constraintsViolated.map((constraint) => (
                  <StatusChip key={constraint} tone="danger" label={constraint} />
                ))}
                <span className="text-[9px] uppercase tracking-wider text-text-secondary">
                  projection
                </span>
              </div>
              {preview.etaCascade.length > 0 && (
                <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto border-t border-command-border pt-2 text-[11px] text-text-secondary">
                  {preview.etaCascade.map((entry) => (
                    <li key={entry.address} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{entry.address}</span>
                      <span className="shrink-0 font-semibold text-status-warning">
                        +{entry.arrivalDeltaMinutes} min
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[12px] leading-snug text-status-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-command-border bg-command-surface px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 rounded-lg px-3 text-[12px] font-semibold text-text-secondary hover:bg-command-raised hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!preview || busy || (preview?.constraintsViolated.length ?? 0) > 0}
            onClick={() => void confirm()}
            className="min-h-9 rounded-lg bg-brand-primary px-3.5 text-[12px] font-bold text-on-brand hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Assigning..." : "Confirm assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}







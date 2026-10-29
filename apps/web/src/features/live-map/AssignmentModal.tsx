/**
 * Assignment modal (the Honey Pot interaction, docs/05.5): dry-run
 * preview with ETA impact and cascade, then one authoritative commit
 * with an idempotency key. Keyboard operable throughout. When opened
 * from a drag drop, the target driver is preselected.
 */
import { useEffect, useState } from "react";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={`Assign ${job?.reference ?? "job"}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-command-border bg-command-surface p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            Assign {job?.reference} {job ? `- ${job.serviceType}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1 text-sm text-text-secondary hover:bg-command-raised hover:text-text-primary"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {eligible.map((driver) => (
            <button
              key={driver.id}
              type="button"
              onClick={() => void chooseDriver(driver)}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm ${
                selectedDriver?.id === driver.id
                  ? "border-brand-primary bg-brand-primary/10"
                  : "border-command-border bg-command-raised hover:border-brand-primary/50"
              }`}
            >
              <span className="font-semibold">{driver.fullName}</span>
              <StatusChip
                tone={driver.status === "on_route" ? "success" : "neutral"}
                label={driver.status === "on_route" ? "en route" : "available"}
              />
            </button>
          ))}
        </div>

        {preview && (
          <div className="mt-4 rounded-xl border border-command-border bg-command-bg p-4">
            <p className="text-sm text-text-primary">{preview.message}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusChip tone="warning" label={`+${preview.etaImpactMinutes} min`} />
              {preview.constraintsViolated.map((constraint) => (
                <StatusChip key={constraint} tone="danger" label={constraint} />
              ))}
              <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                demo projection
              </span>
            </div>
            {preview.etaCascade.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-command-border pt-3 text-xs text-text-secondary">
                {preview.etaCascade.map((entry) => (
                  <li key={entry.address} className="flex justify-between">
                    <span>{entry.address}</span>
                    <span className="font-semibold text-status-warning">
                      +{entry.arrivalDeltaMinutes} min
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={busy || preview.constraintsViolated.length > 0}
              onClick={() => void confirm()}
              className="mt-3 w-full rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-on-brand hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Assigning..." : "Confirm assignment"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}


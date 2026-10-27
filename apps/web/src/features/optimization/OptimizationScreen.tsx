/**
 * Route Optimisation Workbench (screen 3, docs/10.2 and handoff section
 * 3): side-by-side baseline vs proposal, honest simulated-result
 * labelling, and a dispatcher approval step before publishing. No fake
 * loading - the async state is the real API call.
 */
import { useState } from "react";
import type {
  FleetState,
  OptimizationProposal,
  OptimizedStop,
} from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { Panel } from "../../shared/ui/Panel";
import { StatusChip } from "../../shared/ui/StatusChip";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StopList({ stops }: { stops: OptimizedStop[] }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {stops.map((stop, index) => (
        <li
          key={`${stop.jobId}-${index}`}
          className="flex items-center gap-3 rounded-lg border border-command-border bg-command-raised px-3 py-2"
        >
          <span className="w-6 text-[10px] font-bold text-text-secondary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="w-14 tabular-nums text-xs text-text-secondary">
            {timeOf(stop.arrivalAt)}
          </span>
          <span className="flex-1 truncate">
            <span className="mr-1 font-bold">{stop.jobRef}</span>
            {stop.address}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-text-secondary">
            {stop.stopType}
          </span>
          {stop.feasible ? (
            <StatusChip tone="success" label="OK" />
          ) : (
            <StatusChip tone="danger" label="at risk" />
          )}
        </li>
      ))}
    </ol>
  );
}

export function OptimizationScreen({ state }: { state: FleetState }) {
  const [driverId, setDriverId] = useState(state.drivers[0]?.id ?? "");
  const [run, setRun] = useState<OptimizationProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function optimise() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.runOptimization(driverId);
      setRun(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimisation failed");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!run) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.approvePlan(run.runId);
      setRun(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Make the plan measurably better.</h1>
          <p className="text-sm text-text-secondary">
            Compare baseline to a constraint-checked proposal before publishing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="optimize-driver" className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
            Route for
          </label>
          <select
            id="optimize-driver"
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
            className="rounded-lg border border-command-border bg-command-surface px-3 py-1.5 text-sm text-text-primary"
          >
            {state.drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.fullName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void optimise()}
            disabled={busy || !driverId}
            className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-command-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && !run ? "Optimising..." : "Optimise routes"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
          {error}
        </p>
      )}

      {run && (
        <>
          <div className="rounded-xl border border-brand-primary/40 bg-brand-primary/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold text-text-primary">
                {run.savedMinutes} min estimated time saved
              </span>
              <span className="text-text-secondary">-</span>
              <span className="text-lg font-bold text-text-primary">
                {run.savedMiles} mi less travel vs. baseline sequence
              </span>
              <StatusChip tone="warning" label="SIMULATED RESULT" />
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              Savings are simulated demo data. Production metrics must come from
              routing-engine output.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Panel
              title={`Current plan - ${run.baseline.durationMinutes} min - ${run.baseline.distanceMiles} mi`}
              action={
                <StatusChip tone="danger" label={`${run.baseline.atRiskWindows} windows at risk`} />
              }
            >
              <StopList stops={run.baseline.stops} />
            </Panel>
            <Panel
              title={`Optimisation proposal - DRAFT - ${run.proposal.durationMinutes} min - ${run.proposal.distanceMiles} mi`}
              action={<StatusChip tone="success" label="windows feasible" />}
            >
              <StopList stops={run.proposal.stops} />
            </Panel>
          </div>

          <div className="flex items-center gap-3">
            {run.published ? (
              <div className="flex items-center gap-3">
                <StatusChip tone="success" label="Published" />
                <span className="text-sm text-text-secondary">
                  The board and live map now reflect this plan
                  {run.publishedAt ? ` (${timeOf(run.publishedAt)})` : ""}.
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void publish()}
                  disabled={busy}
                  className="rounded-xl bg-status-success px-4 py-2 text-sm font-bold text-command-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Publishing..." : "Publish approved plan"}
                </button>
                <span className="text-xs text-text-secondary">
                  Solver output is a proposal - approval publishes the route
                  version and notifies the board.
                </span>
              </>
            )}
          </div>
        </>
      )}

      {!run && !busy && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-text-secondary">
            Pick a driver and optimise. The proposal compares the current plan to a
            reordered, constraint-checked sequence.
          </p>
        </div>
      )}
    </div>
  );
}

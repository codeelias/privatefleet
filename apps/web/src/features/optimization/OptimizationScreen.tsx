/**
 * Route Optimisation Workbench (screen 3, docs/10.2 and handoff section
 * 3): side-by-side baseline vs proposal, honest simulated-result
 * labelling, and a dispatcher approval step before publishing. No fake
 * loading - the async state is the real API call.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FleetOptimizationProposal,
  FleetState,
  OptimizationProposal,
  OptimizedStop,
} from "@privatefleet/contracts";
import { api, HttpError } from "../../shared/api/client";
import { Panel } from "../../shared/ui/Panel";
import { StatusChip } from "../../shared/ui/StatusChip";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reasonLabel(reason: string | undefined): string {
  switch (reason) {
    case "MISSING_SKILL":
      return "No vehicle has the required capability";
    case "CAPACITY_EXCEEDED":
      return "Vehicle capacity exceeded";
    case "CONSTRAINTS_INCOMPLETE":
      return "Capacity constraints are incomplete";
    case "MISSING_STOP":
      return "Job has no usable stop";
    case "SOLVER_UNASSIGNED":
      return "Solver could not place this job";
    case undefined:
      return "Unassigned";
    default:
      return reason;
  }
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
  const queryClient = useQueryClient();
  const [run, setRun] = useState<OptimizationProposal | null>(null);
  const [liveRun, setLiveRun] = useState<FleetOptimizationProposal | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = state.demoMode === false;
  const hasPendingWork = state.jobs.some(
    (job) => job.status !== "completed" && job.status !== "cancelled",
  );

  async function optimise() {
    setBusy(true);
    setError(null);
    try {
      if (live) {
        const result = await api.runFleetOptimization();
        setLiveRun(result);
        setPublishedVersion(null);
        setRun(null);
      } else {
        const result = await api.runOptimization(driverId);
        setRun(result);
      }
    } catch (err) {
      if (
        err instanceof HttpError &&
        err.status === 409 &&
        /eligible|pickup\/dropoff/i.test(err.message)
      ) {
        setError(
          "Nothing to optimise: every job is completed. Import new jobs with pickup/dropoff pairs first.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Optimisation failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!run && !liveRun) {
      return;
    }
    setApproving(true);
    setError(null);
    try {
      if (live && liveRun) {
        const result = await api.approveFleetPlan(
          liveRun.runId,
          liveRun.expectedRouteVersion,
        );
        setPublishedVersion(result.version);
        setLiveRun({
          ...liveRun,
          published: true,
          publishedAt: result.publishedAt,
          publishedVersion: result.version,
        });
        // Authoritative refresh: map, board and assignments come from state.
        await queryClient.invalidateQueries({ queryKey: ["fleet"] });
      } else if (run) {
        const result = await api.approvePlan(run.runId, state.routeVersion);
        setRun(result);
      }
    } catch (err) {
      if (live && err instanceof HttpError && err.status === 409) {
        setError(
          "This proposal is stale - the fleet changed since it was generated. " +
            "Refresh and run fleet optimisation again; nothing was published.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Publish failed");
      }
    } finally {
      setApproving(false);
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
          {!live && (
            <>
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
            </>
          )}
          <button
            type="button"
            onClick={() => void optimise()}
            disabled={busy || (!live && !driverId) || (live && !hasPendingWork)}
            className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-on-brand hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && !run && !liveRun
              ? "Optimising..."
              : live
                ? hasPendingWork
                  ? "Optimise fleet"
                  : "No jobs to optimise"
                : "Optimise routes"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
          {error}
        </p>
      )}

      {live && liveRun && (
        <>
          <div className="rounded-xl border border-brand-primary/40 bg-brand-primary/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip tone="success" label="OSRM + VROOM - FLEET PROPOSAL" />
              <span className="text-lg font-bold text-text-primary">
                {(liveRun.totalDistanceMetres / 1000).toFixed(1)} km -{" "}
                {Math.round(liveRun.totalDurationSeconds / 60)} min across{" "}
                {liveRun.vehicles.length} routes
              </span>
              <StatusChip
                tone={liveRun.unassigned.length > 0 ? "warning" : "success"}
                label={
                  liveRun.unassigned.length > 0
                    ? liveRun.unassigned.length + " unassigned"
                    : "all work placed"
                }
              />
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              {liveRun.shipmentCount} paired shipments and {liveRun.singleStopJobCount}{" "}
              single-stop jobs considered - engine {liveRun.engine} - dataset{" "}
              {liveRun.datasetVersion} - run {liveRun.runId.slice(0, 8)} - expected
              fleet version {liveRun.expectedRouteVersion}.
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Road-network distance and duration from the routing engine. Arrival
              times appear only when the solver returns an absolute time.
            </p>
          </div>

          {liveRun.baseline && (
            <div className="rounded-xl border border-command-border bg-command-surface px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusChip tone="neutral" label="BASELINE - CURRENT PUBLISHED PLAN" />
                <span className="text-sm text-text-secondary">
                  {liveRun.baseline.routeCount} routes -{" "}
                  {(liveRun.baseline.distanceMetres / 1000).toFixed(1)} km -{" "}
                  {Math.round(liveRun.baseline.durationSeconds / 60)} min -{" "}
                  {liveRun.baseline.assignedStops} stops -{" "}
                  {liveRun.baseline.unassignedJobs} unassigned
                </span>
              </div>
              <p className="mt-1 text-xs text-text-secondary">
                Proposal delta:{" "}
                {(
                  (liveRun.totalDistanceMetres - liveRun.baseline.distanceMetres) /
                  1000
                ).toFixed(1)}{" "}
                km,{" "}
                {Math.round(
                  (liveRun.totalDurationSeconds - liveRun.baseline.durationSeconds) / 60,
                )}{" "}
                min,{" "}
                {liveRun.vehicles.reduce((sum, route) => sum + route.stops.length, 0) -
                  liveRun.baseline.assignedStops}{" "}
                assigned stops.
              </p>
              {liveRun.gate && !liveRun.gate.allowed && (
                <ul className="mt-2 space-y-1 text-xs text-status-danger">
                  {liveRun.gate.reasons.map((reason) => (
                    <li key={reason}>Publish blocked: {reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {liveRun.vehicles.map((route) => (
              <Panel
                key={route.vehicleId}
                title={
                  route.driverName +
                  " - " +
                  (route.distanceMetres / 1000).toFixed(1) +
                  " km - " +
                  Math.round(route.durationSeconds / 60) +
                  " min"
                }
                action={
                  <StatusChip tone="success" label={route.stops.length + " stops"} />
                }
              >
                <ol className="space-y-1.5 text-sm">
                  {route.stops.map((stop, index) => (
                    <li
                      key={stop.stopId}
                      className="flex items-center gap-3 rounded-lg border border-command-border bg-command-raised px-3 py-2"
                    >
                      <span className="w-6 text-[10px] font-bold text-text-secondary">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {stop.arrivalAt ? (
                        <span className="w-14 tabular-nums text-xs text-text-secondary">
                          {timeOf(stop.arrivalAt)}
                        </span>
                      ) : (
                        <span className="w-14 text-[10px] text-text-secondary">
                          no ETA
                        </span>
                      )}
                      <span className="flex-1 truncate">
                        <span className="mr-1 font-bold">{stop.jobRef}</span>
                        {stop.address}
                      </span>
                      <StatusChip
                        tone={stop.stopType === "service" ? "warning" : "neutral"}
                        label={
                          stop.stopType === "service"
                            ? "SINGLE JOB"
                            : stop.stopType === "pickup"
                              ? "PICKUP"
                              : "DELIVERY"
                        }
                      />
                    </li>
                  ))}
                </ol>
              </Panel>
            ))}
          </div>

          {liveRun.unassigned.length > 0 && (
            <Panel
              title={"Unassigned work - " + liveRun.unassigned.length}
              action={<StatusChip tone="warning" label="left untouched" />}
            >
              <ul className="space-y-1 text-sm">
                {liveRun.unassigned.map((entry) => (
                  <li
                    key={entry.jobId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2"
                  >
                    <span className="truncate font-mono text-xs">{entry.jobId}</span>
                    <span className="text-status-warning">
                      {reasonLabel(entry.reason)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-secondary">
                These jobs are not published and not reassigned by this approval.
              </p>
            </Panel>
          )}

          <div className="flex items-center gap-3">
            {liveRun.published ? (
              <div className="flex items-center gap-3">
                <StatusChip tone="success" label="Published" />
                <span className="text-sm text-text-secondary">
                  Fleet version {publishedVersion ?? liveRun.publishedVersion ?? ""} is
                  live
                  {liveRun.publishedAt
                    ? " (" + timeOf(liveRun.publishedAt) + ")"
                    : ""}
                  . The board and map now show the persisted routes.
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void publish()}
                  disabled={busy || approving || (liveRun.gate ? !liveRun.gate.allowed : false)}
                  className="rounded-xl bg-status-success px-4 py-2 text-sm font-bold text-on-brand hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {approving
                    ? "Publishing fleet plan..."
                    : liveRun.gate && !liveRun.gate.allowed
                      ? "Plan blocked by baseline gate"
                      : "Approve fleet plan"}
                </button>
                <span className="text-xs text-text-secondary">
                  One atomic transaction publishes every affected route; a stale
                  fleet version is rejected with 409 and nothing is partially
                  published.
                </span>
              </>
            )}
          </div>
        </>
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
                  className="rounded-xl bg-status-success px-4 py-2 text-sm font-bold text-on-brand hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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

      {live && !liveRun && !busy && (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-xl text-center text-sm text-text-secondary">
            Live routing is enabled. Run fleet optimisation to solve all eligible
            vehicles and pending work together; review every route, the unassigned
            panel and totals before approving. Nothing publishes without approval.
          </p>
        </div>
      )}

      {!live && !run && !busy && (
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





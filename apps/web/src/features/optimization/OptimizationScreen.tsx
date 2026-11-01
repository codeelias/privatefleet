/**
 * Route Optimisation Workbench (screen 3, docs/10.2 and handoff section
 * 3): side-by-side baseline vs proposal, honest simulated-result
 * labelling, and a dispatcher approval step before publishing. No fake
 * loading - the async state is the real API call.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FleetOptimizationProposal,
  FleetState,
  OptimizationProposal,
  OptimizedStop,
} from "@privatefleet/contracts";
import {
  api,
  HttpError,
  type DispatchPolicyView,
  type RecommendationResponse,
  type WorkRequestView,
} from "../../shared/api/client";
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
  const [policy, setPolicy] = useState<DispatchPolicyView | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [workRequests, setWorkRequests] = useState<WorkRequestView[]>([]);
  const [workRequestError, setWorkRequestError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState<
    Record<string, { km: string; visits: string }>
  >({});
  const [draft, setDraft] = useState({
    km: 200,
    travelHours: 9,
    workingHours: 10,
    visits: 50,
  });
  const live = state.demoMode === false;

  useEffect(() => {
    if (!live) return;
    void api
      .getDispatchPolicy()
      .then((next) => {
        setPolicy(next);
        setDraft({
          km: Math.round(next.maxDistanceM / 1000),
          travelHours: Math.round(next.maxTravelTimeS / 3600),
          workingHours: Math.round(next.maxWorkingDurationS / 3600),
          visits: next.maxVisits,
        });
      })
      .catch((err) => setPolicyError(err instanceof Error ? err.message : "Policy load failed"));
  }, [live]);

  useEffect(() => {
    if (!live) return;
    void api
      .getRecommendations()
      .then(setRecommendations)
      .catch((err) =>
        setRecommendationError(
          err instanceof Error ? err.message : "Recommendations failed",
        ),
      );
  }, [live]);

  useEffect(() => {
    if (!live) return;
    void api
      .getWorkRequests()
      .then(setWorkRequests)
      .catch((err) =>
        setWorkRequestError(err instanceof Error ? err.message : "Work requests failed"),
      );
  }, [live]);

  async function decideWorkRequest(
    id: string,
    decision: "approved" | "declined",
  ) {
    setWorkRequestError(null);
    try {
      await api.decideWorkRequest(id, decision);
      setWorkRequests(await api.getWorkRequests());
    } catch (err) {
      setWorkRequestError(err instanceof Error ? err.message : "Decision failed");
    }
  }

  async function savePolicy(input: {
    preset?: "local" | "balanced" | "extended";
    maxDistanceM?: number;
    maxTravelTimeS?: number;
    maxWorkingDurationS?: number;
    maxVisits?: number;
  }) {
    if (!policy) return;
    setSavingPolicy(true);
    setPolicyError(null);
    try {
      const next = await api.updateDispatchPolicy({
        expectedRevision: policy.revision,
        ...input,
      });
      setPolicy(next);
      setOverrideDraft(
        Object.fromEntries(
          next.overrides.map((override) => [
            override.vehicleId,
            {
              km: override.maxDistanceM ? String(Math.round(override.maxDistanceM / 1000)) : "",
              visits: override.maxVisits ? String(override.maxVisits) : "",
            },
          ]),
        ),
      );
      setDraft({
        km: Math.round(next.maxDistanceM / 1000),
        travelHours: Math.round(next.maxTravelTimeS / 3600),
        workingHours: Math.round(next.maxWorkingDurationS / 3600),
        visits: next.maxVisits,
      });
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : "Policy update failed");
    } finally {
      setSavingPolicy(false);
    }
  }
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

      {live && (
        <Panel
          title="Dispatch policy"
          action={
            <StatusChip
              tone={policy ? "success" : "warning"}
              label={
                policy
                  ? `${policy.preset} - revision ${policy.revision}`
                  : "not loaded"
              }
            />
          }
        >
          <p className="text-sm text-text-secondary">
            The company sets the operating limits once; optimisation and approval
            both use this same policy revision.
          </p>
          {policyError && (
            <p className="mt-2 text-sm text-status-danger">{policyError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {(["local", "balanced", "extended"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={savingPolicy || !policy}
                onClick={() => void savePolicy({ preset })}
                className={
                  "rounded-xl px-3 py-2 text-sm font-bold " +
                  (policy?.preset === preset
                    ? "bg-brand-primary text-on-brand"
                    : "border border-command-border bg-command-surface text-text-primary")
                }
              >
                {preset === "local"
                  ? "Local"
                  : preset === "balanced"
                    ? "Balanced Urban"
                    : "Extended"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAdvanced((value) => !value)}
              className="rounded-xl border border-command-border px-3 py-2 text-sm font-bold text-text-primary"
            >
              {advanced ? "Hide advanced" : "Advanced"}
            </button>
          </div>
          {policy && !advanced && (
            <p className="mt-3 text-xs text-text-secondary">
              Max {Math.round(policy.maxDistanceM / 1000)} km -{" "}
              {Math.round(policy.maxTravelTimeS / 3600)} h travel -{" "}
              {Math.round(policy.maxWorkingDurationS / 3600)} h working -{" "}
              {policy.maxVisits} visits per route. Minimum route utilisation is a
              soft balancing target, never a reason to add empty driving.
            </p>
          )}
          {policy && advanced && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <label className="block text-xs text-text-secondary">
                Max km
                <input
                  type="number"
                  min={1}
                  value={draft.km}
                  onChange={(event) => setDraft({ ...draft, km: Number(event.target.value) })}
                  className="mt-1 w-full rounded-lg border border-command-border bg-command-surface px-2 py-1 text-text-primary"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                Travel hours
                <input
                  type="number"
                  min={1}
                  value={draft.travelHours}
                  onChange={(event) =>
                    setDraft({ ...draft, travelHours: Number(event.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-command-border bg-command-surface px-2 py-1 text-text-primary"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                Working hours
                <input
                  type="number"
                  min={1}
                  value={draft.workingHours}
                  onChange={(event) =>
                    setDraft({ ...draft, workingHours: Number(event.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-command-border bg-command-surface px-2 py-1 text-text-primary"
                />
              </label>
              <label className="block text-xs text-text-secondary">
                Visits
                <input
                  type="number"
                  min={1}
                  value={draft.visits}
                  onChange={(event) =>
                    setDraft({ ...draft, visits: Number(event.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-command-border bg-command-surface px-2 py-1 text-text-primary"
                />
              </label>

              <div className="col-span-2 flex items-end gap-2 md:col-span-4">
                <button
                  type="button"
                  disabled={savingPolicy}
                  onClick={() =>
                    void savePolicy({
                      maxDistanceM: draft.km * 1000,
                      maxTravelTimeS: draft.travelHours * 3600,
                      maxWorkingDurationS: draft.workingHours * 3600,
                      maxVisits: draft.visits,
                    })
                  }
                  className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-on-brand"
                >
                  {savingPolicy ? "Saving..." : "Save custom limits"}
                </button>
              </div>
              <div className="col-span-2 mt-4 border-t border-command-border pt-3 md:col-span-4">
                <h4 className="text-sm font-bold text-text-primary">Vehicle overrides</h4>
                <p className="mb-2 text-xs text-text-secondary">
                  Leave a field blank to inherit the company limits. Changes increment the same policy revision.
                </p>
                <div className="space-y-2">
                  {state.vehicles.map((vehicle) => {
                    const driverName =
                      state.drivers.find((driver) => driver.id === vehicle.driverId)?.fullName ??
                      "Unassigned";
                    const entry = overrideDraft[vehicle.id] ?? { km: "", visits: "" };
                    return (
                      <div key={vehicle.id} className="grid grid-cols-2 items-end gap-2 md:grid-cols-4">
                        <span className="text-xs text-text-secondary">
                          {vehicle.registration} Ãƒâ€šÃ‚Â· {driverName}
                        </span>
                        <label className="text-xs text-text-secondary">
                          Max km
                          <input
                            type="number"
                            min={1}
                            value={entry.km}
                            onChange={(event) =>
                              setOverrideDraft({
                                ...overrideDraft,
                                [vehicle.id]: { ...entry, km: event.target.value },
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-command-border bg-command-surface px-2 py-1 text-text-primary"
                          />
                        </label>
                        <label className="text-xs text-text-secondary">
                          Visits
                          <input
                            type="number"
                            min={1}
                            value={entry.visits}
                            onChange={(event) =>
                              setOverrideDraft({
                                ...overrideDraft,
                                [vehicle.id]: { ...entry, visits: event.target.value },
                              })
                            }
                            className="mt-1 w-full rounded-lg border border-command-border bg-command-surface px-2 py-1 text-text-primary"
                          />
                        </label>
                        <span className="text-[11px] text-text-secondary">
                          {entry.km || entry.visits
                            ? `Override: ${entry.km || "inherit"} km / ${entry.visits || "inherit"} visits`
                            : "Inherits company limits"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={savingPolicy}
                  onClick={() => {
                    if (!policy) return;
                    void api
                      .updateDispatchPolicy({
                        expectedRevision: policy.revision,
                        overrides: Object.entries(overrideDraft)
                          .filter(([, value]) => value.km || value.visits)
                          .map(([vehicleId, value]) => ({
                            vehicleId,
                            ...(value.km ? { maxDistanceM: Number(value.km) * 1000 } : {}),
                            ...(value.visits ? { maxVisits: Number(value.visits) } : {}),
                          })),
                      })
                      .then((next) => setPolicy(next))
                      .catch((err) =>
                        setPolicyError(err instanceof Error ? err.message : "Override save failed"),
                      );
                  }}
                  className="mt-3 rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-on-brand"
                >
                  Save vehicle overrides
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {live && (
        <Panel
          title="Cost-aware recommendations"
          action={<StatusChip tone="success" label="advisory only" />}
        >
          <p className="text-sm text-text-secondary">
            Fuel, vehicle running cost and driver wage are estimated per route.
            Recommendations are suggestions for the dispatcher; nothing is assigned automatically.
          </p>
          {recommendationError && (
            <p className="mt-2 text-sm text-status-danger">{recommendationError}</p>
          )}
          {recommendations && (
            <>
              <p className="mt-2 text-xs text-text-secondary">
                Rates: fuel Ã‚Â£{(recommendations.economics.fuelPencePerKm / 100).toFixed(2)}/km,
                vehicle Ã‚Â£{(recommendations.economics.vehiclePencePerKm / 100).toFixed(2)}/km,
                driver Ã‚Â£{(recommendations.economics.driverPencePerHour / 100).toFixed(2)}/h,
                max detour {recommendations.economics.maxDetourKm} km.
              </p>
              <div className="mt-2 grid grid-cols-1 gap-1 text-xs md:grid-cols-3">
                {recommendations.routes.map((route) => (
                  <span key={route.driverId} className="rounded-lg bg-command-raised px-2 py-1">
                    {route.driverName}: {(route.distanceMetres / 1000).toFixed(1)} km,{" "}
                    Ã‚Â£{(route.estimatedCostPence / 100).toFixed(2)} estimated cost
                  </span>
                ))}
              </div>
              <ul className="mt-3 space-y-2">
                {recommendations.recommendations.length === 0 && (
                  <li className="text-sm text-text-secondary">
                    No unassigned job is close enough to an existing route under the current policy.
                  </li>
                )}
                {recommendations.recommendations.map((item) => (
                  <li
                    key={`${item.jobId}:${item.driverId}`}
                    className="rounded-lg border border-command-border bg-command-surface px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={item.priority === "stat" ? "danger" : "neutral"} label={item.reference} />
                      <span className="text-sm font-bold text-text-primary">
                        {item.driverName} Ã‚Â· {item.registration}
                      </span>
                      <span className="text-xs text-text-secondary">
                        +{item.detourKm} km Ã‚Â· +{item.addedMinutes} min Ã‚Â· Ã‚Â£
                        {(item.addedCostPence / 100).toFixed(2)} incremental
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">{item.reason}</p>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  void api
                    .getRecommendations()
                    .then(setRecommendations)
                    .catch((err) =>
                      setRecommendationError(
                        err instanceof Error ? err.message : "Recommendations failed",
                      ),
                    )
                }
                className="mt-3 rounded-xl border border-command-border px-3 py-2 text-sm font-bold text-text-primary"
              >
                Refresh recommendations
              </button>
            </>
          )}
        </Panel>
      )}
      {live && (
        <Panel
          title="Driver work requests"
          action={<StatusChip tone={workRequests.some((r) => r.status === "pending") ? "warning" : "success"} label={`${workRequests.filter((r) => r.status === "pending").length} pending`} />}
        >
          <p className="text-sm text-text-secondary">
            A request is the driver asking for more work. Approval records the decision;
            assigning jobs still happens through optimisation so the route stays valid.
          </p>
          {workRequestError && (
            <p className="mt-2 text-sm text-status-danger">{workRequestError}</p>
          )}
          <ul className="mt-3 space-y-2">
            {workRequests.length === 0 && (
              <li className="text-sm text-text-secondary">No work requests yet.</li>
            )}
            {workRequests.map((request) => (
              <li
                key={request.id}
                className="rounded-lg border border-command-border bg-command-surface px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    tone={request.status === "pending" ? "warning" : request.status === "approved" ? "success" : "neutral"}
                    label={request.status}
                  />
                  <span className="text-sm font-bold text-text-primary">
                    {request.driverName} · {request.registration ?? "no vehicle"}
                  </span>
                  <span className="text-xs text-text-secondary">
                    route v{request.routeVersion ?? "?"} · policy rev {request.policyRevision ?? "?"}
                    {request.gpsAgeSeconds !== null
                      ? ` · GPS ${Math.round(request.gpsAgeSeconds / 60)}m old`
                      : " · no GPS"}
                  </span>
                </div>
                {request.note && (
                  <p className="mt-1 text-xs text-text-secondary">“{request.note}”</p>
                )}
                {request.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void decideWorkRequest(request.id, "approved")}
                      className="rounded-lg bg-status-success px-2 py-1 text-[11px] font-bold text-on-brand"
                    >
                      Approve request
                    </button>
                    <button
                      type="button"
                      onClick={() => void decideWorkRequest(request.id, "declined")}
                      className="rounded-lg border border-command-border px-2 py-1 text-[11px] font-bold text-text-primary"
                    >
                      Decline
                    </button>
                  </div>
                )}
                {request.decisionNote && (
                  <p className="mt-1 text-xs text-text-secondary">{request.decisionNote}</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
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









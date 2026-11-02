/**
 * Calm Command Center shell wired to the DEMO_MODE API (handoff section 9
 * steps 1-4): live fleet snapshot via React Query, telemetry via
 * Socket.IO, scenario reset, drag-and-drop assignment (map pins and
 * dispatch lanes) with keyboard/click fallbacks, and screen navigation.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FleetState,
  ScenarioName,
  VehiclePosition,
} from "@privatefleet/contracts";
import { DispatchBoard } from "../features/dispatch-board/Board";
import { JobCard } from "../features/dispatch/JobCard";
import { AlertsScreen } from "../features/alerts/AlertsScreen";
import { JobsScreen } from "../features/jobs/JobsScreen";
import { HeadsUp } from "../features/heads-up/HeadsUp";
import { TrackingHub } from "../features/customer-tracking/TrackingHub";
import { AssignmentModal } from "../features/live-map/AssignmentModal";
import { MapCanvas } from "../features/live-map/MapCanvas";
import { OptimizationScreen } from "../features/optimization/OptimizationScreen";
import { api } from "../shared/api/client";
import { LoginScreen } from "../features/auth/LoginScreen";
import { useSession } from "../shared/auth/useSession";
import { createFleetSocket } from "../shared/realtime/socket";
import {
  acceptTelemetry,
  staleVehicleIds,
  type TrackMap,
} from "../features/live-map/engine/telemetry";
import { markTelemetry, startBenchSampler } from "../features/live-map/engine/benchmark";
import { KpiCard } from "../shared/ui/KpiCard";
import { StatusChip } from "../shared/ui/StatusChip";

type ScreenId = "live" | "board" | "jobs" | "optimise" | "alerts" | "tracking";

const WORKSPACE_ITEMS: ReadonlyArray<{ label: string; id: ScreenId }> = [
  { label: "Live Operations", id: "live" },
  { label: "Dispatch Board", id: "board" },
  { label: "Jobs & Work Orders", id: "jobs" },
  { label: "Route Optimisation", id: "optimise" },
  { label: "Exceptions & Alerts", id: "alerts" },
  { label: "Customer Tracking", id: "tracking" },
];

const SCENARIOS: ReadonlyArray<{ id: ScenarioName; label: string }> = [
  { id: "morning-rush", label: "Morning Rush" },
  { id: "emergency", label: "Emergency" },
  { id: "proof", label: "Proof of Service" },
];

const EMPTY_STATE: FleetState = {
  tenantId: "",
  demoMode: true,
  drivers: [],
  vehicles: [],
  jobs: [],
  alerts: [],
  serviceZones: [],
  routes: [],
  routeVersion: 1,
  serverTime: new Date().toISOString(),
};

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

function Dashboard({
  tenantName,
  onSignOut,
}: {
  tenantName?: string;
  onSignOut?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [screen, setScreen] = useState<ScreenId>("live");
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const [assignDriverId, setAssignDriverId] = useState<string | undefined>(undefined);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("pf.overview.expanded") === "1";
    } catch {
      return false;
    }
  });
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);
  const [vehiclePanel, setVehiclePanel] = useState<"expanded" | "compact" | "closed">(
    "compact",
  );
  const [queueOpen, setQueueOpen] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const telemetryTrackRef = useRef<TrackMap>({});
  const pendingPositionsRef = useRef<Map<string, VehiclePosition>>(new Map());
  const gpsSeenRef = useRef<Map<string, number>>(new Map());

  const fleetQuery = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api.fleetState(false),
    refetchInterval: 15_000,
    retry: 2,
  });
  // Geometry is versioned separately: it changes only when a plan is
  // published, so 20 snapshot reads/s never carry 240k route points.
  const routesQuery = useQuery({
    queryKey: ["fleet-routes", fleetQuery.data?.routeVersion ?? 0],
    queryFn: api.fleetRoutes,
    enabled: fleetQuery.data?.demoMode === false,
    staleTime: 60_000,
  });
  const baseState = fleetQuery.data ?? EMPTY_STATE;
  const state = useMemo(
    () =>
      routesQuery.data?.routes
        ? { ...baseState, routes: routesQuery.data.routes }
        : baseState,
    [baseState, routesQuery.data],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem("pf.overview.expanded", overviewExpanded ? "1" : "0");
    } catch {
      // Private mode or storage disabled: the workspace still works.
    }
  }, [overviewExpanded]);

  // The queue starts collapsed in every mode so the map owns the workspace.
  // Demo users open it with the same explicit control as production users.

  useEffect(() => {
    const socket = createFleetSocket();
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    // Coalesce accepted telemetry into one flush per animation frame
    // (docs/17.5): newest sample per vehicle, one React commit. Business
    // events never take this path.
    const pending = pendingPositionsRef.current;
    let handle: number | null = null;
    const flush = (): void => {
      handle = null;
      if (pending.size === 0) {
        return;
      }
      const batch = new Map(pending);
      pending.clear();
      queryClient.setQueryData<FleetState>(["fleet"], (old) => {
        if (!old) {
          return old;
        }
        return {
          ...old,
          vehicles: old.vehicles.map((vehicle) => {
            const position = batch.get(vehicle.id);
            return position
              ? {
                  ...vehicle,
                  location: {
                    latitude: position.latitude,
                    longitude: position.longitude,
                  },
                  stale: false,
                }
              : vehicle;
          }),
        };
      });
    };
    socket.on("vehicle.position", (position: VehiclePosition) => {
      // Out-of-order or duplicate telemetry must never move a marker
      // backwards (docs/17): accept only samples newer than the last.
      const accepted = acceptTelemetry(telemetryTrackRef.current, position, Date.now());
      if (!accepted.accepted) {
        return;
      }
      telemetryTrackRef.current = accepted.track;
      gpsSeenRef.current.set(position.vehicleId, Date.now());
      markTelemetry(position.vehicleId);
      pending.set(position.vehicleId, position);
      if (handle === null) {
        handle = requestAnimationFrame(flush);
      }
    });
    socket.on("event", () => {
      void queryClient.invalidateQueries({ queryKey: ["fleet"] });
    });
    return () => {
      socket.disconnect();
      setSocketConnected(false);
      if (handle !== null) {
        cancelAnimationFrame(handle);
      }
      pending.clear();
    };
  }, [queryClient]);

  useEffect(() => {
    // Performance gate instrumentation (no-op unless ?benchmark=1).
    return startBenchSampler();
  }, []);

  useEffect(() => {
    // Honest staleness: if accepted samples stop arriving, ghost the
    // marker instead of showing last-known as live.
    const timer = setInterval(() => {
      const stale = staleVehicleIds(telemetryTrackRef.current, Date.now(), 10_000);
      if (stale.size === 0) {
        return;
      }
      queryClient.setQueryData<FleetState>(["fleet"], (old) => {
        if (!old) {
          return old;
        }
        return {
          ...old,
          vehicles: old.vehicles.map((vehicle) =>
            stale.has(vehicle.id) ? { ...vehicle, stale: true } : vehicle,
          ),
        };
      });
    }, 2_000);
    return () => clearInterval(timer);
  }, [queryClient]);

  async function resetScenario(id: ScenarioName) {
    if (scenarioBusy) {
      return; // no double-fires during a live pitch
    }
    setScenarioBusy(true);
    setScenarioError(null);
    telemetryTrackRef.current = {};
    try {
      await api.resetScenario(id);
    } catch {
      // One automatic retry absorbs transient dev-server hiccups; only a
      // persistent failure surfaces, and as an amber notice, not a red
      // server-blame banner (review fix).
      try {
        await api.resetScenario(id);
      } catch (err) {
        setScenarioError(
          err instanceof Error ? err.message : "Demo reset hiccup - try again.",
        );
      }
    } finally {
      setScenarioBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
    }
  }

  function openAssignment(jobId: string, driverId?: string) {
    setAssignJobId(jobId);
    setAssignDriverId(driverId);
  }

  function handleDragEnd(event: DragEndEvent) {
    const jobId = event.active.data.current?.jobId as string | undefined;
    const driverId = event.over?.data.current?.driverId as string | undefined;
    if (jobId && driverId) {
      openAssignment(jobId, driverId);
    }
  }

  const openAlerts = state.alerts.filter((a) => !a.acknowledged);
  const activeVehicles = state.vehicles.filter(
    (v) => v.status !== "inactive" && v.status !== "maintenance",
  ).length;
  const onRoute = state.vehicles.filter((v) => v.status === "on_route").length;
  const inProgress = state.jobs.filter((j) => j.status !== "unassigned").length;
  const unassigned = state.jobs.filter((j) => j.status === "unassigned");
  const queuePageSize = 3;
  const queuePageCount = Math.max(1, Math.ceil(unassigned.length / queuePageSize));
  const queuePageSafe = Math.min(queuePage, queuePageCount - 1);
  const queueJobs = unassigned.slice(
    queuePageSafe * queuePageSize,
    queuePageSafe * queuePageSize + queuePageSize,
  );
  const urgent = unassigned.filter((j) => j.priority === "stat" || j.priority === "urgent").length;
  const atRisk = openAlerts.length;
  const selectedVehicle =
    state.vehicles.find((vehicle) => vehicle.driverId === focusedDriverId) ?? state.vehicles[0];
  const selectedDriver = state.drivers.find((d) => d.id === selectedVehicle?.driverId);
  const selectedJob = state.jobs.find((j) => j.assignedVehicleId === selectedVehicle?.id);
  const selectedRoute = state.routes.find(
    (route) => route.vehicleId === selectedVehicle?.id,
  );
  const nextStop = selectedJob?.stops.find((s) => s.status !== "completed");
  const selectedInitials = (selectedDriver?.fullName ?? "No vehicle")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-screen flex-col bg-command-bg text-text-primary">
        <header className="relative z-40 border-b border-command-border/80 bg-command-surface/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-3 sm:px-5 lg:gap-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary text-on-brand">
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M6 18c0-6 12-6 12-12" strokeLinecap="round" />
                  <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
                  <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <div>
                <p className="text-[20px] font-semibold leading-none tracking-[-0.035em]">
                  PrivateFleet
                </p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-text-secondary">
                  <span>Fleet operations</span>
                  <span className="px-1 text-command-border">{"\u00b7"}</span>
                  <span data-testid="tenant-name">{tenantName ?? "Northstar"}</span>
                </p>
              </div>
            </div>

            <nav className="mx-auto hidden h-full items-center gap-6 xl:flex">
              {WORKSPACE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScreen(item.id)}
                  aria-current={screen === item.id ? "page" : undefined}
                  className={`relative flex h-10 items-center text-[12px] font-medium transition-colors ${
                    screen === item.id
                      ? "text-text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-primary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-[11px] text-text-secondary 2xl:block">
                {todayLabel()}
              </span>
              <StatusChip
                tone={socketConnected ? "success" : "neutral"}
                label={socketConnected ? "Global live" : "Reconnecting"}
                pulse={socketConnected}
              />
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex items-center gap-2 rounded-full border border-command-border bg-command-surface py-1 pl-1 pr-3 text-[11px] font-semibold text-text-secondary transition-colors hover:text-text-primary"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-command-raised text-[11px] font-bold text-text-primary">
                    {(tenantName ?? "N").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              )}
            </div>
          </div>

          <nav className="pf-scroll flex gap-5 overflow-x-auto border-t border-command-border/50 px-5 pb-2 pt-2 xl:hidden">
            {WORKSPACE_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScreen(item.id)}
                aria-current={screen === item.id ? "page" : undefined}
                className={`shrink-0 border-b-2 pb-1 text-[11px] font-medium ${
                  screen === item.id
                    ? "bg-text-primary text-command-surface"
                    : "text-text-secondary hover:bg-command-raised"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <main className="flex flex-1 flex-col overflow-hidden">
            {fleetQuery.isError && (
              <div className="border-b border-status-warning/40 bg-status-warning/10 px-5 py-2 text-xs text-status-warning">
                Demo API not reachable - restart the stack with `pnpm dev` (API on
                port 4000). The dashboard will recover automatically when it
                returns.
              </div>
            )}
            {screen === "board" ? (
              <DispatchBoard state={state} onSelectJob={openAssignment} />
            ) : screen === "jobs" ? (
              <JobsScreen
                state={state}
                onSelectJob={openAssignment}
                onImported={() => {
                  void queryClient.invalidateQueries({ queryKey: ["fleet"] });
                }}
              />
            ) : screen === "optimise" ? (
              <OptimizationScreen state={state} />
            ) : screen === "alerts" ? (
              <AlertsScreen
                state={state}
                onReassign={(jobId) => openAssignment(jobId)}
                onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["fleet"] })}
              />
            ) : screen === "tracking" ? (
              <TrackingHub state={state} />
            ) : screen === "live" ? (
              <>
                {/* Compact overview expands in place without moving the map when collapsed */}
                <div className="px-5 pb-2 pt-3">
                  <div className="flex min-h-11 flex-wrap items-center gap-1 border-y border-command-border/70 bg-command-surface/70 px-1">
                    <button
                      type="button"
                      onClick={() => setOverviewExpanded((value) => !value)}
                      aria-expanded={overviewExpanded}
                      aria-controls="fleet-overview-detail"
                      aria-label={overviewExpanded ? "Collapse fleet overview" : "Expand fleet overview"}
                      className="flex min-h-9 items-center gap-2 px-2 text-left text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        className={"h-3 w-3 text-text-secondary transition-transform " + (overviewExpanded ? "rotate-180" : "")}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        aria-hidden="true"
                      >
                        <path d="M2 4.5 6 8.5l4-4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                        Overview
                      </span>
                    </button>
                    <div className="flex flex-1 flex-wrap items-center divide-x divide-command-border/60 text-[11px] text-text-secondary">
                      <span className="flex items-baseline gap-1.5 px-3"><strong className="text-[15px] font-semibold tabular-nums text-text-primary">{activeVehicles}</strong><span>active</span></span>
                      <span className="flex items-baseline gap-1.5 px-3"><strong className="text-[15px] font-semibold tabular-nums text-text-primary">{inProgress}</strong><span>in progress</span></span>
                      <span className="flex items-baseline gap-1.5 px-3"><strong className="text-[15px] font-semibold tabular-nums text-text-primary">{unassigned.length}</strong><span>unassigned</span></span>
                      <span className="flex items-baseline gap-1.5 px-3"><strong className={"text-[15px] font-semibold tabular-nums " + (atRisk > 0 ? "text-status-danger" : "text-text-primary")}>{atRisk}</strong><span>open alerts</span></span>
                    </div>
                    {state.demoMode && (
                      <div className="ml-auto flex items-center gap-1.5">
                        <span className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary 2xl:inline">
                          Demo
                        </span>
                        {SCENARIOS.map((scenario) => (
                          <button
                            key={scenario.id}
                            type="button"
                            onClick={() => void resetScenario(scenario.id)}
                            disabled={scenarioBusy}
                            className={"min-h-8 rounded-full border px-2.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 " +
                              (state.scenario === scenario.id
                                ? "border-brand-primary bg-brand-primary/15 text-brand-ink"
                                : "border-command-border text-text-secondary hover:text-text-primary")}
                          >
                            {scenario.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {overviewExpanded && (
                    <div id="fleet-overview-detail" className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      <KpiCard label="Active vehicles" value={String(activeVehicles)} sub={onRoute + " on route"} />
                      <KpiCard label="Jobs in progress" value={String(inProgress)} sub={unassigned.length + " unassigned"} />
                      <KpiCard label="Unassigned" value={String(unassigned.length)} sub={urgent + " urgent"} tone={urgent > 0 ? "warning" : undefined} />
                      <KpiCard label="Open alerts" value={String(atRisk)} sub="needs attention" tone={atRisk > 0 ? "danger" : undefined} />
                    </div>
                  )}
                  {scenarioError && (
                    <p className="mt-1 rounded-xl border border-status-warning/50 bg-status-warning/10 px-3 py-1.5 text-xs text-status-warning">
                      {scenarioError}
                    </p>
                  )}
                  <HeadsUp
                    state={state}
                    onOpenJob={openAssignment}
                    onFocusDriver={setFocusedDriverId}
                    onOpenAlerts={() => setScreen("alerts")}
                    onPublished={() => void queryClient.invalidateQueries({ queryKey: ["fleet"] })}
                  />
                </div>

                <div className="relative flex min-h-0 flex-1 overflow-hidden p-3">
                  <MapCanvas
                    state={state}
                    gpsSeenAt={gpsSeenRef.current}
                    selectedDriverId={focusedDriverId}
                    onSelectDriver={setFocusedDriverId}
                  />

                  {/* Inset map HUD: selected vehicle stays inside the map edge. */}
                {vehiclePanel !== "closed" ? (
                  <aside className="pointer-events-none absolute left-8 top-8 z-30 hidden w-[250px] max-w-[calc(100%-1.5rem)] md:block">
                    <div className="pf-map-hud pointer-events-auto overflow-hidden">
                      <div className="pf-map-hud__header">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-primary" aria-hidden="true" />
                          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                            Vehicle
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setVehiclePanel(vehiclePanel === "expanded" ? "compact" : "expanded")}
                            aria-label={vehiclePanel === "expanded" ? "Minimise selected vehicle" : "Expand selected vehicle"}
                            title={vehiclePanel === "expanded" ? "Minimise" : "Expand"}
                            className="pf-icon-button focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                          >
                            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                              <path d={vehiclePanel === "expanded" ? "M2 7.5 6 3.5l4 4" : "M2 4.5 6 8.5l4-4"} strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setVehiclePanel("closed")}
                            aria-label="Close selected vehicle"
                            title="Close"
                            className="pf-icon-button focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                          >
                            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                              <path d="m3 3 6 6M9 3 3 9" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {vehiclePanel === "compact" ? (
                        <button
                          type="button"
                          onClick={() => setVehiclePanel("expanded")}
                          className="flex w-full items-start gap-2.5 px-3.5 pb-3 pt-1 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                          aria-label="Expand selected vehicle details"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-primary/15 text-[11px] font-bold text-brand-ink">
                            {selectedInitials}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold leading-tight">
                              {selectedDriver?.fullName ?? "No vehicle selected"}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-text-secondary">
                              {selectedVehicle
                                ? `${selectedVehicle.registration} \u00b7 ${selectedVehicle.stale ? "GPS stale" : selectedVehicle.status.replace("_", " ")}`
                                : "No vehicles on shift"}
                            </span>
                            <span className="mt-2 block truncate text-[11px] font-medium text-text-primary">
                              {selectedJob
                                ? `${selectedJob.reference} \u00b7 ${nextStop?.address ?? "Next stop to confirm"}`
                                : "Ready for assignment"}
                            </span>
                            {selectedRoute && (
                              <span className="mt-1 block text-[10px] text-text-secondary">
                                Route v{selectedRoute.version} <span aria-hidden="true">{"\u00b7"}</span> {selectedRoute.waypoints?.length ?? 0} stops
                              </span>
                            )}
                            {openAlerts[0] && (
                              <span className="mt-1 block truncate text-[10px] font-medium text-status-warning">
                                {openAlerts[0].title}
                              </span>
                            )}
                          </span>
                          <svg viewBox="0 0 12 12" className="mt-3 h-3 w-3 shrink-0 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                            <path d="m4.5 2.5 3.5 3.5-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : (
                        <div className="pf-map-hud__scroll px-3.5 pb-3 pt-1">
                          {selectedVehicle ? (
                            <VehicleDetails
                              state={state}
                              vehicleId={selectedVehicle.id}
                              lastGpsAt={gpsSeenRef.current.get(selectedVehicle.id)}
                            />
                          ) : (
                            <p className="text-sm text-text-secondary">No vehicles on shift.</p>
                          )}
                          {selectedRoute && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm("Close this route and return unfinished work to the unassigned queue?")) return;
                                void api
                                  .closeFleetRoute(selectedRoute.vehicleId, selectedRoute.version)
                                  .then(() => queryClient.invalidateQueries({ queryKey: ["fleet"] }))
                                  .catch((err) => window.alert(err instanceof Error ? err.message : "Route close failed"));
                              }}
                              className="mt-3 w-full rounded-lg border border-status-warning/50 px-2 py-1.5 text-[10px] font-bold text-status-warning hover:bg-status-warning/10"
                            >
                              Close route and release work
                            </button>
                          )}
                          <div className="mt-3 border-t border-command-border/70 pt-2.5">
                            {openAlerts.length === 0 ? (
                              <p className="text-[10px] text-text-secondary">No current exceptions.</p>
                            ) : (
                              <>
                                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                                  Needs attention
                                </p>
                                <ul className="space-y-1.5 text-[10px] text-text-secondary">
                                  {openAlerts.map((alert) => (
                                    <li key={alert.id} className="flex items-start gap-2">
                                      <StatusChip
                                        tone={alert.severity === "urgent" ? "danger" : "warning"}
                                        label={alert.severity === "urgent" ? "urgent" : "at risk"}
                                      />
                                      <span className="min-w-0 flex-1">{alert.title}</span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </aside>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVehiclePanel("compact")}
                    className="pf-map-hud absolute left-8 top-8 z-30 hidden min-h-8 items-center gap-2 rounded-full px-2.5 text-[10px] font-semibold text-text-secondary shadow-sm md:flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    aria-label="Open selected vehicle panel"
                    title="Show selected vehicle"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-primary/15 text-brand-ink" aria-hidden="true">
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 7.5h8M3 7.5 4 3h4l1 4.5M3.5 9.5h.01M8.5 9.5h.01" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    Vehicle
                  </button>
                )}

                {/* Bottom dock: a centred taskbar icon when minimised, a bounded popover when open. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-7 z-30 flex justify-center px-3">
                  <div className={"pf-map-dock " + (queueOpen ? "pf-map-dock--open" : "")}>
                    <button
                      type="button"
                      onClick={() => {
                        setQueueOpen((value) => !value);
                        setQueuePage(0);
                      }}
                      aria-expanded={queueOpen}
                      aria-controls="unassigned-drawer"
                      aria-label={queueOpen ? "Close unassigned jobs" : "Open unassigned jobs"}
                      title="Unassigned jobs"
                      className="pf-map-dock__trigger focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
                    >
                      <span className="pf-dock-mark" aria-hidden="true">
                        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
                          <path d="m7 1.8 4.7 2.6L7 7 2.3 4.4 7 1.8Z" strokeLinejoin="round" />
                          <path d="m2.3 7 4.7 2.6L11.7 7M2.3 9.6 7 12.2l4.7-2.6" strokeLinejoin="round" />
                        </svg>
                      </span>
                      {queueOpen && (
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-[11px] font-semibold leading-tight text-text-primary">Unassigned jobs</span>
                          <span className="mt-0.5 block text-[9px] leading-tight text-text-secondary">Drag onto a driver or select</span>
                        </span>
                      )}
                      <span className="pf-dock-count">{unassigned.length}</span>
                      {queueOpen && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-3 w-3 shrink-0 rotate-180 text-text-secondary"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          aria-hidden="true"
                        >
                          <path d="M2 7.5 6 3.5l4 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    {queueOpen && (
                      <>
                        <div id="unassigned-drawer" className="pf-map-dock__body p-2.5">
                          <div className="flex flex-col gap-1.5">
                            {queueJobs.map((job) => (
                              <JobCard
                                key={job.id}
                                job={job}
                                dense
                                onSelect={() => openAssignment(job.id)}
                              />
                            ))}
                            {unassigned.length === 0 && (
                              <p className="py-2 text-xs text-text-secondary">
                                {state.demoMode
                                  ? "Queue clear. Reset a scenario to seed new jobs."
                                  : "No unassigned jobs. Dispatch is clear."}
                              </p>
                            )}
                          </div>
                        </div>
                        {unassigned.length > 0 && (
                          <div className="pf-map-dock__pager">
                            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-text-secondary">
                              {queuePageSafe * queuePageSize + 1}-
                              {Math.min((queuePageSafe + 1) * queuePageSize, unassigned.length)} of {unassigned.length}
                            </span>
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                disabled={queuePageSafe === 0}
                                onClick={() => setQueuePage((page) => Math.max(0, page - 1))}
                                aria-label="Previous unassigned jobs"
                                className="pf-icon-button disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                                  <path d="M7.5 2.5 4 6l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                disabled={queuePageSafe >= queuePageCount - 1}
                                onClick={() => setQueuePage((page) => Math.min(queuePageCount - 1, page + 1))}
                                aria-label="Next unassigned jobs"
                                className="pf-icon-button disabled:cursor-not-allowed disabled:opacity-35"
                              >
                                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                                  <path d="M4.5 2.5 8 6l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}                  </div>
                </div>

                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="max-w-sm text-center">
                  <p className="text-lg font-bold">Next slice</p>
                  <p className="mt-2 text-sm text-text-secondary">
                    {WORKSPACE_ITEMS.find((i) => i.id === screen)?.label} arrives in the
                    following build slices, per the handoff sequence. Live Operations and
                    the Dispatch Board are live now.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>

        {assignJobId && (
          <AssignmentModal
            state={state}
            jobId={assignJobId}
            initialDriverId={assignDriverId}
            onClose={() => {
              setAssignJobId(null);
              setAssignDriverId(undefined);
            }}
            onAssigned={() => {
              setAssignJobId(null);
              setAssignDriverId(undefined);
              void queryClient.invalidateQueries({ queryKey: ["fleet"] });
            }}
          />
        )}
      </div>
    </DndContext>
  );
}

function VehicleDetails({
  state,
  vehicleId,
  lastGpsAt,
}: {
  state: FleetState;
  vehicleId: string;
  lastGpsAt?: number | undefined;
}) {
  const vehicle = state.vehicles.find((v) => v.id === vehicleId);
  const driver = state.drivers.find((d) => d.id === vehicle?.driverId);
  const currentJob = state.jobs.find((j) => j.assignedVehicleId === vehicleId);
  if (!vehicle) {
    return null;
  }
  const initials = (driver?.fullName ?? "Driver")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
  const stops = [...(currentJob?.stops ?? [])].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const stopLabel = (type: string): string =>
    type === "pickup" ? "Pick up" : type === "dropoff" ? "Drop off" : "Service";
  const stopTime = (value?: string): string =>
    value
      ? new Date(value).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Time to be confirmed";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary/15 text-[13px] font-bold text-brand-ink">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">
            {driver?.fullName ?? "Unassigned vehicle"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-secondary">
            {vehicle.registration} {"\u00b7"} {vehicle.vehicleType}
          </p>
          {vehicle.stale && (
            <p className="mt-1 text-[11px] font-medium leading-snug text-status-warning">
              GPS stale {"\u00b7"}{" "}
              {lastGpsAt
                ? `last updated ${Math.max(1, Math.round((Date.now() - lastGpsAt) / 60_000))}m ago`
                : "last known position"}
            </p>
          )}
        </div>
        <StatusChip
          tone={vehicle.stale ? "stale" : vehicle.status === "on_route" ? "success" : "neutral"}
          label={vehicle.stale ? "stale" : vehicle.status}
        />
      </div>

      {currentJob ? (
        <>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-command-raised/60 px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em]">
              {currentJob.reference}
            </span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-text-secondary">
              {currentJob.serviceType}
            </span>
          </div>
          <ol className="relative ml-1 space-y-4 border-l border-command-border pl-5">
            {stops.slice(0, 4).map((stop, index) => (
              <li key={stop.id} className="relative">
                <span
                  className={`absolute -left-[25px] top-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 ${
                    index === 0 || stop.status === "completed"
                      ? "border-brand-primary bg-brand-primary"
                      : "border-command-border bg-command-surface"
                  }`}
                />
                <p className="text-[11px] font-semibold leading-tight">
                  {stopLabel(stop.stopType)}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">
                  {stop.address}
                </p>
                <p className="mt-0.5 text-[10px] text-text-secondary/80">
                  {stopTime(stop.windowStart)}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="rounded-xl bg-command-raised/50 px-3 py-2 text-xs text-text-secondary">
          No current job. This vehicle is ready for assignment.
        </p>
      )}

      {vehicle.location && (
        <p className="border-t border-command-border/70 pt-3 text-[10px] text-text-secondary">
          Position {vehicle.location.latitude.toFixed(4)}, {vehicle.location.longitude.toFixed(4)}
        </p>
      )}
    </div>
  );
}


/**
 * Composition gate (docs/05.4): demo mode opens the fleet interface
 * directly (ADR-0007); production mode requires a valid session and
 * renders the login screen otherwise.
 */
export function App() {
  const { state, login, logout } = useSession();

  if (state.kind === "booting") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-command-bg text-text-secondary">
        <p role="status">Loading workspace...</p>
      </main>
    );
  }

  if (state.kind === "anonymous") {
    return <LoginScreen onLogin={login} />;
  }

  const authenticated = state.kind === "authenticated";
  return (
    <Dashboard
      {...(authenticated ? { tenantName: state.session.tenant.name } : {})}
      {...(authenticated ? { onSignOut: () => void logout() } : {})}
    />
  );
}
































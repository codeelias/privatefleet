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
  const telemetryTrackRef = useRef<TrackMap>({});
  const pendingPositionsRef = useRef<Map<string, VehiclePosition>>(new Map());

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
    const socket = createFleetSocket();
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
  const activeVehicles = state.vehicles.filter((v) => !v.stale).length;
  const onRoute = state.vehicles.filter((v) => v.status === "on_route").length;
  const inProgress = state.jobs.filter((j) => j.status !== "unassigned").length;
  const unassigned = state.jobs.filter((j) => j.status === "unassigned");
  const urgent = unassigned.filter((j) => j.priority === "stat" || j.priority === "urgent").length;
  const atRisk = openAlerts.length;

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-screen flex-col bg-command-bg text-text-primary">
        <header className="relative z-40 border-b border-command-border/80 bg-command-surface/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1800px] items-center gap-5 px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-primary text-command-surface shadow-[0_5px_16px_rgba(239,132,47,0.25)]">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M6 18c0-6 12-6 12-12" strokeLinecap="round" />
                  <circle cx="6" cy="18" r="2" fill="currentColor" stroke="none" />
                  <circle cx="18" cy="6" r="2" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <div>
                <p className="text-[21px] font-semibold leading-none tracking-[-0.03em]">
                  PrivateFleet
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  <span>Fleet Operations</span>
                  <span className="px-1 text-command-border">·</span>
                  <span data-testid="tenant-name">{tenantName ?? "Northstar"}</span>
                </p>
              </div>
            </div>

            <nav className="mx-auto hidden items-center gap-1 rounded-full border border-command-border/70 bg-command-bg/90 p-1 xl:flex">
              {WORKSPACE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScreen(item.id)}
                  aria-current={screen === item.id ? "page" : undefined}
                  className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
                    screen === item.id
                      ? "bg-text-primary text-command-surface shadow-sm"
                      : "text-text-secondary hover:bg-command-raised hover:text-text-primary"
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
              <StatusChip tone="success" label="Live" pulse />
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex items-center gap-2 rounded-full border border-command-border bg-command-surface py-1 pl-1 pr-3 text-[11px] font-semibold text-text-secondary transition-colors hover:text-text-primary"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-command-raised text-[11px] font-bold text-text-primary">
                    {(tenantName ?? "N").slice(0, 1).toUpperCase()}
                  </span>
                  Sign out
                </button>
              )}
            </div>
          </div>

          <nav className="pf-scroll flex gap-1 overflow-x-auto px-4 pb-3 xl:hidden">
            {WORKSPACE_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScreen(item.id)}
                aria-current={screen === item.id ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium ${
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
              <DispatchBoard state={state} />
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
                {/* Fleet summary + demo scenarios */}
                <div className="flex flex-wrap items-stretch gap-3 px-5 pb-3 pt-4">
                  <div className="mr-1 hidden min-w-[140px] flex-col justify-center 2xl:flex">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                      Fleet overview
                    </p>
                    <p className="mt-1 text-[13px] font-medium text-text-primary">
                      Everything moving, at a glance.
                    </p>
                  </div>
                  <KpiCard label="Active vehicles" value={String(activeVehicles)} sub={`${onRoute} on route`} />
                  <KpiCard label="Jobs in progress" value={String(inProgress)} sub={`${unassigned.length} unassigned`} />
                  <KpiCard label="Unassigned" value={String(unassigned.length)} sub={`${urgent} urgent`} tone={urgent > 0 ? "warning" : undefined} />
                  <KpiCard label="At-risk stops" value={String(atRisk)} sub="needs attention" tone={atRisk > 0 ? "danger" : undefined} />
                  {state.demoMode && (
                    <div className="ml-auto flex items-center gap-2 self-center">
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                        Demo scenario
                      </span>
                      {SCENARIOS.map((scenario) => (
                        <button
                          key={scenario.id}
                          type="button"
                          onClick={() => void resetScenario(scenario.id)}
                          disabled={scenarioBusy}
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                            state.scenario === scenario.id
                              ? "border-brand-primary bg-brand-primary/15 text-brand-primary"
                              : "border-command-border text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {scenario.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {scenarioError && (
                    <p className="rounded-xl border border-status-warning/50 bg-status-warning/10 px-3 py-1.5 text-xs text-status-warning">
                      {scenarioError}
                    </p>
                  )}
                </div>

                <div className="relative flex flex-1 overflow-hidden px-4">
                  <MapCanvas state={state} />

                  {/* Floating vehicle card over the map */}
                  <aside className="pointer-events-none absolute left-8 top-6 z-30 hidden w-[318px] lg:block">
                    <div className="pointer-events-auto overflow-hidden rounded-[22px] border border-command-border/80 bg-command-surface/95 shadow-[0_18px_50px_rgba(20,19,16,0.18)] backdrop-blur-xl">
                      <div className="flex items-center justify-between px-4 pb-3 pt-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                          Selected vehicle
                        </p>
                        <span className="rounded-full bg-command-raised px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-secondary">
                          Live
                        </span>
                      </div>
                      <div className="px-4 pb-4">
                        {state.vehicles[0] ? (
                          <VehicleDetails state={state} vehicleId={state.vehicles[0].id} />
                        ) : (
                          <p className="text-sm text-text-secondary">No vehicles on shift.</p>
                        )}
                      </div>
                      <div className="border-t border-command-border/70 px-4 py-3">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                          Needs attention
                        </p>
                        {openAlerts.length === 0 ? (
                          <p className="text-xs text-text-secondary">All clear.</p>
                        ) : (
                          <ul className="space-y-2 text-xs text-text-secondary">
                            {openAlerts.map((alert) => (
                              <li key={alert.id} className="flex items-start gap-2">
                                <StatusChip
                                  tone={alert.severity === "urgent" ? "danger" : "warning"}
                                  label={alert.severity === "urgent" ? "urgent" : "at risk"}
                                />
                                {alert.title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </aside>
                </div>

                {/* Parcel tray - drag onto pins, or click */}
                <div className="border-t border-command-border/80 bg-command-bg px-5 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-secondary">
                      Unassigned jobs - drag onto a driver or select
                    </p>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      {unassigned.length} parcels
                    </span>
                  </div>
                  <div className="pf-scroll flex gap-3 overflow-x-auto pb-2">
                    {unassigned.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onSelect={() => openAssignment(job.id)}
                      />
                    ))}
                    {unassigned.length === 0 && (
                      <p className="py-2 text-xs text-text-secondary">
                        Queue clear. Reset a scenario to seed new jobs.
                      </p>
                    )}
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

function VehicleDetails({ state, vehicleId }: { state: FleetState; vehicleId: string }) {
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
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-primary/15 text-[13px] font-bold text-brand-primary">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">
            {driver?.fullName ?? "Unassigned vehicle"}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-secondary">
            {vehicle.registration} {"\u00b7"} {vehicle.vehicleType}
          </p>
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









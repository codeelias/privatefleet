/**
 * Calm Command Center shell wired to the DEMO_MODE API (handoff section 9
 * steps 1-4): live fleet snapshot via React Query, telemetry via
 * Socket.IO, scenario reset, drag-and-drop assignment (map pins and
 * dispatch lanes) with keyboard/click fallbacks, and screen navigation.
 */
import { useEffect, useRef, useState } from "react";
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
import { KpiCard } from "../shared/ui/KpiCard";
import { Panel } from "../shared/ui/Panel";
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

const MANAGE_ITEMS: ReadonlyArray<string> = [
  "Drivers & Vehicles",
  "Reports",
  "Settings",
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

  const fleetQuery = useQuery({
    queryKey: ["fleet"],
    queryFn: api.fleetState,
    refetchInterval: 15_000,
    retry: 2,
  });
  const state = fleetQuery.data ?? EMPTY_STATE;

  useEffect(() => {
    const socket = createFleetSocket();
    socket.on("vehicle.position", (position: VehiclePosition) => {
      // Out-of-order or duplicate telemetry must never move a marker
      // backwards (docs/17): accept only samples newer than the last.
      const accepted = acceptTelemetry(telemetryTrackRef.current, position, Date.now());
      if (!accepted.accepted) {
        return;
      }
      telemetryTrackRef.current = accepted.track;
      queryClient.setQueryData<FleetState>(["fleet"], (old) => {
        if (!old) {
          return old;
        }
        return {
          ...old,
          vehicles: old.vehicles.map((vehicle) =>
            vehicle.id === position.vehicleId
              ? {
                  ...vehicle,
                  location: {
                    latitude: position.latitude,
                    longitude: position.longitude,
                  },
                  stale: false,
                }
              : vehicle,
          ),
        };
      });
    });
    socket.on("event", () => {
      void queryClient.invalidateQueries({ queryKey: ["fleet"] });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

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
        {/* Topbar */}
        <header className="flex items-center justify-between border-b border-command-border bg-command-surface px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-primary text-sm font-black text-command-bg">
              N
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                Fleet Operations
              </p>
              <p data-testid="tenant-name" className="text-sm font-bold">
                {tenantName ?? "Northstar"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-text-secondary sm:block">{todayLabel()}</span>
            <StatusChip tone="success" label="Live" pulse />
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-lg border border-command-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary"
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <nav className="flex w-56 shrink-0 flex-col border-r border-command-border bg-command-surface p-3">
            <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
              Workspace
            </p>
            <ul className="space-y-0.5">
              {WORKSPACE_ITEMS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setScreen(item.id)}
                    aria-current={screen === item.id ? "page" : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      screen === item.id
                        ? "bg-brand-primary/15 font-semibold text-brand-primary"
                        : "text-text-secondary hover:bg-command-raised hover:text-text-primary"
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-2 pb-2 pt-5 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
              Manage
            </p>
            <ul className="space-y-0.5">
              {MANAGE_ITEMS.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-command-raised hover:text-text-primary"
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Main column */}
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
                {/* KPI strip + demo scenarios */}
                <div className="flex flex-wrap items-center gap-3 border-b border-command-border px-5 py-3">
                  <KpiCard label="Active vehicles" value={String(activeVehicles)} sub={`${onRoute} on route`} />
                  <KpiCard label="Jobs in progress" value={String(inProgress)} sub={`${unassigned.length} unassigned`} />
                  <KpiCard label="Unassigned" value={String(unassigned.length)} sub={`${urgent} urgent`} tone={urgent > 0 ? "warning" : undefined} />
                  <KpiCard label="At-risk stops" value={String(atRisk)} sub="needs attention" tone={atRisk > 0 ? "danger" : undefined} />
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                      Demo scenario
                    </span>
                    {SCENARIOS.map((scenario) => (
                      <button
                        key={scenario.id}
                        type="button"
                        onClick={() => void resetScenario(scenario.id)}
                        disabled={scenarioBusy}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                          state.scenario === scenario.id
                            ? "border-brand-primary bg-brand-primary/15 text-brand-primary"
                            : "border-command-border text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {scenario.label}
                      </button>
                    ))}
                  </div>
                  {scenarioError && (
                    <p className="rounded-lg border border-status-warning/50 bg-status-warning/10 px-3 py-1.5 text-xs text-status-warning">
                      {scenarioError}
                    </p>
                  )}
                </div>

                <div className="flex flex-1 overflow-hidden">
                  <MapCanvas state={state} />

                  {/* Right drawer */}
                  <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-command-border p-3 lg:flex">
                    <Panel title="Selected vehicle">
                      {state.vehicles[0] ? (
                        <VehicleDetails state={state} vehicleId={state.vehicles[0].id} />
                      ) : (
                        <p className="text-sm text-text-secondary">No vehicles on shift.</p>
                      )}
                    </Panel>
                    <Panel title="Needs attention">
                      {openAlerts.length === 0 ? (
                        <p className="text-sm text-text-secondary">All clear.</p>
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
                    </Panel>
                  </aside>
                </div>

                {/* Bottom tray - unassigned jobs (drag onto pins, or click) */}
                <div className="border-t border-command-border bg-command-surface px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                      Unassigned jobs - drag onto a driver or select
                    </p>
                    {unassigned.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onSelect={() => openAssignment(job.id)}
                      />
                    ))}
                    {unassigned.length === 0 && (
                      <p className="text-xs text-text-secondary">
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
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{driver?.fullName ?? "Unassigned vehicle"}</span>
        <StatusChip
          tone={vehicle.stale ? "stale" : vehicle.status === "on_route" ? "success" : "neutral"}
          label={vehicle.stale ? "stale" : vehicle.status}
        />
      </div>
      <p className="text-text-secondary">
        {vehicle.registration} - {vehicle.vehicleType}
      </p>
      {currentJob ? (
        <p className="text-text-secondary">
          Current: {currentJob.reference} - {currentJob.serviceType}
        </p>
      ) : (
        <p className="text-text-secondary">No current job</p>
      )}
      {vehicle.location && (
        <p className="text-xs text-text-secondary">
          Position: {vehicle.location.latitude.toFixed(4)},{" "}
          {vehicle.location.longitude.toFixed(4)}
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


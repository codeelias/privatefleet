/**
 * Calm Command Center shell wired to the DEMO_MODE API (handoff section 9
 * steps 1-3): live fleet snapshot via React Query, telemetry via
 * Socket.IO, scenario reset, and the assignment flow.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FleetState,
  ScenarioName,
  VehiclePosition,
} from "@privatefleet/contracts";
import { AssignmentModal } from "../features/live-map/AssignmentModal";
import { MapCanvas } from "../features/live-map/MapCanvas";
import { api } from "../shared/api/client";
import { createFleetSocket } from "../shared/realtime/socket";
import { KpiCard } from "../shared/ui/KpiCard";
import { Panel } from "../shared/ui/Panel";
import { StatusChip } from "../shared/ui/StatusChip";

const WORKSPACE_ITEMS: ReadonlyArray<{ label: string; active?: boolean }> = [
  { label: "Live Operations", active: true },
  { label: "Dispatch Board" },
  { label: "Jobs & Work Orders" },
  { label: "Route Optimisation" },
  { label: "Exceptions & Alerts" },
  { label: "Customer Tracking" },
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

export function App() {
  const queryClient = useQueryClient();
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const fleetQuery = useQuery({
    queryKey: ["fleet"],
    queryFn: api.fleetState,
    refetchInterval: 15_000,
  });
  const state = fleetQuery.data ?? EMPTY_STATE;

  useEffect(() => {
    const socket = createFleetSocket();
    socket.on("vehicle.position", (position: VehiclePosition) => {
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

  async function resetScenario(id: ScenarioName) {
    setScenarioError(null);
    try {
      await api.resetScenario(id);
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : "Reset failed");
    }
  }

  const activeVehicles = state.vehicles.filter((v) => !v.stale).length;
  const onRoute = state.vehicles.filter((v) => v.status === "on_route").length;
  const inProgress = state.jobs.filter((j) => j.status !== "unassigned").length;
  const unassigned = state.jobs.filter((j) => j.status === "unassigned");
  const urgent = unassigned.filter((j) => j.priority === "stat" || j.priority === "urgent").length;
  const atRisk = state.alerts.length;

  return (
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
            <p className="text-sm font-bold">Northstar</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-text-secondary sm:block">{todayLabel()}</span>
          <StatusChip tone="success" label="Live" pulse />
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
              <li key={item.label}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    item.active
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
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    state.scenario === scenario.id
                      ? "border-brand-primary bg-brand-primary/15 text-brand-primary"
                      : "border-command-border text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
            {scenarioError && <p className="text-xs text-status-danger">{scenarioError}</p>}
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
                {state.alerts.length === 0 ? (
                  <p className="text-sm text-text-secondary">All clear.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-text-secondary">
                    {state.alerts.map((alert) => (
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

          {/* Bottom tray - unassigned jobs */}
          <div className="border-t border-command-border bg-command-surface px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                Unassigned jobs - select to assign
              </p>
              {unassigned.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setAssignJobId(job.id)}
                  className="flex items-center gap-2 rounded-lg border border-command-border bg-command-raised px-3 py-1.5 text-xs hover:border-brand-primary/60"
                >
                  <span className="font-bold">{job.reference}</span>
                  <StatusChip
                    tone={
                      job.priority === "stat" || job.priority === "urgent" ? "danger" : "neutral"
                    }
                    label={job.priority === "stat" ? "stat" : job.serviceType}
                  />
                  <span className="text-text-secondary">
                    {job.stops.find((s) => s.stopType === "pickup")?.address ?? ""}
                  </span>
                </button>
              ))}
              {unassigned.length === 0 && (
                <p className="text-xs text-text-secondary">
                  Queue clear. Reset a scenario to seed new jobs.
                </p>
              )}
            </div>
          </div>
        </main>
      </div>

      {assignJobId && (
        <AssignmentModal
          state={state}
          jobId={assignJobId}
          onClose={() => setAssignJobId(null)}
          onAssigned={() => {
            setAssignJobId(null);
            void queryClient.invalidateQueries({ queryKey: ["fleet"] });
          }}
        />
      )}
    </div>
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

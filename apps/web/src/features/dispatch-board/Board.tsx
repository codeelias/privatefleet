/**
 * Dispatch Board (screen 2, docs/05.3): Gantt lanes per driver over the
 * shift window, seeded job blocks, draggable unassigned cards with
 * drop-target highlighting. Drop opens the assignment modal with the
 * server-side impact preview - never frontend-only arithmetic.
 */
import { useDroppable } from "@dnd-kit/core";
import type { DriverDto, FleetState, JobDto } from "@privatefleet/contracts";
import { JobCard } from "../dispatch/JobCard";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;
const HOURS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

function minutesToPct(iso: string): number {
  const d = new Date(iso);
  const minutes = d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60;
  return Math.max(0, Math.min(100, (minutes / ((DAY_END_HOUR - DAY_START_HOUR) * 60)) * 100));
}

function blockTone(job: JobDto): string {
  if (job.priority === "stat") {
    return "border-status-danger/60 bg-status-danger/15 text-status-danger";
  }
  if (job.priority === "urgent") {
    return "border-status-warning/60 bg-status-warning/15 text-status-warning";
  }
  return "border-brand-primary/50 bg-brand-primary/10 text-text-primary";
}

function DriverLane({
  driver,
  state,
}: {
  driver: DriverDto;
  state: FleetState;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane-${driver.id}`,
    data: { driverId: driver.id },
  });
  const jobs = state.jobs.filter((j) => j.assignedDriverId === driver.id);
  return (
    <div
      ref={setNodeRef}
      className={`relative h-16 rounded-lg border transition-colors ${
        isOver
          ? "border-brand-primary bg-brand-primary/10"
          : "border-command-border bg-command-surface/60"
      }`}
    >
      {jobs.map((job) => {
        const pickup = job.stops.find((s) => s.stopType === "pickup");
        const windowStart = pickup?.windowStart;
        if (!windowStart) {
          return null;
        }
        const left = minutesToPct(windowStart);
        const width = job.priority === "stat" ? 6 : 9;
        return (
          <div
            key={job.id}
            className={`absolute top-2 bottom-2 flex flex-col justify-center overflow-hidden rounded-md border px-2 ${blockTone(
              job,
            )}`}
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`${job.reference} - ${job.serviceType} (${job.status})`}
          >
            <span className="truncate text-[11px] font-bold">
              {job.reference} {job.priority === "stat" ? "STAT" : ""}
            </span>
            <span className="truncate text-[10px] opacity-80">{job.serviceType}</span>
          </div>
        );
      })}
      {isOver && (
        <span className="absolute -top-5 left-2 text-[10px] font-semibold uppercase tracking-wider text-brand-primary">
          drop to preview impact
        </span>
      )}
    </div>
  );
}

export function DispatchBoard({ state }: { state: FleetState }) {
  const unassigned = state.jobs.filter((j) => j.status === "unassigned");
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Plan the day. Rebalance with confidence.</h1>
          <p className="text-sm text-text-secondary">
            Drop a job into a driver lane. Inspect the ETA impact before committing.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-secondary">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-status-danger" /> stat
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-status-warning" /> urgent
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-brand-primary" /> scheduled
          </span>
          <span className="ml-2">TUE 27 OCT - DAY SHIFT</span>
        </div>
      </div>

      {state.publishedPlan && (
        <div className="rounded-lg border border-status-success/40 bg-status-success/10 px-4 py-2 text-sm text-text-primary">
          Published plan: {state.publishedPlan.driverName} -{" "}
          {state.publishedPlan.proposal.stops.length} stops (-
          {state.publishedPlan.savedMinutes} min, -{state.publishedPlan.savedMiles} mi) -
          simulated result
        </div>
      )}

      <div className="grid grid-cols-[200px_1fr] gap-2">
        <div>
          <div className="h-6 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
            Driver / Vehicle
          </div>
          {state.drivers.map((driver) => {
            const vehicle = state.vehicles.find((v) => v.driverId === driver.id);
            return (
              <div key={driver.id} className="flex h-16 items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-command-raised text-[10px] font-bold">
                  {driver.fullName
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
                <div>
                  <p className="text-sm font-semibold">{driver.fullName}</p>
                  <p className="text-[10px] text-text-secondary">
                    {vehicle?.registration ?? "no vehicle"} - on shift
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div className="relative h-6 border-b border-command-border">
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute top-0 text-[10px] text-text-secondary"
                style={{ left: `${((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            {state.drivers.map((driver) => (
              <DriverLane key={driver.id} driver={driver} state={state} />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-command-border pt-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
          Unassigned - drag into a lane
        </p>
        <div className="flex flex-wrap gap-2">
          {unassigned.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
          {unassigned.length === 0 && (
            <p className="text-xs text-text-secondary">Queue clear.</p>
          )}
        </div>
      </div>
    </div>
  );
}

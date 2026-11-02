/**
 * Dispatch Board (screen 2, docs/05.3): a resource scheduler, not an admin
 * dashboard. The schedule is the primary surface; the unassigned queue stays
 * beside it, compact and continuously scannable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { DriverDto, FleetState, JobDto } from "@privatefleet/contracts";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;
const HOURS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, index) => DAY_START_HOUR + index,
);
const SHIFT_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

type PriorityFilter = "all" | "stat" | "urgent";

interface JobWindow {
  start: number | null;
  end: number | null;
}

interface LaneModel {
  jobs: JobDto[];
  conflicts: Set<string>;
  conflictCount: number;
}

function windowFor(job: JobDto): JobWindow {
  const pickup = job.stops.find((stop) => stop.stopType === "pickup");
  const dropoff = job.stops.find((stop) => stop.stopType === "dropoff");
  const start = pickup?.windowStart ?? dropoff?.windowStart;
  const end = pickup?.windowEnd ?? dropoff?.windowEnd;
  return {
    start: start ? new Date(start).getTime() : null,
    end: end ? new Date(end).getTime() : null,
  };
}

function minutesIntoShift(value: number): number {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() - DAY_START_HOUR * 60;
}

function pct(value: number): number {
  return Math.max(0, Math.min(100, (minutesIntoShift(value) / SHIFT_MINUTES) * 100));
}

function formatTime(value: number | null): string {
  if (value === null) return "Window TBC";
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function priorityTone(priority: JobDto["priority"]): string {
  if (priority === "stat") return "border-status-danger bg-status-danger/10 text-status-danger";
  if (priority === "urgent") return "border-status-warning bg-status-warning/10 text-status-warning";
  return "border-command-border bg-command-raised text-text-primary";
}

function priorityLabel(priority: JobDto["priority"]): string {
  return priority === "stat" ? "STAT" : priority === "urgent" ? "Urgent" : "Standard";
}

function typeLabel(value: string): string {
  return value.replaceAll("_", " ");
}

interface PlannedInterval {
  start: number;
  end: number | null;
}

/**
 * Conflict semantics use the published plan's arrival times, never the wide
 * customer service windows. Two overlapping customer windows are normal.
 */
function plannedIntervals(state: FleetState): Map<string, Map<string, PlannedInterval>> {
  const byDriver = new Map<string, Map<string, PlannedInterval>>();
  for (const route of state.routes) {
    if (!route.driverId) continue;
    const byJob = new Map<string, number[]>();
    for (const waypoint of route.waypoints ?? []) {
      if (!waypoint.jobId || !waypoint.plannedArrivalAt) continue;
      const at = new Date(waypoint.plannedArrivalAt).getTime();
      if (!Number.isFinite(at)) continue;
      const list = byJob.get(waypoint.jobId) ?? [];
      list.push(at);
      byJob.set(waypoint.jobId, list);
    }
    const planned = new Map<string, PlannedInterval>();
    for (const [jobId, times] of byJob) {
      const sorted = [...new Set(times)].sort((a, b) => a - b);
      if (sorted.length === 0) continue;
      planned.set(jobId, { start: sorted[0]!, end: sorted[1] ?? null });
    }
    byDriver.set(route.driverId, planned);
  }
  return byDriver;
}

function laneModel(
  jobs: JobDto[],
  planned: Map<string, PlannedInterval>,
  state: FleetState,
  driverId: string,
): LaneModel {
  const risks = new Set<string>();
  const stops = new Map(jobs.flatMap((job) => job.stops).map((stop) => [stop.id, stop]));
  for (const route of state.routes) {
    if (route.driverId !== driverId) continue;
    for (const waypoint of route.waypoints ?? []) {
      if (!waypoint.jobId || !waypoint.jobStopId || !waypoint.plannedArrivalAt) continue;
      const stop = stops.get(waypoint.jobStopId);
      if (!stop) continue;
      const arrival = new Date(waypoint.plannedArrivalAt).getTime();
      if (!Number.isFinite(arrival)) continue;
      const startAt = stop.windowStart ? new Date(stop.windowStart).getTime() : null;
      const endAt = stop.windowEnd ? new Date(stop.windowEnd).getTime() : null;
      if ((startAt !== null && arrival < startAt) || (endAt !== null && arrival > endAt)) {
        risks.add(waypoint.jobId);
      }
    }
  }
  return {
    jobs: [...jobs].sort((left, right) => {
      const leftStart = planned.get(left.id)?.start ?? windowFor(left).start ?? Number.MAX_SAFE_INTEGER;
      const rightStart = planned.get(right.id)?.start ?? windowFor(right).start ?? Number.MAX_SAFE_INTEGER;
      return leftStart - rightStart;
    }),
    conflicts: risks,
    conflictCount: risks.size,
  };
}

function QueueItem({ job, onSelect }: { job: JobDto; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { jobId: job.id },
  });
  const pickup = job.stops.find((stop) => stop.stopType === "pickup");
  const delivery = job.stops.find((stop) => stop.stopType === "dropoff");
  const window = windowFor(job);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      className={`group w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
        isDragging
          ? "border-brand-primary bg-brand-primary/10 opacity-60"
          : "border-command-border bg-command-surface hover:border-brand-primary/60 hover:bg-command-raised/40"
      }`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          {...listeners}
          {...attributes}
          aria-label={`Drag ${job.reference} to assign`}
          title="Drag to assign"
          className="cursor-grab touch-none select-none text-[11px] leading-none text-text-secondary active:cursor-grabbing"
        >
          ::
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold tracking-[-0.01em]">
          {job.reference}
        </span>
        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.08em] ${priorityTone(job.priority)}`}>
          {priorityLabel(job.priority)}
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-text-primary">
        {pickup?.address ?? "Pickup TBC"} <span aria-hidden="true">{"\u2192"}</span>{" "}
        {delivery?.address ?? "Drop-off TBC"}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-text-secondary">
        <span className="truncate">
          {formatTime(window.start)}
          {window.end !== null ? `-${formatTime(window.end)}` : ""} | {job.stops.length} stop{job.stops.length === 1 ? "" : "s"}
        </span>
        <span className="shrink-0 font-semibold uppercase tracking-[0.08em] text-brand-ink">
          {typeLabel(job.serviceType)}
        </span>
      </div>
    </button>
  );
}

function chipRows(
  jobs: JobDto[],
  planned: Map<string, PlannedInterval>,
): Map<string, number> {
  const rows: Array<Array<{ left: number; right: number }>> = [[], [], [], [], []];
  const assigned = new Map<string, number>();
  for (const job of jobs) {
    const startAt = planned.get(job.id)?.start ?? windowFor(job).start;
    if (startAt === null) continue;
    const left = pct(startAt);
    const right = left + 6.4;
    let row = rows.findIndex((used) =>
      used.every((span) => right <= span.left || left >= span.right),
    );
    if (row === -1) row = rows.length - 1;
    rows[row]!.push({ left, right });
    assigned.set(job.id, row);
  }
  return assigned;
}

function DriverLane({
  driver,
  jobs,
  model,
  planned,
  isToday,
}: {
  driver: DriverDto;
  jobs: JobDto[];
  model: LaneModel;
  planned: Map<string, PlannedInterval>;
  isToday: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane-${driver.id}`,
    data: { driverId: driver.id },
  });
  const rows = chipRows(model.jobs, planned);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow = isToday && nowMinutes >= DAY_START_HOUR * 60 && nowMinutes <= DAY_END_HOUR * 60;
  const nowPct = pct(now.getTime());
  return (
    <div
      ref={setNodeRef}
      className={`relative h-[172px] border-b border-command-border/70 transition-colors ${
        isOver ? "bg-brand-primary/10" : "bg-command-surface"
      }`}
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--color-command-border) 1px, transparent 1px)",
        backgroundSize: `${100 / (DAY_END_HOUR - DAY_START_HOUR)}% 100%`,
      }}
    >
      {showNow && (
        <span
          className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-status-danger/80"
          style={{ left: `${nowPct}%` }}
          title="Current time"
        />
      )}
      {model.conflictCount > 0 && (
        <span className="absolute right-2 top-1 z-20 flex items-center gap-1 rounded bg-status-danger/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-status-danger">
          {model.conflictCount} window risk{model.conflictCount === 1 ? "" : "s"}
        </span>
      )}
      {model.jobs.map((job) => {
        const plan = planned.get(job.id);
        const customer = windowFor(job);
        const startAt = plan?.start ?? customer.start;
        if (startAt === null) {
          return (
            <span
              key={job.id}
              title={`${job.reference} - window not scheduled`}
              className="absolute left-1 top-3 z-20 h-2.5 w-2.5 rounded-full border-2 border-command-surface bg-text-secondary"
            />
          );
        }
        const left = pct(startAt);
        const conflict = model.conflicts.has(job.id);
        return (
          <div key={job.id}>
            <div
              title={
                plan
                  ? `${job.reference} - pickup ${formatTime(plan.start)}${plan.end ? `, drop-off ${formatTime(plan.end)}` : ""}${conflict ? " - planned arrival outside customer window" : ""}`
                  : `${job.reference} - customer window ${formatTime(customer.start)}${customer.end ? `-${formatTime(customer.end)}` : ""}; no planned arrival`
              }
              className={`absolute z-20 flex h-[30px] w-[6.4%] min-w-[54px] flex-col justify-center overflow-hidden rounded-md border px-1 ${
                plan ? priorityTone(job.priority) : "border-dashed border-command-border bg-command-raised text-text-secondary"
              } ${conflict ? "ring-2 ring-status-danger ring-offset-1" : ""}`}
              style={{
                left: `${left}%`,
                top: `${6 + (rows.get(job.id) ?? 0) * 32}px`,
              }}
            >
              <span className="truncate text-[9px] font-bold leading-tight">
                {job.reference}
              </span>
              <span className="truncate text-[8px] leading-tight opacity-80">
                {formatTime(startAt)}
              </span>
              {conflict && (
                <span className="absolute right-0.5 top-0.5 text-[8px] font-black" aria-label="window risk">
                  !
                </span>
              )}
            </div>
          </div>
        );
      })}
      {isOver && (
        <span className="absolute inset-x-2 top-1/2 z-30 -translate-y-1/2 rounded border border-dashed border-brand-primary bg-command-surface/90 px-2 py-1 text-center text-[10px] font-semibold text-brand-ink">
          Drop to preview assignment
        </span>
      )}
      {jobs.length === 0 && !isOver && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary">
          No scheduled jobs
        </span>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="flex min-w-14 flex-col border-l border-command-border/70 pl-3">
      <span className={`text-[17px] font-semibold leading-none tabular-nums ${tone === "danger" && value > 0 ? "text-status-danger" : "text-text-primary"}`}>
        {value}
      </span>
      <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
        {label}
      </span>
    </div>
  );
}

export function DispatchBoard({
  state,
  onSelectJob,
}: {
  state: FleetState;
  onSelectJob?: (jobId: string) => void;
}) {
  const timelineRef = useRef<HTMLElement | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [query, setQuery] = useState("");

  const unassigned = useMemo(
    () => state.jobs.filter((job) => job.status === "unassigned"),
    [state.jobs],
  );
  const filteredQueue = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...unassigned]
      .filter((job) => priorityFilter === "all" || job.priority === priorityFilter)
      .filter((job) => {
        if (!normalized) return true;
        const text = [
          job.reference,
          job.serviceType,
          ...job.stops.map((stop) => stop.address),
        ].join(" ").toLowerCase();
        return text.includes(normalized);
      })
      .sort((left, right) => {
        const rank = { stat: 0, urgent: 1, standard: 2 };
        return rank[left.priority] - rank[right.priority];
      });
  }, [unassigned, priorityFilter, query]);

  const lanes = useMemo(
    () => state.drivers.map((driver) => ({
      driver,
      vehicle: state.vehicles.find((vehicle) => vehicle.driverId === driver.id),
      jobs: state.jobs.filter((job) =>
        job.assignedDriverId === driver.id &&
        job.status !== "completed" &&
        job.status !== "cancelled"),
    })),
    [state.drivers, state.vehicles, state.jobs],
  );
  const plannedByDriver = useMemo(() => plannedIntervals(state), [state]);
  const models = useMemo(
    () => new Map(lanes.map((lane) => [
      lane.driver.id,
      laneModel(
        lane.jobs,
        plannedByDriver.get(lane.driver.id) ?? new Map(),
        state,
        lane.driver.id,
      ),
    ])),
    [lanes, plannedByDriver, state],
  );
  const conflictCount = [...models.values()].reduce((sum, model) => sum + model.conflictCount, 0);
  useEffect(() => {
    const element = timelineRef.current;
    if (!element || element.dataset.autoScrolled === "1") return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const plan of plannedByDriver.values()) {
      for (const interval of plan.values()) earliest = Math.min(earliest, interval.start);
    }
    if (!Number.isFinite(earliest)) return;
    const columnWidth = window.innerWidth >= 1024 ? 210 : 150;
    const timelineWidth = element.scrollWidth - columnWidth;
    element.scrollLeft = Math.max(0, columnWidth + (pct(earliest) / 100) * timelineWidth - 90);
    element.dataset.autoScrolled = "1";
  }, [plannedByDriver]);
  const openAlerts = state.alerts.filter((alert) => !alert.acknowledged);
  const atRisk = openAlerts.filter((alert) => alert.severity !== "info").length;
  const onShift = state.drivers.filter((driver) => driver.status === "on_route" || driver.status === "available").length;
  const shiftDate = new Date(state.serverTime || Date.now()).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const isToday = new Date(state.serverTime || Date.now()).toDateString() === new Date().toDateString();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showNow = isToday && nowMinutes >= DAY_START_HOUR * 60 && nowMinutes <= DAY_END_HOUR * 60;
  const nowPct = pct(now.getTime());

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            Dispatch Board
          </h1>
          <p className="mt-1 text-[12px] text-text-secondary">
            {shiftDate} | Day shift | Greater London
          </p>
          <p className="mt-1 text-[10px] text-text-secondary">
            Planned pickup chips | window risk = arrival outside promised window
          </p>
        </div>
        <div className="flex items-end gap-1">
          <Metric label="Unassigned" value={unassigned.length} />
          <Metric label="On shift" value={onShift} />
          <Metric label="At risk" value={atRisk} tone="danger" />
          <Metric label="Window risks" value={conflictCount} tone="danger" />
        </div>
      </header>

      {state.publishedPlan && (
        <div className="shrink-0 rounded-lg border border-status-success/40 bg-status-success/10 px-3 py-1.5 text-[11px] text-text-primary">
          Published plan: {state.publishedPlan.driverName} |{" "}
          {state.publishedPlan.proposal.stops.length} stops |{" "}
          {state.publishedPlan.savedMinutes} min saved | simulated result
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <section ref={timelineRef} className="pf-scroll h-[340px] min-w-0 flex-none overflow-auto rounded-xl border border-command-border bg-command-surface lg:h-auto lg:flex-1">
          <div className="min-w-[860px]">
            <div className="sticky top-0 z-30 grid grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[210px_minmax(0,1fr)] border-b border-command-border bg-command-surface">
              <div className="sticky left-0 z-40 border-r border-command-border bg-command-surface px-2 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-text-secondary lg:px-3">
                Driver / vehicle
              </div>
              <div className="relative h-9">
                {HOURS.map((hour) => (
                  <span
                    key={hour}
                    className="absolute top-2 -translate-x-1/2 text-[9px] tabular-nums text-text-secondary"
                    style={{ left: `${((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
                {showNow && (
                  <span
                    className="absolute top-0 z-20 h-full w-px bg-status-danger/80"
                    style={{ left: `${nowPct}%` }}
                    title={`Current time ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
                  />
                )}
              </div>
            </div>

            {lanes.map(({ driver, jobs: laneJobs }) => {
              const model = models.get(driver.id)!;
              return (
                <div key={driver.id} className="grid grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[210px_minmax(0,1fr)]">
                  <div className="sticky left-0 z-30 flex items-center gap-2 border-b border-r border-command-border/70 bg-command-surface px-2 py-2 lg:px-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-command-raised text-[10px] font-bold">
                      {driver.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold">{driver.fullName}</p>
                      <p className="mt-0.5 truncate text-[9px] text-text-secondary">
                        {lanes.find((lane) => lane.driver.id === driver.id)?.vehicle?.registration ?? "No vehicle"} | {driver.status.replace("_", " ")}
                      </p>
                      <p className="mt-0.5 text-[9px] text-text-secondary">
                        {laneJobs.length} job{laneJobs.length === 1 ? "" : "s"} | {model.conflictCount} window risk{model.conflictCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <DriverLane
                    driver={driver}
                    jobs={laneJobs}
                    model={model}
                    planned={plannedByDriver.get(driver.id) ?? new Map()}
                    isToday={isToday}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <aside
          className={`flex min-h-[300px] flex-1 flex-col overflow-hidden rounded-xl border border-command-border bg-command-surface transition-[width] lg:min-h-0 lg:flex-none ${
            queueCollapsed ? "w-full lg:w-[58px]" : "w-full lg:w-[330px]"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-command-border px-3 py-2">
            {!queueCollapsed && (
              <div className="min-w-0">
                <p className="text-[12px] font-semibold">Job queue</p>
                <p className="text-[9px] text-text-secondary">{filteredQueue.length} of {unassigned.length} unassigned</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setQueueCollapsed((value) => !value)}
              aria-label={queueCollapsed ? "Expand job queue" : "Collapse job queue"}
              title={queueCollapsed ? "Expand queue" : "Collapse queue"}
              className="pf-icon-button ml-auto shrink-0"
            >
              <svg viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${queueCollapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="m4.5 2.5 3.5 3.5-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {!queueCollapsed && (
            <>
              <div className="shrink-0 space-y-2 border-b border-command-border px-3 py-2">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find job, address or reference"
                  aria-label="Search unassigned jobs"
                  className="h-8 w-full rounded-md border border-command-border bg-command-bg px-2 text-[11px] text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none"
                />
                <div className="flex gap-1">
                  {(["all", "stat", "urgent"] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setPriorityFilter(filter)}
                      aria-pressed={priorityFilter === filter}
                      className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${
                        priorityFilter === filter
                          ? "border-brand-primary bg-brand-primary/15 text-brand-ink"
                          : "border-command-border text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {filter === "all" ? "All" : filter}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pf-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                {filteredQueue.map((job) => (
                  <QueueItem
                    key={job.id}
                    job={job}
                    onSelect={() => onSelectJob?.(job.id)}
                  />
                ))}
                {filteredQueue.length === 0 && (
                  <p className="rounded-lg border border-dashed border-command-border px-3 py-6 text-center text-[11px] text-text-secondary">
                    {unassigned.length === 0 ? "Queue clear. Dispatch is current." : "No jobs match this filter."}
                  </p>
                )}
              </div>
            </>
          )}
          {queueCollapsed && (
            <button
              type="button"
              onClick={() => setQueueCollapsed(false)}
              className="flex min-h-0 flex-1 flex-col items-center gap-2 py-3 text-[9px] font-semibold uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary"
              aria-label="Expand job queue"
            >
              <span className="rounded-full bg-command-raised px-1.5 py-0.5 text-[10px] tabular-nums text-text-primary">
                {unassigned.length}
              </span>
              <span className="[writing-mode:vertical-rl]">Job queue</span>
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}









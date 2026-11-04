/**
 * Jobs & Work Orders, including CSV bulk ingestion. The preview is
 * server-authoritative: address/PostGIS validation, duplicate detection and
 * counts come from the API; commit sends only the validated preview payload.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DeliveryPerformanceReport,
  FleetState,
  JobDto,
  JobImportPreview,
  StopEvidenceDto,
} from "@privatefleet/contracts";
import { api } from "../../shared/api/client";
import { StatusChip } from "../../shared/ui/StatusChip";

const STATUS_FILTERS = ["unassigned", "assigned", "in_progress", "completed", "failed", "cancelled"];

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "warning";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "assigned") return "warning";
  return "neutral";
}

export function JobsScreen({
  state,
  onImported,
  onSelectJob,
}: {
  state: FleetState;
  onImported: () => void;
  onSelectJob?: (jobId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [report, setReport] = useState<DeliveryPerformanceReport | null>(null);
  const [reportFilter, setReportFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [driverFilter, setDriverFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"reference" | "schedule" | "priority" | "status" | "driver">("reference");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const jobs = useMemo(
    () => [...state.jobs].sort((a, b) => a.reference.localeCompare(b.reference)),
    [state.jobs],
  );
  const driverName = useMemo(
    () => new Map(state.drivers.map((driver) => [driver.id, driver.fullName])),
    [state.drivers],
  );
  const vehicleFor = (job: JobDto) =>
    state.vehicles.find((vehicle) => vehicle.id === job.assignedVehicleId);
  const scheduleFor = (job: JobDto) => {
    const pickup = job.stops.find((stop) => stop.stopType === "pickup");
    return {
      start: pickup?.windowStart ? new Date(pickup.windowStart).getTime() : null,
      end: pickup?.windowEnd ? new Date(pickup.windowEnd).getTime() : null,
    };
  };
  const scheduleLabel = (job: JobDto): string => {
    const window = scheduleFor(job);
    if (window.start === null) return "Not scheduled";
    const start = new Date(window.start).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    if (window.end === null) return start;
    const end = new Date(window.end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `${start}-${end}`;
  };
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
    return counts;
  }, [jobs]);
  const serviceTypes = useMemo(
    () => [...new Set(jobs.map((job) => job.serviceType))].sort(),
    [jobs],
  );
  const driversWithJobs = useMemo(
    () => state.drivers.filter((driver) => jobs.some((job) => job.assignedDriverId === driver.id)),
    [state.drivers, jobs],
  );

  const filteredJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rank = { standard: 0, urgent: 1, stat: 2 } as const;
    const filtered = jobs.filter((job) => {
      if (statusFilter !== "all" && job.status !== statusFilter) return false;
      if (priorityFilter !== "all" && job.priority !== priorityFilter) return false;
      if (driverFilter !== "all" && job.assignedDriverId !== driverFilter) return false;
      if (serviceFilter !== "all" && job.serviceType !== serviceFilter) return false;
      if (!normalized) return true;
      const driver = job.assignedDriverId ? driverName.get(job.assignedDriverId) ?? "" : "";
      const vehicle = vehicleFor(job);
      return [
        job.reference,
        job.serviceType,
        driver,
        vehicle?.registration ?? "",
        ...job.stops.map((stop) => stop.address),
      ].join(" ").toLowerCase().includes(normalized);
    });
    return filtered.sort((left, right) => {
      let a: string | number = "";
      let b: string | number = "";
      if (sortKey === "reference") [a, b] = [left.reference, right.reference];
      if (sortKey === "schedule") {
        a = scheduleFor(left).start ?? Number.MAX_SAFE_INTEGER;
        b = scheduleFor(right).start ?? Number.MAX_SAFE_INTEGER;
      }
      if (sortKey === "priority") [a, b] = [rank[left.priority], rank[right.priority]];
      if (sortKey === "status") [a, b] = [left.status, right.status];
      if (sortKey === "driver") {
        a = left.assignedDriverId ? driverName.get(left.assignedDriverId) ?? "" : "";
        b = right.assignedDriverId ? driverName.get(right.assignedDriverId) ?? "" : "";
      }
      const result = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b));
      return sortDirection === "asc" ? result : -result;
    });
  }, [jobs, query, statusFilter, priorityFilter, driverFilter, serviceFilter, sortKey, sortDirection, driverName, state.vehicles]);

  const selectedJob = selectedJobId ? jobs.find((job) => job.id === selectedJobId) ?? null : null;
  const filteredIds = filteredJobs.map((job) => job.id);
  const allVisibleSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  function toggleSort(key: typeof sortKey): void {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function toggleSelected(jobId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function exportSelected(): void {
    const chosen = jobs.filter((job) => selectedIds.has(job.id));
    const lines = [
      "reference,service,priority,status,driver,pickup,dropoff,schedule",
      ...chosen.map((job) => {
        const pickup = job.stops.find((stop) => stop.stopType === "pickup")?.address ?? "";
        const dropoff = job.stops.find((stop) => stop.stopType === "dropoff")?.address ?? "";
        return [
          job.reference,
          job.serviceType,
          job.priority,
          job.status,
          job.assignedDriverId ? driverName.get(job.assignedDriverId) ?? "" : "",
          pickup,
          dropoff,
          scheduleLabel(job),
        ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "privatefleet-jobs.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const clearFilters = (): void => {
    setQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setDriverFilter("all");
    setServiceFilter("all");
  };
  const filtersActive = query.length > 0 || statusFilter !== "all" || priorityFilter !== "all" || driverFilter !== "all" || serviceFilter !== "all";

  const header = (key: typeof sortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 font-semibold text-text-secondary hover:text-text-primary"
    >
      {label}
      <span aria-hidden="true" className={sortKey === key ? "text-brand-ink" : "text-command-border"}>
        {sortKey === key ? (sortDirection === "asc" ? "^" : "v") : "="}
      </span>
    </button>
  );

  async function loadReport(jobId?: string): Promise<void> {
    setReportBusy(true);
    setReportError(null);
    setReportFilter(jobId ?? null);
    try {
      const queryString = jobId ? `?jobId=${jobId}` : "";
      setReport(await api.deliveryPerformance(queryString));
    } catch (err) {
      setReport(null);
      setReportError(err instanceof Error ? err.message : "Report unavailable");
    } finally {
      setReportBusy(false);
    }
  }

  async function downloadReport(): Promise<void> {
    setReportBusy(true);
    try {
      const queryString = reportFilter ? `?jobId=${reportFilter}` : "";
      const csv = await api.deliveryPerformanceCsv(queryString);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "delivery-performance.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "CSV download failed");
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-command-border/70 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
              Dispatch workspace
            </p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-text-primary">
              Jobs &amp; work orders
            </h1>
            <p className="mt-1 text-[12px] text-text-secondary">
              {jobs.length} jobs | {jobs.reduce((sum, job) => sum + job.stops.length, 0)} stops | manage the record, not just the route
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setReportOpen(true);
                void loadReport();
              }}
              className="min-h-9 rounded-lg border border-command-border bg-command-surface px-3.5 text-[11px] font-bold text-text-primary hover:bg-command-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Delivery performance
            </button>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="min-h-9 rounded-lg border border-command-border bg-command-surface px-3.5 text-[11px] font-bold text-text-primary hover:bg-command-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Bulk import
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            aria-pressed={statusFilter === "all"}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusFilter === "all" ? "border-brand-primary bg-brand-primary/15 text-brand-ink" : "border-command-border text-text-secondary hover:text-text-primary"}`}
          >
            All jobs <span className="ml-1 tabular-nums">{jobs.length}</span>
          </button>
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              aria-pressed={statusFilter === status}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold capitalize ${statusFilter === status ? "border-brand-primary bg-brand-primary/15 text-brand-ink" : "border-command-border text-text-secondary hover:text-text-primary"}`}
            >
              {status.replace("_", " ")} <span className="ml-1 tabular-nums">{statusCounts.get(status) ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(240px,1.5fr)_repeat(4,minmax(110px,0.6fr))_auto]">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reference, address, driver or vehicle..."
            aria-label="Search jobs"
            className="h-9 rounded-lg border border-command-border bg-command-surface px-3 text-[12px] text-text-primary placeholder:text-text-secondary focus:border-brand-primary focus:outline-none"
          />
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} aria-label="Filter service type" className="h-9 rounded-lg border border-command-border bg-command-surface px-2 text-[11px] text-text-primary">
            <option value="all">All services</option>
            {serviceTypes.map((service) => <option key={service} value={service}>{service.replaceAll("_", " ")}</option>)}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Filter priority" className="h-9 rounded-lg border border-command-border bg-command-surface px-2 text-[11px] text-text-primary">
            <option value="all">All priorities</option>
            <option value="stat">STAT</option>
            <option value="urgent">Urgent</option>
            <option value="standard">Standard</option>
          </select>
          <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)} aria-label="Filter driver" className="h-9 rounded-lg border border-command-border bg-command-surface px-2 text-[11px] text-text-primary">
            <option value="all">All drivers</option>
            {driversWithJobs.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter status" className="h-9 rounded-lg border border-command-border bg-command-surface px-2 text-[11px] text-text-primary">
            <option value="all">All statuses</option>
            {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}
          </select>
          <button type="button" onClick={clearFilters} disabled={!filtersActive} className="min-h-9 rounded-lg px-2 text-[11px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-35">Clear</button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-primary/40 bg-brand-primary/10 px-3 py-2 text-[11px]">
            <span className="font-semibold text-brand-ink">{selectedIds.size} job{selectedIds.size === 1 ? "" : "s"} selected</span>
            <div className="flex gap-2">
              <button type="button" onClick={exportSelected} className="rounded-md border border-command-border bg-command-surface px-2 py-1 font-semibold text-text-primary">Export CSV</button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded-md px-2 py-1 font-semibold text-text-secondary">Clear selection</button>
            </div>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-command-border bg-command-surface p-6 text-sm text-text-secondary">
            No jobs yet. Use Bulk Import to ingest a CSV batch.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-command-border bg-command-surface">
            <div className="max-h-[calc(100vh-290px)] overflow-auto">
              <table className="w-full min-w-[1050px] border-collapse text-left text-[12px]">
                <thead className="sticky top-0 z-10 border-b border-command-border bg-command-surface text-[9px] uppercase tracking-[0.12em] text-text-secondary">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all visible jobs"
                        checked={allVisibleSelected}
                        onChange={() => setSelectedIds(allVisibleSelected ? new Set() : new Set(filteredIds))}
                      />
                    </th>
                    <th className="px-3 py-2.5">{header("reference", "Reference")}</th>
                    <th className="px-3 py-2.5">Service</th>
                    <th className="px-3 py-2.5">Route</th>
                    <th className="px-3 py-2.5">{header("schedule", "Schedule")}</th>
                    <th className="px-3 py-2.5">{header("priority", "Priority")}</th>
                    <th className="px-3 py-2.5">{header("status", "Status")}</th>
                    <th className="px-3 py-2.5">{header("driver", "Driver")}</th>
                    <th className="px-3 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => {
                    const pickup = job.stops.find((stop) => stop.stopType === "pickup");
                    const dropoff = [...job.stops].reverse().find((stop) => stop.stopType !== "pickup") ?? job.stops[job.stops.length - 1];
                    const intermediate = Math.max(0, job.stops.length - 2);
                    const driver = job.assignedDriverId ? state.drivers.find((candidate) => candidate.id === job.assignedDriverId) : undefined;
                    const vehicle = vehicleFor(job);
                    const selected = selectedIds.has(job.id);
                    return (
                      <tr
                        key={job.id}
                        tabIndex={0}
                        onClick={() => setSelectedJobId(job.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedJobId(job.id);
                          }
                        }}
                        className={`h-12 cursor-pointer border-b border-command-border/50 last:border-0 hover:bg-command-raised/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus ${selected ? "bg-brand-primary/5" : ""}`}
                      >
                        <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${job.reference}`} checked={selected} onChange={() => toggleSelected(job.id)} />
                        </td>
                        <td className="px-3 py-2 font-semibold text-text-primary">{job.reference}</td>
                        <td className="px-3 py-2 capitalize text-text-secondary">{job.serviceType.replaceAll("_", " ")}</td>
                        <td className="px-3 py-2">
                          <div className="min-w-[260px] space-y-0.5">
                            <div className="flex gap-2"><span className="w-12 shrink-0 text-[8px] font-bold uppercase tracking-[0.1em] text-text-secondary">Pickup</span><span className="truncate text-[11px]">{pickup?.address ?? "TBC"}</span></div>
                            <div className="flex gap-2"><span className="w-12 shrink-0 text-[8px] font-bold uppercase tracking-[0.1em] text-text-secondary">Drop-off</span><span className="truncate text-[11px]">{dropoff?.address ?? "TBC"}</span></div>
                            {intermediate > 0 && <div className="pl-14 text-[9px] text-text-secondary">+{intermediate} intermediate stop{intermediate === 1 ? "" : "s"}</div>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-secondary">{scheduleLabel(job)}</td>
                        <td className="px-3 py-2"><PriorityChip priority={job.priority} /></td>
                        <td className="px-3 py-2"><StatusChip tone={statusTone(job.status)} label={job.status.replace("_", " ")} /></td>
                        <td className="px-3 py-2">
                          <div className="text-[11px]">{driver?.fullName ?? "Unassigned"}</div>
                          <div className="text-[9px] text-text-secondary">{vehicle?.registration ?? "-"}</div>
                        </td>
                        <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setSelectedJobId(job.id)}
                            className="rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-text-primary hover:bg-command-raised"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredJobs.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-text-secondary">No jobs match the current search and filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {reportOpen && (
        <PerformanceModal
          busy={reportBusy}
          error={reportError}
          report={report}
          filtered={reportFilter !== null}
          onClose={() => setReportOpen(false)}
          onDownload={() => void downloadReport()}
        />
      )}

      {open && (
        <BulkImportModal
          onClose={() => setOpen(false)}
          onImported={() => {
            onImported();
          }}
        />
      )}

      {selectedJob && (
        <JobDetailDrawer
          job={selectedJob}
          state={state}
          onClose={() => setSelectedJobId(null)}
          {...(onSelectJob ? { onAssign: onSelectJob } : {})}
        />
      )}
    </div>
  );
}

function PriorityChip({ priority }: { priority: JobDto["priority"] }) {
  const tone = priority === "stat"
    ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
    : priority === "urgent"
      ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
      : "border-command-border bg-command-raised text-text-secondary";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${tone}`}>{priority === "stat" ? "STAT" : priority}</span>;
}

function JobDetailDrawer({
  job,
  state,
  onClose,
  onAssign,
}: {
  job: JobDto;
  state: FleetState;
  onClose: () => void;
  onAssign?: (jobId: string) => void;
}) {
  const [evidence, setEvidence] = useState<StopEvidenceDto[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const driver = state.drivers.find((candidate) => candidate.id === job.assignedDriverId);
  const vehicle = state.vehicles.find((candidate) => candidate.id === job.assignedVehicleId);
  const route = state.routes.find((candidate) => candidate.driverId === job.assignedDriverId);
  const plannedByStop = new Map(
    (route?.waypoints ?? [])
      .filter((waypoint) => waypoint.jobStopId && waypoint.plannedArrivalAt)
      .map((waypoint) => [waypoint.jobStopId!, new Date(waypoint.plannedArrivalAt!).getTime()]),
  );
  const proofStops = job.stops.filter((stop) => stop.status === "completed" || stop.status === "arrived");

  useEffect(() => {
    let cancelled = false;
    setEvidence([]);
    setEvidenceError(null);
    if (proofStops.length === 0) return;
    setEvidenceBusy(true);
    void Promise.all(proofStops.map((stop) => api.stopEvidence(job.id, stop.id).catch(() => ({ evidence: [] }))))
      .then((lists) => {
        if (cancelled) return;
        setEvidence(lists.flatMap((entry) => entry.evidence));
      })
      .catch((error) => { if (!cancelled) setEvidenceError(error instanceof Error ? error.message : "Proof unavailable"); })
      .finally(() => { if (!cancelled) setEvidenceBusy(false); });
    return () => { cancelled = true; };
  }, [job.id, proofStops.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const stamp = (value?: string) => value ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not recorded";
  const events = job.stops.flatMap((stop) => {
    const entries: Array<{ at: string; label: string }> = [];
    if (stop.arrivedAt) entries.push({ at: stop.arrivedAt, label: `Arrived at ${stop.address}` });
    if (stop.completedAt) entries.push({ at: stop.completedAt, label: `${stop.stopType === "pickup" ? "Collected" : "Delivered"} at ${stop.address}` });
    const failureAt = stop.arrivedAt ?? stop.completedAt;
    if (stop.failureCode && failureAt) entries.push({ at: failureAt, label: `Failed: ${stop.failureCode.replaceAll("_", " ")}` });
    return entries;
  }).sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={`Job ${job.reference} details`} className="flex h-full w-full max-w-[460px] flex-col overflow-hidden border-l border-command-border bg-command-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-command-border px-4 py-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">Job detail</p>
            <h2 className="mt-0.5 text-[18px] font-bold">{job.reference}</h2>
            <p className="mt-0.5 text-[11px] capitalize text-text-secondary">{job.serviceType.replaceAll("_", " ")} | {job.stops.length} stops</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close job detail" className="pf-icon-button">Close</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <section className="rounded-lg border border-command-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <PriorityChip priority={job.priority} />
              <StatusChip tone={statusTone(job.status)} label={job.status.replace("_", " ")} />
              <span className="text-[10px] text-text-secondary">Job version {job.version}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              <div><dt className="text-text-secondary">Driver</dt><dd className="mt-0.5 font-semibold">{driver?.fullName ?? "Unassigned"}</dd></div>
              <div><dt className="text-text-secondary">Vehicle</dt><dd className="mt-0.5 font-semibold">{vehicle?.registration ?? "-"}</dd></div>
              <div><dt className="text-text-secondary">Route</dt><dd className="mt-0.5 font-semibold">{route ? `v${route.version}` : "Not published"}</dd></div>
              <div><dt className="text-text-secondary">Assignment</dt><dd className="mt-0.5 font-semibold">{job.assignedDriverId ? "Assigned" : "Unassigned"}</dd></div>
            </dl>
            {onAssign && (
              <button type="button" onClick={() => onAssign(job.id)} className="mt-3 min-h-8 w-full rounded-md border border-command-border px-2 text-[11px] font-semibold text-text-primary hover:bg-command-raised">
                {job.assignedDriverId ? "Reassign job" : "Assign job"}
              </button>
            )}
          </section>

          <section className="mt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-secondary">Journey</h3>
            <ol className="mt-2 space-y-2">
              {[...job.stops].sort((left, right) => left.sequenceNo - right.sequenceNo).map((stop) => {
                const planned = plannedByStop.get(stop.id);
                return (
                  <li key={stop.id} className="rounded-lg border border-command-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-secondary">{stop.stopType}</span>
                      <StatusChip tone={statusTone(stop.status)} label={stop.status.replace("_", " ")} />
                    </div>
                    <p className="mt-1 text-[12px] font-medium">{stop.address}</p>
                    <p className="mt-1 text-[10px] text-text-secondary">
                      Window: {stop.windowStart ? `${stamp(stop.windowStart)}-${stamp(stop.windowEnd)}` : "Not recorded"}
                      {planned ? ` --------- Planned ${new Date(planned).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
                    </p>
                    {stop.failureCode && <p className="mt-1 text-[10px] font-semibold text-status-danger">{stop.failureCode.replaceAll("_", " ")}</p>}
                    {stop.deliveryConfidence && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${stop.deliveryConfidence.score >= 70 ? "bg-[#14532D]/30 text-[#86EFAC]" : stop.deliveryConfidence.score >= 40 ? "bg-[#713F12]/30 text-[#FCD34D]" : "bg-[#7F1D1D]/30 text-[#FCA5A5]"}`}>
                          Confidence {stop.deliveryConfidence.score}
                        </span>
                        <span className="truncate text-[9px] text-text-secondary">
                          {stop.deliveryConfidence.factors.join(", ").replaceAll("_", " ")}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="mt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-secondary">Execution history</h3>
            {events.length === 0 ? <p className="mt-2 text-[11px] text-text-secondary">No execution timestamps recorded.</p> : (
              <ol className="mt-2 space-y-2 border-l border-command-border pl-3">
                {events.map((event, index) => (
                  <li key={`${event.at}-${index}`} className="relative text-[11px]">
                    <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-brand-primary" />
                    <p className="font-medium">{event.label}</p>
                    <p className="text-[9px] text-text-secondary">{stamp(event.at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="mt-4 pb-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-secondary">Proof and evidence</h3>
            {evidenceBusy && <p className="mt-2 text-[11px] text-text-secondary">Loading recorded proof...</p>}
            {evidenceError && <p className="mt-2 text-[11px] text-status-danger">{evidenceError}</p>}
            {!evidenceBusy && evidence.length === 0 && <p className="mt-2 text-[11px] text-text-secondary">No evidence recorded for this job.</p>}
            <ul className="mt-2 space-y-2">
              {evidence.map((item) => (
                <li key={item.id} className="rounded-lg border border-command-border px-3 py-2 text-[10px]">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold capitalize">{item.kind}</span>
                    <span className="text-text-secondary">{stamp(item.capturedAt)}</span>
                  </div>
                  <p className="mt-1 truncate text-text-secondary">SHA-256 {item.contentHash.slice(0, 16)}--------------- --------- {item.byteSize} bytes</p>
                  {item.dataBase64 && item.mimeType.startsWith("image/") && (
                    <img src={`data:${item.mimeType};base64,${item.dataBase64}`} alt={`${item.kind} proof`} className="mt-2 max-h-32 rounded border border-command-border object-contain" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}

function PerformanceModal({
  busy,
  error,
  report,
  filtered,
  onClose,
  onDownload,
}: {
  busy: boolean;
  error: string | null;
  report: DeliveryPerformanceReport | null;
  filtered: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="performance-title"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-command-border bg-command-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-command-border/70 px-5 py-4">
          <div>
            <h2 id="performance-title" className="text-base font-bold text-text-primary">
              Delivery performance report
            </h2>
            <p className="mt-1 text-xs text-text-secondary">
              Planned versus recorded arrival. Missing timestamps or windows are shown as
              Unavailable and are never counted as on-time.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close delivery performance"
            className="min-h-8 rounded-md border border-command-border px-2 text-xs text-text-secondary"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {busy && <p className="text-xs text-text-secondary">Loading report...</p>}
          {error && (
            <p role="alert" className="rounded-lg bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {error}
            </p>
          )}
          {report && (
            <div className="overflow-x-auto rounded-xl border border-command-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-command-border/70 text-[10px] uppercase tracking-[0.12em] text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Job</th>
                    <th className="px-3 py-2 font-semibold">Address</th>
                    <th className="px-3 py-2 font-semibold">Stop status</th>
                    <th className="px-3 py-2 font-semibold">Planned arrival</th>
                    <th className="px-3 py-2 font-semibold">Arrived</th>
                    <th className="px-3 py-2 font-semibold">Delta</th>
                    <th className="px-3 py-2 font-semibold">On time</th>
                    <th className="px-3 py-2 font-semibold">Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.stopId} className="border-b border-command-border/50 last:border-0">
                      <td className="px-3 py-2 font-semibold text-text-primary">{row.jobReference}</td>
                      <td className="px-3 py-2 text-text-secondary">{row.address}</td>
                      <td className="px-3 py-2 text-text-secondary">{row.stopStatus}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {row.plannedArrivalAt
                          ? new Date(row.plannedArrivalAt).toLocaleTimeString("en-GB")
                          : "Unavailable"}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {row.arrivedAt
                          ? new Date(row.arrivedAt).toLocaleTimeString("en-GB")
                          : "Unavailable"}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">
                        {row.arrivalDeltaS !== undefined ? `${row.arrivalDeltaS} s` : "Unavailable"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusChip
                          tone={
                            row.onTime === "on_time"
                              ? "success"
                              : row.onTime === "unavailable"
                                ? "neutral"
                                : "danger"
                          }
                          label={row.onTime === "unavailable" ? "Unavailable" : row.onTime.replace("_", " ")}
                        />
                      </td>
                      <td className="px-3 py-2 text-status-danger">{row.failureCode ?? "-"}</td>
                    </tr>
                  ))}
                  {report.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-text-secondary">
                        No published route stops match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-command-border/70 px-5 py-3">
          <p className="text-[11px] text-text-secondary">
            {filtered ? "Filtered to one job." : "All published route stops."} Whole-route planned
            distance is context only and is not compared with stop-level GPS distance.
          </p>
          <button
            type="button"
            onClick={onDownload}
            disabled={!report || busy}
            className="min-h-9 rounded-lg bg-brand-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Download CSV
          </button>
        </footer>
      </div>
    </div>
  );
}

function BulkImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<JobImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ count: number; references: string[] } | null>(
    null,
  );

  async function loadFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    setImported(null);
    setFileName(file.name);
    try {
      const csv = await file.text();
      setPreview(await api.importPreview(csv));
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV could not be read.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (!preview?.canCommit || preview.jobs.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importCommit(preview.jobs);
      setImported({ count: result.imported, references: result.references });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  const issueCount = preview ? preview.invalid + preview.duplicates : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-import-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-command-border bg-command-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-command-border/70 px-5 py-4">
          <div>
            <h2 id="bulk-import-title" className="text-base font-bold text-text-primary">
              Bulk import jobs
            </h2>
            <p className="mt-1 text-xs text-text-secondary">
              CSV rows sharing a job_ref become one job. Addresses are checked against the
              tenant service area with PostGIS.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk import"
            className="min-h-8 rounded-md border border-command-border px-2 text-xs text-text-secondary"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file) void loadFile(file);
            }}
            className="rounded-xl border border-dashed border-command-border bg-command-bg/50 px-4 py-5 text-center"
          >
            <p className="text-sm font-semibold text-text-primary">
              Drag and drop a CSV here
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Required columns: job_ref, address, latitude, longitude. Optional: service_type,
              priority, stop_type, window_start, window_end.
            </p>
            <input
              ref={inputRef}
              aria-label="CSV file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-3 min-h-8 rounded-lg border border-command-border bg-command-surface px-3 text-xs font-semibold text-text-primary"
            >
              Choose CSV file
            </button>
            {fileName && <p className="mt-2 text-[11px] text-text-secondary">{fileName}</p>}
            <p className="mt-3 text-[10px] leading-relaxed text-text-secondary">
              Validation checks coordinates against the operating region. Ensure your CSV
              includes accurate Latitude and Longitude columns.
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {error}
            </p>
          )}
          {busy && <p className="mt-3 text-xs text-text-secondary">Validating...</p>}

          {preview && (
            <>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-status-success/15 px-2.5 py-1 font-semibold text-status-success">
                  {preview.valid} valid
                </span>
                <span className="rounded-full bg-status-danger/15 px-2.5 py-1 font-semibold text-status-danger">
                  {preview.invalid} invalid
                </span>
                <span className="rounded-full bg-status-warning/15 px-2.5 py-1 font-semibold text-status-warning">
                  {preview.duplicates} duplicates
                </span>
              </div>

              <div className="mt-3 overflow-x-auto rounded-xl border border-command-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-command-border/70 text-[10px] uppercase tracking-[0.12em] text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Row</th>
                      <th className="px-3 py-2 font-semibold">Job ref</th>
                      <th className="px-3 py-2 font-semibold">Stops</th>
                      <th className="px-3 py-2 font-semibold">Address</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row) => (
                      <tr
                        key={row.jobRef}
                        className={
                          row.status === "valid"
                            ? "border-b border-command-border/50 last:border-0"
                            : "border-b border-command-border/50 bg-status-danger/5 last:border-0"
                        }
                      >
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{row.row}</td>
                        <td className="px-3 py-2 font-semibold text-text-primary">{row.jobRef}</td>
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{row.stopCount}</td>
                        <td className="px-3 py-2 text-text-secondary">{row.address}</td>
                        <td className="px-3 py-2">
                          <StatusChip
                            tone={
                              row.status === "valid"
                                ? "success"
                                : row.status === "duplicate"
                                  ? "warning"
                                  : "danger"
                            }
                            label={row.status}
                          />
                        </td>
                        <td className="px-3 py-2 text-status-danger">{row.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {issueCount > 0 && (
                <p className="mt-3 text-xs text-status-danger">
                  Fix the highlighted rows and upload the corrected CSV. Commit is disabled
                  until every row is valid and unique.
                </p>
              )}
            </>
          )}

          {imported && (
            <div role="status" className="mt-4 rounded-lg bg-status-success/10 px-3 py-2 text-xs text-status-success">
              {imported.count} jobs imported: {imported.references.join(", ")}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-command-border/70 px-5 py-3">
          <p className="text-[11px] text-text-secondary">
            The commit is one database transaction; any insert failure rolls back the batch.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-9 rounded-lg border border-command-border px-3 text-xs font-semibold text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={!preview?.canCommit || busy || Boolean(imported)}
              className="min-h-9 rounded-lg bg-brand-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? "Working..."
                : preview
                  ? `Commit ${preview.valid} Jobs`
                  : "Commit Jobs"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}









/**
 * Calm Command Center shell (handoff section 9, step 1): brand rail,
 * workspace navigation, topbar with live clock, KPI strip, main canvas,
 * vehicle drawer and unassigned-job tray placeholders.
 * Static slice - screens and live data arrive in the following slices.
 */
import { Panel } from "../shared/ui/Panel";
import { KpiCard } from "../shared/ui/KpiCard";
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

const UNASSIGNED_JOBS = [
  { ref: "J-208", kind: "STAT", area: "Farringdon", tone: "danger" },
  { ref: "J-214", kind: "Pickup", area: "Camden", tone: "neutral" },
  { ref: "J-221", kind: "Collection", area: "London Bridge", tone: "neutral" },
] as const;

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

export function App() {
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
          <span className="hidden text-sm text-text-secondary sm:block">
            {todayLabel()}
          </span>
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
          {/* KPI strip */}
          <div className="flex flex-wrap gap-3 border-b border-command-border px-5 py-3">
            <KpiCard label="Active vehicles" value="12" sub="3 on route" />
            <KpiCard label="Jobs in progress" value="28" sub="6 due in 30 min" />
            <KpiCard label="Unassigned" value="4" sub="1 urgent" tone="warning" />
            <KpiCard label="At-risk stops" value="3" sub="2 need action" tone="danger" />
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Map canvas placeholder (Live Operations) */}
            <section className="relative flex-1 bg-command-bg">
              <div className="absolute inset-4 flex items-center justify-center rounded-2xl border border-dashed border-command-border bg-command-surface/40">
                <div className="text-center">
                  <p className="text-sm font-semibold text-text-secondary">
                    Live map canvas
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    MapLibre layers arrive with the Live Operations slice.
                    Grey ghost pins show last known position - never imply a
                    fresh GPS fix.
                  </p>
                </div>
              </div>
            </section>

            {/* Right drawer */}
            <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-command-border p-3 lg:flex">
              <Panel title="Selected vehicle">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Alex Brooks</span>
                    <StatusChip tone="warning" label="At risk" />
                  </div>
                  <p className="text-text-secondary">VAN-04 - En route</p>
                  <p className="text-text-secondary">Current: J-198 - Urgent pickup</p>
                  <p className="text-text-secondary">
                    Next stop: St Thomas' Hospital - ETA 14:42 (+8 min)
                  </p>
                  <p className="text-xs text-text-secondary">
                    Last GPS fix - 12 seconds ago
                  </p>
                </div>
              </Panel>
              <Panel title="Needs attention">
                <ul className="space-y-2 text-xs text-text-secondary">
                  <li>J-198 likely to arrive 8 minutes late</li>
                  <li>Driver stationary at pickup for 6 minutes</li>
                </ul>
              </Panel>
            </aside>
          </div>

          {/* Bottom tray - unassigned jobs */}
          <div className="border-t border-command-border bg-command-surface px-5 py-3">
            <div className="flex items-center gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                Unassigned jobs - drag to assign
              </p>
              <div className="flex gap-2">
                {UNASSIGNED_JOBS.map((job) => (
                  <div
                    key={job.ref}
                    className="flex items-center gap-2 rounded-lg border border-command-border bg-command-raised px-3 py-1.5 text-xs"
                  >
                    <span className="font-bold">{job.ref}</span>
                    <StatusChip
                      tone={job.tone === "danger" ? "danger" : "neutral"}
                      label={job.kind}
                    />
                    <span className="text-text-secondary">{job.area}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

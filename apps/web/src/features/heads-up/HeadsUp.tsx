/**
 * Heads-Up: proactive operational intelligence above the live map. It is a
 * compact strip by default and a non-modal ranked panel when opened. Actions
 * reuse the existing assignment and follow flows.
 */
import { useEffect, useMemo, useState } from "react";
import type { FleetState } from "@privatefleet/contracts";
import { StatusChip } from "../../shared/ui/StatusChip";
import { buildHeadsUp, type HeadsUpItem } from "./engine/heads-up";

function toneFor(item: HeadsUpItem): "danger" | "warning" | "neutral" {
  return item.severity === "critical" ? "danger" : item.severity === "warning" ? "warning" : "neutral";
}

export function HeadsUp({
  state,
  onOpenJob,
  onFocusDriver,
  onOpenAlerts,
}: {
  state: FleetState;
  onOpenJob: (jobId: string) => void;
  onFocusDriver: (driverId: string) => void;
  onOpenAlerts: () => void;
}) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => buildHeadsUp(state), [state]);
  const { summary } = result;
  const top = result.items[0];
  const visibleItems = result.items.slice(0, 8);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const summaryLabel =
    summary.total === 0
      ? "No predicted exceptions"
      : [
          summary.critical > 0 ? `${summary.critical} critical` : null,
          summary.late > 0 ? `${summary.late} projected late` : null,
          summary.stale > 0 ? `${summary.stale} stale GPS` : null,
          summary.unassigned > 0 ? `${summary.unassigned} window risk${summary.unassigned === 1 ? "" : "s"}` : null,
          summary.offRoute > 0 ? `${summary.offRoute} route issue` : null,
        ].filter(Boolean).join(" | ");

  return (
    <div className="relative mt-2" data-testid="heads-up">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="heads-up-panel"
        className="flex min-h-10 w-full items-center gap-3 rounded-lg border border-command-border bg-command-surface px-3 text-left transition-colors hover:border-brand-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${summary.critical > 0 ? "bg-status-danger text-white" : summary.total > 0 ? "bg-status-warning/20 text-status-warning" : "bg-status-success/15 text-status-success"}`}
        >
          !
        </span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-text-secondary">
          Heads up
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
          {top && summary.total > 0 ? `${summaryLabel} · ${top.title}` : "Routes, windows and tracking are aligned"}
        </span>
        {summary.total > 0 && (
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            {summary.critical > 0 && <StatusChip tone="danger" label={`${summary.critical} critical`} />}
            {summary.warning > 0 && <StatusChip tone="warning" label={`${summary.warning} warning`} />}
          </span>
        )}
        <span className="shrink-0 text-[10px] font-semibold text-brand-ink">
          {open ? "Close" : summary.total > 0 ? "Review" : "Details"}
        </span>
      </button>

      {open && (
        <div
          id="heads-up-panel"
          role="region"
          aria-label="Predicted operational exceptions"
          className="absolute left-0 top-full z-50 mt-1 max-h-[min(62vh,520px)] w-[440px] max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-xl border border-command-border bg-command-surface p-3 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                Predicted exceptions
              </p>
              <p className="mt-0.5 text-[11px] text-text-secondary">
                From live route progress and windows. Not a traffic forecast.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAlerts}
              className="shrink-0 rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-text-primary hover:bg-command-raised"
            >
              Open exceptions
            </button>
          </div>

          {result.items.length === 0 ? (
            <p className="mt-3 rounded-lg border border-status-success/30 bg-status-success/10 px-3 py-2 text-[11px] text-status-success">
              No predicted exceptions right now. Use exceptions and alerts for confirmed operational events.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {visibleItems.map((item) => (
                <li key={item.id} className="rounded-lg border border-command-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-semibold leading-snug text-text-primary">{item.title}</p>
                    <StatusChip tone={toneFor(item)} label={item.severity} />
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{item.detail}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-primary">{item.recommendation}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.jobId && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onOpenJob(item.jobId!);
                        }}
                        className="rounded-md bg-brand-primary px-2 py-1 text-[10px] font-bold text-on-brand"
                      >
                        Open assignment
                      </button>
                    )}
                    {item.driverId && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onFocusDriver(item.driverId!);
                        }}
                        className="rounded-md border border-command-border px-2 py-1 text-[10px] font-semibold text-text-primary"
                      >
                        Follow vehicle
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.items.length > visibleItems.length && (
            <button
              type="button"
              onClick={onOpenAlerts}
              className="mt-2 w-full rounded-md border border-command-border px-2 py-1.5 text-[10px] font-semibold text-text-primary hover:bg-command-raised"
            >
              +{result.items.length - visibleItems.length} more predicted issues - open exceptions
            </button>
          )}
        </div>
      )}
    </div>
  );
}

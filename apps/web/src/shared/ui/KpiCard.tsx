import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "danger" | "warning";
}) {
  const valueClass =
    tone === "danger"
      ? "text-status-danger"
      : tone === "warning"
        ? "text-status-warning"
        : "text-text-primary";
  return (
    <div className="flex min-w-[180px] flex-col gap-0.5 rounded-xl border border-command-border bg-command-surface px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
        {label}
      </span>
      <span className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</span>
      <span className="text-xs text-text-secondary">{sub}</span>
    </div>
  );
}

export type { ReactNode };

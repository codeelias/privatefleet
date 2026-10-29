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
  tone?: "default" | "danger" | "warning" | undefined;
}) {
  const valueClass =
    tone === "danger"
      ? "text-status-danger"
      : tone === "warning"
        ? "text-status-warning"
        : "text-text-primary";
  return (
    <div className="flex min-w-[170px] flex-1 flex-col gap-0.5 rounded-2xl border border-command-border/80 bg-command-surface px-4 py-3 shadow-[0_1px_0_rgba(25,24,21,0.03)]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
        {label}
      </span>
      <span className={`text-[26px] font-semibold leading-tight tabular-nums ${valueClass}`}>
        {value}
      </span>
      <span className="text-[11px] text-text-secondary">{sub}</span>
    </div>
  );
}

export type { ReactNode };

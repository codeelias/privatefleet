/** Status chip: colour is never the only signal (handoff section 8). */
export type ChipTone = "success" | "warning" | "danger" | "neutral" | "stale";

const TONE_CLASSES: Record<ChipTone, string> = {
  success: "bg-status-success/15 text-status-success border-status-success/40",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/40",
  danger: "bg-status-danger/15 text-status-danger border-status-danger/40",
  neutral: "bg-command-raised text-text-secondary border-command-border",
  stale: "bg-command-raised text-text-secondary border-command-border stale-ghost",
};

const TONE_DOT: Record<ChipTone, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  neutral: "bg-text-secondary",
  stale: "bg-text-secondary",
};

export function StatusChip({
  tone,
  label,
  pulse = false,
}: {
  tone: ChipTone;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulse ? "animate-pulse" : ""}`}
      />
      {label}
    </span>
  );
}

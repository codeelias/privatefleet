/** Status chip: colour is never the only signal (handoff section 8). */
export type ChipTone = "success" | "warning" | "danger" | "neutral" | "stale";

const TONE_CLASSES: Record<ChipTone, string> = {
  success: "bg-status-success/10 text-status-success border-status-success/25",
  warning: "bg-status-warning/10 text-status-warning border-status-warning/25",
  danger: "bg-status-danger/10 text-status-danger border-status-danger/25",
  neutral: "bg-command-raised/70 text-text-secondary border-command-border",
  stale: "bg-command-raised/70 text-text-secondary border-command-border stale-ghost",
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${TONE_CLASSES[tone]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulse ? "animate-pulse" : ""}`}
      />
      {label}
    </span>
  );
}

/**
 * Draggable parcel card (dnd-kit): the grip is the only drag activator, so
 * the card's click opens the assignment flow without interference.
 * Keyboard/click fallback per handoff section 8.
 */
import { useDraggable } from "@dnd-kit/core";
import type { JobDto } from "@privatefleet/contracts";
import { StatusChip } from "../../shared/ui/StatusChip";

export function JobCard({
  job,
  onSelect,
}: {
  job: JobDto;
  onSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: job.id,
    data: { jobId: job.id },
  });
  const pickup = job.stops.find((s) => s.stopType === "pickup");
  const delivery = job.stops.find((s) => s.stopType === "dropoff");
  const urgent = job.priority === "stat" || job.priority === "urgent";
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      className={`group flex w-[292px] shrink-0 flex-col gap-3 rounded-2xl border bg-command-surface p-4 text-left shadow-[0_6px_20px_rgba(25,24,21,0.05)] transition-all ${
        isDragging
          ? "rotate-1 opacity-40"
          : urgent
            ? "border-brand-primary/50 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(25,24,21,0.10)]"
            : "border-command-border/80 hover:-translate-y-0.5 hover:border-brand-primary/40 hover:shadow-[0_12px_28px_rgba(25,24,21,0.10)]"
      }`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              {...listeners}
              {...attributes}
              aria-label={`Drag ${job.reference} to assign`}
              className="cursor-grab touch-none select-none text-[13px] leading-none text-text-secondary active:cursor-grabbing"
            >
              {"\u283f"}
            </span>
            <span className="truncate text-[13px] font-bold tracking-[-0.01em]">
              {job.reference}
            </span>
          </div>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
            {job.serviceType.replaceAll("_", " ")}
          </p>
        </div>
        <StatusChip
          tone={urgent ? "danger" : "neutral"}
          label={job.priority === "stat" ? "stat" : job.priority}
        />
      </div>

      <div className="relative space-y-3 border-l border-dashed border-command-border pl-4">
        <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-brand-primary bg-command-surface" />
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">
            Pick up
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium">
            {pickup?.address ?? "Pickup to confirm"}
          </p>
        </div>
        <span className="absolute -left-[5px] bottom-4 h-2.5 w-2.5 rounded-full bg-text-primary" />
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-text-secondary">
            Drop off
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium">
            {delivery?.address ?? "Destination to confirm"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-command-border/70 pt-2.5 text-[10px] text-text-secondary">
        <span>{job.stops.length} {job.stops.length === 1 ? "stop" : "stops"}</span>
        <span className="font-semibold uppercase tracking-[0.12em] text-brand-primary">
          Assign {"\u2192"}
        </span>
      </div>
    </button>
  );
}


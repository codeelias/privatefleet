/**
 * Draggable job card (dnd-kit) with a keyboard/click fallback that opens
 * the assignment flow without a drag (handoff section 8 accessibility).
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
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-2 rounded-lg border bg-command-raised px-3 py-1.5 text-xs active:cursor-grabbing ${
        isDragging ? "opacity-40" : "border-command-border hover:border-brand-primary/60"
      }`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <span className="font-bold">{job.reference}</span>
      <StatusChip
        tone={job.priority === "stat" || job.priority === "urgent" ? "danger" : "neutral"}
        label={job.priority === "stat" ? "stat" : job.serviceType}
      />
      <span className="text-text-secondary">{pickup?.address ?? ""}</span>
    </button>
  );
}

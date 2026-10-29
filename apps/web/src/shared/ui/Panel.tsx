import type { ReactNode } from "react";

/** Reusable paper panel used by dispatcher surfaces. */
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-command-border/80 bg-command-surface shadow-[0_10px_30px_rgba(25,24,21,0.06)]">
      <header className="flex items-center justify-between border-b border-command-border/70 px-4 py-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

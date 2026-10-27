import type { ReactNode } from "react";

/** Reusable panel surface on the command background. */
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
    <section className="flex flex-col rounded-xl border border-command-border bg-command-surface">
      <header className="flex items-center justify-between border-b border-command-border px-4 py-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

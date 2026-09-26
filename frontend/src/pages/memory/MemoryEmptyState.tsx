import type { ReactNode } from "react";

/** The Memory card's empty / error state (TkF-Inbox-4): a 52px icon tile, a display title, a
 *  sentence, and up to two small buttons. */
export function MemoryEmptyState({
  icon,
  title,
  body,
  actions,
  label,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  actions?: ReactNode;
  label?: string;
}) {
  return (
    <section className="mem-card" aria-label={label ?? title}>
      <div className="mem-empty">
        <span className="mem-empty__icon" aria-hidden="true">
          {icon}
        </span>
        <h2 className="mem-empty__title">{title}</h2>
        <div className="mem-empty__body">{body}</div>
        {actions && <div className="mem-empty__actions">{actions}</div>}
      </div>
    </section>
  );
}

/** A list card that is still loading. */
export function MemoryLoading({ label }: { label: string }) {
  return (
    <section className="mem-card" aria-label={label} aria-busy="true">
      <div className="mem-empty mem-loading">Loading memories…</div>
    </section>
  );
}

import type { ReactNode } from "react";

/** The Skills card's empty/no-match/error state (TkF-SkillsEmpty-1/2): a 52px icon tile, a display
 *  title, a sentence, and up to two small buttons. */
export function SkillsEmptyState({
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
    <section className="sk-card" aria-label={label ?? title}>
      <div className="sk-empty">
        <span className="sk-empty__icon" aria-hidden="true">
          {icon}
        </span>
        <h2 className="sk-empty__title">{title}</h2>
        <div className="sk-empty__body">{body}</div>
        {actions && <div className="sk-empty__actions">{actions}</div>}
      </div>
    </section>
  );
}

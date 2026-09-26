/**
 * The Toolkit's empty-state block (Tools "No tools yet" / "No tools match …", Secrets "No secrets
 * yet"): a 52px icon tile, a serif title, one line of help and up to two small buttons, inside the
 * page's card.
 */
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="tk-empty">
      <span className="tk-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="tk-empty__title">{title}</div>
      {children && <div className="tk-empty__body">{children}</div>}
      {actions && <div className="tk-empty__actions">{actions}</div>}
    </div>
  );
}

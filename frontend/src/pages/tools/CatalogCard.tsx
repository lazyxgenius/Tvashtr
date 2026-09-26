/**
 * One Browse card (Toolkit-ToolsBrowse, TkF-Catalog-*): an icon tile, the title, a badge on the
 * right, the copy and one action underneath.
 */
import { type ReactNode, useId } from "react";

import { Badge } from "../../design-system/components";

type BadgeVariant = "neutral" | "success" | "warning";

export function CatalogCard({
  icon,
  title,
  badge,
  badgeVariant = "neutral",
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  badge: string;
  badgeVariant?: BadgeVariant;
  description: string;
  action: ReactNode;
}) {
  const titleId = useId();
  return (
    <article className="tk-cat" aria-labelledby={titleId}>
      <div className="tk-cat__head">
        <span className="tk-cat__tile" aria-hidden="true">
          {icon}
        </span>
        <span className="tk-cat__title" id={titleId}>
          {title}
        </span>
        {badge && (
          <span className="tk-cat__badge">
            <Badge variant={badgeVariant}>{badge}</Badge>
          </span>
        )}
      </div>
      <p className="tk-cat__desc">{description}</p>
      <div>{action}</div>
    </article>
  );
}

/**
 * One domain on the Domains list (DM-9…DM-13): serif name linking to the domain, status and
 * template badges, the ⋯ menu (DomainMenu), the files / quality / usage lines and the updated
 * footer.
 */
import { FileText, Target, Workflow } from "lucide-react";

import { Badge } from "../../design-system/components";
import type { DomainListItem } from "../../lib/api/domains";
import { routeToHash } from "../../lib/nav";
import {
  filesLine,
  footerLine,
  qualityLine,
  stateBadge,
  templateLabel,
  usageLine,
} from "./domainFormat";
import { DomainMenu } from "./DomainMenu";

const LINE_ICON = { size: 14, strokeWidth: 1.6, "aria-hidden": true } as const;

export function DomainCard({
  domain,
  now,
  existingNames,
  onChanged,
  onDeleted,
}: {
  domain: DomainListItem;
  now: Date;
  existingNames: string[];
  onChanged: () => void;
  onDeleted: (domain: DomainListItem) => void;
}) {
  const badge = stateBadge(domain.state);
  const open = { page: "domains", domainId: domain.domain_id } as const;
  return (
    <article className="dm-card" aria-label={domain.name}>
      <div className="dm-card__top">
        <div className="dm-card__titles">
          <a className="dm-card__name" href={routeToHash(open)}>
            {domain.name}
          </a>
          <div className="dm-card__badges">
            <Badge variant={badge.variant} dot={badge.dot}>
              {badge.label}
            </Badge>
            <span className="dm-pill">{templateLabel(domain.template)}</span>
          </div>
        </div>
        <DomainMenu
          domain={domain}
          where="card"
          existingNames={existingNames}
          onChanged={onChanged}
          onDeleted={() => onDeleted(domain)}
        />
      </div>
      <div className="dm-card__lines">
        <span className="dm-card__line">
          <FileText {...LINE_ICON} />
          {filesLine(domain)}
        </span>
        <span className="dm-card__line">
          <Target {...LINE_ICON} />
          {qualityLine(domain)}
        </span>
        <span className="dm-card__line">
          <Workflow {...LINE_ICON} />
          {usageLine(domain)}
        </span>
      </div>
      <div className="dm-card__foot">{footerLine(domain, now)}</div>
    </article>
  );
}

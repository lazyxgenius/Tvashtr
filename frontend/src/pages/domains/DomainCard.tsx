/**
 * One domain on the Domains list (DM-9…DM-13): serif name linking to the domain, status and
 * template badges, the ⋯ menu, the files / quality / usage lines and the updated footer.
 */
import { FileText, Target, Workflow } from "lucide-react";

import { Badge, Menu, type MenuEntry } from "../../design-system/components";
import type { DomainListItem } from "../../lib/api/domains";
import { navigate, routeToHash } from "../../lib/nav";
import {
  filesLine,
  footerLine,
  qualityLine,
  stateBadge,
  templateLabel,
  usageLine,
} from "./domainFormat";

const LINE_ICON = { size: 14, strokeWidth: 1.6, "aria-hidden": true } as const;

export function DomainCard({
  domain,
  now,
  onCopyId,
}: {
  domain: DomainListItem;
  now: Date;
  onCopyId: (domain: DomainListItem) => void;
}) {
  const badge = stateBadge(domain.state);
  const open = { page: "domains", domainId: domain.domain_id } as const;
  // Rename, Duplicate settings and Delete… join this menu with their dialogs (DmF-Menu).
  const items: MenuEntry[] = [
    { key: "open", label: "Open", onSelect: () => navigate(open) },
    {
      key: "ask",
      label: "Ask a question",
      onSelect: () => navigate({ ...open, tab: "ask" }),
    },
    { key: "copy", label: "Copy domain ID", onSelect: () => onCopyId(domain) },
  ];
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
        <Menu label={`More actions for ${domain.name}`} items={items} width={210} />
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

/**
 * A domain's page (`#/domains/<id>[/<tab>][?file=&piece=]`; Dm-Sources, DmF-First-4/5 and the
 * Sources flows): breadcrumb, serif name, status and template badges, the meta line, Use in a
 * team and the ⋯ menu; the setup strip until the first read finishes, then the summary strip on
 * Sources; the tabs; and the tab itself. Live while files are read (DM-4); when the first read
 * finishes a toast offers to ask it a question.
 *
 * INTERIM: until the Ask, Quality, Use in teams and Settings tabs are redesigned, those tabs show
 * the previous Domains screen's matching panel under the new header.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Ellipsis, Workflow } from "lucide-react";

import { DomainsPage, type DetailTab } from "../../components/DomainsPage";
import {
  Badge,
  Button,
  IconButton,
  Menu,
  type MenuEntry,
  Tabs,
  useToast,
} from "../../design-system/components";
import type { DomainDetailView } from "../../lib/api/domains";
import { type DomainTab, navigate } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { detailBadge, metaLine, templateLabel } from "./domainFormat";
import { SetupStrip, SummaryStrip } from "./DomainStrips";
import { SourcesTab } from "./SourcesTab";
import { useDomainDetail } from "./useDomainDetail";
import "./domains.css";

/** The previous screen's panel each not-yet-redesigned tab shows meanwhile. */
const INTERIM_TAB: Record<Exclude<DomainTab, "sources">, DetailTab> = {
  ask: "chat",
  quality: "eval",
  teams: "overview",
  settings: "config",
};

/** "now", re-read every 30 s so "Just now" and "updated 2 minutes ago" age on an open page. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function tabItems(d: DomainDetailView) {
  return [
    { value: "sources" as const, label: "Sources", count: d.files.total || undefined },
    { value: "ask" as const, label: "Ask" },
    { value: "quality" as const, label: "Quality" },
    { value: "teams" as const, label: "Use in teams", count: d.usage.uses || undefined },
    { value: "settings" as const, label: "Settings" },
  ];
}

export function DomainDetailPage({
  domainId,
  tab = "sources",
  file,
  piece,
}: {
  domainId: string;
  tab?: DomainTab;
  file?: string;
  piece?: number;
}) {
  const { detail, missing, error, tick, reload } = useDomainDetail(domainId);
  const toast = useToast();
  const now = useClock();
  const prev = useRef<DomainDetailView | null>(null);

  const go = (next: DomainTab) =>
    navigate(
      { page: "domains", domainId, tab: next === "sources" ? undefined : next },
      { replace: true },
    );

  // The first read just finished: offer to ask it something (DmF-First-5).
  useEffect(() => {
    const before = prev.current;
    prev.current = detail;
    if (!before || !detail || before.domain_id !== detail.domain_id) return;
    if (!before.setup.files_read && detail.setup.files_read && detail.state === "ready") {
      toast({
        message: `${detail.name} is ready. Ask it a question.`,
        action: {
          label: "Ask now",
          onClick: () => navigate({ page: "domains", domainId: detail.domain_id, tab: "ask" }),
        },
      });
    }
  }, [detail, toast]);

  useEffect(() => {
    if (missing) void refreshBadges();
  }, [missing]);

  if (missing) {
    return (
      <div className="dm-detail">
        <div className="dm-missing" role="status">
          <p className="dm-missing__text">This domain doesn’t exist any more.</p>
          <Button variant="secondary" size="sm" onClick={() => navigate({ page: "domains" })}>
            Back to Domains
          </Button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return error ? (
      <div className="dm-detail">
        <div className="dm-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      </div>
    ) : null;
  }

  const badge = detailBadge(detail);
  const copyId = () => {
    const failed = () => toast({ message: "Couldn’t copy the domain ID.", tone: "error" });
    if (!navigator.clipboard) return failed();
    navigator.clipboard
      .writeText(detail.domain_id)
      .then(() => toast({ message: "Domain ID copied." }))
      .catch(failed);
  };
  // Rename, Duplicate settings and Delete… join this menu with their dialogs (OQ-28).
  const menu: MenuEntry[] = [
    { key: "ask", label: "Ask a question", onSelect: () => go("ask") },
    { key: "copy", label: "Copy domain ID", onSelect: copyId },
  ];

  return (
    <div className="dm-detail">
      <nav className="dm-crumbs" aria-label="Breadcrumb">
        <a href="#/domains" className="dm-crumbs__link">
          Domains
        </a>
        <ChevronRight size={13} strokeWidth={1.6} aria-hidden />
        <span className="dm-crumbs__here" aria-current="page">
          {detail.name}
        </span>
      </nav>

      <header className="dm-dhead">
        <div className="dm-dhead__text">
          <div className="dm-dhead__titles">
            <h1 className="dm-dhead__title">{detail.name}</h1>
            <Badge variant={badge.variant} dot={badge.dot}>
              {badge.label}
            </Badge>
            <span className="dm-pill">{templateLabel(detail.template)} template</span>
          </div>
          <p className="dm-dhead__meta">{metaLine(detail, now)}</p>
        </div>
        <div className="dm-dhead__actions">
          <Button
            variant="secondary"
            size="sm"
            className="dm-btn-inline"
            onClick={() => go("teams")}
          >
            <Workflow size={15} strokeWidth={1.6} aria-hidden />
            <span>Use in a team</span>
          </Button>
          <Menu
            label={`More actions for ${detail.name}`}
            items={menu}
            width={210}
            trigger={(props) => (
              <IconButton
                size="sm"
                variant="outline"
                aria-label={`More actions for ${detail.name}`}
                {...props}
              >
                <Ellipsis size={16} strokeWidth={1.6} aria-hidden />
              </IconButton>
            )}
          />
        </div>
      </header>

      {!detail.setup.files_read ? (
        <SetupStrip detail={detail} />
      ) : (
        tab === "sources" && <SummaryStrip detail={detail} />
      )}

      <div className="dm-tabs">
        <Tabs
          variant="line"
          aria-label="Domain sections"
          items={tabItems(detail)}
          value={tab}
          onChange={go}
        />
      </div>

      <div className="dm-tabbody">
        {tab === "sources" ? (
          <SourcesTab
            detail={detail}
            tick={tick}
            file={file}
            piece={piece}
            now={now}
            onChanged={() => void reload()}
          />
        ) : (
          <DomainsPage
            key={tab}
            initialDomainId={detail.domain_id}
            embeddedTab={INTERIM_TAB[tab]}
            onLeaveDetail={() => navigate({ page: "domains" })}
            onOpenEngines={() => navigate({ page: "engines", tab: "overview" })}
          />
        )}
      </div>
    </div>
  );
}

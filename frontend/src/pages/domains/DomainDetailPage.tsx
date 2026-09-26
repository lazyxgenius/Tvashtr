/**
 * A domain's page (`#/domains/<id>[/<tab>][?file=&piece=]`; Dm-Sources, DmF-First-4/5 and the
 * Sources flows): breadcrumb, serif name, status and template badges, the meta line, Use in a
 * team and the ⋯ menu; the setup strip until the first read finishes, then the summary strip on
 * Sources; the tabs; and the tab itself. Live while files are read (DM-4); when the first read
 * finishes a toast offers to ask it a question.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Workflow } from "lucide-react";

import { Badge, Button, Tabs, useToast } from "../../design-system/components";
import type { DomainDetailView } from "../../lib/api/domains";
import { type DomainTab, navigate } from "../../lib/nav";
import { refreshBadges, useNavBadges } from "../../lib/workspaceStatus";
import {
  detailBadge,
  detailWithout,
  metaLine,
  shownRereading,
  templateLabel,
} from "./domainFormat";
import { AskTab } from "./AskTab";
import { DomainMenu } from "./DomainMenu";
import { QualityTab } from "./QualityTab";
import { SettingsTab } from "./SettingsTab";
import { SetupStrip, SummaryStrip } from "./DomainStrips";
import { SourcesTab } from "./SourcesTab";
import { UseInTeamsTab } from "./UseInTeamsTab";
import { useDomainDetail } from "./useDomainDetail";
import { useFileDeletes } from "./useFileDeletes";
import "./domains.css";

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
  const { detail: loaded, missing, error, tick, stamp, reload } = useDomainDetail(domainId);
  const toast = useToast();
  // Files deleted from the Sources table: gone from every count at once, sent when Undo lapses.
  const deletes = useFileDeletes(domainId, () => void reload());
  const detail = loaded && detailWithout(loaded, deletes.gone(stamp));
  const names = (useNavBadges().domains ?? []).map((d) => d.name);
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

  return (
    <div
      className={
        tab === "ask" || tab === "quality"
          ? "dm-detail dm-detail--fill"
          : tab === "settings"
            ? "dm-detail dm-detail--grow"
            : "dm-detail"
      }
    >
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
          <DomainMenu
            domain={detail}
            where="header"
            existingNames={names}
            onChanged={() => void reload().then(() => refreshBadges())}
            onDeleted={() => {
              navigate({ page: "domains" });
              void refreshBadges();
            }}
          />
        </div>
      </header>

      {!detail.setup.files_read ? (
        <SetupStrip detail={detail} />
      ) : (
        // A re-read of every file hides the "14 of 14 files read" strip (DmF-Embed-4, DmF-Piece-3).
        tab === "sources" && !shownRereading(detail) && <SummaryStrip detail={detail} />
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
            key={detail.domain_id}
            detail={detail}
            tick={tick}
            file={file}
            piece={piece}
            now={now}
            deletes={deletes}
            onChanged={() => void reload()}
          />
        ) : tab === "ask" ? (
          <AskTab
            key={detail.domain_id}
            detail={detail}
            now={now}
            onChanged={() => void reload()}
          />
        ) : tab === "quality" ? (
          <QualityTab key={detail.domain_id} detail={detail} now={now} />
        ) : tab === "settings" ? (
          <SettingsTab key={detail.domain_id} detail={detail} onChanged={() => void reload()} />
        ) : (
          <UseInTeamsTab
            key={detail.domain_id}
            detail={detail}
            now={now}
            onChanged={() => void reload()}
          />
        )}
      </div>
    </div>
  );
}

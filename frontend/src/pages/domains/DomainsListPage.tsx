/**
 * The Domains list (`#/domains`; Dm-List, Dm-ListEmpty, DmF-First-1, DmF-Find-1…3). Header with
 * New domain, the hideable how-it-works strip, search and sort, and a card per domain — or, with
 * no domains yet, the empty page with its starting points and key hint.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Button, Input, useToast } from "../../design-system/components";
import { listProviders } from "../../lib/api";
import {
  type DomainListItem,
  type DomainTemplate,
  listDomainTemplates,
} from "../../lib/api/domains";
import { getAccountPreferences, patchAccountPreferences } from "../../lib/api/teams";
import { navigate } from "../../lib/nav";
import { refreshBadges } from "../../lib/workspaceStatus";
import { DomainCard } from "./DomainCard";
import { DomainsEmpty } from "./DomainsEmpty";
import {
  type DomainSort,
  READING_PROVIDERS,
  SORT_OPTIONS,
  filterDomains,
  sortDomains,
} from "./domainFormat";
import { HowDomainsWorkDialog, HowItWorksStrip } from "./HowItWorksStrip";
import { NewDomainDialog } from "./NewDomainDialog";
import { SortSelect } from "./SortSelect";
import { useDomainList } from "./useDomainList";
import "./domains.css";

/** "now", re-read every minute so "Updated just now" ages on an open page. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function DomainsListPage() {
  const { items, error, reload } = useDomainList();
  const toast = useToast();
  const now = useMinuteClock();
  const sortLabelId = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DomainSort>("recent");
  const [howtoHidden, setHowtoHidden] = useState<boolean | null>(null);
  const [templates, setTemplates] = useState<DomainTemplate[]>([]);
  const [held, setHeld] = useState<string[] | null>(null);
  const [creating, setCreating] = useState<{ template?: string } | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const empty = items !== null && items.length === 0;

  useEffect(() => {
    let live = true;
    getAccountPreferences()
      .then((p) => live && setHowtoHidden(Boolean(p.domains_howto_hidden)))
      .catch(() => live && setHowtoHidden(false));
    return () => {
      live = false;
    };
  }, []);

  // The empty page's starting points and key hint (DM-18, DM-20).
  useEffect(() => {
    if (!empty) return;
    let live = true;
    listDomainTemplates()
      .then((t) => live && setTemplates(t))
      .catch(() => live && setTemplates([]));
    listProviders()
      .then((ps) => live && setHeld(ps.map((p) => p.provider)))
      .catch(() => live && setHeld([]));
    return () => {
      live = false;
    };
  }, [empty]);

  const shown = useMemo(
    () => (items ? sortDomains(filterDomains(items, query), sort) : []),
    [items, query, sort],
  );

  const hideHowto = () => {
    setHowtoHidden(true);
    patchAccountPreferences({ domains_howto_hidden: true }).catch(() => {
      setHowtoHidden(false);
      toast({ message: "Couldn’t hide it. Try again.", tone: "error" });
    });
  };

  const copyId = (d: DomainListItem) => {
    const failed = () => toast({ message: "Couldn’t copy the domain ID.", tone: "error" });
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard
      .writeText(d.domain_id)
      .then(() => toast({ message: "Domain ID copied." }))
      .catch(failed);
  };

  const showKeyHint = held !== null && !held.some((p) => READING_PROVIDERS.includes(p));

  return (
    <div className="dm-page">
      <header className="dm-head">
        <div className="dm-head__text">
          <h1 className="dm-head__title">Domains</h1>
          <p className="dm-head__lede">
            Libraries of your own files. You and your agents ask them questions and get answers with
            sources.
          </p>
        </div>
        {items !== null && !empty && (
          <Button
            variant="primary"
            size="md"
            className="dm-btn-inline"
            onClick={() => setCreating({})}
          >
            <Plus size={15} strokeWidth={1.6} aria-hidden />
            <span>New domain</span>
          </Button>
        )}
      </header>

      {items === null && error && (
        <div className="dm-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      )}

      {items !== null && !empty && (
        <>
          {howtoHidden === false && <HowItWorksStrip onHide={hideHowto} />}
          <div className="dm-tools">
            <Input
              size="sm"
              style={{ width: 280 }}
              placeholder="Search domains"
              aria-label="Search domains"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span id={sortLabelId} className="dm-tools__sort-label">
              Sort
            </span>
            <SortSelect
              value={sort}
              options={SORT_OPTIONS}
              onChange={setSort}
              labelId={sortLabelId}
            />
          </div>
          {shown.length > 0 ? (
            <div className="dm-grid">
              {shown.map((d) => (
                <DomainCard key={d.domain_id} domain={d} now={now} onCopyId={copyId} />
              ))}
            </div>
          ) : (
            <div className="dm-nomatch" role="status">
              No domains match “{query.trim()}”.{" "}
              <a
                className="dm-link"
                href="#/domains"
                role="button"
                onClick={(e) => {
                  e.preventDefault();
                  setQuery("");
                }}
              >
                Clear search
              </a>
            </div>
          )}
        </>
      )}

      {empty && (
        <DomainsEmpty
          templates={templates}
          showKeyHint={showKeyHint}
          onNewDomain={(template) => setCreating({ template })}
          onHowItWorks={() => setHowOpen(true)}
        />
      )}

      <NewDomainDialog
        open={creating !== null}
        initialTemplate={creating?.template}
        existingNames={(items ?? []).map((d) => d.name)}
        onClose={() => setCreating(null)}
        onCreated={(domain) => {
          setCreating(null);
          void refreshBadges();
          navigate({ page: "domains", domainId: domain.domain_id });
        }}
      />
      <HowDomainsWorkDialog open={howOpen} onClose={() => setHowOpen(false)} />
    </div>
  );
}

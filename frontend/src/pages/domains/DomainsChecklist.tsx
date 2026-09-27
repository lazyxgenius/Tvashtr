/**
 * An agent's "Domains this agent can search" (DM-105/106, Dm-AgentAccess): every domain as a
 * checkbox with its status, then the callout about the two tools it gets. It edits the agent's
 * `tool_config.tvashtr.domains` — `true` (every domain, the round-1 switch) or a list of ids — and
 * the drawer saves it. An agent on a Desktop plan gets the DM-96 note: those runs get no tools.
 */
import { useEffect, useId, useState } from "react";
import { Info } from "lucide-react";

import { Checkbox } from "../../design-system/components";
import { type DomainListItem, listDomainSummaries } from "../../lib/api/domains";
import {
  type DomainAccess,
  accessIncludes,
  domainStatusLine,
  toggleAccess,
} from "./queryNodeFormat";
import { publishDomainNav } from "./useDomainList";
import { subscriptionNote } from "./useInTeamsFormat";
import "./queryNode.css";

export function DomainsChecklist({
  value,
  onChange,
  subscription = null,
  domains: given,
}: {
  /** The agent's `tvashtr.domains` (`null`: no domains). */
  value: DomainAccess | null;
  /** The new list (empty: no domains). */
  onChange: (ids: string[]) => void;
  /** "claude" / "grok" when the agent runs on a Desktop plan. */
  subscription?: string | null;
  /** The account's domains; loaded here when not given. */
  domains?: DomainListItem[];
}) {
  const [loaded, setLoaded] = useState<DomainListItem[] | null>(null);
  useEffect(() => {
    if (given) return;
    let live = true;
    listDomainSummaries()
      .then((list) => {
        if (!live) return;
        setLoaded(list);
        publishDomainNav(list);
      })
      .catch(() => live && setLoaded([]));
    return () => {
      live = false;
    };
  }, [given]);
  const domains = given ?? loaded;
  const allIds = (domains ?? []).map((d) => d.domain_id);
  const headId = useId();

  return (
    <section className="dm-dlist" aria-labelledby={headId}>
      <span id={headId} className="dm-dlist__head">
        Domains this agent can search
      </span>
      {domains && domains.length === 0 ? (
        <p className="dm-dlist__empty">You don’t have a domain yet. Make one under Domains.</p>
      ) : (
        <div className="dm-dlist__items">
          {(domains ?? []).map((d) => (
            <Checkbox
              key={d.domain_id}
              label={d.name}
              description={domainStatusLine(d)}
              checked={accessIncludes(value, d.domain_id)}
              onChange={(e) =>
                onChange(toggleAccess(value, d.domain_id, e.currentTarget.checked, allIds))
              }
            />
          ))}
        </div>
      )}
      <div className="dm-dlist__callout">
        <span className="dm-dlist__icon">
          <Info size={14} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="dm-dlist__text">
          During a run this agent gets two tools: <b>ask a domain</b> (answer + sources) and{" "}
          <b>find passages</b> (no answer). It picks the domain by name — no IDs needed.
        </span>
      </div>
      {subscription && <p className="dm-dlist__note">{subscriptionNote(subscription)}</p>}
    </section>
  );
}

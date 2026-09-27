/**
 * The Query domain node's card on the canvas (DM-99): the eyebrow, its title, the domain it asks
 * (or "Pick a domain"), badges — "Needs a domain" (none, or one that was deleted), "No way out",
 * then how the last run went ("Answered", "No answer", "Failed") — and "Passes the answer on".
 * The card frame, handles and hover affordances stay the canvas's.
 */
import { useEffect } from "react";

import { listDomainSummaries } from "../../lib/api/domains";
import { type NavDomain, useNavBadges } from "../../lib/workspaceStatus";
import { DEFAULT_TITLE, accessLine, accessOf, cardBadges } from "./queryNodeFormat";
import { publishDomainNav } from "./useDomainList";
import "./queryNode.css";

let loading: Promise<void> | null = null;

/** The account's domains as the nav knows them, loaded once if nothing has loaded them yet. */
function useDomainNames(enabled = true): NavDomain[] | undefined {
  const domains = useNavBadges().domains;
  useEffect(() => {
    if (!enabled || domains || loading) return;
    loading = listDomainSummaries()
      .then(publishDomainNav)
      .catch(() => undefined)
      .finally(() => {
        loading = null;
      });
  }, [enabled, domains]);
  return domains;
}

export function QueryDomainCardBody({
  config,
  errorCode,
  lastOutcome,
  failed = false,
}: {
  config: unknown;
  errorCode?: string | null;
  lastOutcome?: string | null;
  failed?: boolean;
}) {
  const cfg = (config ?? {}) as { domain_id?: unknown; title?: unknown; pass_to_spec?: unknown };
  const domains = useDomainNames();
  const id = typeof cfg.domain_id === "string" ? cfg.domain_id : "";
  const domain = id ? domains?.find((d) => d.id === id) : undefined;
  // Until the list loads, a set id counts as a domain (no false "Needs a domain").
  const hasDomain = Boolean(id) && (domains === undefined || domain !== undefined);
  const title = typeof cfg.title === "string" && cfg.title.trim() ? cfg.title : DEFAULT_TITLE;
  const badges = cardBadges({ hasDomain, errorCode, lastOutcome, failed });
  return (
    <>
      <div className="rf-node__eyebrow">Query domain</div>
      <div className="rf-node__title">{title}</div>
      <div className="rf-node__blurb">{hasDomain ? (domain?.name ?? "") : "Pick a domain"}</div>
      {badges.length > 0 && (
        <div className="dm-qcard__badges">
          {badges.map((b) => (
            <span key={b.label} className={`dm-qcard__badge dm-qcard__badge--${b.tone}`}>
              {b.label}
            </span>
          ))}
        </div>
      )}
      {cfg.pass_to_spec === true && <div className="dm-qcard__foot">Passes the answer on</div>}
    </>
  );
}

/** An agent card's "Can search Support docs" line (DM-99); nothing when it can't search any. */
export function AgentDomainsLine({ toolConfig }: { toolConfig: unknown }) {
  const access = accessOf(toolConfig);
  const domains = useDomainNames(access !== null);
  const line = accessLine(access, domains);
  return line ? <div className="dm-qcard__access">{line}</div> : null;
}

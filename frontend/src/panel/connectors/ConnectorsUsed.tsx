/**
 * What a round did through connectors (Page-Agent-Runs-what-it-read, CnF-Run-1/2, CnF-Expired-2):
 * `ConnectorsUsed` is the chips ("Supabase · 6 reads") and the call list, writes first and marked;
 * `ConnectorsSkipped` is one line per connector the round ran without, with the way to fix it.
 * Both read the round's `connectors` block and show nothing when it has nothing for them.
 */
import { useId, useState } from "react";
import { Ban, Eye, Pencil, TriangleAlert } from "lucide-react";

import { Badge, ButtonLink } from "../../design-system/components";
import type { ConnectorCall, RoundConnectors } from "../../lib/api/roundConnectors";
import { tileLetters } from "../../pages/connectors/connectorFormat";
import {
  type OpenConnector,
  callMeta,
  connectorsHref,
  opening,
  usedLabel,
} from "./connectorFormat";
import "./connectors.css";

/** Calls shown before "Show all N calls". */
const FIRST_CALLS = 4;
const icon = { size: 11, strokeWidth: 1.6, "aria-hidden": true } as const;

export function ConnectorsUsed({ connectors }: { connectors: RoundConnectors | null | undefined }) {
  const [all, setAll] = useState(false);
  const usedId = useId();
  const callsId = useId();
  const listId = useId();
  if (!connectors) return null;
  const { used, calls, total_calls: total } = connectors;
  // The server sends at most the first 50 calls of a round; `total` counts them all.
  const capped = total > calls.length;
  const shown = all ? calls : calls.slice(0, FIRST_CALLS);
  // A call names its connection; the tile's letters go by the slug, which `used` carries.
  const slugs = new Map(used.map((u) => [u.connection_id, u.slug]));
  return (
    <>
      {used.length > 0 && (
        <div className="nd-conn-used" role="group" aria-labelledby={usedId}>
          <span className="nd-section__title" id={usedId}>
            Connectors used this round
          </span>
          <ul className="nd-conn-chips">
            {used.map((u) => (
              <li className="nd-conn-chip" key={u.connection_id}>
                <span className="nd-conn-tile" aria-hidden="true">
                  {tileLetters(u.slug, u.name)}
                </span>
                {usedLabel(u)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {calls.some(wrote) && (
        <div className="nd-conn-note">
          <Pencil size={14} strokeWidth={1.6} aria-hidden />
          <span>Writes are listed first and marked.</span>
        </div>
      )}
      {calls.length > 0 && (
        <div className="nd-conn-used">
          <span className="nd-section__title" id={callsId}>
            Calls
          </span>
          <ul className="nd-conn-calls" id={listId} aria-labelledby={callsId}>
            {shown.map((call, i) => (
              <Call key={i} call={call} slug={slugs.get(call.connection_id) ?? ""} />
            ))}
          </ul>
          {calls.length > FIRST_CALLS && (
            // One button for both ways, so keyboard focus stays on it.
            <button
              type="button"
              className="nd-link nd-conn-used__more"
              aria-expanded={all}
              aria-controls={listId}
              onClick={() => setAll(!all)}
            >
              {all
                ? "Show fewer calls"
                : capped
                  ? `Show the first ${calls.length} calls`
                  : `Show all ${total} calls`}
            </button>
          )}
          {all && capped && (
            <p className="nd-conn-used__cap">
              The first {calls.length} of {total} calls.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** A write that went through (a refused one changed nothing). */
const wrote = (call: ConnectorCall) => call.write && !call.blocked;

function Call({ call, slug }: { call: ConnectorCall; slug: string }) {
  // Only an https address becomes a link: never `javascript:` or anything else a server sent.
  const url = call.result_url?.startsWith("https://") ? call.result_url : null;
  return (
    <li className={`nd-conn-call${wrote(call) ? " nd-conn-call--write" : ""}`}>
      <span className="nd-conn-tile" aria-hidden="true">
        {tileLetters(slug, call.name)}
      </span>
      <div className="nd-conn-call__body">
        <div className="nd-conn-call__top">
          <span className="nd-conn-call__name">{call.name}</span>
          <span className="nd-conn-call__tool">{call.tool}</span>
          <span className="nd-conn-call__kind">
            {call.blocked ? (
              <Badge variant="warning">
                <Ban {...icon} /> Blocked
              </Badge>
            ) : call.write ? (
              <Badge variant="accent">
                <Pencil {...icon} /> Write
              </Badge>
            ) : (
              <Badge variant="neutral">
                <Eye {...icon} /> Read
              </Badge>
            )}
          </span>
        </div>
        {call.arg && <div className="nd-conn-call__arg">{call.arg}</div>}
        <div className="nd-conn-call__meta">
          <span>{callMeta(call)}</span>
          {url && (
            <>
              {" · "}
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open result
              </a>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function ConnectorsSkipped({
  connectors,
  onOpen,
}: {
  connectors: RoundConnectors | null | undefined;
  /** The Team drawer opens Connectors itself (it may have unsaved changes); else a plain link. */
  onOpen?: OpenConnector;
}) {
  return (
    <>
      {(connectors?.skipped ?? []).map((s, i) => (
        <div className="nd-conn-skip" role="note" key={i}>
          <TriangleAlert size={14} strokeWidth={1.6} aria-hidden />
          <span className="nd-conn-skip__text">
            Ran without <b>{s.name}</b>: {s.reason}.
          </span>
          <ButtonLink
            variant="secondary"
            size="sm"
            href={connectorsHref(s.connection_id)}
            onClick={opening(onOpen, s.connection_id)}
          >
            {s.connection_id ? "Sign in" : "Open Connectors"}
          </ButtonLink>
        </div>
      ))}
    </>
  );
}

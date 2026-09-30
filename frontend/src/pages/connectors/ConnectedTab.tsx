/**
 * Toolkit › Connectors › Connected (Page-Connected-tab, CnF-Expired-1): an amber banner per
 * connection whose sign-in expired (naming the agents that run without it), the table —
 * connector, access, status, who uses it and a ⋯ menu — filtered by the search words and the
 * Status select, and the footnote on how agents get access.
 */
import { Plug, Search, Shield, TriangleAlert } from "lucide-react";
import type { MouseEvent } from "react";

import { Badge, Button } from "../../design-system/components";
import type { Connection } from "../../lib/api/connectors";
import { navigate, routeToHash } from "../../lib/nav";
import { EmptyState } from "../tools/EmptyState";
import { usedByLabel } from "../tools/toolFormat";
import type { StatusFilter } from "../tools/toolsState";
import { AccessBadge } from "./AccessBadge";
import { ConnectorRowMenu } from "./ConnectorRowMenu";
import { ConnectorTile } from "./ConnectorTile";
import {
  connectionSubline,
  expiredSentence,
  filterConnections,
  reconnects,
  usesKey,
} from "./connectorFormat";

const pageOf = (c: Connection) => ({ page: "connector", connectorId: c.id }) as const;

export interface ConnectedActions {
  /** Sign in again, or replace the key of a connection that uses one. */
  onSignIn: (c: Connection) => void;
  onGiveAccess: (c: Connection) => void;
  onChangeProject: (c: Connection) => void;
  onDisconnect: (c: Connection) => void;
}

export function ConnectedTab({
  connections,
  error,
  onRetry,
  query,
  status,
  onClearFilters,
  freshIds,
  actions,
}: {
  /** null while loading. */
  connections: Connection[] | null;
  error: boolean;
  onRetry: () => void;
  query: string;
  status: StatusFilter;
  onClearFilters: () => void;
  /** Connected during this visit: their rows say "New". */
  freshIds: string[];
  actions: ConnectedActions;
}) {
  if (connections === null) {
    if (error) {
      return (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>Couldn’t load your connectors.</span>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </section>
      );
    }
    return (
      <section className="tk-card" aria-busy="true" aria-label="Loading connectors">
        <div className="tk-skel" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tk-skel__row">
              <span className="tk-skel__tile" />
              <span className="tk-skel__bar" style={{ width: 120 }} />
              <span className="tk-skel__bar" style={{ width: 90 }} />
              <span className="tk-skel__bar" style={{ width: 140 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (connections.length === 0) {
    return (
      <section className="tk-card">
        <EmptyState
          icon={<Plug size={24} strokeWidth={1.6} />}
          title="Nothing connected yet"
          actions={
            <Button
              size="sm"
              onClick={() => navigate({ page: "connectors", view: "browse" }, { replace: true })}
            >
              Browse connectors
            </Button>
          }
        >
          Sign in to an app in Browse. It shows up here, ready to turn on for an agent.
        </EmptyState>
      </section>
    );
  }

  // The API answers oldest first; the page shows what you connected last on top.
  const newestFirst = [...connections].reverse();
  const rows = filterConnections(newestFirst, query, status);
  const expired = newestFirst.filter((c) => c.status === "needs_signin");

  return (
    <>
      {expired.map((c) => (
        <div key={c.id} className="cn-banner" role="status">
          <TriangleAlert size={16} strokeWidth={1.6} aria-hidden />
          <span className="cn-banner__text">
            <b>{reconnects(c) ? c.name : `${c.name}’s`}</b>
            {expiredSentence(c)}
          </span>
          {reconnects(c) ? (
            <Button variant="secondary" size="sm" onClick={() => actions.onDisconnect(c)}>
              {`Disconnect ${c.name}`}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => actions.onSignIn(c)}>
              {usesKey(c) ? `Replace ${c.name}’s key` : `Sign in to ${c.name}`}
            </Button>
          )}
        </div>
      ))}
      {rows.length === 0 ? (
        <section className="tk-card">
          <EmptyState
            icon={<Search size={24} strokeWidth={1.6} />}
            title={query.trim() ? `No connectors match “${query.trim()}”` : "Nothing to show"}
            actions={
              <Button variant="secondary" size="sm" onClick={onClearFilters}>
                {query.trim() ? "Clear search" : "Clear filter"}
              </Button>
            }
          >
            {query.trim()
              ? "Try another word, or look for it in Browse."
              : "No connector has this status."}
          </EmptyState>
        </section>
      ) : (
        <ConnectionsTable rows={rows} freshIds={freshIds} actions={actions} />
      )}
      <div className="cn-note">
        <span className="cn-note__icon">
          <Shield size={14} strokeWidth={1.6} aria-hidden />
        </span>
        <span>
          Connecting doesn’t give any agent access. You turn a connector on per agent in its{" "}
          <b>Skills &amp; tools</b> tab, and it starts read-only. Agents never hold your sign-in:
          their calls go through Tvashtr, which adds it.
        </span>
      </div>
    </>
  );
}

function ConnectionsTable({
  rows,
  freshIds,
  actions,
}: {
  rows: Connection[];
  freshIds: string[];
  actions: ConnectedActions;
}) {
  // A click on the row (outside its buttons) opens the connector's page.
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, c: Connection) => {
    if ((e.target as HTMLElement).closest("button, a, [role='menu']")) return;
    navigate(pageOf(c));
  };

  return (
    <section className="tk-card tk-card--open">
      <table className="tk-table">
        <thead>
          <tr>
            <th scope="col">Connector</th>
            <th scope="col">Access</th>
            <th scope="col">Status</th>
            <th scope="col">Used by</th>
            <th scope="col">
              <span className="tk-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="tk-row" onClick={(e) => onRowClick(e, c)}>
              <td>
                <div className="tk-toolcell">
                  <ConnectorTile connectorKey={c.connector_key} name={c.name} />
                  <div>
                    <div className="cn-name">
                      <a className="tk-toolcell__name" href={routeToHash(pageOf(c))}>
                        {c.name}
                      </a>
                      {!c.reviewed && <Badge variant="outline">Not reviewed</Badge>}
                    </div>
                    <div className="cn-sub">{connectionSubline(c)}</div>
                  </div>
                </div>
              </td>
              <td>
                <AccessBadge access={c.access} />
              </td>
              <td>
                {c.status === "needs_signin" ? (
                  <div className="tk-needs">
                    <span className="tk-needs__label">
                      <TriangleAlert size={13} strokeWidth={1.6} aria-hidden />
                      {reconnects(c)
                        ? "Connect it again"
                        : usesKey(c)
                          ? "Key stopped working"
                          : "Sign in again"}
                    </span>
                    {reconnects(c) ? (
                      <Button variant="tint" size="sm" onClick={() => actions.onDisconnect(c)}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button variant="tint" size="sm" onClick={() => actions.onSignIn(c)}>
                        {usesKey(c) ? "Replace key" : "Sign in"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <span className="cn-status">
                    <span className="tk-ready">
                      <span className="tk-ready__dot" aria-hidden="true" />
                      Ready
                    </span>
                    {freshIds.includes(c.id) && <Badge variant="success">New</Badge>}
                  </span>
                )}
              </td>
              <td>
                {c.used_by.agent_count > 0 ? (
                  <span className="tk-usedby">{usedByLabel(c.used_by)}</span>
                ) : (
                  <>
                    <span className="cn-unused">Not used yet · </span>
                    <button
                      type="button"
                      className="cn-link"
                      onClick={() => actions.onGiveAccess(c)}
                    >
                      Give an agent access
                    </button>
                  </>
                )}
              </td>
              <td className="cn-actions">
                <ConnectorRowMenu
                  name={c.name}
                  onOpen={() => navigate(pageOf(c))}
                  onChangeProject={
                    c.scope_picker && c.status === "connected"
                      ? () => actions.onChangeProject(c)
                      : undefined
                  }
                  onDisconnect={() => actions.onDisconnect(c)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

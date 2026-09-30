/**
 * Toolkit › Connectors › one connector (`#/toolkit/connectors/<id>`, Page-One-connector-Supabase),
 * loaded from `GET /api/connectors/{id}`.
 *
 * - "← Connectors" returns to the list.
 * - The header: the tile, the name, Ready / Needs attention, the access and who makes it; Change
 *   access and a ⋯ menu (Change project, Disconnect).
 * - Connection: the project (Change), the access (Change), when it was connected, and the sign-in
 *   (Sign in again; a key connection has Replace key).
 * - What agents can call: every tool as Read, Write or "Off · write", with a warning when the
 *   server marks no tool read-only.
 * - Used by: the agents that have it, each removable, and "Give an agent access".
 * - Recent use: which runs called it.
 */
import { ArrowLeft, Check, Lock, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { Badge, Button, IconButton, useToast } from "../../design-system/components";
import { cx } from "../../design-system/components/utils";
import { ApiDetailError } from "../../lib/api/runs";
import {
  type Connection,
  type ConnectionDetail,
  type ConnectorUsageRow,
  checkConnection,
  connectorRefusal,
  getConnection,
  listConnectorAgents,
  setConnectorAgents,
} from "../../lib/api/connectors";
import { navigate, routeToHash } from "../../lib/nav";
import { formatRelativeTime } from "../../lib/time";
import { refreshBadges } from "../../lib/workspaceStatus";
import { formatUpdated } from "../secrets/secretFormat";
import { agentName, plural } from "../tools/toolFormat";
import { AccessBadge } from "./AccessBadge";
import { ChangeAccessDialog } from "./ChangeAccessDialog";
import { type ConnectDone, ConnectSheet } from "./ConnectSheet";
import { ConnectorRowMenu } from "./ConnectorRowMenu";
import { ConnectorTile } from "./ConnectorTile";
import { DisconnectDialog } from "./DisconnectDialog";
import { GiveAccessDialog } from "./GiveAccessDialog";
import { Note } from "./connectParts";
import { prepareSignInWindow } from "./connectSignIn";
import {
  accessGivenToast,
  accessLabel,
  recentUseLine,
  reconnectReason,
  toolsHint,
  usesKey,
} from "./connectorFormat";
import "../tools/tools.css";
import "./connectors.css";

const LIST = { page: "connectors", view: "connected" } as const;
const NOT_FOUND = "This connector isn’t connected any more.";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; missing: boolean }
  | { state: "ready"; connection: ConnectionDetail };

/** What a button on the page opens. */
type Overlay =
  | { kind: "signin"; prepared: Window | null }
  | { kind: "project" }
  | { kind: "access" }
  | { kind: "give" }
  | { kind: "disconnect" }
  | null;

function useConnection(id: string) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const read = useCallback(async () => {
    try {
      setLoad({ state: "ready", connection: await getConnection(id) });
    } catch (e) {
      const missing = e instanceof ApiDetailError && e.status === 404;
      setLoad({
        state: "error",
        missing,
        message: missing ? NOT_FOUND : "Couldn’t load this connector.",
      });
    }
  }, [id]);
  useEffect(() => {
    void read();
  }, [read]);
  const retry = () => {
    setLoad({ state: "loading" });
    void read();
  };
  return { load, reload: read, retry };
}

export function ConnectorDetailPage({ connectorId }: { connectorId: string }) {
  const { load, reload, retry } = useConnection(connectorId);
  return (
    <>
      <a className="cn-back" href={routeToHash(LIST)}>
        <ArrowLeft size={14} strokeWidth={1.6} aria-hidden />
        Connectors
      </a>
      {load.state === "ready" ? (
        <Connector connection={load.connection} reload={reload} />
      ) : load.state === "error" ? (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>{load.message}</span>
            {load.missing ? (
              <Button variant="secondary" size="sm" onClick={() => navigate(LIST)}>
                Back to connectors
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={retry}>
                Retry
              </Button>
            )}
          </div>
        </section>
      ) : (
        <section className="tk-card" aria-busy="true">
          <div className="tk-state">Loading the connector…</div>
        </section>
      )}
    </>
  );
}

function Connector({
  connection: c,
  reload,
}: {
  connection: ConnectionDetail;
  reload: () => Promise<void>;
}) {
  const toast = useToast();
  const ids = useId();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  /** After every change: this page, then the nav's count and "to fix". */
  const changed = async () => {
    await reload();
    void refreshBadges();
  };

  const closeSheet = () => {
    setOverlay(null);
    // A sign-in may have gone through behind a sheet that was closed.
    void changed();
  };

  const onSheetDone = async (saved: Connection, what: ConnectDone) => {
    setOverlay(null);
    await changed();
    if (what === "project") {
      const project = saved.scope?.label.split(" · ")[0] ?? "the whole account";
      toast({ message: `${saved.name} now uses ${project}.` });
    } else {
      toast({ message: `${saved.name} is ready again.` });
    }
  };

  const onAccessSaved = async (saved: Connection) => {
    setOverlay(null);
    await changed();
    toast({ message: `${saved.name} is now ${accessLabel(saved.access).toLowerCase()}.` });
  };

  // The window opens in this click; a key connection needs none.
  const signInAgain = () =>
    setOverlay({ kind: "signin", prepared: usesKey(c) ? null : prepareSignInWindow() });

  const check = async () => {
    setChecking(true);
    try {
      await checkConnection(c.id);
      await changed();
    } catch (e) {
      toast({
        message: connectorRefusal(e)?.message ?? `Couldn’t check ${c.name}. Try again.`,
        tone: "error",
      });
    } finally {
      setChecking(false);
    }
  };

  const removeAccess = async (agent: ConnectorUsageRow) => {
    setRemoving(agent.node_id);
    try {
      // The PUT takes the full set: who has it now, not who had it when this page loaded, so a
      // grant made elsewhere since stays.
      const now = (await listConnectorAgents(c.id)).flatMap((t) => t.agents);
      await setConnectorAgents(
        c.id,
        now.filter((a) => a.enabled && a.node_id !== agent.node_id).map((a) => a.node_id),
      );
      await changed();
      toast({ message: `${agentName(agent)} can’t use ${c.name} any more.` });
    } catch {
      toast({ message: `Couldn’t remove ${agentName(agent)}’s access. Try again.`, tone: "error" });
    } finally {
      setRemoving(null);
    }
  };

  const canChangeAccess = c.access_modes.includes("write");
  const keyed = usesKey(c);
  const agents = c.used_by_agents;
  const tools = c.tools;
  const noReads = tools !== null && tools.length > 0 && tools.every((t) => !t.on);

  return (
    <>
      <div className="cn-dhead">
        <ConnectorTile connectorKey={c.connector_key} name={c.name} size="lg" />
        <div className="cn-dhead__id">
          <h1 className="cn-dhead__name">{c.name}</h1>
          <div className="cn-dhead__meta">
            {c.status === "connected" ? (
              <Badge variant="success" dot>
                Ready
              </Badge>
            ) : (
              <Badge variant="warning" dot>
                {c.status === "pending" ? "Not connected yet" : "Needs attention"}
              </Badge>
            )}
            <AccessBadge access={c.access} />
            <Badge variant="outline">{c.publisher ? `By ${c.publisher}` : c.host}</Badge>
            {!c.reviewed && (
              <Badge variant="outline">
                {`${c.connector_key.startsWith("custom:") ? "Custom" : "From the MCP Registry"} · not reviewed by Tvashtr`}
              </Badge>
            )}
          </div>
        </div>
        {canChangeAccess && (
          <Button variant="secondary" size="sm" onClick={() => setOverlay({ kind: "access" })}>
            Change access
          </Button>
        )}
        <ConnectorRowMenu
          name={c.name}
          size="md"
          onChangeProject={
            c.scope_picker && c.status === "connected"
              ? () => setOverlay({ kind: "project" })
              : undefined
          }
          onDisconnect={() => setOverlay({ kind: "disconnect" })}
        />
      </div>

      <div className="cn-dgrid">
        <div className="cn-dcol">
          <section className="cn-dcard" aria-labelledby={`${ids}-conn`}>
            <h2 id={`${ids}-conn`} className="cn-dcard__title">
              Connection
            </h2>
            <dl className="cn-dl">
              {c.scope_picker && (
                <>
                  <dt>{c.scope_picker.label}</dt>
                  <dd>{c.scope?.label ?? "The whole account"}</dd>
                  <dd>
                    {c.status === "connected" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Change ${c.scope_picker.label.toLowerCase()}`}
                        onClick={() => setOverlay({ kind: "project" })}
                      >
                        Change
                      </Button>
                    )}
                  </dd>
                </>
              )}
              <dt>Access</dt>
              <dd>{accessLabel(c.access)}</dd>
              <dd>
                {canChangeAccess && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Change what agents may do"
                    onClick={() => setOverlay({ kind: "access" })}
                  >
                    Change
                  </Button>
                )}
              </dd>
              <dt>Connected</dt>
              <dd>{connectedOn(c.connected_at)}</dd>
              <dd />
              {keyed ? (
                <>
                  <dt>Key</dt>
                  <dd>{c.last_error ?? "Kept encrypted with this connector"}</dd>
                  <dd>
                    <Button variant="ghost" size="sm" onClick={signInAgain}>
                      Replace key
                    </Button>
                  </dd>
                </>
              ) : c.auth_kind === "oauth" ? (
                <>
                  <dt>Sign-in</dt>
                  <dd>
                    {c.last_error ??
                      (c.status === "pending" ? "Not finished yet" : "Renews by itself")}
                  </dd>
                  <dd>
                    <Button variant="ghost" size="sm" onClick={signInAgain}>
                      {c.status === "pending" ? "Sign in" : "Sign in again"}
                    </Button>
                  </dd>
                </>
              ) : (
                // It never signed in, so there is nothing to renew: it is connected again.
                c.status === "needs_signin" && (
                  <>
                    <dt>Sign-in</dt>
                    <dd>{reconnectReason(c)}</dd>
                    <dd>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOverlay({ kind: "disconnect" })}
                      >
                        Disconnect
                      </Button>
                    </dd>
                  </>
                )
              )}
            </dl>
          </section>

          <section className="cn-dcard" aria-labelledby={`${ids}-tools`}>
            <h2 id={`${ids}-tools`} className="cn-dcard__title">
              What agents can call
            </h2>
            {tools === null || tools.length === 0 ? (
              <div className="cn-dcard__empty">
                <span>
                  {tools === null
                    ? "Tvashtr couldn’t list this connector’s tools."
                    : "This server has no tools."}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={checking}
                  onClick={() => void check()}
                >
                  Check again
                </Button>
              </div>
            ) : (
              <>
                {noReads && c.access === "read" && (
                  <Note kind="warn" role="alert">
                    This server doesn’t mark any tool as read-only. Agents can’t call anything until
                    access is Read &amp; write.
                  </Note>
                )}
                <ul className="cn-tools">
                  {tools.map((t) => (
                    <li key={t.name} className={cx("cn-tool", !t.on && "cn-tool--off")}>
                      <span className="cn-tool__icon">
                        {t.on ? (
                          <Check size={13} strokeWidth={1.6} aria-hidden />
                        ) : (
                          <Lock size={12} strokeWidth={1.6} aria-hidden />
                        )}
                      </span>
                      <span className="cn-tool__name" title={t.title ?? undefined}>
                        {t.name}
                      </span>
                      <span className="cn-tool__badge">
                        {!t.on ? (
                          <Badge variant="outline">Off · write</Badge>
                        ) : t.write ? (
                          <Badge variant="accent">Write</Badge>
                        ) : (
                          <Badge variant="neutral">Read</Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <span className="cn-hint">{toolsHint(c)}</span>
              </>
            )}
          </section>
        </div>

        <div className="cn-dcol">
          <section className="cn-dcard" aria-labelledby={`${ids}-used`}>
            <div className="cn-dcard__head">
              <h2 id={`${ids}-used`} className="cn-dcard__title">
                {agents.length > 0 ? `Used by · ${plural(agents.length, "agent")}` : "Used by"}
              </h2>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Plus size={14} strokeWidth={1.6} aria-hidden />}
                disabled={c.status === "pending"}
                onClick={() => setOverlay({ kind: "give" })}
              >
                Give an agent access
              </Button>
            </div>
            {agents.length > 0 ? (
              <ul className="cn-used">
                {agents.map((a) => (
                  <li key={`${a.team_id}/${a.node_id}`} className="cn-used__row">
                    <span className="cn-used__who">
                      <a
                        className="cn-used__name"
                        href={routeToHash({
                          page: "team",
                          teamId: a.team_id,
                          node: a.node_id,
                          tab: "skills",
                        })}
                      >
                        {agentName(a)}
                      </a>
                      <span className="cn-used__team">{a.team_name}</span>
                    </span>
                    <AccessBadge access={a.access} />
                    <IconButton
                      size="sm"
                      aria-label={`Remove access for ${agentName(a)}`}
                      disabled={removing !== null}
                      onClick={() => void removeAccess(a)}
                    >
                      <X size={15} strokeWidth={1.6} aria-hidden />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cn-hint">
                No agent uses it yet. Give one access here, or tick it in an agent’s Skills &amp;
                tools tab.
              </p>
            )}
          </section>

          <section className="cn-dcard" aria-labelledby={`${ids}-recent`}>
            <h2 id={`${ids}-recent`} className="cn-dcard__title">
              Recent use
            </h2>
            {c.recent_use.length > 0 ? (
              <ul className="cn-recent">
                {c.recent_use.map((r) => (
                  <li key={`${r.run_id}/${r.agent}`} className="cn-recent__row">
                    <span className="cn-recent__run">
                      {r.run_number !== null ? `Run ${r.run_number}` : "Run"}
                    </span>
                    <span className="cn-recent__what">{recentUseLine(r)}</span>
                    <span className="cn-recent__when">{r.at ? formatRelativeTime(r.at) : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cn-hint">No agent has called it yet.</p>
            )}
          </section>
        </div>
      </div>

      {overlay?.kind === "signin" && (
        <ConnectSheet
          target={{ connection: c, mode: "signin", prepared: overlay.prepared }}
          onClose={closeSheet}
          onDone={(saved, what) => void onSheetDone(saved, what)}
        />
      )}
      {overlay?.kind === "project" && (
        <ConnectSheet
          target={{ connection: c, mode: "project" }}
          onClose={closeSheet}
          onDone={(saved, what) => void onSheetDone(saved, what)}
        />
      )}
      {overlay?.kind === "give" && (
        <GiveAccessDialog
          connection={c}
          onClose={() => setOverlay(null)}
          onSaved={(added) => {
            setOverlay(null);
            toast({ message: accessGivenToast(added, c.name) });
            void changed();
          }}
        />
      )}
      {overlay?.kind === "disconnect" && (
        <DisconnectDialog
          connection={c}
          detail={c}
          onClose={() => setOverlay(null)}
          onDisconnected={() => {
            void refreshBadges();
            toast({ message: `${c.name} is disconnected. It’s back in Browse if you need it.` });
            navigate(LIST, { replace: true });
          }}
        />
      )}
      {overlay?.kind === "access" && (
        <ChangeAccessDialog
          connection={c}
          onClose={() => setOverlay(null)}
          onSaved={(saved) => void onAccessSaved(saved)}
        />
      )}
    </>
  );
}

/** "Sep 28 by you": connections are yours alone. */
function connectedOn(iso: string | null): string {
  const when = formatUpdated(iso);
  return when === "—" || when === "Just now" ? when : `${when} by you`;
}

/**
 * An agent's "Connectors this agent can use" (Page-Agent-Skills-tools, CnF-Grant): every connection
 * of the account as a checkbox with its access, an Access select on a ticked connection that allows
 * writes, and "Sign in again" on one that needs attention. It edits the agent's
 * `tool_config.tvashtr.connectors` and the drawer saves it.
 *
 * "Connect an app" (CnF-FromAgent-1..3) connects one more without leaving the drawer: the Featured
 * connectors, then the connect sheet, and the new connection is ticked here, first and marked New,
 * until the agent is saved.
 *
 * Every list it writes keeps only connections that exist, so a grant to a disconnected connector
 * drops out on the next save, and "Remove" drops it right away. Until the list has loaded there is
 * nothing to tick, so a failed load can't wipe the agent's grants.
 */
import { useId, useRef, useState } from "react";
import { CircleCheck, Info, Pencil, Plus, TriangleAlert } from "lucide-react";

import { Badge, Button, Checkbox, Select } from "../../design-system/components";
import { type CatalogEntry, type Connection, listConnections } from "../../lib/api/connectors";
import { ConnectSheet } from "../../pages/connectors/ConnectSheet";
import { InfoTip } from "../InfoTip";
import { useLoaded } from "../runs/useLoaded";
import type { ConnectorGrant } from "../tools/nodeTools";
import { ConnectAppDialog } from "./ConnectAppDialog";
import {
  type OpenConnector,
  accessLine,
  connectorsHref,
  fixLabel,
  opening,
} from "./connectorFormat";
import "../../pages/domains/queryNode.css";
import "./connectors.css";

const ACCESS_OPTIONS = [
  { value: "read", label: "Read only" },
  { value: "write", label: "Read & write" },
];

export function ConnectorsChecklist({
  value,
  onChange,
  saved,
  onOpen,
  onBrowse,
  agentName,
  plan = null,
}: {
  /** The agent's grants (`connectorsOf`). */
  value: ConnectorGrant[];
  onChange: (grants: ConnectorGrant[]) => void;
  /** The grants as last saved: the "starts on read only" note goes once its tick is saved. */
  saved?: ConnectorGrant[];
  /**
   * Open one connection's page (`null`: the Connectors list). The drawer gives it so leaving asks
   * "Save your changes?" first; without it the links are plain addresses.
   */
  onOpen?: OpenConnector;
  /** Open Connectors › Browse the same way (the "Connect an app" dialog's "Open Connectors"). */
  onBrowse?: () => void;
  /** "Reviewer": names the agent in the Access select and the notes. */
  agentName?: string;
  /** "Claude" / "Grok" when the agent runs on that plan in Tvashtr Desktop (no connectors yet). */
  plan?: string | null;
}) {
  const list = useLoaded("connections", listConnections);
  // Connected from here since the list loaded ("Connect an app"), newest first.
  const [added, setAdded] = useState<Connection[]>([]);
  // The "Connect an app" dialog, then the sheet of the connector picked in it.
  const [connecting, setConnecting] = useState<"pick" | CatalogEntry | null>(null);
  const connections = list.value && [
    ...added,
    ...list.value.filter((c) => !added.some((a) => a.id === c.id)),
  ];
  // The write-capable connection ticked last: the callout says its access starts on read only.
  const [fresh, setFresh] = useState<string | null>(null);
  const headId = useId();
  const headRef = useRef<HTMLHeadingElement>(null);

  const known = new Set((connections ?? []).map((c) => c.id));
  const granted = connections ? value.filter((g) => known.has(g.id)) : value;
  const write = (next: ConnectorGrant[], ticked: string | null = null) => {
    setFresh(ticked);
    onChange(next);
  };
  const who = agentName ?? "This agent";
  const freshOne = connections?.find(
    (c) =>
      c.id === fresh && granted.some((g) => g.id === c.id) && !saved?.some((g) => g.id === c.id),
  );
  // Connected from here and not saved with this agent yet: its row says New.
  const isNew = (id: string) => added.some((a) => a.id === id) && !saved?.some((g) => g.id === id);
  const newOne = added.find((a) => isNew(a.id) && granted.some((g) => g.id === a.id));
  const connected = (c: Connection) => {
    setConnecting(null);
    setAdded((prev) => [c, ...prev.filter((a) => a.id !== c.id)]);
    if (!granted.some((g) => g.id === c.id)) write([...granted, { id: c.id, access: "read" }]);
  };
  // Grants whose connection no longer exists (known only once the list has loaded).
  const gone = value.length - granted.length;
  // "Try again" leaves the page when the list reloads, so focus moves to the heading.
  const retry = () => {
    list.retry();
    headRef.current?.focus();
  };
  const Note = plan ? TriangleAlert : newOne ? CircleCheck : freshOne ? Pencil : Info;

  return (
    <section
      className="nd-kit nd-kit--tools nd-conn"
      aria-labelledby={headId}
      aria-busy={list.state === "loading" || undefined}
    >
      <div className="nd-kit__head">
        <h3 className="nd-kit__title" id={headId} ref={headRef} tabIndex={-1}>
          Connectors
          <span className="nd-kit__count">{granted.length}</span>
          <InfoTip text="Apps you connected in Toolkit › Connectors. Tick the ones this agent may use." />
        </h3>
        {/* Off for an agent on a plan (nothing here reaches its runs) and until the list is known. */}
        <Button
          variant="secondary"
          size="sm"
          className="nd-btn-flush"
          disabled={plan !== null || list.state !== "ready"}
          onClick={() => setConnecting("pick")}
        >
          <Plus size={13} strokeWidth={1.6} aria-hidden />
          <span>Connect an app</span>
        </Button>
      </div>
      <span className="dm-dlist__head">Connectors this agent can use</span>
      {list.state === "loading" ? (
        <p className="dm-dlist__empty" role="status">
          Loading your connectors…
        </p>
      ) : list.state === "error" ? (
        <div className="nd-conn__error" role="alert">
          Couldn’t load your connectors.
          {/* Not a <button>: the run view shows this tab inside a disabled fieldset, which would
              switch a button off. */}
          <span
            role="button"
            tabIndex={0}
            className="nd-link"
            onClick={retry}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              retry();
            }}
          >
            Try again
          </span>
        </div>
      ) : connections && connections.length === 0 ? (
        <p className="dm-dlist__empty">
          You haven’t connected an app yet.{" "}
          <a className="nd-link" href={connectorsHref()} onClick={opening(onOpen, null)}>
            Open Connectors
          </a>
        </p>
      ) : (
        <div className="dm-dlist__items">
          {(connections ?? []).map((c) => {
            const grant = granted.find((g) => g.id === c.id);
            return (
              <div className="nd-conn__row" key={c.id}>
                <div className="nd-conn__check">
                  <Checkbox
                    label={c.name}
                    description={accessLine(c)}
                    checked={grant !== undefined}
                    disabled={plan !== null}
                    onChange={(e) =>
                      e.currentTarget.checked
                        ? write(
                            [...granted, { id: c.id, access: "read" }],
                            c.access === "write" ? c.id : null,
                          )
                        : write(granted.filter((g) => g.id !== c.id))
                    }
                  />
                </div>
                {isNew(c.id) && <Badge variant="success">New</Badge>}
                {c.status === "needs_signin" ? (
                  <a
                    className="nd-link"
                    href={connectorsHref(c.id)}
                    onClick={opening(onOpen, c.id)}
                  >
                    {fixLabel(c)}
                  </a>
                ) : (
                  grant &&
                  c.access === "write" && (
                    <div className="nd-conn__access">
                      <Select
                        size="sm"
                        aria-label={`What ${agentName ?? "this agent"} may do in ${c.name}`}
                        options={ACCESS_OPTIONS}
                        value={grant.access}
                        disabled={plan !== null}
                        onChange={(e) => {
                          const access = e.currentTarget.value === "write" ? "write" : "read";
                          write(granted.map((g) => (g.id === c.id ? { ...g, access } : g)));
                        }}
                      />
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
      {gone > 0 && (
        <div className="nd-conn__error">
          {gone === 1
            ? "1 connector this agent had is no longer connected."
            : `${gone} connectors this agent had are no longer connected.`}
          <button type="button" className="nd-link" onClick={() => write(granted)}>
            Remove
          </button>
        </div>
      )}
      <div
        className={`dm-dlist__callout nd-conn__callout${plan ? " nd-conn__callout--warn" : newOne ? " nd-conn__callout--ok" : freshOne ? " nd-conn__callout--plain" : ""}`}
        // Announced when it appears: nothing else on screen says the connect went through.
        role={!plan && newOne ? "status" : undefined}
      >
        <span className="dm-dlist__icon">
          <Note size={14} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="dm-dlist__text">
          {plan
            ? `${who} runs on your ${plan} plan in Tvashtr Desktop. Connectors and tools don’t reach plan runs yet. Give it an API-key model in Setup to use them.`
            : newOne
              ? `${newOne.name} is connected and ticked for ${agentName ?? "this agent"}. Save to keep it.`
              : freshOne
                ? `${freshOne.name} is connected with read & write, so you choose per agent. ${who} starts on read only.`
                : "During a run it can call the read tools of what’s ticked. Calls go through Tvashtr, so the agent never holds your sign-in."}
        </span>
      </div>
      {connecting === "pick" ? (
        <ConnectAppDialog
          agentName={agentName ?? "this agent"}
          connectedKeys={new Set((connections ?? []).map((c) => c.connector_key))}
          onPick={setConnecting}
          onBrowse={onBrowse}
          onClose={() => setConnecting(null)}
        />
      ) : (
        connecting && (
          <ConnectSheet
            target={{ entry: connecting }}
            onClose={() => setConnecting(null)}
            onDone={connected}
          />
        )
      )}
    </section>
  );
}

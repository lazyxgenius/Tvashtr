/**
 * An agent's "Connectors this agent can use" (Page-Agent-Skills-tools, CnF-Grant): every connection
 * of the account as a checkbox with its access, an Access select on a ticked connection that allows
 * writes, and "Sign in again" on one that needs attention. It edits the agent's
 * `tool_config.tvashtr.connectors` and the drawer saves it.
 *
 * Every list it writes keeps only connections that exist, so a grant to a disconnected connector
 * drops out on the next save. Until the list has loaded there is nothing to tick, so a failed load
 * can't wipe the agent's grants.
 */
import { useId, useState } from "react";
import { Info } from "lucide-react";

import { Checkbox, Select } from "../../design-system/components";
import { listConnections } from "../../lib/api/connectors";
import { InfoTip } from "../InfoTip";
import { useLoaded } from "../runs/useLoaded";
import type { ConnectorGrant } from "../tools/nodeTools";
import { accessLine, connectorsHref } from "./connectorFormat";
import "../../pages/domains/queryNode.css";
import "./connectors.css";

const ACCESS_OPTIONS = [
  { value: "read", label: "Read only" },
  { value: "write", label: "Read & write" },
];

export function ConnectorsChecklist({
  value,
  onChange,
  agentName,
  plan = null,
}: {
  /** The agent's grants (`connectorsOf`). */
  value: ConnectorGrant[];
  onChange: (grants: ConnectorGrant[]) => void;
  /** "Reviewer": names the agent in the Access select and the notes. */
  agentName?: string;
  /** "Claude" / "Grok" when the agent runs on that plan in Tvashtr Desktop (no connectors yet). */
  plan?: string | null;
}) {
  const list = useLoaded("connections", listConnections);
  const connections = list.value;
  // The write-capable connection ticked last: the callout says its access starts on read only.
  const [fresh, setFresh] = useState<string | null>(null);
  const headId = useId();

  const known = new Set((connections ?? []).map((c) => c.id));
  const granted = connections ? value.filter((g) => known.has(g.id)) : value;
  const write = (next: ConnectorGrant[], ticked: string | null = null) => {
    setFresh(ticked);
    onChange(next);
  };
  const who = agentName ?? "This agent";
  const freshOne = connections?.find((c) => c.id === fresh && granted.some((g) => g.id === c.id));

  return (
    <section className="nd-kit nd-kit--tools nd-conn" aria-labelledby={headId}>
      <div className="nd-kit__head">
        <h3 className="nd-kit__title" id={headId}>
          Connectors
          <span className="nd-kit__count">{granted.length}</span>
          <InfoTip text="Apps you connected in Toolkit › Connectors. Tick the ones this agent may use." />
        </h3>
      </div>
      <span className="dm-dlist__head">Connectors this agent can use</span>
      {list.state === "error" ? (
        <div className="nd-conn__error" role="alert">
          Couldn’t load your connectors.
          <button type="button" className="nd-link" onClick={list.retry}>
            Try again
          </button>
        </div>
      ) : connections && connections.length === 0 ? (
        <p className="dm-dlist__empty">
          You haven’t connected an app yet.{" "}
          <a className="nd-link" href={connectorsHref()}>
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
                {c.status === "needs_signin" ? (
                  // A plain address: it works before and after the Connectors routes land.
                  <a className="nd-link" href={connectorsHref(c.id)}>
                    Sign in again
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
      <div
        className={`dm-dlist__callout nd-conn__callout${freshOne && !plan ? " nd-conn__callout--plain" : ""}`}
      >
        <span className="dm-dlist__icon">
          <Info size={14} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="dm-dlist__text">
          {plan
            ? `${who} runs on your ${plan} plan in Tvashtr Desktop. Connectors and tools don’t reach plan runs yet. Give it an API-key model in Setup to use them.`
            : freshOne
              ? `${freshOne.name} is connected with read & write, so you choose per agent. ${who} starts on read only.`
              : "During a run it can call the read tools of what’s ticked. Calls go through Tvashtr, so the agent never holds your sign-in."}
        </span>
      </div>
    </section>
  );
}

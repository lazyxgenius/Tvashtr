/**
 * "Give agents access to <name>" (CnF-Page-1): pick a team, then tick the agents that may use the
 * connector. Agents that already have it are ticked and fixed (their access is removed on the
 * connector's page); an agent a Desktop plan runs says connectors don't reach it yet. Save sends
 * the full set — who had it plus who was ticked, in every team — and new agents start read only.
 */
import { useCallback, useEffect, useState } from "react";

import { Button, Checkbox, Dialog, Select } from "../../design-system/components";
import {
  type Connection,
  type ConnectorAgent,
  type ConnectorAgentsByTeam,
  type ConnectorAgentsSaved,
  connectorRefusal,
  listConnectorAgents,
  setConnectorAgents,
} from "../../lib/api/connectors";
import { agentName } from "../tools/toolFormat";

function description(agent: ConnectorAgent): string | undefined {
  if (agent.enabled) return "Already has access";
  if (agent.subscription) {
    const plan = agent.subscription === "claude" ? "Claude" : "Grok";
    return `Runs on your ${plan} plan. Connectors don’t reach plan runs yet.`;
  }
  return undefined;
}

export function GiveAccessDialog({
  connection,
  onClose,
  onSaved,
}: {
  connection: Connection;
  onClose: () => void;
  /** The names of the agents that were added, and who has it now. */
  onSaved: (added: string[], saved: ConnectorAgentsSaved) => void;
}) {
  const [teams, setTeams] = useState<ConnectorAgentsByTeam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const next = await listConnectorAgents(connection.id);
      setTeams(next);
      setTeamId((id) => id || (next[0]?.team_id ?? ""));
    } catch {
      setFailed(true);
    }
  }, [connection.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (!teams || picked.size === 0) return;
    // The dialog's order: team by team, left → right. Who has it keeps it.
    const all = teams.flatMap((t) => t.agents);
    setBusy(true);
    setError(null);
    try {
      const saved = await setConnectorAgents(
        connection.id,
        all.filter((a) => a.enabled || picked.has(a.node_id)).map((a) => a.node_id),
      );
      onSaved(all.filter((a) => picked.has(a.node_id)).map(agentName), saved);
    } catch (e) {
      setBusy(false);
      setError(connectorRefusal(e)?.message ?? "Couldn’t save who uses it. Try again.");
    }
  };

  const team = teams?.find((t) => t.team_id === teamId);

  return (
    <Dialog
      open
      title={`Give agents access to ${connection.name}`}
      onClose={() => !busy && onClose()}
      width={436}
      closeButton={false}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={picked.size === 0} loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <span className="cn-give__sub">
        {`Pick a team, then tick the agents that may use ${connection.name}.`}
      </span>
      {failed ? (
        <div className="cn-dcard__empty" role="alert">
          <span>Couldn’t load your agents.</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : teams === null ? (
        <p className="cn-hint" role="status">
          Loading agents…
        </p>
      ) : teams.length === 0 ? (
        <p className="cn-hint">No agents yet. Your teams’ agents show up here.</p>
      ) : (
        <>
          <Select
            label="Team"
            aria-label="Team"
            value={teamId}
            disabled={busy}
            onChange={(e) => setTeamId(e.target.value)}
            options={teams.map((t) => ({ value: t.team_id, label: t.team_name }))}
          />
          <div className="cn-give__agents" role="group" aria-label="Agents">
            {(team?.agents ?? []).map((a) => (
              <Checkbox
                key={a.node_id}
                label={agentName(a)}
                description={description(a)}
                checked={a.enabled || picked.has(a.node_id)}
                disabled={a.enabled || busy}
                onChange={() => toggle(a.node_id)}
              />
            ))}
          </div>
          <span className="cn-hint">
            {connection.access === "write"
              ? `${connection.name} is connected with read & write, so you choose per agent. New agents start on read only.`
              : "They get the connector’s access: read only."}
          </span>
        </>
      )}
      {error && (
        <div className="cn-error" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}

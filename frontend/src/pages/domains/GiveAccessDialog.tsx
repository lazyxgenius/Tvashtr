/**
 * "Let an agent search <name>" (DM-96, DmF-Agent-2; 560 wide): a search over agents and teams and
 * one radio row per agent — its title and "<Team> · <model>". Agents that can search it already
 * are listed but can't be picked; an agent a connected Desktop plan runs says it gets no Domains
 * tools there (B-16). Give access keeps every agent that already has access (the full set).
 */
import { useEffect, useState } from "react";

import { Button, Checkbox, Input } from "../../design-system/components";
import { type DomainAgent, listDomainAgents, setDomainAgents } from "../../lib/api/domains";
import { DomainDialog } from "./DomainDialog";
import { agentChoiceLine, matchesAgent, subscriptionNote } from "./useInTeamsFormat";
import "./teams.css";

const LOAD_FAILED = "Couldn’t load your agents — is the backend running?";

export function GiveAccessDialog({
  domainId,
  domainName,
  onClose,
  onGiven,
}: {
  domainId: string;
  domainName: string;
  onClose: () => void;
  onGiven: (agent: DomainAgent) => void;
}) {
  const [agents, setAgents] = useState<DomainAgent[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDomainAgents(domainId)
      .then((rows) => live && setAgents(rows))
      .catch(() => live && setError(LOAD_FAILED));
    return () => {
      live = false;
    };
  }, [domainId]);

  const shown = (agents ?? []).filter((a) => matchesAgent(a, query));
  const choice = agents?.find((a) => a.node_id === picked && !a.scope) ?? null;

  const submit = async () => {
    if (!agents || !choice || saving) return;
    setSaving(true);
    setError(null);
    try {
      const keep = agents.filter((a) => a.scope).map((a) => a.node_id);
      await setDomainAgents(domainId, [...keep, choice.node_id]);
      onGiven(choice);
    } catch (err) {
      setError(err instanceof Error ? err.message : LOAD_FAILED);
      setSaving(false);
    }
  };

  return (
    <DomainDialog
      title={`Let an agent search ${domainName}`}
      subtitle="Pick an agent. It can ask this domain whenever it needs to during a run."
      width={560}
      top={110}
      locked={saving}
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={!choice || saving}
            loading={saving}
          >
            Give access
          </Button>
        </>
      }
    >
      {agents && agents.length === 0 ? (
        <p className="dm-dlg__text">
          You don’t have any agents yet. Add a team on Home, then give its agents access.
        </p>
      ) : (
        <>
          <Input
            size="sm"
            type="search"
            placeholder="Search agents and teams"
            aria-label="Search agents and teams"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {agents && (
            <div className="dm-access__rows" role="radiogroup" aria-label="Agents">
              {shown.map((a) => (
                <Checkbox
                  key={a.node_id}
                  type="radio"
                  name="agent"
                  label={a.title}
                  description={
                    a.subscription && !a.scope ? (
                      <>
                        {agentChoiceLine(a)}
                        <span className="dm-access__note">{subscriptionNote(a.subscription)}</span>
                      </>
                    ) : (
                      agentChoiceLine(a)
                    )
                  }
                  checked={a.node_id === picked && !a.scope}
                  disabled={Boolean(a.scope) || saving}
                  onChange={() => setPicked(a.node_id)}
                />
              ))}
              {shown.length === 0 && (
                <p className="dm-access__none">No agents match “{query.trim()}”.</p>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="dm-dlg__error" role="alert">
          {error}
        </p>
      )}
    </DomainDialog>
  );
}

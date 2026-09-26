/**
 * "Turn <name> on for…" (TkF-AddTool-6, TOOL-47): every agent of your teams as a checkbox, grouped
 * under its team, with its role glyph and a `thinker` tag for edits-off agents. Opened for an
 * existing tool (the row's ⋯), the agents that already use it start checked and the confirm sends
 * the full set — unchecking one turns it off (spec Q4). The wizard (G6) opens it without a tool id
 * and holds the choice until "Add tool". The primary button counts the checked agents. On Desktop a
 * line says tools don't reach agents that run on this computer with a subscription (spec Q10).
 */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../design-system/components";
import { ApiDetailError } from "../../lib/api/runs";
import { type AgentTeam, listAgents } from "../../lib/api/tools";
import { isDesktopApp } from "../../lib/desktopRepos";
import { useModalDialog } from "../../lib/useModalDialog";
import { glyphForNode } from "../../panel/nodeGlyph";
import { agentName, plural } from "./toolFormat";
import "../secrets/secrets.css";

const SAVE_FAILED = "Couldn’t save who uses it. Try again.";

/** The teams and their agents, loaded when the dialog opens. */
function useAgentTeams(toolId: string | undefined) {
  const [teams, setTeams] = useState<AgentTeam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    setTeams(null);
    try {
      setTeams(await listAgents({ toolId }));
    } catch {
      setFailed(true);
    }
  }, [toolId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { teams, failed, retry: () => void load() };
}

export function TurnOnForAgentsDialog({
  toolName,
  toolId,
  initial,
  onClose,
  onConfirm,
}: {
  toolName: string;
  /** An existing tool: its current agents start checked. */
  toolId?: string;
  /** A choice already held (the wizard reopening the dialog). */
  initial?: string[];
  /** Skip, Escape or the scrim. */
  onClose: () => void;
  /** The full checked set; a rejection keeps the dialog open with an error. */
  onConfirm: (nodeIds: string[]) => Promise<void> | void;
}) {
  const { teams, failed, retry } = useAgentTeams(toolId);
  // Who uses it now: the held choice, else the server's `enabled` agents. Until you tick a box the
  // dialog shows exactly that; your first change starts from it.
  const serverOn = useMemo(
    () => (teams ?? []).flatMap((t) => t.agents.filter((a) => a.enabled).map((a) => a.node_id)),
    [teams],
  );
  const before = initial ?? serverOn;
  const [picked, setPicked] = useState<Set<string> | null>(initial ? new Set(initial) : null);
  const checked = picked ?? new Set(before);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => {
    if (!busy) onClose();
  };
  const ref = useModalDialog<HTMLDivElement>(true, cancel);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev ?? before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = checked.size;
  const turnsOff = count === 0 && before.length > 0;
  const canConfirm = teams !== null && teams.length > 0 && (count > 0 || turnsOff) && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canConfirm || !teams) return;
    // Keep the dialog's order: team by team, left → right.
    const ids = teams
      .flatMap((t) => t.agents.map((a) => a.node_id))
      .filter((id) => checked.has(id));
    setBusy(true);
    setError(null);
    try {
      await onConfirm(ids);
    } catch (err) {
      setBusy(false);
      const status = err instanceof ApiDetailError ? err.status : 0;
      const message = err instanceof Error && err.message ? err.message : "";
      setError(status >= 400 && status < 500 && message ? message : SAVE_FAILED);
    }
  };

  let body;
  if (failed) {
    body = (
      <div className="tk-turnon__state" role="alert">
        <span>Couldn’t load your agents.</span>
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  } else if (teams === null) {
    body = (
      <p className="tk-turnon__state" role="status">
        Loading agents…
      </p>
    );
  } else if (teams.length === 0) {
    body = <p className="tk-turnon__state">No agents yet. Your teams’ agents show up here.</p>;
  } else {
    body = teams.map((team) => (
      <div
        key={team.team_id}
        role="group"
        aria-labelledby={`tk-turnon-${team.team_id}`}
        className="tk-turnon__team"
      >
        <span id={`tk-turnon-${team.team_id}`} className="tk-turnon__teamname">
          {team.team_name}
        </span>
        {team.agents.map((a) => {
          const Glyph = glyphForNode(a.kind, a.role_name);
          return (
            <label key={a.node_id} className="tk-turnon__agent">
              <input
                type="checkbox"
                checked={checked.has(a.node_id)}
                onChange={() => toggle(a.node_id)}
                disabled={busy}
              />
              <Glyph size={14} strokeWidth={1.6} aria-hidden />
              {agentName(a)}
              <span className="tk-turnon__tag">{a.edits_allowed ? "" : "thinker"}</span>
            </label>
          );
        })}
      </div>
    ));
  }

  return createPortal(
    <>
      <div className="ds-scrim tk-turnon-scrim" onClick={cancel} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Turn on for agents"
        className="ds-dialog sc-dialog tk-turnon"
        tabIndex={-1}
      >
        <form className="tk-turnon__form" onSubmit={(e) => void submit(e)} noValidate>
          <h2 className="sc-dialog__title">{`Turn ${toolName} on for…`}</h2>
          <p className="tk-turnon__sub">
            Each agent can still switch it off in its Skills &amp; tools tab.
          </p>
          {body}
          {isDesktopApp() && (
            <p className="tk-turnon__note">
              Tools don’t reach agents that run on this computer with a Claude or Grok subscription.
            </p>
          )}
          {error && (
            <div className="sc-dialog__error" role="alert">
              {error}
            </div>
          )}
          <div className="sc-dialog__actions">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Skip
            </Button>
            <Button type="submit" size="sm" disabled={!canConfirm} loading={busy}>
              {turnsOff ? "Turn off for all agents" : `Turn on for ${plural(count, "agent")}`}
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}

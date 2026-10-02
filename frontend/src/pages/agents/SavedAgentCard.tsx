import { Layers, UserRound } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Button, useToast } from "../../design-system/components";
import { type SavedAgent, undoAgent, updateTeamAgent } from "../../lib/api/myAgents";
import { ApiDetailError } from "../../lib/api/runs";
import { behindPill, libraryMeta, usedInLine } from "../../lib/myAgentsFormat";

/**
 * One saved agent (Agents-Library / Agents-Page): its tile, name and version, what it's for, what
 * it's built on, the teams that use it, "1 team is on v1 · Update Bugfix squad" (with Undo), Use in
 * a team and its ⋯ menu.
 */
export function SavedAgentCard({
  agent,
  onUse,
  more,
  onChanged,
}: {
  agent: SavedAgent;
  /** "Use in a team". */
  onUse: () => void;
  /** The ⋯ "More for <name>" menu. */
  more: ReactNode;
  /** A team was updated (or put back): read the list again. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const nameId = useId();
  const used = usedInLine(agent);
  const pill = behindPill(agent);
  const failed = (err: unknown) =>
    toast({
      tone: "error",
      message: err instanceof ApiDetailError ? err.message : "Couldn’t update. Try again.",
    });
  const update = (teamId: string) =>
    void updateTeamAgent(agent.id, teamId).then((res) => {
      onChanged();
      toast({
        message: res.text,
        action: {
          label: "Undo",
          onClick: () =>
            void Promise.all(res.updated.map((u) => undoAgent(teamId, u.node_id, u.before))).then(
              onChanged,
              failed,
            ),
        },
      });
    }, failed);

  return (
    <article className="ag-card" aria-labelledby={nameId}>
      <span className="ag-card__tile" aria-hidden>
        <UserRound size={19} strokeWidth={1.6} />
      </span>
      <div className="ag-card__body">
        <div className="ag-card__title">
          <span id={nameId} className="ag-card__name">
            {agent.name}
          </span>
          <span className="ag-card__ver">v{agent.latest}</span>
        </div>
        {agent.purpose && <div className="ag-card__purpose">{agent.purpose}</div>}
        <div className="ag-card__meta">{libraryMeta(agent)}</div>
        {used && (
          <div className="ag-card__used">
            <Layers size={13} strokeWidth={1.6} aria-hidden />
            {used}
          </div>
        )}
        {pill && (
          <div className="ag-card__behind">
            <span className="ag-card__pill">{pill}</span>
            {agent.behind.map((b) => (
              <button
                key={b.team_id}
                type="button"
                className="ag-card__update"
                onClick={() => update(b.team_id)}
              >
                Update {b.team_name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ag-card__actions">
        <Button variant="secondary" size="sm" onClick={onUse}>
          Use in a team
        </Button>
        {more}
      </div>
    </article>
  );
}

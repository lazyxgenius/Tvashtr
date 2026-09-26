import { ClipboardCheck, Layers, Pencil, Terminal, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../../design-system/components";
import {
  type SkillAgent,
  type SkillAgentTeam,
  type SkillAgentsResult,
  getSkillAgents,
  setSkillAgents,
} from "../../lib/api/skills";
import { useModalDialog } from "../../lib/useModalDialog";
import { agentLabel, agentsActionLabel } from "./skillsModel";

type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/** The role glyph the agent pickers use (PM ⚡, Engineer >_, Reviewer clipboard, others a pen). */
function RoleIcon({ agent }: { agent: SkillAgent }) {
  const p = { size: 14, strokeWidth: 1.6, "aria-hidden": true } as const;
  const role = (agent.role_name ?? "").toLowerCase();
  if (role === "pm" || agent.kind === "completion") return <Zap {...p} />;
  if (role === "architect") return <Layers {...p} />;
  if (role === "engineer") return <Terminal {...p} />;
  if (role === "reviewer") return <ClipboardCheck {...p} />;
  return <Pencil {...p} />;
}

/**
 * "Turn on for agents…" (the row menu, and the "Choose agents" toast after saving a skill): every
 * agent by team with a checkbox, checked where the skill is already on; saving sends the full set
 * (`PUT /api/skill-library/{id}/agents`), so unchecking takes it off. Undesigned for skills — the
 * geometry mirrors Toolkit › Tools' "Turn on for agents" dialog (TkF-AddTool-6). Mount it per skill
 * (`key={skill.id}`).
 */
export function SkillAgentsDialog({
  skill,
  onClose,
  onSaved,
}: {
  skill: { id: string; name: string };
  onClose: () => void;
  onSaved: (result: SkillAgentsResult) => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const [teams, setTeams] = useState<Load<SkillAgentTeam[]>>({ state: "loading" });
  const [initial, setInitial] = useState<ReadonlySet<string>>(new Set());
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(() => {
    getSkillAgents(skill.id).then(
      (data) => {
        const on = new Set(data.flatMap((t) => t.agents.filter((a) => a.enabled)));
        const ids = new Set([...on].map((a) => a.node_id));
        setInitial(ids);
        setChecked(ids);
        setTeams({ state: "ready", data });
      },
      (e: unknown) => setTeams({ state: "error", message: errorText(e) }),
    );
  }, [skill.id]);
  useEffect(fetchAgents, [fetchAgents]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const changed = checked.size !== initial.size || [...checked].some((id) => !initial.has(id));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await setSkillAgents(skill.id, [...checked]));
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const empty = teams.state === "ready" && teams.data.every((t) => t.agents.length === 0);

  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Turn on for agents"
        className="ds-dialog sk-agents"
        tabIndex={-1}
      >
        <h2 className="sk-agents__title">Turn {skill.name} on for…</h2>
        {teams.state === "loading" && (
          <div className="sk-agents__lede" aria-busy="true">
            Loading your agents…
          </div>
        )}
        {teams.state === "error" && (
          <div className="sk-agents__lede" role="alert">
            {teams.message}
          </div>
        )}
        {empty && <div className="sk-agents__lede">You don’t have any agents yet.</div>}
        {teams.state === "ready" && !empty && (
          <>
            <div className="sk-agents__lede">
              Each agent can still switch it off in its Skills &amp; tools tab.
            </div>
            <div className="sk-agents__list">
              {teams.data
                .filter((t) => t.agents.length > 0)
                .map((team) => (
                  <div key={team.team_id} className="sk-agents__team">
                    <span className="sk-agents__team-name">{team.team_name}</span>
                    {team.agents.map((a) => (
                      <label key={a.node_id} className="sk-agents__row">
                        <input
                          type="checkbox"
                          checked={checked.has(a.node_id)}
                          onChange={() => toggle(a.node_id)}
                        />
                        <RoleIcon agent={a} />
                        {agentLabel(a)}
                        <span className="sk-agents__tag">
                          {a.overridden ? "own copy wins" : a.edits_allowed ? "" : "thinker"}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
            </div>
          </>
        )}
        {error && (
          <div className="sk-agents__error" role="alert">
            {error}
          </div>
        )}
        <div className="ds-dialog__actions">
          {teams.state === "error" ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setTeams({ state: "loading" });
                  fetchAgents();
                }}
              >
                Try again
              </Button>
            </>
          ) : empty ? (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={teams.state !== "ready" || !changed}
                loading={saving}
                onClick={() => void save()}
              >
                {agentsActionLabel(checked.size, initial.size > 0)}
              </Button>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

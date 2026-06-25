import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Template, TeamSummary } from "../lib/api";

/**
 * The teams rail (P1.8b team library): the docked LEFT shelf of the user's library teams, shown in
 * the authoring view beside the persistent canvas. It lists each team (the current one highlighted),
 * offers a `+ New team` action that opens an INLINE template picker (calm, no modal — the panel
 * aesthetic), and a per-row delete with an inline confirm. Selecting a team hands its id up; the
 * parent makes it current, closes any open node panel, and loads its graph. "Editing a team" is the
 * existing click-a-node → prompt/model panel on the same canvas — there is no separate editor here.
 */
export function TeamsRail({
  teams,
  currentTeamId,
  templates,
  onSelect,
  onCreate,
  onDelete,
  busy = false,
}: {
  teams: TeamSummary[];
  currentTeamId: string | null;
  templates: Template[];
  onSelect: (teamId: string) => void;
  onCreate: (template: string, name: string) => void | Promise<void>;
  onDelete: (teamId: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canCreate = template !== null && name.trim().length > 0 && !busy;

  const startPicking = () => {
    setConfirmId(null);
    setTemplate(templates[0]?.template ?? null);
    setName("");
    setPicking(true);
  };
  const cancelPicking = () => {
    setPicking(false);
    setTemplate(null);
    setName("");
  };
  const submit = async () => {
    if (!canCreate || template === null) return;
    await onCreate(template, name.trim());
    cancelPicking();
  };

  return (
    <aside className="tv-rail" aria-label="Your teams">
      <div className="tv-rail__head">
        <h2 className="tv-rail__title">Your teams</h2>
        <button
          type="button"
          className="tv-rail__new"
          onClick={picking ? cancelPicking : startPicking}
          aria-expanded={picking}
          disabled={busy}
        >
          <Plus size={15} strokeWidth={2} />
          New team
        </button>
      </div>

      {picking && (
        <div className="tv-rail__picker" aria-label="New team from a template">
          <div className="tv-rail__picker-label">Start from a template, or from scratch</div>
          <ul className="tv-rail__templates">
            {/* P1.8d: a blank team seeds the minimal valid skeleton (root thinker → Ship) the user
                then wires up with the canvas palette + edge drawing. */}
            <li key="blank">
              <button
                type="button"
                className={`tv-rail__template${template === "blank" ? " tv-rail__template--active" : ""}`}
                onClick={() => setTemplate("blank")}
                aria-pressed={template === "blank"}
              >
                <span className="tv-rail__template-name">Blank team</span>
                <span className="tv-rail__template-desc">
                  Start from a single thinker → Ship and author your own wiring.
                </span>
              </button>
            </li>
            {templates.map((t) => {
              const chosen = template === t.template;
              return (
                <li key={t.template}>
                  <button
                    type="button"
                    className={`tv-rail__template${chosen ? " tv-rail__template--active" : ""}`}
                    onClick={() => setTemplate(t.template)}
                    aria-pressed={chosen}
                  >
                    <span className="tv-rail__template-name">{t.name}</span>
                    <span className="tv-rail__template-desc">{t.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="tv-field">
            <span className="tv-field__label">Team name</span>
            <input
              className="tv-rail__name"
              type="text"
              value={name}
              placeholder="e.g. My shipping team"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="tv-rail__picker-actions">
            <button
              className="tv-btn"
              type="button"
              onClick={() => void submit()}
              disabled={!canCreate}
            >
              Create team
            </button>
            <button
              className="tv-btn tv-btn--ghost"
              type="button"
              onClick={cancelPicking}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="tv-rail__list">
        {teams.map((team) => {
          const active = team.team_graph_id === currentTeamId;
          const confirming = confirmId === team.team_graph_id;
          return (
            <li
              key={team.team_graph_id}
              className={`tv-rail__item${active ? " tv-rail__item--active" : ""}`}
            >
              <button
                type="button"
                className="tv-rail__select"
                onClick={() => onSelect(team.team_graph_id)}
                aria-current={active}
              >
                <span className="tv-rail__name-text">{team.name}</span>
                <span className="tv-rail__count">{team.node_count} nodes</span>
              </button>
              {confirming ? (
                <div className="tv-rail__confirm">
                  <span className="tv-rail__confirm-q">Delete?</span>
                  <button
                    type="button"
                    className="tv-rail__confirm-yes"
                    onClick={() => {
                      setConfirmId(null);
                      void onDelete(team.team_graph_id);
                    }}
                    disabled={busy}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="tv-rail__confirm-no"
                    onClick={() => setConfirmId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="tv-rail__delete"
                  onClick={() => setConfirmId(team.team_graph_id)}
                  aria-label={`Delete ${team.name}`}
                  title="Delete team"
                  disabled={busy}
                >
                  <Trash2 size={15} strokeWidth={1.7} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

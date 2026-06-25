import { useState } from "react";
import { X } from "lucide-react";

import { MODEL_PRESETS, type TeamGraphNode, updateTeamNode } from "../lib/api";

// Friendly titles for the seeded template roles; any other role falls back to its raw name.
const ROLE_TITLES: Record<string, string> = {
  pm: "Product manager",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

/**
 * The team-authoring editor (P1.8b): the right-hand panel shown when an **agent** node
 * (`completion`/`agent`) is selected on the persistent team canvas. It edits the node's two
 * authorable fields — its **prompt** (the node's whole identity in the prompt-driven model) and
 * its **model** (free text, with a tiny set of proven presets as datalist quick-picks). Save is
 * explicit and **dirty-aware** (no autosave): it PATCHes the node-update endpoint, then asks the
 * parent to refetch the team. Gate/terminal nodes never reach this panel (the canvas only opens it
 * for agent/completion nodes), so there is no editable surface for the control primitives.
 *
 * Reset-on-select is handled by a `key` on the parent mount (keyed on the selected role, which is
 * unique per node in the seeded team): selecting a different node remounts with fresh state, while
 * a post-save refetch of the SAME node keeps the local edits + the "Saved" note (the values now
 * match, so the panel reads clean).
 */
export function TeamNodePanel({
  teamId,
  node,
  onSaved,
  onClose,
}: {
  teamId: string;
  node: TeamGraphNode | null;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(node?.prompt ?? "");
  const [model, setModel] = useState(node?.model ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  const title = node ? (ROLE_TITLES[node.role_name] ?? node.role_name) : "Node";

  const dirty = node !== null && (prompt !== (node.prompt ?? "") || model !== (node.model ?? ""));
  const canSave = dirty && !saving && prompt.trim().length > 0 && model.trim().length > 0;

  const handleSave = async () => {
    if (!node || !canSave) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateTeamNode(teamId, node.id, prompt, model);
      setSaved(true);
      await onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="tv-panel" aria-label={`${title} editor`}>
      <header className="tv-panel__head">
        <div>
          <div className="tv-panel__title">{title}</div>
          <div className="tv-panel__subtitle">
            Its prompt is its whole identity — edit, then run
          </div>
        </div>
        <button
          type="button"
          className="tv-panel__close"
          onClick={onClose}
          aria-label="Close panel"
          title="Close"
        >
          <X size={18} strokeWidth={1.7} />
        </button>
      </header>

      <div className="tv-panel__body">
        {!node ? (
          <div className="tv-scroll">
            <p className="tv-panel-note">This node isn’t editable.</p>
          </div>
        ) : (
          <div className="tv-scroll tv-node-edit">
            <label className="tv-field">
              <span className="tv-field__label">Prompt</span>
              <span className="tv-field__hint">
                The agent’s behavior. The run appends the idea + the live PRD on top of this.
              </span>
              <textarea
                className="tv-node-prompt"
                value={prompt}
                rows={14}
                spellCheck={false}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setSaved(false);
                }}
              />
            </label>

            <label className="tv-field">
              <span className="tv-field__label">Model</span>
              <span className="tv-field__hint">
                Free text — pick a proven preset or type any provider/model slug.
              </span>
              <input
                className="tv-node-model"
                type="text"
                list="tv-model-presets"
                value={model}
                spellCheck={false}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSaved(false);
                }}
              />
              <datalist id="tv-model-presets">
                {MODEL_PRESETS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            <div className="tv-prd__editbar">
              <button
                className="tv-btn"
                type="button"
                onClick={() => void handleSave()}
                disabled={!canSave}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {dirty ? (
                <span className="tv-prd__dirty">Unsaved changes</span>
              ) : saved ? (
                <span className="tv-prd__saved">Saved — this drives the next run you launch.</span>
              ) : null}
              {saveError && <span className="tv-prd__saveerr">Couldn’t save — try again.</span>}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

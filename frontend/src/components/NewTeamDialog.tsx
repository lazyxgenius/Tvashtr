import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { createTeam, getTemplates, type Template } from "../lib/api";

// The Blank starting-point the FE adds ahead of the server templates — the minimal valid skeleton
// (one thinker → Ship) the backend materializes for the "blank" key.
const BLANK_CARD: Template = {
  template: "blank",
  name: "Blank",
  description: "Start from an empty canvas — one thinker into Ship. Wire the rest yourself.",
};

/**
 * The New-team template picker (F2c) — a warm centered pop-up over a dimmed dashboard (the shared
 * `.tv-scrim` + a `.tv-dash__dialog` card). A name field + the starting-point cards (a FE-added
 * Blank + one card per `getTemplates()`); selecting a card highlights it. Create →
 * `createTeam(selectedKey, name)` → `onOpenTeam(new id)` lands on the canvas in authoring mode.
 * Cancel / close / the scrim dismiss.
 */
export function NewTeamDialog({
  onOpenTeam,
  onClose,
}: {
  onOpenTeam: (teamId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("New team");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string>(BLANK_CARD.template);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the starter templates — is the backend running?");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [BLANK_CARD, ...templates];

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await createTeam(selected, name.trim() || "New team");
      onOpenTeam(created.team_graph_id);
    } catch {
      setError("Couldn't create the team — is the backend running?");
      setCreating(false);
    }
  };

  return (
    <>
      <div className="tv-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="tv-dash__dialog tv-card"
        role="dialog"
        aria-modal="true"
        aria-label="New team"
      >
        <header className="tv-dash__dialog-head">
          <h2 className="tv-dash__dialog-title">New team</h2>
          <button type="button" className="tv-panel__close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.7} />
          </button>
        </header>

        <div className="tv-dash__dialog-body">
          <label className="tv-field">
            <span className="tv-field__label">Name</span>
            <input
              className="tv-launch__input"
              value={name}
              aria-label="Team name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className="tv-field">
            <span className="tv-field__label">Starting point</span>
            <ul className="tv-dash__templates">
              {cards.map((c) => (
                <li key={c.template}>
                  <button
                    type="button"
                    className={`tv-dash__template${
                      selected === c.template ? " tv-dash__template--active" : ""
                    }`}
                    aria-pressed={selected === c.template}
                    onClick={() => setSelected(c.template)}
                  >
                    <span className="tv-dash__template-name">{c.name}</span>
                    <span className="tv-dash__template-desc">{c.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {error && (
            <div className="tv-dash__error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="tv-dash__dialog-foot">
          <button
            type="button"
            className="tv-btn"
            onClick={() => void create()}
            disabled={creating}
          >
            {creating ? "Creating…" : "Create team"}
          </button>
          <button type="button" className="tv-btn tv-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </>
  );
}

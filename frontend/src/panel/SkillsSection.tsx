import { useState } from "react";

import type { SkillSource } from "../lib/api";

/**
 * M-tools C7.B — the per-node **Skills** editor. Renders for BOTH thinker and worker nodes (a worker
 * gets an AgentContext; a thinker folds the same resolved skills into its prompt), so — unlike Tools —
 * it takes no `capability`. It authors the `skills` source array the resolver
 * (`control_plane/node_skills.py`) turns into SDK Skill objects at run time:
 *  - **New skill (inline)** — a name + SKILL.md content + a disclosure mode (Always / On trigger /
 *    Agent decides); On-trigger reveals a trigger-words input.
 *  - **Add from a repo** — a URL + pinned ref (+ optional filter) → a `repo` source.
 *  - **Use this repo's own rules** — a toggle for the single `project_rules` source.
 * Each source shows a badge + a remove control. Clearing the last source calls `onChange(null)` (the
 * C7.A clear-path then PATCHes `skills: null`). The props match the C7.0 stub exactly so
 * `TeamNodePanel` stays untouched.
 */

type Mode = InlineSkillSource["mode"];
type InlineSkillSource = Extract<SkillSource, { type: "inline" }>;

const MODE_LABELS: Record<Mode, string> = {
  always: "Always",
  trigger: "On trigger",
  agent: "Agent decides",
};

const BADGE_LABEL: Record<SkillSource["type"], string> = {
  inline: "Inline",
  repo: "Repo",
  project_rules: "Repo rules",
};

const BADGE_CLASS: Record<SkillSource["type"], string> = {
  inline: "tv-badge tv-badge--accent",
  repo: "tv-badge tv-badge--neutral",
  project_rules: "tv-badge tv-badge--outline",
};

function sourceLabel(s: SkillSource): string {
  if (s.type === "inline") return s.name || "(unnamed skill)";
  if (s.type === "repo") return s.url || "(repo)";
  return "This repo’s own rules";
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
} as const;

export function SkillsSection({
  value,
  onChange,
}: {
  value: unknown[] | null;
  onChange: (value: unknown[] | null) => void;
}) {
  const sources = (value ?? []) as SkillSource[];
  const [open, setOpen] = useState(true);

  // New-inline draft.
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("always");
  const [triggers, setTriggers] = useState("");

  // Add-from-repo draft.
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [filter, setFilter] = useState("");

  const hasProjectRules = sources.some((s) => s.type === "project_rules");

  // Persist the source list — an empty list clears to null so C7.A's PATCH sends `skills: null`.
  const emit = (next: SkillSource[]) => onChange(next.length > 0 ? next : null);

  const addInline = () => {
    if (!name.trim() || !content.trim()) return;
    const src: InlineSkillSource =
      mode === "trigger"
        ? {
            type: "inline",
            name: name.trim(),
            content,
            mode,
            triggers: triggers
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : { type: "inline", name: name.trim(), content, mode };
    emit([...sources, src]);
    setName("");
    setContent("");
    setTriggers("");
    setMode("always");
  };

  const addRepo = () => {
    if (!url.trim() || !ref.trim()) return;
    const src: SkillSource = {
      type: "repo",
      url: url.trim(),
      ref: ref.trim(),
      ...(filter.trim() ? { filter: filter.trim() } : {}),
    };
    emit([...sources, src]);
    setUrl("");
    setRef("");
    setFilter("");
  };

  const toggleProjectRules = () => {
    emit(
      hasProjectRules
        ? sources.filter((s) => s.type !== "project_rules")
        : [...sources, { type: "project_rules" }],
    );
  };

  const removeAt = (idx: number) => emit(sources.filter((_, i) => i !== idx));

  return (
    <details
      className="tv-field tv-skills"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="tv-field__label">
        Skills{sources.length > 0 ? ` · ${sources.length}` : ""}
      </summary>
      <span className="tv-field__hint">
        Reusable know-how for this node. A worker gets them as context/tools; a thinker folds them
        into its prompt.
      </span>

      {sources.length > 0 && (
        <ul
          className="tv-skills__rows"
          aria-label="Skill sources"
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0.5rem 0",
            display: "grid",
            gap: "0.35rem",
          }}
        >
          {sources.map((s, i) => (
            <li className="tv-skills__row" key={`${s.type}-${i}`} style={rowStyle}>
              <span className={BADGE_CLASS[s.type]}>{BADGE_LABEL[s.type]}</span>
              <span
                className="tv-skills__label"
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {sourceLabel(s)}
              </span>
              <button
                type="button"
                className="tv-btn tv-btn--link tv-btn--sm"
                aria-label={`Remove ${sourceLabel(s)}`}
                onClick={() => removeAt(i)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* New inline skill */}
      <div
        className="tv-skills__add"
        style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}
      >
        <span className="tv-field__label">New skill</span>
        <input
          className="tv-launch__input"
          aria-label="Skill name"
          placeholder="name (e.g. house-style)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="tv-node-prompt"
          aria-label="Skill content (SKILL.md)"
          rows={4}
          spellCheck={false}
          placeholder="SKILL.md content…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="tv-seg" role="group" aria-label="Disclosure mode">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={mode === m}
              className={`tv-seg__btn${mode === m ? " tv-seg__btn--active" : ""}`}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode === "trigger" && (
          <input
            className="tv-launch__input"
            aria-label="Trigger words"
            placeholder="comma-separated trigger words"
            value={triggers}
            onChange={(e) => setTriggers(e.target.value)}
          />
        )}
        <span className="tv-field__hint">
          {mode === "always"
            ? "Always active — its full content rides in every prompt."
            : mode === "trigger"
              ? "Surfaced only when the conversation matches a trigger word."
              : "Listed as a skill the agent can choose to open on demand."}
        </span>
        <button
          type="button"
          className="tv-btn tv-btn--sm"
          disabled={!name.trim() || !content.trim()}
          onClick={addInline}
        >
          Add skill
        </button>
      </div>

      {/* Add from a repo */}
      <div
        className="tv-skills__add"
        style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}
      >
        <span className="tv-field__label">Add from a repo</span>
        <input
          className="tv-launch__input"
          aria-label="Repository URL"
          placeholder="https://github.com/org/skills"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="tv-launch__input"
          aria-label="Repository ref"
          placeholder="ref — a branch, tag, or commit (pins reproducibility)"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <input
          className="tv-launch__input"
          aria-label="Repository filter"
          placeholder="filter (optional) — narrow to a subset"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="tv-btn tv-btn--sm"
          disabled={!url.trim() || !ref.trim()}
          onClick={addRepo}
        >
          Add repo
        </button>
      </div>

      {/* Adopt this repo's own rules */}
      <label
        className="tv-skills__toggle"
        style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginTop: "0.6rem" }}
      >
        <input
          type="checkbox"
          aria-label="Use this repo's own rules"
          checked={hasProjectRules}
          onChange={toggleProjectRules}
        />
        <span>
          <span className="tv-field__label">Use this repo’s own rules</span>
          <span className="tv-field__hint">
            When the run works on a real folder, adopt its CLAUDE.md / .cursorrules / AGENTS.md and
            .cursor/rules.
          </span>
        </span>
      </label>
    </details>
  );
}

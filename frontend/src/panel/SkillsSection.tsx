import { useEffect, useState } from "react";

import type { SkillLibraryItem, SkillPresetEntry, SkillSource } from "../lib/api";
import { createSkillLibraryItem, listSkillLibrary, listSkillPresets } from "../lib/api";

/**
 * M-tools C7.B + C7.C — the per-node **Skills** editor. Renders for BOTH thinker and worker nodes (a
 * worker gets an AgentContext; a thinker folds the same resolved skills into its prompt), so — unlike
 * Tools — it takes no `capability`. It authors the `skills` source array the resolver
 * (`control_plane/node_skills.py`) turns into SDK Skill objects at run time:
 *  - **New skill (inline)** — a name + SKILL.md content + a disclosure mode (Always / On trigger /
 *    Agent decides); On-trigger reveals a trigger-words input.
 *  - **Add from a repo** — a URL + pinned ref (+ optional filter) → a `repo` source.
 *  - **Use this repo's own rules** — a toggle for the single `project_rules` source.
 *  - **(C7.C) Add from library** — reference a reusable account-library skill by id (appends a
 *    `{type:"library",id}` source); referenced skills render as **Library**-badged rows. When a
 *    library skill's name collides with an earlier source's name a muted "overridden" tag shows
 *    (first-in-list wins — the resolver de-dups by name).
 * Each source shows a badge + a remove control. Clearing the last source calls `onChange(null)`. The
 * props match the C7.0 stub exactly so `TeamNodePanel` stays untouched.
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
  library: "Library",
};

const BADGE_CLASS: Record<SkillSource["type"], string> = {
  inline: "tv-badge tv-badge--accent",
  repo: "tv-badge tv-badge--neutral",
  project_rules: "tv-badge tv-badge--outline",
  library: "tv-badge tv-badge--accent",
};

// The display label for a source's row (the library item's name is resolved from the account list).
function labelOf(s: SkillSource, lib: SkillLibraryItem[]): string {
  if (s.type === "inline") return s.name || "(unnamed skill)";
  if (s.type === "repo") return s.url || "(repo)";
  if (s.type === "project_rules") return "This repo’s own rules";
  const item = lib.find((x) => x.id === s.id);
  return item ? item.name : "(removed from library)";
}

// The name used for the first-in-list "overridden" check — null when unknowable at author time
// (a repo/project_rules source, or a library ref to a repo/project_rules skill).
function overrideNameOf(s: SkillSource, lib: SkillLibraryItem[]): string | null {
  if (s.type === "inline") return s.name || null;
  if (s.type === "library") {
    const item = lib.find((x) => x.id === s.id);
    return item && item.source.type === "inline" ? item.name : null;
  }
  return null;
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

  // C7.C: the account's library skills — to resolve a referenced id to its name + power the picker.
  const [librarySkills, setLibrarySkills] = useState<SkillLibraryItem[]>([]);
  const [presets, setPresets] = useState<SkillPresetEntry[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);

  useEffect(() => {
    let live = true;
    listSkillLibrary()
      .then((s) => live && setLibrarySkills(s))
      .catch(() => {});
    listSkillPresets()
      .then((p) => live && setPresets(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const hasProjectRules = sources.some((s) => s.type === "project_rules");
  const referencedIds = new Set(sources.flatMap((s) => (s.type === "library" ? [s.id] : [])));

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

  const addLibraryRef = (id: string) => {
    if (referencedIds.has(id)) return;
    emit([...sources, { type: "library", id }]);
    setShowPicker(false);
  };

  const addFromPreset = async (entry: SkillPresetEntry) => {
    if (!entry.attachable) return;
    setPresetBusy(true);
    try {
      const item = librarySkills.find((s) => s.name === entry.name) ?? null;
      let id = item?.id;
      if (!id) {
        const created = await createSkillLibraryItem(entry.name, entry.source);
        id = created.id;
        setLibrarySkills((prev) =>
          prev.some((s) => s.id === id)
            ? prev
            : [
                ...prev,
                {
                  id: created.id,
                  name: created.name,
                  source: entry.source,
                  created_at: "",
                },
              ],
        );
      }
      addLibraryRef(id);
      setShowPresets(false);
    } catch {
      // keep editor usable if the library upsert fails
    } finally {
      setPresetBusy(false);
    }
  };

  const toggleProjectRules = () => {
    emit(
      hasProjectRules
        ? sources.filter((s) => s.type !== "project_rules")
        : [...sources, { type: "project_rules" }],
    );
  };

  const removeAt = (idx: number) => emit(sources.filter((_, i) => i !== idx));

  // Precompute the first-in-list "overridden" flags (the resolver de-dups by name, first wins).
  const seenNames = new Set<string>();
  const rows = sources.map((s, i) => {
    const overrideName = overrideNameOf(s, librarySkills);
    const overridden = overrideName != null && seenNames.has(overrideName);
    if (overrideName != null) seenNames.add(overrideName);
    return { s, i, label: labelOf(s, librarySkills), overridden };
  });

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
          {rows.map(({ s, i, label, overridden }) => (
            <li className="tv-skills__row" key={`${s.type}-${i}`} style={rowStyle}>
              <span className={BADGE_CLASS[s.type]}>{BADGE_LABEL[s.type]}</span>
              <span
                className="tv-skills__label"
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {label}
              </span>
              {overridden && (
                <span className="tv-field__hint" style={{ fontStyle: "italic" }}>
                  overridden
                </span>
              )}
              <button
                type="button"
                className="tv-btn tv-btn--link tv-btn--sm"
                aria-label={`Remove ${label}`}
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

      {/* Add from built-in presets */}
      <div
        className="tv-skills__add"
        style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}
      >
        <button
          type="button"
          className="tv-btn tv-btn--sm"
          aria-label="Add from presets"
          disabled={presetBusy}
          onClick={() => setShowPresets((v) => !v)}
        >
          Add from presets
        </button>
        {showPresets && (
          <ul
            aria-label="Skill presets picker"
            style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}
          >
            {presets.length === 0 ? (
              <li className="tv-field__hint">No presets available.</li>
            ) : (
              presets.map((entry) => {
                const alreadyName = librarySkills.some((s) => s.name === entry.name);
                const alreadyRef = librarySkills.some(
                  (s) => s.name === entry.name && referencedIds.has(s.id),
                );
                return (
                  <li key={`preset-${entry.key}`} style={rowStyle}>
                    <span className="tv-mcp-badge">{entry.badge}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{entry.title}</span>
                    <button
                      type="button"
                      className="tv-btn tv-btn--sm"
                      aria-label={`Add ${entry.name} from presets`}
                      disabled={presetBusy || alreadyRef}
                      onClick={() => void addFromPreset(entry)}
                    >
                      {alreadyRef ? "added" : alreadyName ? "Attach" : "Add"}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {/* Add from the account library */}
      <div
        className="tv-skills__add"
        style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}
      >
        <button
          type="button"
          className="tv-btn tv-btn--sm"
          aria-label="Add from library"
          onClick={() => setShowPicker((v) => !v)}
        >
          Add from library
        </button>
        {showPicker && (
          <ul
            aria-label="Skill library picker"
            style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}
          >
            {librarySkills.length === 0 ? (
              <li className="tv-field__hint">
                No library skills yet — add one in Toolkit › Skills.
              </li>
            ) : (
              librarySkills.map((item) => {
                const already = referencedIds.has(item.id);
                return (
                  <li key={`pick-${item.id}`} style={rowStyle}>
                    <span className="tv-badge tv-badge--outline">{item.source.type}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{item.name}</span>
                    <button
                      type="button"
                      className="tv-btn tv-btn--sm"
                      aria-label={`Add ${item.name} from library`}
                      disabled={already}
                      onClick={() => addLibraryRef(item.id)}
                    >
                      {already ? "added" : "Add"}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
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

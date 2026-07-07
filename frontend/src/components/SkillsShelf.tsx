import { useEffect, useRef, useState } from "react";
import { BookMarked, X } from "lucide-react";

import {
  createSkillLibraryItem,
  deleteSkillLibraryItem,
  type LibrarySkillItemSource,
  listSkillLibrary,
  type SkillLibraryItem,
  updateSkillLibraryItem,
} from "../lib/api";

/**
 * M-tools C7.C — the account's central **Skill library** shelf, beside the Providers/Secrets/Tools
 * shelves. A reusable skill defined ONCE here can be REFERENCED from any node's Skills section (the
 * node stores only the id; the resolver fetches this source fresh each run). Editing here propagates
 * to every referencing node's next run.
 *
 * One row = one skill source: a display name + an **inline** SKILL.md (content + disclosure mode) or a
 * **repo** pointer (url + pinned ref [+ filter]).
 */
type Mode = "always" | "trigger" | "agent";
const MODE_LABELS: Record<Mode, string> = {
  always: "Always",
  trigger: "On trigger",
  agent: "Agent decides",
};

function badgeOf(source: LibrarySkillItemSource): string {
  if (source.type === "repo") return "Repo";
  if (source.type === "project_rules") return "Repo rules";
  return "Inline";
}

export function SkillsShelf() {
  const [skills, setSkills] = useState<SkillLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<"inline" | "repo">("inline");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<Mode>("always");
  const [triggers, setTriggers] = useState("");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [filter, setFilter] = useState("");
  const mounted = useRef(true);

  const reload = async () => {
    const s = await listSkillLibrary();
    if (mounted.current) setSkills(s);
  };

  useEffect(() => {
    mounted.current = true;
    listSkillLibrary()
      .then((s) => mounted.current && setSkills(s))
      .catch(() => {})
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
    };
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setKind("inline");
    setName("");
    setContent("");
    setMode("always");
    setTriggers("");
    setUrl("");
    setRef("");
    setFilter("");
  };

  const startEdit = (s: SkillLibraryItem) => {
    setEditingId(s.id);
    setName(s.name);
    if (s.source.type === "repo") {
      setKind("repo");
      setUrl(s.source.url);
      setRef(s.source.ref);
      setFilter(s.source.filter ?? "");
    } else if (s.source.type === "inline") {
      setKind("inline");
      setContent(s.source.content);
      setMode(s.source.mode);
      setTriggers((s.source.triggers ?? []).join(", "));
    }
  };

  const buildSource = (label: string): LibrarySkillItemSource | null => {
    if (kind === "repo") {
      if (!url.trim() || !ref.trim()) return null;
      return {
        type: "repo",
        url: url.trim(),
        ref: ref.trim(),
        ...(filter.trim() ? { filter: filter.trim() } : {}),
      };
    }
    if (!content.trim()) return null;
    return mode === "trigger"
      ? {
          type: "inline",
          name: label,
          content,
          mode,
          triggers: triggers
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }
      : { type: "inline", name: label, content, mode };
  };

  const handleSave = async () => {
    const label = name.trim();
    if (label === "") {
      setError("A name is required.");
      return;
    }
    const source = buildSource(label);
    if (source === null) {
      setError(kind === "repo" ? "A repo URL and ref are required." : "Skill content is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) await updateSkillLibraryItem(editingId, label, source);
      else await createSkillLibraryItem(label, source);
      resetForm();
      await reload();
    } catch {
      if (mounted.current) setError("Couldn't save the skill.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await deleteSkillLibraryItem(id);
      if (editingId === id) resetForm();
      await reload();
    } catch {
      if (mounted.current) setError("Couldn't remove the skill.");
    }
  };

  return (
    <section className="tv-dash__panel tv-dash__prov" aria-label="Your skill library">
      <div className="tv-dash__prov-head">
        <div className="tv-dash__prov-lede">
          <div className="tv-dash__prov-title">
            <BookMarked size={16} strokeWidth={1.7} />
            <h2>Skill library</h2>
          </div>
          <p className="tv-dash__prov-sub">
            Reusable know-how — define a skill once, then reference it from any node&rsquo;s Skills
            section. Edits propagate on the next run.
          </p>
        </div>
        <div className="tv-dash__prov-add" style={{ display: "grid", gap: "0.4rem" }}>
          <input
            className="tv-launch__input"
            aria-label="Skill name"
            placeholder="name (e.g. house-style)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="tv-seg" role="group" aria-label="Skill source type">
            <button
              type="button"
              aria-pressed={kind === "inline"}
              className={`tv-seg__btn${kind === "inline" ? " tv-seg__btn--active" : ""}`}
              onClick={() => setKind("inline")}
            >
              Inline
            </button>
            <button
              type="button"
              aria-pressed={kind === "repo"}
              className={`tv-seg__btn${kind === "repo" ? " tv-seg__btn--active" : ""}`}
              onClick={() => setKind("repo")}
            >
              Repo
            </button>
          </div>
          {kind === "inline" ? (
            <>
              <textarea
                className="tv-node-prompt"
                aria-label="Skill content"
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
            </>
          ) : (
            <>
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
                placeholder="ref — a branch, tag, or commit"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
              <input
                className="tv-launch__input"
                aria-label="Repository filter"
                placeholder="filter (optional)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </>
          )}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              className="tv-btn tv-btn--primary"
              onClick={() => void handleSave()}
              disabled={busy}
            >
              {editingId ? "Save skill" : "Add skill"}
            </button>
            {editingId && (
              <button className="tv-btn tv-btn--ghost" onClick={resetForm} disabled={busy}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
      {!loading && skills.length === 0 ? (
        <p className="tv-dash__prov-empty">
          Add a reusable skill so any node can reference it from its Skills section.
        </p>
      ) : (
        <ul className="tv-dash__prov-list">
          {skills.map((s) => (
            <li className="tv-dash__prov-chip" key={s.id}>
              <span className="tv-badge tv-badge--accent">{badgeOf(s.source)}</span>
              <span className="tv-dash__prov-name">{s.name}</span>
              <button
                type="button"
                className="tv-btn tv-btn--link tv-btn--sm"
                aria-label={`Edit ${s.name}`}
                onClick={() => startEdit(s)}
              >
                Edit
              </button>
              <button
                type="button"
                className="tv-dash__prov-x"
                aria-label={`Remove ${s.name}`}
                onClick={() => void handleRemove(s.id)}
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="tv-dash__error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

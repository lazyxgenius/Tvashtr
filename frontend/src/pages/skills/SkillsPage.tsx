import { Check, Layers, Pencil, Plus, Search, Sparkle, Trash, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, type MenuEntry, Tabs, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type Skill,
  type SkillAgentsResult,
  type SkillPreset,
  createSkill,
  duplicateSkill,
  listSkillPresets,
  listSkills,
} from "../../lib/api/skills";
import { navigate } from "../../lib/nav";
import { publishBadges } from "../../lib/workspaceStatus";
import { GithubIcon } from "../home/homeIcons";
import { AddFromGithubSheet } from "./AddFromGithubSheet";
import { DeleteSkillDialog } from "./DeleteSkillDialog";
import { SkillAgentsDialog } from "./SkillAgentsDialog";
import { PresetPreviewDialog, SkillPresetsGrid } from "./SkillPresets";
import { SkillsEmptyState } from "./SkillsEmptyState";
import { SkillsTable } from "./SkillsTable";
import { matchesQuery, plural, presetInLibrary, sortByName } from "./skillsModel";
import "./skills.css";

export type SkillsView = "mine" | "presets";

type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

/**
 * Toolkit › Skills (Toolkit-Skills, Toolkit-SkillPresets; flows TkF-SkillTabs, SkillsEmpty,
 * Presets): the page header with Add from GitHub / New skill, pill tabs "Your skills N" / "Presets"
 * (the address carries the tab), the client-side search, the skills table and its empty states,
 * the free presets with their preview dialog, each row's ⋯ menu (Edit, Duplicate, Turn on for
 * agents…, Delete skill — TkF-SkillMenu), and Add from GitHub (TkF-FromRepo).
 */
export function SkillsPage({ view }: { view: SkillsView }) {
  const toast = useToast();
  const [skills, setSkills] = useState<Load<Skill[]>>({ state: "loading" });
  const [presets, setPresets] = useState<Load<SkillPreset[]> | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillPreset | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [agentsFor, setAgentsFor] = useState<Skill | null>(null);
  const [fromGithub, setFromGithub] = useState(false);
  // Rows the last import added: tinted until the next one (TkF-FromRepo-3).
  const [justAdded, setJustAdded] = useState<ReadonlySet<string>>(new Set());

  const loadSkills = useCallback(() => {
    setSkills({ state: "loading" });
    listSkills().then(
      (data) => {
        setSkills({ state: "ready", data });
        publishBadges({ skills: data.length });
      },
      (e: unknown) => setSkills({ state: "error", message: errorText(e) }),
    );
  }, []);

  const loadPresets = useCallback(() => {
    setPresets({ state: "loading" });
    listSkillPresets().then(
      (data) => setPresets({ state: "ready", data }),
      (e: unknown) => setPresets({ state: "error", message: errorText(e) }),
    );
  }, []);

  useEffect(loadSkills, [loadSkills]);
  useEffect(() => {
    if (view === "presets" && presets === null) loadPresets();
  }, [view, presets, loadPresets]);

  const library = skills.state === "ready" ? skills.data : null;
  const rows = useMemo(
    () => (library ? sortByName(library.filter((s) => matchesQuery(s, query))) : []),
    [library, query],
  );

  const inLibrary = useCallback(
    (p: SkillPreset) => (library ? presetInLibrary(p, library) : false),
    [library],
  );

  const addPreset = async (preset: SkillPreset) => {
    setAdding(preset.key);
    try {
      const skill = await createSkill(preset.name, preset.source);
      const data = [...(library ?? []).filter((s) => s.id !== skill.id), skill];
      setSkills({ state: "ready", data });
      publishBadges({ skills: data.length });
      setPreview(null);
      toast({ message: `${preset.title} added to your skills.` });
    } catch (e) {
      // 409: a skill with that name appeared meanwhile (another tab) — show the library as it is.
      if (e instanceof ApiError && e.status === 409) loadSkills();
      toast({ message: errorText(e), tone: "error" });
    } finally {
      setAdding(null);
    }
  };

  const openSkill = (s: Skill) => navigate({ page: "skill", skillId: s.id });
  const newSkill = () => navigate({ page: "skill", skillId: "new" });

  /** The library after a change; the nav badge follows it. */
  const setLibrary = (data: Skill[]) => {
    setSkills({ state: "ready", data });
    publishBadges({ skills: data.length });
  };

  const duplicate = async (s: Skill) => {
    try {
      const copy = await duplicateSkill(s.id);
      setLibrary([...(library ?? []), copy]);
      navigate({ page: "skill", skillId: copy.id });
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };

  const onDeleted = (s: Skill) => {
    setDeleting(null);
    setLibrary((library ?? []).filter((x) => x.id !== s.id));
    toast({ message: `${s.name} deleted.` });
  };

  const onAgentsSaved = (s: Skill, res: SkillAgentsResult) => {
    setAgentsFor(null);
    setLibrary(
      (library ?? []).map((x) =>
        x.id === s.id ? { ...x, usage: { agents: res.agent_count, teams: res.team_count } } : x,
      ),
    );
    toast({
      message:
        res.agent_count > 0
          ? `${s.name} is on for ${plural(res.agent_count, "agent")}.`
          : `${s.name} is off for every agent.`,
    });
  };

  const onImported = (added: Skill[], skipped: string[], repo: string) => {
    setFromGithub(false);
    const ids = new Set(added.map((a) => a.id));
    setLibrary([...(library ?? []).filter((x) => !ids.has(x.id)), ...added]);
    setJustAdded(ids);
    toast({
      message:
        added.length > 0
          ? `${plural(added.length, "skill")} added from ${repo}.`
          : `Nothing new: ${skipped.length === 1 ? "that skill is" : "those skills are"} already in your skills.`,
    });
  };

  const menuFor = (s: Skill): MenuEntry[] => {
    const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
    return [
      { key: "edit", label: "Edit", icon: <Pencil {...icon} />, onSelect: () => openSkill(s) },
      {
        key: "duplicate",
        label: "Duplicate",
        icon: <Layers {...icon} />,
        onSelect: () => void duplicate(s),
      },
      {
        key: "agents",
        label: "Turn on for agents…",
        icon: <Check {...icon} />,
        onSelect: () => setAgentsFor(s),
      },
      "separator",
      {
        key: "delete",
        label: "Delete skill",
        icon: <Trash {...icon} />,
        danger: true,
        onSelect: () => setDeleting(s),
      },
    ];
  };

  return (
    <>
      <div className="pg-head">
        <div>
          <h1 className="pg-head__title sk-title">Skills</h1>
          <p className="pg-head__lede sk-lede">
            Reusable know-how. Write a skill once, or pull skills from a GitHub repo, then add them
            to any agent.
          </p>
        </div>
        <div className="pg-head__actions">
          {view === "mine" && (
            <Button
              variant="secondary"
              className="sk-btn-inline"
              onClick={() => setFromGithub(true)}
            >
              <GithubIcon size={15} />
              <span>Add from GitHub</span>
            </Button>
          )}
          <Button variant="primary" className="sk-btn-inline" onClick={newSkill}>
            <Plus size={15} strokeWidth={1.6} aria-hidden />
            <span>New skill</span>
          </Button>
        </div>
      </div>

      <div className="sk-bar">
        <Tabs
          variant="pill"
          aria-label="Skills"
          value={view}
          onChange={(v) => navigate({ page: "skills", view: v })}
          items={[
            { value: "mine", label: "Your skills", count: library ? library.length : null },
            { value: "presets", label: "Presets" },
          ]}
        />
        {view === "mine" && (
          <Input
            size="sm"
            placeholder="Search skills"
            aria-label="Search skills"
            className="sk-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {view === "mine" ? (
        <YourSkills
          skills={skills}
          rows={rows}
          query={query}
          onClearSearch={() => setQuery("")}
          onRetry={loadSkills}
          onOpen={openSkill}
          onNew={newSkill}
          menuFor={menuFor}
          highlight={justAdded}
        />
      ) : (
        <PresetsTab
          presets={presets}
          library={skills}
          inLibrary={inLibrary}
          adding={adding}
          onAdd={(p) => void addPreset(p)}
          onPreview={setPreview}
          onRetry={() => {
            if (skills.state === "error") loadSkills();
            if (presets?.state === "error") loadPresets();
          }}
        />
      )}

      <PresetPreviewDialog
        preset={preview}
        added={preview ? inLibrary(preview) : false}
        adding={preview !== null && adding === preview.key}
        onAdd={(p) => void addPreset(p)}
        onClose={() => setPreview(null)}
      />
      {deleting && (
        <DeleteSkillDialog
          key={deleting.id}
          skill={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={onDeleted}
        />
      )}
      {agentsFor && (
        <SkillAgentsDialog
          key={agentsFor.id}
          skill={agentsFor}
          onClose={() => setAgentsFor(null)}
          onSaved={(res) => onAgentsSaved(agentsFor, res)}
        />
      )}
      {fromGithub && (
        <AddFromGithubSheet onClose={() => setFromGithub(false)} onAdded={onImported} />
      )}
    </>
  );
}

function YourSkills({
  skills,
  rows,
  query,
  onClearSearch,
  onRetry,
  onOpen,
  onNew,
  menuFor,
  highlight,
}: {
  skills: Load<Skill[]>;
  rows: Skill[];
  query: string;
  onClearSearch: () => void;
  onRetry: () => void;
  onOpen: (s: Skill) => void;
  onNew: () => void;
  menuFor: (s: Skill) => MenuEntry[];
  highlight: ReadonlySet<string>;
}) {
  if (skills.state === "loading") {
    return (
      <section className="sk-card" aria-label="Your skills" aria-busy="true">
        <div className="sk-empty sk-loading">Loading your skills…</div>
      </section>
    );
  }
  if (skills.state === "error") {
    return (
      <SkillsEmptyState
        icon={<TriangleAlert size={24} strokeWidth={1.6} />}
        title="Couldn’t load your skills"
        body={skills.message}
        actions={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  if (skills.data.length === 0) {
    return (
      <SkillsEmptyState
        icon={<Sparkle size={24} strokeWidth={1.6} />}
        title="No skills yet"
        body="Skills teach agents your team’s way of doing things. Start from a free preset, pull from GitHub, or write your own."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate({ page: "skills", view: "presets" })}
            >
              Browse presets
            </Button>
            <Button variant="primary" size="sm" onClick={onNew}>
              New skill
            </Button>
          </>
        }
      />
    );
  }
  if (rows.length === 0) {
    return (
      <SkillsEmptyState
        icon={<Search size={24} strokeWidth={1.6} />}
        title={`No skills match “${query.trim()}”`}
        body="Try another word, or write it as a new skill."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={onClearSearch}>
              Clear search
            </Button>
            <Button variant="primary" size="sm" onClick={onNew}>
              New skill
            </Button>
          </>
        }
      />
    );
  }
  return <SkillsTable skills={rows} onOpen={onOpen} menuFor={menuFor} highlight={highlight} />;
}

function PresetsTab({
  presets,
  library,
  inLibrary,
  adding,
  onAdd,
  onPreview,
  onRetry,
}: {
  presets: Load<SkillPreset[]> | null;
  /** The library decides Add vs "In your skills", so the cards wait for it too. */
  library: Load<Skill[]>;
  inLibrary: (p: SkillPreset) => boolean;
  adding: string | null;
  onAdd: (p: SkillPreset) => void;
  onPreview: (p: SkillPreset) => void;
  onRetry: () => void;
}) {
  if (presets === null || presets.state === "loading" || library.state === "loading") {
    return (
      <section className="sk-card" aria-label="Presets" aria-busy="true">
        <div className="sk-empty sk-loading">Loading presets…</div>
      </section>
    );
  }
  if (presets.state === "error" || library.state === "error") {
    return (
      <SkillsEmptyState
        icon={<TriangleAlert size={24} strokeWidth={1.6} />}
        title="Couldn’t load the presets"
        body={
          presets.state === "error"
            ? presets.message
            : library.state === "error"
              ? library.message
              : ""
        }
        actions={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  return (
    <SkillPresetsGrid
      presets={presets.data}
      inLibrary={inLibrary}
      adding={adding}
      onAdd={onAdd}
      onPreview={onPreview}
    />
  );
}

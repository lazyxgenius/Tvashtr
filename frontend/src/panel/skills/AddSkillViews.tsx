import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button, Input, TextArea } from "../../design-system/components";
import {
  ApiError,
  type InlineSkillSource,
  type SkillLibraryItem,
  type SkillPresetEntry,
  createSkillLibraryItem,
  listSkillLibrary,
  listSkillPresets,
} from "../../lib/api";
import type { Route } from "../../lib/nav";
import { SubView } from "../SubView";
import type { ToastAction } from "../useDrawerToast";
import type { AddSkillKind } from "./SkillsPanel";
import {
  MODE_LABELS,
  MODES,
  type SkillMode,
  type SkillRef,
  githubRepoUrl,
  inlineSkill,
  parseTriggers,
  presetRef,
  referencedLibraryIds,
  repoName,
  repoSkill,
  takenNames,
  withAdded,
} from "./nodeSkills";

/** Which add (or edit) sheet is open over the Skills & tools tab. */
export interface SkillSub {
  kind: AddSkillKind;
  /** Write only: the custom skill being edited (its place in the list). */
  index?: number;
}

interface ViewProps {
  skills: unknown[] | null;
  /** The account's library skills (null while unknown). */
  library: SkillLibraryItem[] | null;
  onChange: (next: unknown[] | null) => void;
  onClose: () => void;
}

/**
 * The Skills sub-views (PANEL-86..89; Web-AddSkill, Panel-FromRepo, Flow-Presets): write a skill,
 * add a GitHub repo, pick presets or library skills. Each changes the draft and closes; Save keeps
 * it. New skills go first in the list.
 */
export function AddSkillView({
  sub,
  onLibraryAdded,
  notify,
  onOpenToolkit,
  ...props
}: ViewProps & {
  sub: SkillSub;
  /** Library items a preset was just copied into. */
  onLibraryAdded: (items: SkillLibraryItem[]) => void;
  notify: (message: string, action?: ToastAction) => void;
  onOpenToolkit?: (route: Route) => void;
}) {
  switch (sub.kind) {
    case "write":
      return <WriteSkillForm {...props} index={sub.index} />;
    case "repo":
      return <RepoSkillForm {...props} />;
    case "presets":
      return <PresetPicker {...props} onLibraryAdded={onLibraryAdded} notify={notify} />;
    default:
      return <LibrarySkillPicker {...props} notify={notify} onOpenToolkit={onOpenToolkit} />;
  }
}

const onEnter = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    e.preventDefault();
    run();
  }
};

const FORM_MODE_HINTS: Record<SkillMode, string> = {
  always: "The full skill goes into every prompt.",
  trigger: "Loads only when the conversation mentions one of the trigger words.",
  agent: "Listed; the agent opens it when it needs it.",
};

/** PANEL-86: Write a new skill (or edit a custom one). Name and content are required. */
function WriteSkillForm({
  skills,
  library,
  onChange,
  onClose,
  index,
}: ViewProps & { index?: number }) {
  const editing =
    index === undefined ? undefined : ((skills ?? [])[index] as InlineSkillSource | undefined);
  const [name, setName] = useState(editing?.name ?? "");
  const [content, setContent] = useState(editing?.content ?? "");
  const [mode, setMode] = useState<SkillMode>(editing?.mode ?? "always");
  const [words, setWords] = useState((editing?.triggers ?? []).join(", "));
  const nameRef = useRef<HTMLInputElement>(null);
  const modeId = useId();
  useEffect(() => nameRef.current?.focus(), []);

  const trimmed = name.trim();
  const triggers = parseTriggers(words);
  const duplicate = trimmed !== "" && takenNames(skills, library, index).has(trimmed);
  const ready =
    trimmed !== "" && content.trim() !== "" && (mode !== "trigger" || triggers.length > 0);
  const submit = () => {
    if (!ready) return;
    const skill = inlineSkill(trimmed, content, mode, triggers);
    const list = skills ?? [];
    onChange(
      index === undefined
        ? withAdded(list, [skill])
        : list.map((s, i) => (i === index ? skill : s)),
    );
    onClose();
  };

  return (
    <SubView
      title={editing ? "Edit skill" : "Write a new skill"}
      backLabel="Back to skills"
      onBack={onClose}
      gap={16}
      note={
        editing ? "Changes this agent. Save to keep it." : "Adds to this agent. Save to keep it."
      }
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!ready} onClick={submit}>
            {editing ? "Update skill" : "Add skill"}
          </Button>
        </>
      }
    >
      <Input
        ref={nameRef}
        label="Name"
        placeholder="house-style"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter(submit)}
        helper={
          duplicate ? (
            <span className="nd-skill-form__warn" role="status">
              This agent already has a skill called {trimmed}. A run uses only the one higher in the
              list.
            </span>
          ) : undefined
        }
      />
      <TextArea
        label="Skill content (SKILL.md)"
        rows={8}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="nd-skill-form__mode">
        <span className="nd-skill-form__label" id={modeId}>
          When should it load?
        </span>
        <div className="tv-seg nd-seg" role="group" aria-labelledby={modeId}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`tv-seg__btn${mode === m ? " tv-seg__btn--active" : ""}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <span className="nd-skill-form__hint">{FORM_MODE_HINTS[mode]}</span>
      </div>
      {mode === "trigger" && (
        <Input
          label="Trigger words"
          helper="Separate with commas."
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={onEnter(submit)}
        />
      )}
    </SubView>
  );
}

const REPO_URL_PROBLEM = "Use a GitHub repo URL, like https://github.com/org/skills.";

/** PANEL-89: a GitHub repo pinned at a version, optionally only some of its skills. */
function RepoSkillForm({ skills, onChange, onClose }: ViewProps) {
  const [url, setUrl] = useState("");
  const [version, setVersion] = useState("");
  const [only, setOnly] = useState("");
  const [bad, setBad] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => urlRef.current?.focus(), []);

  const submit = () => {
    if (!url.trim()) return;
    const full = githubRepoUrl(url);
    if (!full) {
      setBad(true);
      urlRef.current?.focus();
      return;
    }
    onChange(withAdded(skills, [repoSkill(full, version, only)]));
    onClose();
  };

  return (
    <SubView
      title="Add skills from a GitHub repo"
      backLabel="Back to skills"
      onBack={onClose}
      gap={16}
      note="Skills load when the team runs."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!url.trim()} onClick={submit}>
            Add repo
          </Button>
        </>
      }
    >
      <Input
        ref={urlRef}
        label="Repository"
        placeholder="https://github.com/org/skills"
        value={url}
        error={bad ? REPO_URL_PROBLEM : undefined}
        onChange={(e) => {
          setUrl(e.target.value);
          setBad(false);
        }}
        onKeyDown={onEnter(submit)}
      />
      <Input
        label="Version"
        optional
        helper="A branch, tag or commit. Pinning keeps runs repeatable."
        placeholder="main"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        onKeyDown={onEnter(submit)}
      />
      <Input
        label="Only these skills"
        optional
        helper="Leave empty to add every skill in the repo."
        placeholder="review-*, pytest-*"
        value={only}
        onChange={(e) => setOnly(e.target.value)}
        onKeyDown={onEnter(submit)}
      />
    </SubView>
  );
}

interface PickItem {
  key: string;
  title: string;
  description: string;
  /** Already on this agent: shown ticked, can't be picked again. */
  added: boolean;
}

const addLabel = (n: number) => (n === 0 ? "Add skills" : `Add ${n} skill${n === 1 ? "" : "s"}`);
const addedText = (n: number) => `${n} skill${n === 1 ? "" : "s"} added`;

/** A search box over checkbox rows (the presets and library pickers). */
export function PickList({
  items,
  picked,
  onToggle,
  searchLabel,
  empty,
}: {
  items: PickItem[];
  picked: readonly string[];
  onToggle: (key: string) => void;
  searchLabel: string;
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((i) => `${i.title} ${i.description}`.toLowerCase().includes(q))
    : items;
  return (
    <>
      <Input
        size="sm"
        placeholder={searchLabel}
        aria-label={searchLabel}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length === 0 && <p className="nd-pick__none">{`${empty} “${query.trim()}”.`}</p>}
      {shown.map((item) => {
        const on = item.added || picked.includes(item.key);
        return (
          <label
            key={item.key}
            className={`nd-pick${on ? " nd-pick--on" : ""}${item.added ? " nd-pick--added" : ""}`}
          >
            <input
              type="checkbox"
              className="nd-pop__check"
              checked={on}
              disabled={item.added}
              onChange={() => onToggle(item.key)}
            />
            <span>
              <span className="nd-pick__title">{item.title}</span>
              <span className="nd-pick__desc">
                {item.added ? `Already added. ${item.description}` : item.description}
              </span>
            </span>
          </label>
        );
      })}
    </>
  );
}

function usePicked() {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  return { picked, toggle };
}

/** Find the library copy of a preset by its name, or put one there (409: it just appeared). */
async function libraryCopy(
  preset: SkillPresetEntry,
  shelf: SkillLibraryItem[],
): Promise<{ item: SkillLibraryItem; created: boolean }> {
  const found = shelf.find((i) => i.name === preset.name);
  if (found) return { item: found, created: false };
  try {
    const made = await createSkillLibraryItem(preset.name, preset.source);
    return { item: { ...made, source: preset.source, created_at: "" }, created: true };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    const again = (await listSkillLibrary()).find((i) => i.name === preset.name);
    if (!again) throw e;
    return { item: again, created: true };
  }
}

/**
 * PANEL-87: ready-made skills. Adding one references its copy in the account library (made on
 * first use) with `origin: "preset:<key>"`, which badges the row "Preset".
 */
function PresetPicker({
  skills,
  library,
  onChange,
  onClose,
  onLibraryAdded,
  notify,
}: ViewProps & {
  onLibraryAdded: (items: SkillLibraryItem[]) => void;
  notify: (message: string, action?: ToastAction) => void;
}) {
  const [presets, setPresets] = useState<SkillPresetEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const { picked, toggle } = usePicked();

  useEffect(() => {
    let live = true;
    listSkillPresets()
      .then((all) => live && setPresets(all.filter((p) => p.attachable)))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [attempt]);

  const refs = referencedLibraryIds(skills);
  const isAdded = (p: SkillPresetEntry) =>
    (skills ?? []).some((s) => (s as SkillRef).origin === `preset:${p.key}`) ||
    (library ?? []).some((i) => i.name === p.name && refs.has(i.id));

  const add = async () => {
    const chosen = (presets ?? []).filter((p) => picked.includes(p.key));
    if (chosen.length === 0) return;
    setBusy(true);
    setAddFailed(false);
    try {
      const shelf = library ?? (await listSkillLibrary());
      const copies = [];
      for (const p of chosen) copies.push({ preset: p, ...(await libraryCopy(p, shelf)) });
      onLibraryAdded(copies.filter((c) => c.created).map((c) => c.item));
      const before = skills;
      onChange(
        withAdded(
          skills,
          copies.map((c) => presetRef(c.item.id, c.preset.key)),
        ),
      );
      notify(addedText(copies.length), { label: "Undo", onAction: () => onChange(before) });
      onClose();
    } catch {
      setAddFailed(true);
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (presets) {
    body = (
      <PickList
        items={presets.map((p) => ({
          key: p.key,
          title: p.title,
          description: p.description,
          added: isAdded(p),
        }))}
        picked={picked}
        onToggle={toggle}
        searchLabel="Search presets"
        empty="No presets match"
      />
    );
  } else if (loadFailed) {
    body = (
      <LoadProblem
        text="Couldn’t load presets."
        onRetry={() => {
          setLoadFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  } else {
    body = <p className="nd-pick__none">Loading presets…</p>;
  }

  return (
    <SubView
      title="Add from presets"
      onBack={onClose}
      gap={10}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={picked.length === 0}
            loading={busy}
            onClick={() => void add()}
          >
            {addLabel(picked.length)}
          </Button>
        </>
      }
    >
      {body}
      {addFailed && (
        <p className="nd-pick__problem" role="alert">
          Couldn’t add the presets. Try again.
        </p>
      )}
    </SubView>
  );
}

function LoadProblem({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="nd-pick__empty" role="alert">
      <p className="nd-pick__none">{text}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function librarySourceLine(item: SkillLibraryItem): string {
  const src = item.source;
  if (src.type === "inline") return `Custom · ${MODE_LABELS[src.mode] ?? MODE_LABELS.always}`;
  if (src.type === "repo") return `${repoName(src.url)} @ ${src.ref}`;
  return "The repo’s rules files";
}

/** PANEL-88: the account's library skills; ones this agent already has can't be added twice. */
function LibrarySkillPicker({
  skills,
  library,
  onChange,
  onClose,
  notify,
  onOpenToolkit,
}: ViewProps & {
  notify: (message: string, action?: ToastAction) => void;
  onOpenToolkit?: (route: Route) => void;
}) {
  const { picked, toggle } = usePicked();
  const refs = referencedLibraryIds(skills);
  const add = () => {
    if (picked.length === 0) return;
    const before = skills;
    onChange(
      withAdded(
        skills,
        picked.map((id) => ({ type: "library", id })),
      ),
    );
    notify(addedText(picked.length), { label: "Undo", onAction: () => onChange(before) });
    onClose();
  };

  let body: ReactNode;
  if (library === null) body = <p className="nd-pick__none">Loading your library…</p>;
  else if (library.length === 0)
    body = (
      <div className="nd-pick__empty">
        <p className="nd-pick__none">No library skills yet.</p>
        {onOpenToolkit && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenToolkit({ page: "skills", view: "mine" })}
          >
            Open Toolkit
          </Button>
        )}
      </div>
    );
  else
    body = (
      <PickList
        items={library.map((item) => ({
          key: item.id,
          title: item.name,
          description: librarySourceLine(item),
          added: refs.has(item.id),
        }))}
        picked={picked}
        onToggle={toggle}
        searchLabel="Search your library"
        empty="No library skills match"
      />
    );

  return (
    <SubView
      title="Add from your library"
      onBack={onClose}
      gap={10}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={picked.length === 0} onClick={add}>
            {addLabel(picked.length)}
          </Button>
        </>
      }
    >
      {body}
    </SubView>
  );
}

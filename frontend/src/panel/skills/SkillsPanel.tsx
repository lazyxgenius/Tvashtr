import { type KeyboardEvent, type ReactNode, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkle,
  Trash,
} from "lucide-react";

import { Button, IconButton, Menu, type MenuEntry, Switch } from "../../design-system/components";
import type { SkillLibraryItem } from "../../lib/api";
import type { Route } from "../../lib/nav";
import { GithubIcon } from "../../pages/home/homeIcons";
import { InfoTip } from "../InfoTip";
import type { ToastAction } from "../useDrawerToast";
import {
  MODE_HINTS,
  MODE_LABELS,
  MODES,
  type SkillMode,
  type SkillRowData,
  followsRules,
  parseTriggers,
  skillRows,
  withMode,
  withRules,
  withoutSkill,
} from "./nodeSkills";

export type AddSkillKind = "write" | "presets" | "library" | "repo";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

const ADD_OPTIONS: { kind: AddSkillKind; label: string; card: string; hint: string }[] = [
  {
    kind: "write",
    label: "Write a new skill",
    card: "Write a new skill",
    hint: "Your own SKILL.md",
  },
  { kind: "presets", label: "From presets", card: "Presets", hint: "Ready-made skills" },
  {
    kind: "library",
    label: "From your library",
    card: "Your library",
    hint: "Skills saved to your account",
  },
  {
    kind: "repo",
    label: "From a GitHub repo",
    card: "From a GitHub repo",
    hint: "Pin a branch, tag or commit",
  },
];

function addIcon(kind: AddSkillKind, size: number) {
  const props = { size, strokeWidth: 1.6, "aria-hidden": true } as const;
  if (kind === "write") return <Pencil {...props} />;
  if (kind === "presets") return <Layers {...props} />;
  if (kind === "library") return <BookOpen {...props} />;
  return <GithubIcon size={size} />;
}

/**
 * Skills & tools › Skills (PANEL-81..91; Web-Skills, Panel-SkillsEmpty, Panel-AddMenu,
 * Flow-LoadMode, Flow-SkillMenu): the "Add skill" menu, one row per source with its badge, load mode
 * and trigger words, the empty state's four ways in, and the repo rules-files switch. Every change
 * goes into the draft; Save keeps it.
 */
export function SkillsPanel({
  skills,
  library,
  onChange,
  notify,
  onAdd,
  onEdit,
  onOpenToolkit,
}: {
  skills: unknown[] | null;
  /** The account's library skills (null while unknown). */
  library: readonly SkillLibraryItem[] | null;
  onChange: (next: unknown[] | null) => void;
  notify: (message: string, action?: ToastAction) => void;
  onAdd: (kind: AddSkillKind) => void;
  onEdit: (index: number) => void;
  onOpenToolkit?: (route: Route) => void;
}) {
  const rows = skillRows(skills, library);
  // The trigger words being typed under a row (Q12: choosing When triggered asks for them).
  const [words, setWords] = useState<{ index: number; text: string; error: boolean } | null>(null);
  const list = skills ?? [];

  const pickMode = (row: SkillRowData, mode: SkillMode) => {
    if (mode === "trigger")
      setWords({ index: row.index, text: row.triggers.join(", "), error: false });
    else {
      setWords(null);
      onChange(withMode(list, row.index, mode));
    }
  };
  const commitWords = () => {
    if (!words) return;
    const next = parseTriggers(words.text);
    if (next.length === 0) {
      setWords({ ...words, error: true });
      return;
    }
    onChange(withMode(list, words.index, "trigger", next));
    setWords(null);
  };
  const remove = (row: SkillRowData) => {
    const before = skills;
    onChange(withoutSkill(list, row.index));
    notify(`Removed ${row.name}`, { label: "Undo", onAction: () => onChange(before) });
  };

  return (
    <section className="nd-kit" aria-labelledby="nd-kit-skills">
      <div className="nd-kit__head">
        <h3 className="nd-kit__title" id="nd-kit-skills">
          Skills
          {rows.length > 0 && <span className="nd-kit__count">{rows.length}</span>}
          <InfoTip text="Reusable know-how. Worker agents get skills as context and tools; thinker agents fold them into their prompt." />
        </h3>
        <span className="nd-kit__add">
          <Menu
            label="Add skill"
            items={ADD_OPTIONS.map((o) => ({
              key: o.kind,
              label: o.label,
              icon: addIcon(o.kind, 15),
              onSelect: () => onAdd(o.kind),
            }))}
            trigger={(props) => (
              <Button
                variant="secondary"
                size="sm"
                className="nd-btn-flush"
                data-add-skill
                {...props}
              >
                <Plus size={13} strokeWidth={1.6} aria-hidden />
                <span>Add skill</span>
              </Button>
            )}
          />
        </span>
      </div>
      {rows.length > 0 ? (
        <ul className="nd-kit__list">
          {rows.map((row) => (
            <SkillRow
              key={row.index}
              row={row}
              onMode={(mode) => pickMode(row, mode)}
              onEdit={row.custom ? () => onEdit(row.index) : undefined}
              onOpenToolkit={
                row.libraryId && onOpenToolkit
                  ? () => onOpenToolkit({ page: "skill", skillId: row.libraryId as string })
                  : undefined
              }
              onRemove={() => remove(row)}
              words={
                words?.index === row.index ? (
                  <TriggerWords
                    name={row.name}
                    value={words.text}
                    error={words.error}
                    onChange={(text) => setWords({ ...words, text, error: false })}
                    onCommit={commitWords}
                    onCancel={() => setWords(null)}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      ) : (
        <SkillsEmpty onAdd={onAdd} />
      )}
      <div className="nd-kit__card nd-kit__card--rules">
        <div>
          <div className="nd-kit__opt-title">Follow the repo’s rules files</div>
          <div className="nd-kit__opt-desc nd-kit__opt-desc--gap">
            When working on a real folder, also use its CLAUDE.md, AGENTS.md, .cursorrules and
            .cursor/rules.
          </div>
        </div>
        <Switch
          aria-label="Follow the repo’s rules files"
          checked={followsRules(skills)}
          onCheckedChange={(on) => onChange(withRules(skills, on))}
        />
      </div>
    </section>
  );
}

function SkillRow({
  row,
  onMode,
  onEdit,
  onOpenToolkit,
  onRemove,
  words,
}: {
  row: SkillRowData;
  onMode: (mode: SkillMode) => void;
  onEdit?: () => void;
  onOpenToolkit?: () => void;
  onRemove: () => void;
  words: ReactNode;
}) {
  const more: MenuEntry[] = [];
  if (onEdit)
    more.push({ key: "edit", label: "Edit", icon: <Pencil {...icon} />, onSelect: onEdit });
  if (onOpenToolkit) {
    more.push({
      key: "toolkit",
      label: "Open in Toolkit",
      icon: <BookOpen {...icon} />,
      onSelect: onOpenToolkit,
    });
  }
  if (more.length > 0) more.push("separator");
  more.push({
    key: "remove",
    label: "Remove from this agent",
    icon: <Trash {...icon} />,
    danger: true,
    onSelect: onRemove,
  });
  return (
    <li className="nd-skill">
      <div className="nd-skill__top">
        <span className="nd-kit__icon">
          <Sparkle size={14} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="nd-skill__name">{row.name}</span>
        <span className="nd-skill__more">
          <Menu
            label={`More actions for ${row.name}`}
            items={more}
            trigger={(props) => (
              <IconButton size="sm" aria-label={`More actions for ${row.name}`} {...props}>
                <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden />
              </IconButton>
            )}
          />
        </span>
      </div>
      <div className="nd-skill__meta">
        <SkillBadge row={row} />
        <LoadModeMenu name={row.name} mode={row.mode} onPick={onMode} />
      </div>
      {words ??
        (row.mode === "trigger" && row.triggers.length > 0 && (
          <div className="nd-skill__chips" aria-label={`Trigger words for ${row.name}`}>
            {row.triggers.map((t) => (
              <span key={t} className="nd-skill__chip">
                {t}
              </span>
            ))}
          </div>
        ))}
    </li>
  );
}

function SkillBadge({ row }: { row: SkillRowData }) {
  return (
    <span className={`ds-badge ds-badge--${row.badge.variant}`}>
      {row.badge.github && <GithubIcon size={11} />}
      {row.badge.label}
    </span>
  );
}

/** The load-mode button and its 290px menu (PANEL-83); the current mode is ticked. */
function LoadModeMenu({
  name,
  mode,
  onPick,
}: {
  name: string;
  mode: SkillMode;
  onPick: (mode: SkillMode) => void;
}) {
  return (
    <span className="nd-skill__modes">
      <Menu
        label={`How ${name} loads`}
        items={MODES.map((m) => ({
          key: m,
          label: MODE_LABELS[m],
          description: MODE_HINTS[m],
          icon: m === mode ? <Check {...icon} /> : <span className="nd-kit__blank" />,
          onSelect: () => onPick(m),
        }))}
        trigger={(props) => (
          <button type="button" className="nd-kit__mode" {...props}>
            {MODE_LABELS[mode]}
            <ChevronDown size={12} strokeWidth={1.6} aria-hidden />
          </button>
        )}
      />
    </span>
  );
}

/** Q12: When triggered needs at least one word, typed inline under the row. */
function TriggerWords({
  name,
  value,
  error,
  onChange,
  onCommit,
  onCancel,
}: {
  name: string;
  value: string;
  error: boolean;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="nd-skill__words">
      <input
        className="nd-skill__input"
        aria-label={`Trigger words for ${name}`}
        placeholder="pytest, tests"
        value={value}
        autoFocus
        aria-invalid={error || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => (parseTriggers(value).length > 0 ? onCommit() : onCancel())}
      />
      <div
        className={`nd-skill__hint${error ? " nd-skill__hint--error" : ""}`}
        role={error ? "alert" : undefined}
      >
        {error ? "Add at least one trigger word." : "Separate with commas."}
      </div>
    </div>
  );
}

/** PANEL-90: no skills yet — the four ways to add one. */
function SkillsEmpty({ onAdd }: { onAdd: (kind: AddSkillKind) => void }) {
  return (
    <div className="nd-skills-empty">
      <div className="nd-skills-empty__title">No skills yet</div>
      <div className="nd-skills-empty__desc">
        Skills teach this agent your team’s way of doing things.
      </div>
      <div className="nd-skills-empty__grid">
        {ADD_OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            className="nd-skills-empty__card"
            onClick={() => onAdd(o.kind)}
          >
            <span className="nd-skills-empty__icon">{addIcon(o.kind, 16)}</span>
            <span className="nd-skills-empty__name">{o.card}</span>
            <span className="nd-skills-empty__hint">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

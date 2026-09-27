import { useId } from "react";

import { Badge, Input } from "../../design-system/components";
import type { SkillMode, SkillUsageRow } from "../../lib/api/skills";
import { type SourceKind, modeHelper } from "./skillDraft";
import { agentLabel } from "./skillsModel";

const MODES: { value: SkillMode; label: string }[] = [
  { value: "always", label: "Always on" },
  { value: "trigger", label: "When triggered" },
  { value: "agent", label: "Agent decides" },
];

const SOURCES: { value: "inline" | "repo"; label: string }[] = [
  { value: "inline", label: "Written here" },
  { value: "repo", label: "GitHub repo" },
];

/** The shared pill toggle (`tv-seg`), one option pressed. */
function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: V | null;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tv-seg sk-ed-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "tv-seg__btn tv-seg__btn--active" : "tv-seg__btn"}
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CardLabel({ id, children }: { id?: string; children: string }) {
  return (
    <div className="sk-ed-card__label-row">
      <span id={id} className="sk-ed-label">
        {children}
      </span>
    </div>
  );
}

/**
 * The right column (340px): "Loads by default" with its helper and, for When triggered, the
 * trigger words; "Source"; and on an existing skill, "Used by" (SKILL-25…28, 33).
 */
export function SkillSettingsCard({
  mode,
  onMode,
  existing,
  triggers,
  onTriggers,
  onTriggersBlur,
  triggersError,
  kind,
  onKind,
  usedBy,
}: {
  mode: SkillMode;
  onMode: (mode: SkillMode) => void;
  existing: boolean;
  triggers: string;
  onTriggers: (text: string) => void;
  onTriggersBlur: () => void;
  triggersError: string | null;
  kind: SourceKind;
  onKind: (kind: "inline" | "repo") => void;
  /** Existing skills only: the agents that have it on. */
  usedBy: SkillUsageRow[] | null;
}) {
  return (
    <section className="sk-ed-card" aria-label="Skill settings">
      <div className="sk-ed-side">
        <CardLabel>Loads by default</CardLabel>
        <Segmented
          label="Default load mode"
          value={mode}
          options={MODES}
          onChange={onMode}
          disabled={kind === "project_rules"}
        />
        <div className="sk-ed-helper">{modeHelper(mode, existing)}</div>
        {mode === "trigger" && kind !== "project_rules" && (
          <Input
            label="Trigger words"
            helper="Separate with commas."
            error={triggersError}
            value={triggers}
            onChange={(e) => onTriggers(e.target.value)}
            onBlur={onTriggersBlur}
          />
        )}
        <CardLabel>Source</CardLabel>
        <Segmented
          label="Source"
          value={kind === "project_rules" ? null : kind}
          options={SOURCES}
          onChange={onKind}
        />
        {usedBy && (
          <>
            <CardLabel>Used by</CardLabel>
            {usedBy.length > 0 ? (
              <div className="sk-ed-usedby">
                {usedBy.map((row) => (
                  <Badge key={row.node_id} variant="neutral">
                    {`${agentLabel(row)} · ${row.team_name}`}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="sk-ed-helper">No agents use it yet.</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Source = GitHub repo (TkF-SkillSource-1, SKILL-29): the repo, a version and a skill filter. */
export function SkillRepoCard({
  url,
  version,
  filter,
  urlError,
  onChange,
}: {
  url: string;
  version: string;
  filter: string;
  urlError: string | null;
  onChange: (patch: { repoUrl?: string; repoRef?: string; repoFilter?: string }) => void;
}) {
  const labelId = useId();
  return (
    <section className="sk-ed-card" aria-labelledby={labelId}>
      <div className="sk-ed-card__body">
        <CardLabel id={labelId}>From a GitHub repo</CardLabel>
        <Input
          label="Repository"
          placeholder="https://github.com/org/skills"
          inputMode="url"
          spellCheck={false}
          error={urlError}
          value={url}
          onChange={(e) => onChange({ repoUrl: e.target.value })}
        />
        <Input
          label="Version"
          optional
          helper="A branch, tag or commit. Pinning keeps runs repeatable."
          spellCheck={false}
          value={version}
          onChange={(e) => onChange({ repoRef: e.target.value })}
        />
        <Input
          label="Only these skills"
          optional
          helper="Leave empty to add every skill in the repo."
          placeholder="review-*, pytest-*"
          spellCheck={false}
          value={filter}
          onChange={(e) => onChange({ repoFilter: e.target.value })}
        />
      </div>
    </section>
  );
}

/** A legacy "Repo rules" skill: nothing to write; switching the source replaces it. */
export function RepoRulesCard() {
  const labelId = useId();
  return (
    <section className="sk-ed-card" aria-labelledby={labelId}>
      <div className="sk-ed-card__body">
        <CardLabel id={labelId}>Repo rules</CardLabel>
        <p className="sk-ed-note">
          This skill loads the rules of the repo each run works on, so there’s nothing to write
          here. Pick Written here or GitHub repo to replace it.
        </p>
      </div>
    </section>
  );
}

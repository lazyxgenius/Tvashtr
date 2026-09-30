/**
 * An agent's `skills` sources (moved from the old SkillsSection) and the rows the Skills list shows
 * (PANEL-81..85). The run resolves them in control_plane/node_skills.py: inline (Custom), repo
 * (GitHub), library references (Library, or Preset when added from presets) and the repo's rules
 * files (`project_rules`, the switch — not a row). Library and repo references may carry this
 * agent's own `mode` / `triggers`. Every edit returns a new list, or null when nothing is left.
 */
import type { SkillLibraryItem, SkillSource } from "../../lib/api";
import { displayNameForSubscription, subscriptionProviderForModel } from "../../lib/engines";
import { type CredentialCover, modelTreatment } from "../setup/modelCopy";

export type SkillMode = "always" | "trigger" | "agent";

/** A source as a node stores it: the per-agent override and the preset it came from ride along. */
export type SkillRef = SkillSource & { mode?: SkillMode; triggers?: string[]; origin?: string };

export const MODES: readonly SkillMode[] = ["always", "trigger", "agent"];
export const MODE_LABELS: Record<SkillMode, string> = {
  always: "Always on",
  trigger: "When triggered",
  agent: "Agent decides",
};
export const MODE_HINTS: Record<SkillMode, string> = {
  always: "The full skill goes into every prompt",
  trigger: "Loads when the conversation mentions a trigger word",
  agent: "Listed; the agent opens it when it needs it",
};

export interface SkillRowData {
  /** Its place in the node's `skills` list. */
  index: number;
  name: string;
  badge: { label: string; variant: "neutral" | "outline" | "info"; github?: boolean };
  mode: SkillMode;
  triggers: string[];
  /** An inline skill written on this agent: the only kind edited here (spec Q13). */
  custom: boolean;
  /** A library item (Library or Preset): "Open in Toolkit". */
  libraryId: string | null;
}

const asRef = (s: unknown): SkillRef => s as SkillRef;
const isMode = (m: unknown): m is SkillMode => MODES.includes(m as SkillMode);
const words = (t: unknown): string[] =>
  Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];

/** "https://github.com/org/skills(.git)" → "org/skills". */
export function repoName(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/** One row per source (Q19): a single-skill filter names the row, otherwise the repo does. */
function repoRowName(url: string, filter: string | null | undefined): string {
  const f = (filter ?? "").trim();
  return f && !/[*?[,]/.test(f) ? f : repoName(url);
}

/** How a library item loads when this agent doesn't override it. */
function libraryMode(item: SkillLibraryItem | undefined): { mode: SkillMode; triggers: string[] } {
  const src = item?.source as SkillRef | undefined;
  if (src && src.type !== "project_rules" && isMode(src.mode)) {
    return { mode: src.mode, triggers: words(src.triggers) };
  }
  // A repo's skills keep their own SKILL.md format: listed, opened when needed.
  return { mode: src?.type === "inline" ? "always" : "agent", triggers: [] };
}

/**
 * The Skills list. `library` is null while unknown (a library row is then named "Library skill").
 * The rules-files source is the switch, not a row.
 */
export function skillRows(
  skills: readonly unknown[] | null,
  library: readonly SkillLibraryItem[] | null,
): SkillRowData[] {
  const rows: SkillRowData[] = [];
  (skills ?? []).forEach((raw, index) => {
    const s = asRef(raw);
    if (s.type === "inline") {
      rows.push({
        index,
        name: s.name || "Untitled skill",
        badge: { label: "Custom", variant: "neutral" },
        mode: isMode(s.mode) ? s.mode : "always",
        triggers: words(s.triggers),
        custom: true,
        libraryId: null,
      });
    } else if (s.type === "repo") {
      rows.push({
        index,
        name: repoRowName(s.url, s.filter),
        badge: { label: `${repoName(s.url)} @ ${s.ref}`, variant: "outline", github: true },
        mode: isMode(s.mode) ? s.mode : "agent",
        triggers: isMode(s.mode) ? words(s.triggers) : [],
        custom: false,
        libraryId: null,
      });
    } else if (s.type === "library") {
      const item = library?.find((x) => x.id === s.id);
      const own = isMode(s.mode) ? { mode: s.mode, triggers: words(s.triggers) } : null;
      rows.push({
        index,
        name: item?.name ?? (library ? "Removed from your library" : "Library skill"),
        badge: s.origin?.startsWith("preset:")
          ? { label: "Preset", variant: "neutral" }
          : { label: "Library", variant: "info" },
        ...(own ?? libraryMode(item)),
        custom: false,
        libraryId: s.id,
      });
    }
  });
  return rows;
}

const orNull = (list: unknown[]): unknown[] | null => (list.length > 0 ? list : null);

/** Load `index` in `mode` (a trigger mode keeps its words; the others drop them). */
export function withMode(
  skills: readonly unknown[],
  index: number,
  mode: SkillMode,
  triggers: string[] = [],
): unknown[] {
  return skills.map((raw, i) => {
    if (i !== index) return raw;
    const next: Record<string, unknown> = { ...(raw as Record<string, unknown>), mode };
    if (mode === "trigger") next.triggers = triggers;
    else delete next.triggers;
    return next;
  });
}

export const withoutSkill = (skills: readonly unknown[], index: number): unknown[] | null =>
  orNull(skills.filter((_, i) => i !== index));

export const followsRules = (skills: readonly unknown[] | null): boolean =>
  (skills ?? []).some((s) => asRef(s).type === "project_rules");

export function withRules(skills: readonly unknown[] | null, on: boolean): unknown[] | null {
  const rest = (skills ?? []).filter((s) => asRef(s).type !== "project_rules");
  return orNull(on ? [...rest, { type: "project_rules" }] : rest);
}

/** "pytest, tests" → ["pytest", "tests"] (trimmed, no blanks, no repeats). */
export function parseTriggers(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

/** New skills go first (Flow-Presets-3 draws the added presets on top of the list). */
export const withAdded = (
  skills: readonly unknown[] | null,
  added: readonly unknown[],
): unknown[] => [...added, ...(skills ?? [])];

/**
 * A GitHub repo as the run clones it: "https://github.com/o/r", "github.com/o/r(.git)" or "o/r" →
 * "https://github.com/o/r"; null when it isn't one (skill_repo.parse_github_repo).
 */
export function githubRepoUrl(text: string): string | null {
  const m =
    /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(
      text.trim(),
    );
  if (!m || m[2] === "." || m[2] === "..") return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

/**
 * PANEL-89: a repo source. The run needs a ref (node_skills pins it), so a blank Version is "main";
 * "Only these skills" is a comma list of globs (blank: every skill in the repo).
 */
export function repoSkill(url: string, version: string, only: string): SkillRef {
  const filter = parseTriggers(only).join(", ");
  return { type: "repo", url, ref: version.trim() || "main", ...(filter ? { filter } : {}) };
}

/** PANEL-86: a skill written on this agent (a trigger mode carries its words). */
export function inlineSkill(
  name: string,
  content: string,
  mode: SkillMode,
  triggers: string[],
): SkillRef {
  return {
    type: "inline",
    name: name.trim(),
    content,
    mode,
    ...(mode === "trigger" ? { triggers } : {}),
  };
}

/**
 * The names this agent's own and library skills go by, but the one at `except` (being edited): the
 * run keeps only the first skill of a name, so a second one is worth a warning.
 */
export function takenNames(
  skills: readonly unknown[] | null,
  library: readonly SkillLibraryItem[] | null,
  except?: number,
): Set<string> {
  return new Set(
    skillRows(skills, library)
      .filter(
        (r) => r.index !== except && (r.custom || library?.some((item) => item.id === r.libraryId)),
      )
      .map((r) => r.name),
  );
}

/** PANEL-87: a preset joins as a reference to its library copy, listed as "Agent decides". */
export const presetRef = (libraryId: string, key: string): SkillRef => ({
  type: "library",
  id: libraryId,
  origin: `preset:${key}`,
  mode: "agent",
});

/** The library items this agent already references. */
export const referencedLibraryIds = (skills: readonly unknown[] | null): Set<string> =>
  new Set(
    (skills ?? [])
      .map(asRef)
      .filter((s) => s.type === "library")
      .map((s) => (s as { id: string }).id),
  );

/**
 * PANEL-103: on Tvashtr Desktop an agent whose model runs on a subscription gets its skills folded
 * into its instructions, but no tools, connectors, Domains or rules files (team_run
 * `_desktop_instruction`).
 */
export function desktopSubscriptionNote(
  model: string,
  cover: CredentialCover | null,
  desktop: boolean,
): string | null {
  const name = desktopSubscriptionName(model, cover, desktop);
  if (!name) return null;
  return `Runs on your ${name} subscription on this computer. Its skills are added to its instructions, but tools, connectors, Domains and the repo’s rules files aren’t used there yet.`;
}

/** The subscription ("Grok") an agent runs on on Tvashtr Desktop; null when it doesn't. */
export function desktopSubscriptionName(
  model: string,
  cover: CredentialCover | null,
  desktop: boolean,
): string | null {
  const sub = subscriptionProviderForModel(model);
  if (!desktop || !cover || !sub || modelTreatment(model, cover, desktop) !== "subscription") {
    return null;
  }
  return displayNameForSubscription(sub);
}

/**
 * The skill editor's draft (TkF-NewSkill-1…5, TkF-SkillSource-1, Toolkit-SkillEditor; analysis
 * SKILL-21…36): what the form holds, the source it saves, when "Save" may run, the name rule, the
 * load-mode helper copy, and which field a backend refusal belongs to. Pure — no React.
 */
import type { Skill, SkillMode, SkillSource } from "../../lib/api/skills";

export type SourceKind = "inline" | "repo" | "project_rules";

export interface SkillDraft {
  name: string;
  kind: SourceKind;
  /** SKILL.md (Written here). Kept while the source is switched, so switching back loses nothing. */
  content: string;
  /** null = a repo row that never picked a mode (each skill file decides; it reads "Agent decides"). */
  mode: SkillMode | null;
  /** "endpoint, route, api" as typed. */
  triggers: string;
  repoUrl: string;
  repoRef: string;
  repoFilter: string;
  /** The commit an imported row is pinned to — kept only while its repo and version are unchanged. */
  resolvedSha: string | null;
  pinnedTo: { url: string; ref: string } | null;
}

export function emptyDraft(): SkillDraft {
  return {
    name: "",
    kind: "inline",
    content: "",
    mode: "always",
    triggers: "",
    repoUrl: "",
    repoRef: "main",
    repoFilter: "",
    resolvedSha: null,
    pinnedTo: null,
  };
}

export function draftFromSkill(skill: Skill): SkillDraft {
  const d: SkillDraft = { ...emptyDraft(), name: skill.name };
  const src = skill.source;
  if (src.type === "project_rules") return { ...d, kind: "project_rules" };
  const triggers = (src.triggers ?? []).join(", ");
  if (src.type === "inline") return { ...d, content: src.content, mode: src.mode, triggers };
  return {
    ...d,
    kind: "repo",
    mode: src.mode ?? null,
    triggers,
    repoUrl: src.url,
    repoRef: src.ref,
    repoFilter: src.filter ?? "",
    resolvedSha: src.resolved_sha ?? null,
    pinnedTo: src.resolved_sha ? { url: src.url, ref: src.ref } : null,
  };
}

/** The mode the segmented control shows. */
export const shownMode = (d: SkillDraft): SkillMode =>
  d.mode ?? (d.kind === "repo" ? "agent" : "always");

/** "endpoint, route,, api " → ["endpoint", "route", "api"] (split on commas, trimmed, empties dropped). */
export function parseTriggers(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The source "Save" sends. A legacy "Repo rules" row keeps its source as it is. */
export function draftSource(d: SkillDraft): SkillSource {
  const mode = shownMode(d);
  const triggers = mode === "trigger" ? { triggers: parseTriggers(d.triggers) } : {};
  if (d.kind === "project_rules") return { type: "project_rules" };
  if (d.kind === "inline")
    return { type: "inline", name: d.name.trim(), content: d.content, mode, ...triggers };
  const url = d.repoUrl.trim();
  const ref = d.repoRef.trim() || "main";
  const pinned = d.resolvedSha && d.pinnedTo?.url === url && d.pinnedTo.ref === ref;
  return {
    type: "repo",
    url,
    ref,
    filter: d.repoFilter.trim() || null,
    ...(d.mode ? { mode: d.mode } : {}),
    ...(d.mode ? triggers : {}),
    ...(pinned && d.resolvedSha ? { resolved_sha: d.resolvedSha } : {}),
  };
}

export const NAME_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const NAME_RULE_MESSAGE =
  "Use lowercase letters, numbers and single hyphens, like house-style.";
export const TRIGGER_REQUIRED = "Add at least one trigger word.";

/** The backend's own name rules (SKILL-36): required, kebab-case, at most 64 characters. */
export function nameError(name: string): string | null {
  const n = name.trim();
  if (!n) return "A skill name is required.";
  if (n.length > 64 || !NAME_RULE.test(n)) return NAME_RULE_MESSAGE;
  return null;
}

/** "When triggered" with no words would never load (Q16): Save waits for one. */
export function triggerError(d: SkillDraft): string | null {
  return shownMode(d) === "trigger" && parseTriggers(d.triggers).length === 0
    ? TRIGGER_REQUIRED
    : null;
}

/** SKILL-22: a name and either the SKILL.md (Written here) or a repository (GitHub repo). The
 *  name's shape and the trigger words are checked when Save is pressed, so the field says why. */
export function canSave(d: SkillDraft): boolean {
  if (!d.name.trim()) return false;
  if (d.kind === "inline") return d.content.trim() !== "";
  if (d.kind === "repo") return d.repoUrl.trim() !== "";
  return true;
}

export type DraftErrors = Partial<Record<DraftField, string>>;

/** What Save refuses before asking the backend (the same rules it applies). */
export function validateDraft(d: SkillDraft): DraftErrors {
  const out: DraftErrors = {};
  const name = nameError(d.name);
  if (name) out.name = name;
  const trig = triggerError(d);
  if (trig) out.triggers = trig;
  return out;
}

/** Whether the draft differs from what was loaded (drives Discard: revert, or leave). */
export function isDirty(d: SkillDraft, saved: SkillDraft): boolean {
  return (
    d.name.trim() !== saved.name.trim() ||
    JSON.stringify(draftSource(d)) !== JSON.stringify(draftSource(saved))
  );
}

/** The gutter numbers four lines past the text, like the design's editor (5 when empty). */
export function gutterLines(text: string): number {
  return text.split("\n").length + 4;
}

/** The helper under "Loads by default" (SKILL-26); an existing skill says each agent can override. */
export function modeHelper(mode: SkillMode, existing: boolean): string {
  if (existing) return "Each agent can change this in its own Skills & tools tab.";
  if (mode === "trigger") return "Loads only when the conversation mentions a trigger word.";
  if (mode === "agent") return "Listed; the agent opens it when it needs it.";
  return "The full skill goes into every prompt.";
}

export type DraftField = "name" | "content" | "repo" | "triggers";

/** Which field a 409/422 refusal belongs under (the backend's own words); null = a toast. */
export function errorField(status: number, message: string): DraftField | null {
  if (status === 409) return "name";
  if (status !== 422) return null;
  if (/skill name|lowercase letters/i.test(message)) return "name";
  if (/SKILL\.md content/i.test(message)) return "content";
  if (/trigger word/i.test(message)) return "triggers";
  if (/GitHub repo URL/i.test(message)) return "repo";
  return null;
}

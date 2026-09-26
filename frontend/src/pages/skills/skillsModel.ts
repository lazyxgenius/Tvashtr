/**
 * Pure labels for Toolkit › Skills (analysis `toolkit-skills-memory.md` SKILL-7…11, 17): the source
 * badge, the "Loads by default" cell, "Used by", "Updated", name sort + search, and whether a preset
 * is already in the library.
 */
import type { Skill, SkillMode, SkillPreset, SkillSource } from "../../lib/api/skills";

export const MODE_LABEL: Record<SkillMode, string> = {
  always: "Always on",
  trigger: "When triggered",
  agent: "Agent decides",
};

/** The load mode a row shows: legacy "Repo rules" rows are always on; a repo row without a mode
 *  lets each skill file decide, which reads as "Agent decides". */
export function loadMode(source: SkillSource): SkillMode {
  if (source.type === "project_rules") return "always";
  if (source.type === "repo") return source.mode ?? "agent";
  return source.mode;
}

/** The first two trigger words, comma-separated ("auth, secrets"), for a When-triggered row. */
export function triggerPreview(source: SkillSource): string {
  if (source.type === "project_rules" || loadMode(source) !== "trigger") return "";
  return (source.triggers ?? []).slice(0, 2).join(", ");
}

/** "lazyxgenius/skills" from https://github.com/lazyxgenius/skills(.git), or null. */
export function repoSlug(url: string): string | null {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[#?].*)?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function sourceBadge(source: SkillSource): {
  label: string;
  variant: "neutral" | "outline";
} {
  if (source.type === "inline") return { label: "Written here", variant: "neutral" };
  if (source.type === "project_rules") return { label: "Repo rules", variant: "neutral" };
  return { label: `${repoSlug(source.url) ?? source.url} @ ${source.ref}`, variant: "outline" };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function usedByLabel(usage: Skill["usage"]): string {
  if (usage.agents <= 0) return "Not used yet";
  return `${plural(usage.agents, "agent")} · ${plural(usage.teams, "team")}`;
}

/** "Just now" under a minute, otherwise a short date ("Sep 23"). */
export function updatedLabel(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  if (now - t < 60_000) return "Just now";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function sortByName(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive name match; an empty query keeps every skill. */
export function matchesQuery(skill: Skill, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || skill.name.toLowerCase().includes(q);
}

export function presetInLibrary(preset: SkillPreset, skills: Skill[]): boolean {
  return skills.some((s) => s.name === preset.name);
}

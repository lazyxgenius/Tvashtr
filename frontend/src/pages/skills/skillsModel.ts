/**
 * Pure labels for Toolkit › Skills (analysis `toolkit-skills-memory.md` SKILL-7…11, 17, 40–47): the
 * source badge, the "Loads by default" cell, "Used by", "Updated", name sort + search, whether a
 * preset is already in the library, agent names, the delete dialog's impact sentence, and the
 * "Add from GitHub" glob filter and counts.
 */
import type {
  Skill,
  SkillMode,
  SkillPreset,
  SkillSource,
  SkillUsageRow,
} from "../../lib/api/skills";

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

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

// ---- agents ----

const ROLE_TITLE: Record<string, string> = {
  pm: "Product manager",
  architect: "Architect",
  engineer: "Engineer",
  reviewer: "Reviewer",
};

/** An agent's name: its own title, else its role ("Reviewer"); a deleted node is "Removed agent". */
export function agentLabel(agent: { title: string | null; role_name: string | null }): string {
  if (agent.title?.trim()) return agent.title.trim();
  const role = agent.role_name?.trim();
  if (!role) return "Removed agent";
  return ROLE_TITLE[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const MAX_NAMES = 3;

/**
 * The delete dialog's body (TkF-SkillMenu-2): who loses the skill, from `GET /{id}` `used_by` —
 * "Reviewer and Engineer in Indicator sprint team use it. They lose it on their next run. You can’t
 * undo this." Without the rows (that read failed) the row's counts say it; an unused skill says so.
 */
export function deleteImpact(usedBy: SkillUsageRow[] | null, usage: Skill["usage"]): string {
  const tail = "You can’t undo this.";
  const agents = usedBy ? usedBy.length : usage.agents;
  if (agents <= 0) return `No agents use it. ${tail}`;
  let who: string;
  if (usedBy) {
    const teams = new Map<string, { name: string; agents: string[] }>();
    for (const row of usedBy) {
      const team = teams.get(row.team_id) ?? { name: row.team_name, agents: [] };
      team.agents.push(agentLabel(row));
      teams.set(row.team_id, team);
    }
    who = joinAnd(
      [...teams.values()].map((t) => {
        const names =
          t.agents.length > MAX_NAMES
            ? [...t.agents.slice(0, MAX_NAMES), `${t.agents.length - MAX_NAMES} more`]
            : t.agents;
        return `${joinAnd(names)} in ${t.name}`;
      }),
    );
  } else {
    who = `${plural(usage.agents, "agent")} in ${plural(usage.teams, "team")}`;
  }
  return agents === 1
    ? `${who} uses it and loses it on its next run. ${tail}`
    : `${who} use it. They lose it on their next run. ${tail}`;
}

/** The agents picker's action: the end state, "Turn on for 2 agents" (or off for all of them). */
export function agentsActionLabel(checked: number, hadAny: boolean): string {
  if (checked === 0 && hadAny) return "Turn off for all agents";
  return `Turn on for ${plural(checked, "agent")}`;
}

// ---- Add from GitHub ----

/** "review-*, pytest-*" → one case-insensitive matcher per glob (`*` any run, `?` one character). */
export function parseGlobs(filter: string): RegExp[] {
  return filter
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => {
      const escaped = g.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
    });
}

/** No globs keep every skill; otherwise any match keeps it (like the runtime's comma filter). */
export function matchesGlobs(name: string, globs: RegExp[]): boolean {
  return globs.length === 0 || globs.some((g) => g.test(name));
}

/** "Found 4 skills at main @ 1a2b3c4" (or "Found 2 of 4 skills …" while a filter hides some). */
export function foundSummary(shown: number, total: number, ref: string, shortSha: string): string {
  const count = shown === total ? plural(total, "skill") : `${shown} of ${plural(total, "skill")}`;
  return `Found ${count} at ${ref} @ ${shortSha}`;
}

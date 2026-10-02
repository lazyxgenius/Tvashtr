/** M6's small words (the Agents-* boards): a saved agent's menu meta, card lines and pills. */
import { listNatural } from "../pages/home/homeFormat";
import { getProviderCatalogue } from "./api";
import type { SavedAgent } from "./api/myAgents";
import { displayNameForSubscription, subscriptionProviderForModel } from "./engines";
import { versionAge } from "./versionFormat";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The Templates menu's "v2 · 2 teams" ("v1" when no team uses it). */
export function agentMenuMeta(a: SavedAgent): string {
  const n = a.used_in.length;
  return n > 0 ? `v${a.latest} · ${plural(n, "team")}` : `v${a.latest}`;
}

/** "Built on Reviewer · xai/grok-4.7 · 2 skills · read-only · updated yesterday". */
export function libraryMeta(a: SavedAgent, now = Date.now()): string {
  return [
    a.built_on && `Built on ${a.built_on}`,
    a.model,
    a.skills > 0 && plural(a.skills, "skill"),
    a.file_access,
    `updated ${versionAge(a.updated_at, now)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Used in Indicator sprint team (v2) and Bugfix squad (v1)", or null when no team uses it. */
export function usedInLine(a: SavedAgent): string | null {
  if (a.used_in.length === 0) return null;
  return `Used in ${listNatural(a.used_in.map((u) => `${u.team_name} (v${u.version})`))}`;
}

/** "1 team is on v1" / "2 teams are on v1" / "2 teams are on older versions"; null when none. */
export function behindPill(a: SavedAgent): string | null {
  const n = a.behind.length;
  if (n === 0) return null;
  const versions = new Set(a.behind.map((b) => b.version));
  const on = versions.size === 1 ? `v${a.behind[0].version}` : "older versions";
  return `${plural(n, "team")} ${n === 1 ? "is" : "are"} on ${on}`;
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The version a save under `name` makes: the next one of the agent with that name, else 1. */
export function nextVersionFor(name: string, agents: SavedAgent[]): number {
  const same = agents.find((a) => key(a.name) === key(name));
  return same ? same.latest + 1 : 1;
}

/** "Teams without Grok …": the plan name for Claude and Grok models, else the provider's label. */
export function providerName(model: string): string {
  const sub = subscriptionProviderForModel(model);
  if (sub === "claude" || sub === "grok") return displayNameForSubscription(sub);
  const slug = model.split("/", 1)[0] ?? "";
  return getProviderCatalogue().find((p) => p.provider === slug)?.label ?? slug;
}

/** Agents-Delete's subtitle: "Its 2 versions are deleted. Indicator sprint team and Bugfix squad
 *  keep their agents exactly as they are." */
export function deleteAgentText(a: SavedAgent): string {
  const n = a.versions.length || a.latest;
  const gone = n === 1 ? "Its version is deleted." : `Its ${n} versions are deleted.`;
  const teams = a.used_in.map((u) => u.team_name);
  if (teams.length === 0) return gone;
  const keep = teams.length === 1 ? "keeps its agents" : "keep their agents";
  return `${gone} ${listNatural(teams)} ${keep} exactly as they are.`;
}

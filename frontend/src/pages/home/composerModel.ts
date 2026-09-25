/**
 * The composer's non-visual rules: which team it starts on (HOME-13), each team's readiness on the
 * current launch target (HOME-14/15/25), the budget field, and the launch refusal copy (HOME-28/31).
 */
import {
  type GithubReposResponse,
  LARGE_REPO_FILE_THRESHOLD,
  type TeamGraphNode,
  type TeamSummary,
} from "../../lib/api";
import { ApiDetailError } from "../../lib/api/runs";
import { listNatural, subscriptionName } from "./homeFormat";

const LAST_TEAM_KEY = "tvashtr.home.lastTeam";

export function rememberLastTeam(teamId: string): void {
  try {
    localStorage.setItem(LAST_TEAM_KEY, teamId);
  } catch {
    // private window / blocked storage: the default falls back to the most recent run
  }
}

/** Last team used from Home, else the team with the most recent run, else the first team. */
export function defaultTeamId(teams: TeamSummary[]): string | null {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_TEAM_KEY);
  } catch {
    last = null;
  }
  if (last && teams.some((t) => t.team_graph_id === last)) return last;
  let best: TeamSummary | null = null;
  for (const t of teams) {
    if (!t.last_run?.at) continue;
    if (!best || (best.last_run?.at ?? "") < t.last_run.at) best = t;
  }
  return best?.team_graph_id ?? teams[0]?.team_graph_id ?? null;
}

export interface Readiness {
  /** null = the server sent no readiness (older API) — show nothing rather than guess. */
  ready: boolean | null;
  missing: string[];
  routed: string[];
}

export function readinessOf(team: TeamSummary | undefined, desktop: boolean): Readiness {
  const r = team?.readiness;
  if (!r) return { ready: null, missing: [], routed: [] };
  if (desktop) {
    return {
      ready: r.desktop.ready,
      missing: r.desktop.missing_providers,
      routed: r.desktop.routed_subscriptions ?? [],
    };
  }
  return { ready: r.website.ready, missing: r.website.missing_providers, routed: [] };
}

function keysPhrase(missing: string[]): string {
  return missing.length === 1 ? `${missing[0]} key` : `${missing.length} keys`;
}

/** The team picker's readiness phrase: "Ready", "Ready · never run", "Website: needs 2 keys". */
export function pickerPhrase(team: TeamSummary, desktop: boolean): string {
  const r = readinessOf(team, desktop);
  if (r.ready === null) return "";
  if (r.ready)
    return (team.run_count ?? (team.last_run ? 1 : 0)) === 0 ? "Ready · never run" : "Ready";
  return `${desktop ? "This computer" : "Website"}: needs ${keysPhrase(r.missing)}`;
}

/** The hint beside Launch (HOME-25). */
export function readinessHint(
  r: Readiness,
  desktop: boolean,
): { tone: "ready" | "gap"; text: string } | null {
  if (r.ready === null) return null;
  if (r.ready) {
    if (!desktop) return { tone: "ready", text: "Ready on the website" };
    const subs = r.routed.map(subscriptionName);
    return {
      tone: "ready",
      text: subs.length ? `Ready on this computer · ${subs.join(", ")}` : "Ready on this computer",
    };
  }
  return {
    tone: "gap",
    text: `${desktop ? "This computer" : "Website"} needs ${keysPhrase(r.missing)}`,
  };
}

/** "$5.00" → 5; blank → undefined (server default); anything else invalid → NaN. */
export function parseBudget(raw: string): number | undefined {
  const s = raw.replace(/[$,\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function budgetError(raw: string): string | null {
  const n = parseBudget(raw);
  if (n === undefined) return null;
  if (Number.isNaN(n) || n <= 0) return "Enter an amount above $0.";
  if (n > 500) return "Budget can’t be more than $500.";
  return null;
}

export interface LaunchProblem {
  kind: "keys" | "message";
  /** keys: the providers with no key. */
  providers?: string[];
  message?: string;
  /** Offer "Open team" (the team graph can't run). */
  openTeam?: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

/** Turn a launch refusal into what the composer shows (HOME-28/31). */
export function launchProblem(
  e: unknown,
  ctx: { repo: string | null; baseRef: string | null },
): LaunchProblem {
  if (e instanceof ApiDetailError) {
    const d = (e.detail ?? {}) as {
      missing_providers?: unknown;
      code?: unknown;
      base_ref?: unknown;
      subpath?: unknown;
      errors?: unknown;
      message?: unknown;
    };
    if (Array.isArray(d.missing_providers) && d.missing_providers.length > 0) {
      return { kind: "keys", providers: d.missing_providers.map(String) };
    }
    if (d.code === "unknown_base_ref") {
      return {
        kind: "message",
        message: `No branch named ${str(d.base_ref) || (ctx.baseRef ?? "")} in ${ctx.repo ?? "that repo"}.`,
      };
    }
    if (d.code === "unknown_subpath") {
      return {
        kind: "message",
        message: `There’s no folder ${str(d.subpath)} in ${ctx.repo ?? "that repo"}.`,
      };
    }
    if (Array.isArray(d.errors) && d.errors.length > 0) {
      const first = d.errors[0] as { message?: unknown } | string;
      const why = typeof first === "string" ? first : str(first?.message);
      return {
        kind: "message",
        message: why ? `This team can’t run yet: ${why}` : e.message,
        openTeam: true,
      };
    }
    return { kind: "message", message: e.message };
  }
  return { kind: "message", message: "Couldn’t reach the server. Try again in a moment." };
}

/** "Indicator sprint team uses anthropic and xai models, and there’s no API key for them." */
export function missingKeysSentence(team: string, providers: string[]): string {
  const them = providers.length === 1 ? "it" : "them";
  return `${team} uses ${listNatural(providers)} models, and there’s no API key for ${them}.`;
}

// ---- The launch target (repo / folder / path / none) ----

export type Target =
  | { kind: "github"; repo: string; defaultBranch: string }
  | { kind: "folder"; path: string; label: string; branch: string | null }
  | { kind: "local"; path: string; branch: string | null }
  | { kind: "none" };

export type RepoList =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ok"; data: GithubReposResponse }
  | { state: "off" };

export function targetBranch(t: Target, baseRef: string): string | null {
  if (baseRef.trim()) return baseRef.trim();
  if (t.kind === "github") return t.defaultBranch;
  if (t.kind === "folder" || t.kind === "local") return t.branch;
  return null;
}

// ---- The large-repo note (analysis §5: keep the old launch panel's advisory inline) ----

/** The large-repo note: only for a whole-repo run on a repo above the threshold. */
export function largeRepoNote(
  trackedFiles: number | null,
  scoped: boolean,
  canScope: boolean,
  nodes: TeamGraphNode[],
): string | null {
  if (trackedFiles === null || trackedFiles <= LARGE_REPO_FILE_THRESHOLD || scoped) return null;
  const workers = nodes.filter((n) => n.kind === "agent").map((n) => n.role_name);
  const names = workers.length ? `: ${workers.join(", ")}` : "";
  const word = workers.length === 1 ? "node" : "node(s)";
  return (
    `Large repo (~${trackedFiles} files). Working on existing code this size is harder — ` +
    (canScope
      ? `scope the run to a package in Options, or use a bigger-context model on your worker ${word}${names}.`
      : `consider a stronger model on your worker ${word}${names}.`)
  );
}

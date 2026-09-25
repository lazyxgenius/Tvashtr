/**
 * Pure helpers for the Teams section (TEAMS-9 … TEAMS-21): status badge, tab membership, sort
 * orders and the card's text lines. Kept out of the component files so they are easy to test.
 */
import type { BadgeVariant } from "../../design-system/components";
import type { TeamSummary } from "../../lib/api";
import { formatRelativeTime } from "../../lib/time";

export type TeamTab = "all" | "needs_you" | "running" | "not_run";
export type TeamSort = "last_active" | "name" | "spend" | "created";
export type TeamView = "grid" | "list";

export const SORT_LABELS: Record<TeamSort, string> = {
  last_active: "Last active",
  name: "Name",
  spend: "Spend",
  created: "Created",
};

export const TAB_EMPTY: Record<TeamTab, string> = {
  all: "No teams yet.",
  needs_you: "No team needs you right now.",
  running: "No teams are running right now.",
  not_run: "Every team has run at least once.",
};

/** The card's status badge (TEAMS-13). */
export function teamBadge(team: TeamSummary): { variant: BadgeVariant; label: string } {
  switch (team.last_run?.status ?? null) {
    case null:
      return { variant: "neutral", label: "Not run yet" };
    case "awaiting_human":
      return { variant: "warning", label: "Awaiting you" };
    case "pending":
    case "running":
      return { variant: "info", label: "Running" };
    case "failed":
      return { variant: "danger", label: "Failed" };
    case "completed":
      return { variant: "success", label: "Completed" };
    case "over_budget":
      return { variant: "outline", label: "Over budget" };
    default:
      return { variant: "outline", label: "Stopped" };
  }
}

/** Which status tab a team is listed under, besides All (TEAMS-11). */
export function teamTabOf(team: TeamSummary): Exclude<TeamTab, "all"> | null {
  const status = team.last_run?.status ?? null;
  if (status === null) return "not_run";
  if (status === "awaiting_human" || status === "failed") return "needs_you";
  if (status === "pending" || status === "running") return "running";
  return null;
}

export function tabCounts(teams: TeamSummary[]): Record<TeamTab, number> {
  const counts: Record<TeamTab, number> = {
    all: teams.length,
    needs_you: 0,
    running: 0,
    not_run: 0,
  };
  for (const t of teams) {
    const tab = teamTabOf(t);
    if (tab) counts[tab] += 1;
  }
  return counts;
}

function time(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Latest run activity, else when the team was made (the "Last active" key). */
export function lastActive(team: TeamSummary): number {
  return (
    time(team.last_active_at) ||
    Math.max(time(team.last_run?.updated_at), time(team.last_run?.at), time(team.created_at))
  );
}

/** TEAMS-9 sort orders; ties fall back to the name so the order is stable. */
export function sortTeams(teams: TeamSummary[], sort: TeamSort): TeamSummary[] {
  const byName = (a: TeamSummary, b: TeamSummary) => a.name.localeCompare(b.name);
  const out = [...teams];
  switch (sort) {
    case "name":
      return out.sort(byName);
    case "spend":
      return out.sort((a, b) => (b.spend_usd ?? 0) - (a.spend_usd ?? 0) || byName(a, b));
    case "created":
      return out.sort((a, b) => time(b.created_at) - time(a.created_at) || byName(a, b));
    default:
      return out.sort((a, b) => lastActive(b) - lastActive(a) || byName(a, b));
  }
}

export function money(usd: number | null | undefined): string {
  return `$${(usd ?? 0).toFixed(2)}`;
}

export function runCount(team: TeamSummary): number {
  return team.run_count ?? (team.last_run ? 1 : 0);
}

/** "7 runs · $4.82" on a card; a team that never ran says "No runs yet" (TEAMS-16/17). */
export function cardCounts(team: TeamSummary): string {
  const n = runCount(team);
  if (n === 0 && !team.last_run) return "No runs yet";
  return `${n} run${n === 1 ? "" : "s"} · ${money(team.spend_usd)}`;
}

/** "7 · $4.82" in the list's "Runs · spend" column. */
export function rowCounts(team: TeamSummary): string {
  return `${runCount(team)} · ${money(team.spend_usd)}`;
}

/** "today", "yesterday", or a short date ("Sep 21"). */
export function dayRelative(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The card's last-run line (TEAMS-15/16). */
export function lastRunLine(team: TeamSummary, now = new Date()): string {
  const run = team.last_run;
  if (!run) {
    if (team.duplicated_from) return `Copied ${formatRelativeTime(team.created_at)}`;
    const when = dayRelative(team.created_at, now);
    return team.template_name ? `Created ${when} from ${team.template_name}` : `Created ${when}`;
  }
  const idea = run.idea?.trim() || "Untitled run";
  if (run.status === "pending" || run.status === "running") {
    return `${idea} · started ${formatRelativeTime(run.at)}`;
  }
  return `${idea} · ${formatRelativeTime(run.updated_at ?? run.at)}`;
}

/** The delete dialog's body and impact warning (TEAMS-30/31). */
export function deleteImpact(team: TeamSummary): { body: string; warning: string | null } {
  const n = runCount(team);
  const body =
    n === 0
      ? "This deletes the team. You can’t undo this."
      : `This deletes the team and its ${n === 1 ? "1 run" : `${n} runs`}, including their history. You can’t undo this.`;
  const awaiting =
    (team.awaiting_run_count ?? 0) > 0 ||
    (team.awaiting_run_count === undefined && team.last_run?.status === "awaiting_human");
  const active =
    (team.active_run_count ?? 0) > 0 ||
    (team.active_run_count === undefined &&
      (team.last_run?.status === "running" || team.last_run?.status === "pending"));
  const warning = awaiting
    ? "A run is waiting for your approval. Deleting stops it."
    : active
      ? "A run is in progress. Deleting stops it."
      : null;
  return { body, warning };
}

// ---- per-browser choices (TEAMS-9/10) ----

const SORT_KEY = "tv.home.teams.sort";
const VIEW_KEY = "tv.home.teams.view";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / blocked storage: the choice just isn't remembered
  }
}

export function loadSort(): TeamSort {
  const v = read(SORT_KEY);
  return v && v in SORT_LABELS ? (v as TeamSort) : "last_active";
}

export function saveSort(sort: TeamSort): void {
  write(SORT_KEY, sort);
}

export function loadView(): TeamView {
  return read(VIEW_KEY) === "list" ? "list" : "grid";
}

export function saveView(view: TeamView): void {
  write(VIEW_KEY, view);
}

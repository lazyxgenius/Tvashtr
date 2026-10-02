/**
 * M8 — Compare two versions (`docs/superpowers/plans/api/compare.md`, ruling R5): the canvas
 * header's Compare opens "Compare versions" — pick A and B, run them on one task, watch both lanes,
 * read the results. Every word (summaries, results, the headline) is made server-side.
 */
import type { ActivityLine } from "./activity";
import type { VersionChange } from "./versions";
import { apiRequest } from "./runs";

/** One version in the A / B pickers (and the Versions tab). */
export interface CompareVersion {
  number: number;
  when: string;
  runs: number;
  summary: string;
  current: boolean;
}

/** The Compare tab: what can be compared, the defaults and the team's newest compare. */
export interface CompareStart {
  team: { id: string; name: string };
  versions: CompareVersion[];
  /** Previous vs current; `a` null when the team has one version. */
  defaults: { a: number | null; b: number | null };
  /** What changed between the default A and B (the "1 change" link). */
  changes: number;
  target: { repo: string; base_ref: string | null } | null;
  /** About $X on your keys · about N min — null before either version has a finished run. */
  estimate: { cost_usd: number; minutes: number } | null;
  latest: { id: string; status: CompareStatus } | null;
  /** M9: the team's task sets (the Task sets tab reads them whole from `listTaskSets`). */
  task_sets?: { id: string; name: string; count: number }[];
}

export type CompareStatus = "waiting" | "running" | "finished" | "stopped";
export type SideStatus = "waiting" | "running" | "needs_you" | "finished" | "failed" | "stopped";

/** One step chip of a lane's pipeline strip (the shape Home's RunProgressStrip gets). */
export interface CompareStripChip {
  node_id: string;
  label: string;
  kind: string;
  state: string;
  /** The chip's icon (Home's `RunProgressChip.role_name`); absent: picked from the label. */
  role_name?: string;
  /** "⇄" between this chip and its loop partner (Home's `RunProgressChip.loops_with`). */
  loops_with?: string | null;
}

export interface CompareSide {
  label: "A" | "B";
  version: number;
  run_id: string | null;
  number: number | null;
  status: SideStatus;
  elapsed_s: number;
  cost_usd: number;
  strip: CompareStripChip[];
  /** "Engineer · round 3" / "Approved in round 2". */
  current: { label: string; text: string } | null;
  /** The run's last few Activity lines. */
  lines: ActivityLine[];
  gate_task_id: number | null;
}

/** One row of the results table; `better` marks the side with the better value. */
export interface CompareRow {
  key: "result" | "cost" | "time" | "repo_tests" | "agent_tests" | "retries" | "files";
  label: string;
  a: string;
  b: string;
  better: "a" | "b" | null;
  difference: string;
}

export interface CompareResults {
  headline: string;
  rows: CompareRow[];
  current_version: number;
  /** "Restore v6" — the other version when it did better than the current one. */
  restore: number | null;
  /** M9, a set compare: the summary cards ("Hidden checks passed" v6 3 of 5 → v7 5 of 5). */
  cards?: SetCard[];
  /** M9, a one-task compare: the team's set for "One task is a small sample" (null: none). */
  sample?: { set_id: string; name: string; count: number } | null;
}

/** M9: one summary card of a set compare's results. */
export interface SetCard {
  key: "checks" | "rounds" | "cost" | "retries";
  label: string;
  a: string;
  b: string;
  /** "2 more tasks really work", "$0.90 less in all". */
  note: string;
}

/** M9: one side of one task in a set compare (a cell of its table). */
export interface SetCell {
  run_id: string | null;
  status: "waiting" | "running" | "finished" | "failed" | "stopped";
  /** "Engineer · round 2" while it works. */
  now: string | null;
  check: "passed" | "failed" | null;
  rounds: number;
  cost_usd: number;
  /** The check's last output line on a failed check, else the run's failure words. */
  note: string | null;
}

export interface SetItem {
  task: string;
  a: SetCell;
  b: SetCell;
  badge: string | null;
}

export interface Compare {
  id: string;
  team_id: string;
  task: string;
  auto_approve: boolean;
  status: CompareStatus;
  elapsed_s: number;
  cost_usd: number;
  created_at: string;
  ended_at: string | null;
  /**
   * Waiting for a free slot: the owner's run slots in use. M9, a set compare: the number of its
   * runs still waiting for a slot.
   */
  waiting: { in_use: number; limit: number } | number | null;
  sides: CompareSide[];
  results: CompareResults | null;
  /** M9: set for a compare on a task set (its table replaces the two lanes). */
  set?: { id: string; name: string; count: number } | null;
  /** M9, a set compare: runs started so far (of 2 × count). */
  started?: number;
  items?: SetItem[];
}

const team = (teamId: string) => `/api/teams/${encodeURIComponent(teamId)}`;

export function getCompareStart(teamId: string): Promise<CompareStart> {
  return apiRequest("GET", `${team(teamId)}/compare`);
}

/** What changed from vA to vB (M5's What changed rows). */
export function getCompareChanges(
  teamId: string,
  a: number,
  b: number,
): Promise<{ a: number; b: number; rows: VersionChange[]; summary: string }> {
  return apiRequest("GET", `${team(teamId)}/compare/changes?a=${a}&b=${b}`);
}

/** Start compare (on one task, or M9's task set). 422 / 409 throw `ApiDetailError`. */
export function startCompare(
  teamId: string,
  body: { a: number; b: number; auto_approve: boolean } & (
    | { task: string }
    | { task_set_id: string }
  ),
): Promise<{ id: string; status: CompareStatus }> {
  return apiRequest("POST", `${team(teamId)}/compare`, body);
}

export function getCompare(compareId: string): Promise<Compare> {
  return apiRequest("GET", `/api/compares/${encodeURIComponent(compareId)}`);
}

export function stopCompare(compareId: string): Promise<{ status: "stopped" }> {
  return apiRequest("POST", `/api/compares/${encodeURIComponent(compareId)}/stop`);
}

// ---- M9: task sets (`docs/superpowers/plans/api/task-sets.md`) ----

export interface TaskSetItem {
  id?: string;
  position?: number;
  task: string;
  /** The branch it starts from; null: the target's default branch. */
  starts_from: string | null;
  /** The command run after each run (R11: never shown to an agent). */
  hidden_check: string;
}

export interface TaskSet {
  id: string;
  name: string;
  items: TaskSetItem[];
  /** "Last used: v6 vs v7 · 2 days ago · v7 better on 4 of 5"; null: not used yet. */
  last_used: { compare_id: string; a: number; b: number; at: string; summary: string } | null;
  /** Comparing two versions on this set: about $X and N min (null: no finished run yet). */
  estimate: { cost_usd: number; minutes: number } | null;
}

export type TaskSetBody = {
  name: string;
  items: { task: string; starts_from: string | null; hidden_check: string }[];
};

export async function listTaskSets(teamId: string): Promise<TaskSet[]> {
  const body = await apiRequest<{ sets?: TaskSet[] } | null>("GET", `${team(teamId)}/task-sets`);
  return Array.isArray(body?.sets) ? body.sets : [];
}

/** 422 (empty name, no tasks, …) / 409 (a name the team has) throw `ApiDetailError`. */
export function createTaskSet(teamId: string, body: TaskSetBody): Promise<TaskSet> {
  return apiRequest("POST", `${team(teamId)}/task-sets`, body);
}

/** The items are replaced as a whole. */
export function updateTaskSet(id: string, body: TaskSetBody): Promise<TaskSet> {
  return apiRequest("PATCH", `/api/task-sets/${encodeURIComponent(id)}`, body);
}

export function deleteTaskSet(id: string): Promise<null> {
  return apiRequest("DELETE", `/api/task-sets/${encodeURIComponent(id)}`);
}

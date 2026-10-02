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
}

export type CompareStatus = "waiting" | "running" | "finished" | "stopped";
export type SideStatus = "waiting" | "running" | "needs_you" | "finished" | "failed" | "stopped";

/** One step chip of a lane's pipeline strip (the shape Home's RunProgressStrip gets). */
export interface CompareStripChip {
  node_id: string;
  label: string;
  kind: string;
  state: string;
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
  /** Waiting for a free slot: the owner's run slots in use. */
  waiting: { in_use: number; limit: number } | null;
  sides: CompareSide[];
  results: CompareResults | null;
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

/** Start compare. 422 / 409 throw `ApiDetailError` with the server's words. */
export function startCompare(
  teamId: string,
  body: { a: number; b: number; task: string; auto_approve: boolean },
): Promise<{ id: string; status: CompareStatus }> {
  return apiRequest("POST", `${team(teamId)}/compare`, body);
}

export function getCompare(compareId: string): Promise<Compare> {
  return apiRequest("GET", `/api/compares/${encodeURIComponent(compareId)}`);
}

export function stopCompare(compareId: string): Promise<{ status: "stopped" }> {
  return apiRequest("POST", `/api/compares/${encodeURIComponent(compareId)}/stop`);
}

/**
 * The run view's Activity (M2, `docs/superpowers/plans/api/activity.md`): one owner-scoped read that
 * feeds the Now bar, the Activity panel, its pinned callout, the node cards' activity line and the
 * Done summary. The words are made server-side; this module only carries them.
 */
import { apiRequest } from "./runs";

/** What a step is doing now (M1 R1) — the machine values of the plain state words. */
export type LiveState =
  | "waiting"
  | "working"
  | "running_command"
  | "needs_you"
  | "retrying"
  | "quiet"
  | "stalled"
  | "failed"
  | "done"
  | "stopped"
  | "carried_over";

export interface ActivityAgent {
  node_id: string;
  origin_node_id: string | null;
  label: string;
  kind: string;
  iteration: number;
  rounds_limit: number | null;
  live_state: LiveState;
  activity: string | null;
  last_event_at: string | null;
  activity_started_at: string | null;
  retry: { attempt: number; of: number; next_at: string } | null;
  backup_model: string | null;
  model: string | null;
}

export type LineKind =
  | "started"
  | "read"
  | "searched"
  | "edited"
  | "wrote_doc"
  | "command"
  | "tests"
  | "gate_waiting"
  | "gate_approved"
  | "gate_rejected"
  | "verdict"
  | "retry"
  | "backup"
  | "stalled"
  | "error"
  | "pr"
  | "done"
  | "message"
  // M3: a step carried from the run this one resumed, and the Run line saying where it resumed.
  | "carried"
  | "resumed";

export interface ActivityRefs {
  files?: string[];
  file?: string;
  added?: number;
  removed?: number;
  query?: string;
  command?: string;
  running?: boolean;
  started_at?: string;
  exit_code?: number | null;
  output_tail?: string[];
  passed?: number;
  failed?: number;
  document_id?: string;
  version?: number;
  name?: string;
  task_id?: number;
  verdict?: string;
  reasons?: string[] | string | null;
  to_model?: string;
  from_model?: string;
  pr_url?: string;
  pr_number?: number;
  branch?: string;
  repo?: string;
  elapsed_s?: number;
  cost_usd?: number;
  [key: string]: unknown;
}

export interface ActivityLine {
  id: string;
  at: string;
  node_id: string | null;
  label: string;
  iteration: number | null;
  /** One of {@link LineKind}; a newer server may send others, shown as plain lines. */
  kind: string;
  text: string;
  tone: "neutral" | "ok" | "warn" | "danger";
  refs: ActivityRefs;
  /** M3: the run a carried line came from (null or absent: this run's own line). */
  from_run?: { run_id: string; number: number | null } | null;
  /** M10: the "Started from run #12 · brought …" line — it links "See what came along". */
  came_along?: boolean;
  /** M10: "Saved 3 new memories from this run" — the page links Review (Toolkit › Memory › Inbox). */
  review_memories?: boolean;
}

/** M3: the run this one resumed (docs/superpowers/plans/api/resume.md). */
export interface ResumedFrom {
  run_id: string;
  number: number | null;
  step_label: string;
}

export interface PinnedCallout {
  /** R19: "stopped" — a run the person stopped (status "cancelled"); never joins Needs you. */
  kind: "gate" | "retrying" | "stalled" | "failed" | "stopped";
  node_id: string | null;
  label: string;
  title: string;
  body: string;
  task_id: number | null;
  backup_model: string | null;
  /** gate: what the gate decides ("prd_approval" = the spec). */
  gate_kind?: string | null;
  /** M3 (failed / stalled; R19 stopped): where Resume picks up ("Engineer, round 2"); null: not offered. */
  resume?: { invocation_id: number; label: string } | null;
  /** M3: what is saved ("your approved spec (v2) and the Engineer’s round 1 changes are saved"). */
  safe?: string | null;
}

export interface RunSummary {
  pr_url: string | null;
  pr_number: number | null;
  branch?: string | null;
  base_ref?: string | null;
  tests_passed?: number | null;
  rounds: number;
  elapsed_s: number;
  cost_usd: number;
}

export interface RunActivity {
  run_id: string;
  status: string;
  live_state: LiveState;
  cursor: string;
  total: number;
  agents: ActivityAgent[];
  lines: ActivityLine[];
  pinned: PinnedCallout | null;
  summary: RunSummary | null;
  /** M3: "run #12" (null without a library team); absent from an older server. */
  number?: number | null;
  resumed_from?: ResumedFrom | null;
}

export function getRunActivity(runId: string, after?: string | null): Promise<RunActivity> {
  const q = after ? `?after=${encodeURIComponent(after)}` : "";
  return apiRequest<RunActivity>("GET", `/api/runs/${encodeURIComponent(runId)}/activity${q}`);
}

/** The Retrying callout's "Switch to the backup model now" (R2). */
export function switchToBackup(runId: string, nodeId: string): Promise<{ switched: boolean }> {
  return apiRequest(
    "POST",
    `/api/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/switch-backup`,
  );
}

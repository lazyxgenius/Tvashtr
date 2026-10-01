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
  | "message";

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
  reasons?: string | null;
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
}

export interface PinnedCallout {
  kind: "gate" | "retrying" | "stalled" | "failed";
  node_id: string | null;
  label: string;
  title: string;
  body: string;
  task_id: number | null;
  backup_model: string | null;
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

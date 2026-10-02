/**
 * M10 — Start a new run from this one (`docs/superpowers/plans/api/start-from-run.md`, ruling R9):
 * what can come along (the dialog), starting the new run, what came along (a started run's
 * snapshot) and the run log. The words are made server-side; this module only carries them.
 */
import { apiUrl } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";
import { ApiDetailError, apiRequest } from "./runs";

export type StartFrom = "pr" | "main";

/** One gate a person resolved: "Spec approved" and their note, if any. */
export interface CarryDecision {
  title: string;
  text: string | null;
}

export interface CarrySummary {
  agent: string;
  text: string;
}

/** GET /api/runs/{id}/next — the "Start a new run from run #12" dialog (Next-Carry). */
export interface NextInfo {
  available: boolean;
  reason: string | null;
  run: { id: string; number: number; idea: string };
  spec: { version: number | null } | null;
  decisions: CarryDecision[];
  memories: { id: string; content: string }[];
  /** Memories still waiting for review: counted, never carried. */
  pending_memories: number;
  summaries: CarrySummary[];
  pr: { number: number; branch: string; merged: boolean } | null;
  start_from: { value: StartFrom; label: string }[];
  default_start: StartFrom;
  /** The version the new run uses (R3: the next one when the team has unsaved changes). */
  team: { id: string; version: number | null };
  /** The team's first agent, who updates the carried spec ("Product manager"). */
  entry_agent?: string | null;
}

/** What the person ticked under "Brings along". */
export interface CarryChoice {
  spec: boolean;
  decisions: boolean;
  memories: boolean;
  summaries: boolean;
}

/** GET /api/runs/{id}/carry — what came along to a run started from another (Next-CameAlong). */
export interface CarrySnapshot {
  from: { run_id: string; number: number | null };
  spec: { version: number | null } | null;
  decisions: CarryDecision[];
  memories: { id: string; content: string }[];
  summaries: CarrySummary[];
}

export type LogFormat = "text" | "jsonl";

const runPath = (runId: string) => `/api/runs/${encodeURIComponent(runId)}`;

export function getNext(runId: string): Promise<NextInfo> {
  return apiRequest<NextInfo>("GET", `${runPath(runId)}/next`);
}

/** Start the new run. Refusals (422 / 429 …) throw `ApiDetailError` with the server's reason. */
export function startNext(
  runId: string,
  body: { task: string; carry: CarryChoice; start_from: StartFrom },
): Promise<{ run_id: string; number: number | null }> {
  return apiRequest("POST", `${runPath(runId)}/next`, body);
}

export function getCarry(runId: string): Promise<CarrySnapshot> {
  return apiRequest<CarrySnapshot>("GET", `${runPath(runId)}/carry`);
}

/** The run log as text (readable text, or one JSON object per line), with the session. */
export async function getRunLog(runId: string, format: LogFormat): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`${runPath(runId)}/log?format=${format}`));
  } catch (e) {
    reportFetchFailed();
    throw e;
  }
  reportFetchOk();
  if (!res.ok) throw new ApiDetailError(res.status, `Couldn’t load the run log.`, null);
  return res.text();
}

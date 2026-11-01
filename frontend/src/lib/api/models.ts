/**
 * The Models API clients (Models 1, `backend/tvashtr/routes/models.py`): a customer's models, their
 * versioned tests, the cost estimate, runs and compare. A refusal throws `ApiError` with the
 * server's words, which the pages show in place.
 */
import { ApiError, apiUrl, getMe } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    reportFetchFailed();
    throw err;
  }
  if (res.status >= 502 && res.status <= 504) reportFetchFailed();
  else reportFetchOk();
  if (res.status === 401) void getMe().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, await detailOf(res));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** The server's words: a `detail` string, or a `detail.message`. */
async function detailOf(res: Response): Promise<string> {
  try {
    const { detail } = (await res.json()) as { detail?: unknown };
    if (typeof detail === "string" && detail.trim()) return detail;
    const message = (detail as { message?: unknown } | undefined)?.message;
    if (typeof message === "string") return message;
  } catch {
    // not JSON
  }
  return "Something went wrong. Try again.";
}

export type AnswerKind = "choice" | "text";
export type Scoring = "exact" | "contains" | "judge";
export type Verdict = "pass" | "fail" | "error";
export type RunStatus = "running" | "completed" | "failed" | "stopped";

export interface ModelRun {
  run_id: string;
  model_slug: string;
  model_name: string;
  provider_label: string;
  version: number;
  status: RunStatus;
  stop_requested: boolean;
  cases_total: number;
  done: number;
  passed: number;
  failed: number;
  errors: number;
  first_error: string | null;
  price_known: boolean;
  estimate_usd: number | null;
  cost_usd: number;
  judge_cost_usd: number;
  total_usd: number;
  avg_latency_ms: number | null;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

/** A model on the Models list. */
export interface ModelCard {
  model_id: string;
  name: string;
  job: string;
  answer_kind: AnswerKind;
  choices: string[];
  current_version: number;
  tests: number;
  badge: "tested" | "not_run" | "changed";
  tested_at: string | null;
  best: ModelRun[];
}

export interface ModelDetail {
  model_id: string;
  name: string;
  job: string;
  answer_kind: AnswerKind;
  choices: string[];
  current_version: number;
  tests: number;
  runs_on_current: number;
  edited_at: string | null;
  judge_default: string | null;
  pre_checked: string[];
  created_at: string | null;
}

export interface ModelTest {
  case_id: string;
  case_key: string;
  position: number;
  input: string;
  expected: string;
  scoring: Scoring;
  must_contain: string[];
  rubric: string | null;
  judge_model: string | null;
  /** This revision's verdict in each of `last_runs`; `null`: that run didn't run it. */
  last_run: ({ verdict: Verdict } | null)[];
}

export interface LastRun {
  run_id: string;
  model_slug: string;
  model_name: string;
  completed_at: string | null;
}

export interface ModelTests {
  version: number;
  is_current: boolean;
  change_note: string | null;
  created_at: string | null;
  tests: ModelTest[];
  last_runs: LastRun[];
}

export interface TestResult extends LastRun {
  verdict: Verdict;
  reason: string | null;
  judge_model: string | null;
  answer: string | null;
}

export interface TestFields {
  input: string;
  expected: string;
  scoring?: Scoring;
  must_contain?: string[];
  rubric?: string | null;
  judge_model?: string | null;
}

export interface ImportResult {
  ready: number;
  next_version: number;
  errors: string[];
  imported: boolean;
}

export interface TestSetVersion {
  version: number;
  change_note: string;
  created_at: string | null;
  tests: number;
  runs: number;
}

export interface ModelEstimate {
  model: string;
  price_known: boolean;
  estimate_usd: number | null;
  model_usd: number | null;
  judge_usd: number | null;
  unpriced_judges: string[];
}

export interface ScoringSummary {
  judge_tests: number;
  judges: string[];
  uses_exact: boolean;
  uses_contains: boolean;
}

export interface Estimate {
  tests: number;
  version: number;
  models: ModelEstimate[];
  summary: ScoringSummary;
}

export interface RunsOfVersion {
  version: number;
  current_version: number;
  runs: ModelRun[];
  best_run_id: string | null;
  lowest_cost_run_id: string | null;
  versions_with_runs: { version: number; runs: number }[];
}

export interface CompareSide {
  answer: string | null;
  verdict: Verdict;
  reason: string | null;
  right: boolean;
}

export interface CompareRow {
  position: number;
  case_key: string;
  input: string;
  expected: string;
  a: CompareSide;
  b: CompareSide;
  differ: boolean;
}

export interface Comparison {
  version: number;
  a: ModelRun;
  b: ModelRun;
  counts: {
    total: number;
    agree: number;
    both_right: number;
    both_wrong: number;
    only_a: number;
    only_b: number;
  };
  rows: CompareRow[];
}

const base = (id: string) => `/api/models/${encodeURIComponent(id)}`;

export const listModels = () =>
  send<{ models: ModelCard[] }>("GET", "/api/models").then((r) => r.models);

export const createModel = (body: {
  name: string;
  job: string;
  answer_kind: AnswerKind;
  choices: string[];
}) => send<ModelDetail>("POST", "/api/models", body);

export const getModel = (id: string) => send<ModelDetail>("GET", base(id));

export const updateModel = (
  id: string,
  body: { name?: string; job?: string; choices?: string[] },
) => send<ModelDetail>("PATCH", base(id), body);

export const deleteModel = (id: string) => send<void>("DELETE", base(id));

export const listTests = (id: string, version?: number) =>
  send<ModelTests>("GET", `${base(id)}/tests${version === undefined ? "" : `?version=${version}`}`);

export const addTest = (id: string, fields: TestFields) =>
  send<{ test: ModelTest; version: number }>("POST", `${base(id)}/tests`, fields);

export const editTest = (id: string, caseKey: string, fields: TestFields) =>
  send<{ test: ModelTest; version: number }>("PUT", `${base(id)}/tests/${caseKey}`, fields);

export const deleteTest = (id: string, caseKey: string) =>
  send<{ version: number }>("DELETE", `${base(id)}/tests/${caseKey}`);

export const testResults = (id: string, caseKey: string) =>
  send<{ results: TestResult[] }>("GET", `${base(id)}/tests/${caseKey}/results`).then(
    (r) => r.results,
  );

export const importTests = (
  id: string,
  body: { filename: string; csv: string; dry_run: boolean },
) => send<ImportResult>("POST", `${base(id)}/tests/import`, body);

export const listVersions = (id: string) =>
  send<{ versions: TestSetVersion[] }>("GET", `${base(id)}/versions`).then((r) => r.versions);

export const restoreVersion = (id: string, version: number) =>
  send<{ version: number }>("POST", `${base(id)}/versions/${version}/restore`);

export const estimateRun = (id: string, models: string[]) =>
  send<Estimate>("POST", `${base(id)}/estimate`, { models });

export const startRuns = (id: string, models: string[]) =>
  send<{ runs: ModelRun[] }>("POST", `${base(id)}/runs`, { models }).then((r) => r.runs);

export const listRuns = (id: string, version?: number) =>
  send<RunsOfVersion>(
    "GET",
    `${base(id)}/runs${version === undefined ? "" : `?version=${version}`}`,
  );

export const stopRun = (id: string, runId: string) =>
  send<ModelRun>("POST", `${base(id)}/runs/${runId}/stop`);

export const compareRuns = (id: string, a: string, b: string) =>
  send<Comparison>("GET", `${base(id)}/compare?a=${a}&b=${b}`);

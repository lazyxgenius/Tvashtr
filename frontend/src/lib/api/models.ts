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
  /** M2: the training set's current version (0 = none), its size, open drafts, a team at work. */
  training_version?: number;
  training?: number;
  drafts?: number;
  drafting?: boolean;
}

/** M2: where an example came from — a Domain file and the quote that supports it. */
export interface Source {
  file: string | null;
  quote: string | null;
  /** "page 4" only when the stored passage carries one. */
  locator?: string | null;
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
  /** M2: the quote it came from (a test from a draft), else `null`. */
  source?: Source | null;
  origin?: "hand" | "csv" | "draft" | null;
  /** "Added by you" / "Imported from x.csv" when there is no source. */
  added_by?: string | null;
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
  /** M2 Part B: the answer size was learned from this account's past tests. */
  learned?: boolean;
  /** M2 Part B: LiteLLM marks it as a model that thinks before it answers. */
  thinks?: boolean;
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

// ---- M2: training examples, drafts and Draft with a team ----

export interface TrainingExample {
  example_id: string;
  example_key: string;
  position: number;
  input: string;
  answer: string;
  source: Source | null;
  origin: "hand" | "csv" | "draft";
  /** "Example builder" / "You" / "You, edited from a draft" / "Imported from x.csv". */
  added_by: string;
}

export interface TrainingSet {
  version: number;
  is_current: boolean;
  change_note: string | null;
  created_at: string | null;
  examples: TrainingExample[];
  /** The model's current number of tests (the note says how many are kept apart). */
  tests: number;
}

export interface TrainingVersion {
  version: number;
  change_note: string;
  created_at: string | null;
  examples: number;
}

export type DraftKind = "test" | "training";

export interface Draft {
  draft_id: string;
  number: number;
  kind: DraftKind;
  input: string;
  answer: string;
  must_contain: string[];
  source: Source;
  review: "none" | "ok" | "flagged";
  review_note: string | null;
  reviewed_by: string | null;
  edited: boolean;
  /** Why it can't be accepted as it is, else `null`. */
  blocked: string | null;
  /** Selected by default. */
  selected: boolean;
}

export interface DraftBatch {
  batch_id: string;
  run_id: string | null;
  state: "drafting" | "ready" | "stopped";
  team_id: string | null;
  team_name: string;
  domain_name: string;
  tests_wanted: number;
  training_wanted: number;
  handed_in: number;
  drafts_total: number;
  created_at: string | null;
  completed_at: string | null;
  cost_usd: number | null;
  estimate_usd: number | null;
  review_rounds: number;
  sent_back: number;
  reviewer_line: string | null;
  drafts: Draft[];
}

export interface Drafts {
  batches: DraftBatch[];
  open: number;
  test_version: number;
  training_version: number;
  answer_kind: AnswerKind;
  choices: string[];
}

export interface AcceptResult {
  accepted_tests: number;
  accepted_training: number;
  test_version: number;
  training_version: number;
  refused: { draft_id: string; number: number; reason: string }[];
}

export interface TeamStep {
  node_id: string;
  label: string;
  model: string | null;
  end: boolean;
  hand_in: boolean;
  loops_with_next: boolean;
}

export interface DraftingTeam {
  team_id: string;
  name: string;
  builder: boolean;
  steps: TeamStep[];
}

export interface DraftingOptions {
  domains: { domain_id: string; name: string; ready_files: number }[];
  teams: DraftingTeam[];
  drafting: boolean;
  answer_kind: AnswerKind;
  choices: string[];
}

export interface DraftingEstimate {
  estimate_usd: number;
  from_history: boolean;
  runs: number;
  hint: string;
  unpriced: string[];
  pause_usd: number;
  agents: number;
}

export interface DraftingBody {
  domain_id: string;
  team_id: string;
  tests: number;
  training: number;
}

/** A refused start that names the providers with no key (`missing_providers`). */
export class MissingKeysError extends ApiError {
  constructor(
    message: string,
    public readonly providers: string[],
  ) {
    super(422, message);
    this.name = "MissingKeysError";
  }
}

export const listTraining = (id: string, version?: number) =>
  send<TrainingSet>(
    "GET",
    `${base(id)}/training${version === undefined ? "" : `?version=${version}`}`,
  );

export const addExample = (id: string, fields: { input: string; answer: string }) =>
  send<{ example: TrainingExample; version: number }>("POST", `${base(id)}/training`, fields);

export const editExample = (id: string, key: string, fields: { input: string; answer: string }) =>
  send<{ example: TrainingExample; version: number }>("PUT", `${base(id)}/training/${key}`, fields);

export const deleteExample = (id: string, key: string) =>
  send<{ version: number }>("DELETE", `${base(id)}/training/${key}`);

export const importTraining = (
  id: string,
  body: { filename: string; csv: string; dry_run: boolean },
) => send<ImportResult>("POST", `${base(id)}/training/import`, body);

export const listTrainingVersions = (id: string) =>
  send<{ versions: TrainingVersion[] }>("GET", `${base(id)}/training/versions`).then(
    (r) => r.versions,
  );

export const restoreTrainingVersion = (id: string, version: number) =>
  send<{ version: number }>("POST", `${base(id)}/training/versions/${version}/restore`);

/** The address a Download link points at (the browser saves the file). */
export const trainingDownloadUrl = (id: string, format: "jsonl" | "csv") =>
  apiUrl(`${base(id)}/training/download?format=${format}`);

export const listDrafts = (id: string) => send<Drafts>("GET", `${base(id)}/drafts`);

export const editDraft = (
  id: string,
  draftId: string,
  fields: { input?: string; answer?: string; must_contain?: string[] },
) => send<{ draft: Draft }>("PUT", `${base(id)}/drafts/${draftId}`, fields).then((r) => r.draft);

export const setDraftKind = (id: string, draftId: string, kind: DraftKind) =>
  send<{ draft: Draft }>("POST", `${base(id)}/drafts/${draftId}/kind`, { kind }).then(
    (r) => r.draft,
  );

export const acceptDrafts = (id: string, draftIds: string[]) =>
  send<AcceptResult>("POST", `${base(id)}/drafts/accept`, { draft_ids: draftIds });

export const rejectDrafts = (id: string, draftIds: string[]) =>
  send<{ rejected: number }>("POST", `${base(id)}/drafts/reject`, { draft_ids: draftIds });

export const draftingOptions = (id: string) => send<DraftingOptions>("GET", `${base(id)}/drafting`);

export const estimateDrafting = (
  id: string,
  body: { team_id: string; tests: number; training: number },
) => send<DraftingEstimate>("POST", `${base(id)}/drafting/estimate`, body);

/** Start drafting. A refusal naming providers with no key is a {@link MissingKeysError}. */
export async function startDrafting(
  id: string,
  body: DraftingBody,
): Promise<{ batch_id: string; run_id: string }> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`${base(id)}/drafting`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    reportFetchFailed();
    throw err;
  }
  reportFetchOk();
  if (res.ok) return (await res.json()) as { batch_id: string; run_id: string };
  let detail: unknown = null;
  try {
    detail = ((await res.json()) as { detail?: unknown }).detail;
  } catch {
    // not JSON
  }
  const d = detail as { missing_providers?: string[]; message?: string } | string | null;
  if (d && typeof d === "object" && Array.isArray(d.missing_providers)) {
    throw new MissingKeysError(d.message ?? "Add a key first.", d.missing_providers);
  }
  const message =
    typeof d === "string" ? d : (d && typeof d === "object" && d.message) || "Couldn’t start.";
  throw new ApiError(res.status, message);
}

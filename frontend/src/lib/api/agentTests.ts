/**
 * M7 — agent tests (`docs/superpowers/plans/api/agent-tests.md`, rulings R6 R7 R12): an agent's
 * Tests tab, a test made from a round or from a file, Run all / Stop, a replay's result and Check the
 * AI check. Every word (metas, `last`, errors) is made server-side.
 */
import { apiRequest } from "./runs";

export type CheckKind = "must_say" | "must_not_say" | "must_name_file" | "ai";

/** A check's AI-check agreement with the owner's labels (null: never labelled). */
export interface CheckJudge {
  agree: number;
  total: number;
  trusted: boolean;
  /** The saved labels (Check the AI check opens with them). */
  labels?: JudgeRow[];
}

export interface TestCheck {
  kind: CheckKind;
  value: string;
  from_round?: boolean;
  judge?: CheckJudge | null;
}

/** What the agent got in the saved round ("What the Reviewer gets"). */
export interface TestGets {
  task: string;
  documents: { name: string; version_no: number; pages: number; is_shared_spec?: boolean }[];
  change: { path: string; added: number; removed: number }[];
  test_output: string | null;
  feedback: boolean;
  /** The role whose change it was ("Engineer": "The Engineer’s change"); null: unknown. */
  change_by?: string | null;
}

export interface AgentTest {
  id: string;
  name: string;
  /** "From run #12 · round 1 · 3 checks". */
  meta: string;
  source:
    | { kind: "round"; run_id: string; run_number: number | null; iteration: number }
    | { kind: "file"; row: number };
  checks: TestCheck[];
  gets: TestGets;
  created_at: string;
}

/** A check as a replay met it (null: an AI check that couldn't run — skipped, not failed). */
export interface CheckResult {
  kind: CheckKind;
  value: string;
  met: boolean | null;
  reason: string | null;
}

export type ResultStatus = "waiting" | "running" | "passed" | "failed" | "stopped";

export interface TestResult {
  id: string;
  test_id: string | null;
  name: string;
  status: ResultStatus;
  answer: string | null;
  files: string[];
  checks: CheckResult[];
  error: string | null;
  cost_usd: number;
}

export interface TestRun {
  id: string;
  status: "running" | "done" | "stopped" | "failed";
  /** The team's version when it started ("On v7"). */
  version: number | null;
  trigger: "manual" | "save";
  total: number;
  done: number;
  passed: number;
  failed: number;
  cost_usd: number;
  started_at: string;
  ended_at: string | null;
  elapsed_s: number;
  /** R12: the owner's runs use all 3 slots. */
  waiting_for_slot: boolean;
  error: string | null;
  /** "+1 since v6" (delta may be ≤ 0). */
  since: { version: number; delta: number } | null;
  results: TestResult[];
}

export interface TestEstimate {
  cost_usd: number;
  minutes?: number;
}

/** R7: AI checks run on Tvashtr's key, 200 per account per month. */
export interface AiChecks {
  available: boolean;
  left: number;
  limit: number;
}

export interface AgentTests {
  tests: AgentTest[];
  run: TestRun | null;
  /** The header subline when not running ("Last run on v7 · 2h ago · 5 passed, 1 failed"). */
  last: string | null;
  estimate: TestEstimate | null;
  ai: AiChecks | null;
}

/** The New test dialog's round. */
export interface FromRound {
  invocation_id: number;
  run_id: string;
  run_number: number | null;
  iteration: number;
  role: string;
  /** A reviewer's verdict in that round. */
  answered: string | null;
  gets: TestGets;
  checks: TestCheck[];
  estimate: TestEstimate | null;
  ai: AiChecks | null;
}

/** How a file's column is used. */
export type ColumnUse = "gets" | "must_say" | "must_name_file" | "skip";

export interface FileCheck {
  filename: string;
  rows: number;
  columns: { name: string; first: string; use: ColumnUse }[];
  ready: { tests: number; must_say: number; must_name_file: number };
}

export interface TestFile {
  filename: string;
  content: string;
  mapping?: Record<string, ColumnUse>;
}

/** Open this replay. */
export interface ReplayDetail {
  id: string;
  name: string;
  version: number | null;
  status: ResultStatus;
  at: string | null;
  duration_s: number | null;
  cost_usd: number;
  gets: TestGets | null;
  answer: string | null;
  files: string[];
  checks: CheckResult[];
  error: string | null;
}

export interface JudgeRow {
  answer: string;
  you: boolean;
  /** null: the month's AI checks ran out mid-way. */
  ai: boolean | null;
  reason: string | null;
}

export interface JudgeResult {
  rows: JudgeRow[];
  agree: number;
  total: number;
  trusted: boolean;
  ai: AiChecks | null;
}

const base = (teamId: string, nodeId: string) =>
  `/api/teams/${encodeURIComponent(teamId)}/nodes/${encodeURIComponent(nodeId)}/tests`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const run = (v: unknown): TestRun | null =>
  isObj(v) ? { ...(v as unknown as TestRun), results: list<TestResult>(v.results) } : null;
const gets = (v: unknown): TestGets => {
  const g = isObj(v) ? v : {};
  return {
    task: typeof g.task === "string" ? g.task : "",
    documents: list(g.documents),
    change: list(g.change),
    test_output: typeof g.test_output === "string" ? g.test_output : null,
    feedback: g.feedback === true,
    change_by: typeof g.change_by === "string" && g.change_by.trim() ? g.change_by : null,
  };
};
/** An AI check's saved agreement; its labels default to none. */
const check = (c: TestCheck): TestCheck =>
  isObj(c.judge) ? { ...c, judge: { ...c.judge, labels: list<JudgeRow>(c.judge.labels) } } : c;
const test = (v: unknown): AgentTest => {
  const t = v as AgentTest;
  return { ...t, checks: list<TestCheck>(t.checks).map(check), gets: gets(t.gets) };
};

/** The Tests tab: the agent's tests, its newest test run, `last`, the estimate and AI checks. */
export async function listTests(teamId: string, nodeId: string): Promise<AgentTests> {
  const body = await apiRequest<unknown>("GET", base(teamId, nodeId));
  const b = isObj(body) ? body : {};
  return {
    tests: list(b.tests).filter(isObj).map(test),
    run: run(b.run),
    last: typeof b.last === "string" ? b.last : null,
    estimate: isObj(b.estimate) ? (b.estimate as unknown as TestEstimate) : null,
    ai: isObj(b.ai) ? (b.ai as unknown as AiChecks) : null,
  };
}

/** The New dialog's round; 409 with the reason when it can't be a test. */
export async function getFromRound(
  teamId: string,
  nodeId: string,
  invocationId: number,
): Promise<FromRound> {
  const r = await apiRequest<FromRound>(
    "GET",
    `${base(teamId, nodeId)}/from-round?invocation_id=${invocationId}`,
  );
  return { ...r, gets: gets(r.gets), checks: list(r.checks) };
}

/** Save test (422 with the server's words: "Add at least one check"). */
export async function createTest(
  teamId: string,
  nodeId: string,
  body: { invocation_id: number; name: string; checks: TestCheck[] },
): Promise<AgentTest> {
  const r = await apiRequest<{ test: unknown }>("POST", base(teamId, nodeId), body);
  return test(r.test);
}

export function deleteTest(teamId: string, nodeId: string, testId: string): Promise<null> {
  return apiRequest("DELETE", `${base(teamId, nodeId)}/${encodeURIComponent(testId)}`);
}

/** Add tests from a file, dry run: the columns, their use and how many tests are ready. */
export async function checkTestFile(
  teamId: string,
  nodeId: string,
  file: TestFile,
): Promise<FileCheck> {
  const r = await apiRequest<FileCheck>("POST", `${base(teamId, nodeId)}/file/check`, file);
  return { ...r, columns: list(r.columns) };
}

export function importTestFile(
  teamId: string,
  nodeId: string,
  file: TestFile & { mapping: Record<string, ColumnUse> },
): Promise<{ added: number }> {
  return apiRequest("POST", `${base(teamId, nodeId)}/file`, file);
}

/** Run all N (409 "The tests are already running", 422 "Add a test first"). */
export async function runTests(teamId: string, nodeId: string): Promise<TestRun | null> {
  const r = await apiRequest<{ run: unknown }>("POST", `${base(teamId, nodeId)}/run`);
  return run(r?.run);
}

/** Stop: the run, `stopped`, its unfinished results `stopped`. */
export async function stopTests(teamId: string, nodeId: string): Promise<TestRun | null> {
  const r = await apiRequest<{ run: unknown }>("POST", `${base(teamId, nodeId)}/stop`);
  return run(r?.run);
}

export async function getReplay(
  teamId: string,
  nodeId: string,
  resultId: string,
): Promise<ReplayDetail> {
  const r = await apiRequest<ReplayDetail>(
    "GET",
    `${base(teamId, nodeId)}/results/${encodeURIComponent(resultId)}`,
  );
  return {
    ...r,
    gets: isObj(r.gets) ? gets(r.gets) : null,
    files: list(r.files),
    checks: list(r.checks),
  };
}

/** Up to 20 distinct answers this agent gave, newest first. */
export async function listAnswers(
  teamId: string,
  nodeId: string,
  testId: string,
): Promise<{ text: string; from: string }[]> {
  const r = await apiRequest<unknown>(
    "GET",
    `${base(teamId, nodeId)}/${encodeURIComponent(testId)}/answers`,
  );
  return list(isObj(r) ? r.answers : null);
}

/** Check the AI check: runs it on each answer not judged before and saves the labels. */
export async function judgeCheck(
  teamId: string,
  nodeId: string,
  testId: string,
  body: { check: number; labels: { answer: string; you: boolean }[] },
): Promise<JudgeResult> {
  const r = await apiRequest<JudgeResult>(
    "POST",
    `${base(teamId, nodeId)}/${encodeURIComponent(testId)}/judge`,
    body,
  );
  return { ...r, rows: list(r.rows) };
}

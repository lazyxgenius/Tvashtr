/**
 * Test data mirroring the M7 boards (Test-List / -Running / -Results / -New / -Upload): the
 * Reviewer's six tests, its runs in each state, a round to make a test from and a file's dry run.
 */
import type {
  AgentTest,
  AgentTests,
  FileCheck,
  FromRound,
  TestResult,
  TestRun,
} from "../../lib/api/agentTests";

const GETS = {
  task: "Add an RSI indicator",
  documents: [{ name: "Spec", version_no: 2, pages: 1, is_shared_spec: true }],
  change: [
    { path: "core/indicators.py", added: 48, removed: 3 },
    { path: "tests/test_indicators.py", added: 31, removed: 0 },
  ],
  test_output: "3 failed, 38 passed",
  feedback: false,
};

const test = (
  id: string,
  name: string,
  meta: string,
  over: Partial<AgentTest> = {},
): AgentTest => ({
  id,
  name,
  meta,
  source: { kind: "round", run_id: "r12", run_number: 12, iteration: 1 },
  checks: [{ kind: "must_say", value: "Changes requested", from_round: true }],
  gets: GETS,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

export const TESTS: AgentTest[] = [
  test("t1", "Catches an unregistered indicator", "From run #12 · round 1 · 3 checks"),
  test("t2", "Approves a clean RSI change", "From run #12 · round 3 · 2 checks"),
  test("t3", "Says why the tests fail", "From run #11 · round 2 · 2 checks + AI check"),
  test("t4", "Flags a missing test file", "From a file · row 4 · 2 checks"),
  test("t5", "Doesn’t approve when tests fail", "From run #10 · round 1 · 1 check"),
  test("t6", "Names the file to fix", "From a file · row 7 · 1 check + AI check", {
    source: { kind: "file", row: 7 },
    checks: [
      { kind: "must_say", value: "Changes requested" },
      { kind: "ai", value: "names the file and line for each problem", judge: null },
    ],
  }),
];

const result = (t: AgentTest, status: TestResult["status"], over: Partial<TestResult> = {}) => ({
  id: `res-${t.id}`,
  test_id: t.id,
  name: t.name,
  status,
  answer: status === "passed" ? "Changes requested: register rsi on INDICATORS." : null,
  files: [],
  checks: [],
  error: null,
  cost_usd: 0.06,
  ...over,
});

export const FAILED_RESULT: TestResult = result(TESTS[5], "failed", {
  answer: "Changes requested: the new function isn’t registered, so the builder can’t list it.",
  checks: [
    { kind: "must_say", value: "Changes requested", met: true, reason: null },
    {
      kind: "ai",
      value: "names the file and line for each problem",
      met: false,
      reason: "No file or line named. Something like core/indicators.py:118 was expected.",
    },
  ],
});

const runBase: TestRun = {
  id: "run7",
  status: "done",
  version: 7,
  trigger: "manual",
  total: 6,
  done: 6,
  passed: 5,
  failed: 1,
  cost_usd: 0.38,
  started_at: new Date(Date.now() - 120_000).toISOString(),
  ended_at: new Date(Date.now() - 10_000).toISOString(),
  elapsed_s: 110,
  waiting_for_slot: false,
  error: null,
  since: { version: 6, delta: 1 },
  results: [...TESTS.slice(0, 5).map((t) => result(t, "passed")), FAILED_RESULT],
};

/** Test-Results: 5 of 6 passed, +1 since v6. */
export const DONE_RUN: TestRun = runBase;

/** Test-Running: running 3 of 6, $0.14 so far. */
export const RUNNING_RUN: TestRun = {
  ...runBase,
  status: "running",
  done: 2,
  passed: 2,
  failed: 0,
  cost_usd: 0.14,
  ended_at: null,
  elapsed_s: 100,
  since: null,
  results: TESTS.map((t, i) => result(t, i < 2 ? "passed" : i === 2 ? "running" : "waiting")),
};

/** Test-Queued: the owner's runs use every slot. */
export const QUEUED_RUN: TestRun = {
  ...RUNNING_RUN,
  done: 0,
  passed: 0,
  cost_usd: 0,
  elapsed_s: 4,
  waiting_for_slot: true,
  results: TESTS.map((t) => result(t, "waiting")),
};

/** Test-Stopped: 2 of 6 ran. */
export const STOPPED_RUN: TestRun = {
  ...RUNNING_RUN,
  status: "stopped",
  ended_at: new Date().toISOString(),
  results: TESTS.map((t, i) => result(t, i < 2 ? "passed" : "stopped")),
};

/** Test-Worse: 4 of 6, −1 since v6, a replay that ran out of time. */
export const WORSE_RUN: TestRun = {
  ...runBase,
  passed: 4,
  failed: 2,
  since: { version: 6, delta: -1 },
  results: [
    result(TESTS[0], "failed", {
      error: "It took more than 10 minutes, so it was stopped.",
      checks: [],
    }),
    ...TESTS.slice(1, 5).map((t) => result(t, "passed")),
    FAILED_RESULT,
  ],
};

export const tests = (run: TestRun | null, over: Partial<AgentTests> = {}): AgentTests => ({
  tests: TESTS,
  run,
  last: run ? "Last run on v7 · 2h ago · 5 passed, 1 failed" : null,
  estimate: { cost_usd: 0.4, minutes: 4 },
  ai: { available: true, left: 186, limit: 200 },
  ...over,
});

export const FROM_ROUND: FromRound = {
  invocation_id: 812,
  run_id: "r12",
  run_number: 12,
  iteration: 1,
  role: "Reviewer",
  answered: "Changes requested",
  gets: GETS,
  checks: [{ kind: "must_say", value: "Changes requested", from_round: true }],
  estimate: { cost_usd: 0.07 },
  ai: { available: true, left: 186, limit: 200 },
};

export const FILE_CHECK: FileCheck = {
  filename: "reviewer-examples.csv",
  rows: 12,
  columns: [
    { name: "task", first: "Add an EMA indicator", use: "gets" },
    { name: "diff", first: "core/indicators.py +22 −0 …", use: "gets" },
    { name: "expected", first: "Changes requested", use: "must_say" },
    { name: "file", first: "core/indicators.py", use: "must_name_file" },
    { name: "notes", first: "from the March audit", use: "skip" },
  ],
  ready: { tests: 12, must_say: 12, must_name_file: 9 },
};

// M7 — agent tests (Quality › Test-Empty, -FromRun, -New, -List, -Running, -Results, -Upload, -Judge,
// -SaveNudge, -RoundMenuOff, -AddCheck, -NoAI, -Replay, -RowMenu, -UploadError, -Worse, -Stopped,
// -Queued, -Focus, -Chips, -SaveNudgeTwo; Set-Checked's History pill). Every board is drawn in
// Desktop (the 30px title strip), so each renders as a website and a Desktop render (versions.mjs's
// `pair`): the Desktop render is the comparison, the web render framed 30px down. `kept-m7-*` capture
// the kept-elements inventories of the screens M7 changes (the team canvas + the drawer's Setup and
// Runs tabs, the run view drawer's Runs tab, History), website and Desktop, before and after.
// The sample data is the boards' (docs/superpowers/plans/api/agent-tests.md's shapes): team
// "Indicator sprint team" v7, the Reviewer's six tests, run #12.
import { ago, now, TEAM_ID } from "./panel-fixtures.mjs";
import { boardNow, boardRoutes, RUN_ID, runPath } from "./runs-fixtures.mjs";
import { pair as runPair } from "./runs-live.mjs";
import { canvasReady, pair, teamRoutes } from "./versions.mjs";

const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
// The clock stands still, so "1m 40s", "2h ago" and "just now" read as drawn.
const STILL = `Date.now = () => ${now};`;
const BASE = `/api/teams/${TEAM_ID}/nodes/n-rev/tests`;
const DAY = 1440;

// ---- The Reviewer's six tests (Test-List) ----
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
  id,
  name,
  meta,
  checks = [{ kind: "must_say", value: "Changes requested" }],
) => ({
  id,
  name,
  meta,
  source: { kind: "round", run_id: RUN_ID, run_number: 12, iteration: 1 },
  checks,
  gets: GETS,
  created_at: ago(DAY),
});
const AI_FIX = "names the file and line for each problem";
const TESTS = [
  test(
    "t1",
    "Catches an unregistered indicator",
    "From run #12 · round 1 · 3 checks",
  ),
  test(
    "t2",
    "Approves a clean RSI change",
    "From run #12 · round 3 · 2 checks",
  ),
  test(
    "t3",
    "Says why the tests fail",
    "From run #11 · round 2 · 2 checks + AI check",
  ),
  test("t4", "Flags a missing test file", "From a file · row 4 · 2 checks"),
  test(
    "t5",
    "Doesn’t approve when tests fail",
    "From run #10 · round 1 · 1 check",
  ),
  test(
    "t6",
    "Names the file to fix",
    "From a file · row 7 · 1 check + AI check",
    [
      { kind: "must_say", value: "Changes requested" },
      { kind: "ai", value: AI_FIX, judge: null },
    ],
  ),
];
const result = (t, status, extra = {}) => ({
  id: `res-${t.id}`,
  test_id: t.id,
  name: t.name,
  status,
  answer: null,
  files: [],
  checks: [],
  error: null,
  cost_usd: 0.06,
  ...extra,
});
const FAILED_ANSWER =
  "Changes requested: the new function isn’t registered, so the builder can’t list it.";
const failed = (answer = FAILED_ANSWER) =>
  result(TESTS[5], "failed", {
    answer,
    checks: [
      { kind: "must_say", value: "Changes requested", met: true, reason: null },
      {
        kind: "ai",
        value: AI_FIX,
        met: false,
        reason:
          "No file or line named. Something like core/indicators.py:118 was expected.",
      },
    ],
  });
const RUN = {
  id: "tr-7",
  status: "done",
  version: 7,
  trigger: "manual",
  total: 6,
  done: 6,
  passed: 5,
  failed: 1,
  cost_usd: 0.38,
  started_at: ago(2),
  ended_at: ago(0),
  elapsed_s: 100,
  waiting_for_slot: false,
  error: null,
  since: { version: 6, delta: 1 },
  results: [...TESTS.slice(0, 5).map((t) => result(t, "passed")), failed()],
};
const RUNNING = {
  ...RUN,
  status: "running",
  done: 2,
  passed: 2,
  failed: 0,
  cost_usd: 0.14,
  ended_at: null,
  since: null,
  results: TESTS.map((t, i) =>
    result(t, i < 2 ? "passed" : i === 2 ? "running" : "waiting"),
  ),
};
const QUEUED = {
  ...RUNNING,
  done: 0,
  passed: 0,
  cost_usd: 0,
  waiting_for_slot: true,
  results: TESTS.map((t) => result(t, "waiting")),
};
const STOPPED = {
  ...RUNNING,
  status: "stopped",
  ended_at: ago(0),
  results: TESTS.map((t, i) => result(t, i < 2 ? "passed" : "stopped")),
};
const WORSE = {
  ...RUN,
  passed: 4,
  failed: 2,
  since: { version: 6, delta: -1 },
  results: [
    result(TESTS[0], "failed", {
      error: "It took more than 10 minutes, so it was stopped.",
    }),
    result(TESTS[1], "failed", {
      checks: [
        { kind: "must_not_say", value: "Approved", met: false, reason: null },
      ],
    }),
    // Opened on the board: its AI check couldn't run (skipped, not failed).
    result(TESTS[2], "passed", {
      answer: "Changes requested: rsi() exceeds 100.",
      checks: [
        {
          kind: "must_say",
          value: "Changes requested",
          met: true,
          reason: null,
        },
        {
          kind: "ai",
          value: "names the file and line",
          met: null,
          reason: "No AI checks left this month",
        },
      ],
    }),
    ...TESTS.slice(3).map((t) => result(t, "passed")),
  ],
};
const view = (run, extra = {}) => ({
  tests: TESTS,
  run,
  last: run ? "Last run on v7 · 2h ago · 5 passed, 1 failed" : null,
  estimate: { cost_usd: 0.4, minutes: 4 },
  ai: { available: true, left: 186, limit: 200 },
  ...extra,
});
const EMPTY = view(null, { tests: [], estimate: null });

// ---- The canvas chips (Test-Chips) ----
const CHIP = {
  none: null,
  count: { total: 6, passed: null, ran: null, running: null, stopped: false },
  passed: { total: 6, passed: 5, ran: 6, running: null, stopped: false },
  worse: { total: 6, passed: 4, ran: 6, running: null, stopped: false },
  stopped: { total: 6, passed: 2, ran: 6, running: null, stopped: true },
  testing: {
    total: 6,
    passed: 5,
    ran: 6,
    running: { done: 2, total: 6 },
    stopped: false,
  },
};

// ---- A round to make a test from (Test-New / -AddCheck / -NoAI) ----
const FROM_ROUND = {
  invocation_id: 812,
  run_id: RUN_ID,
  run_number: 12,
  iteration: 1,
  role: "Reviewer",
  answered: "Changes requested",
  gets: GETS,
  checks: [
    { kind: "must_say", value: "Changes requested", from_round: true },
    { kind: "must_name_file", value: "core/indicators.py" },
    { kind: "must_not_say", value: "Approved" },
    { kind: "ai", value: "Asks for RSI to be registered on INDICATORS" },
  ],
  estimate: { cost_usd: 0.07 },
  ai: { available: true, left: 186, limit: 200 },
};

// ---- A file (Test-Upload / -UploadError) ----
const FILE_CHECK = {
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

// ---- Check the AI check (Test-Judge): the board's seven answers and labels ----
const JUDGE = [
  [
    "Changes requested: register rsi on INDICATORS so the builder lists it.",
    true,
    true,
  ],
  ["Approved. Tests pass and RSI shows up in the list.", false, false],
  ["Changes requested: the bounds test fails (104.2 > 100).", false, false],
  [
    "The builder can’t list the new function. Add it to the registry.",
    true,
    true,
  ],
  ["Changes requested: the default length should be 14.", false, false],
  ["The list of indicators may be out of date.", true, false],
  ["Approved after the registry fix in round 2.", false, false],
  // Three more saved answers, behind "Label more".
  ["Changes requested: add RSI to the indicator list test.", true, true],
  ["Approved. The registry lists rsi and the tests pass.", false, false],
  ["Changes requested: INDICATORS is missing rsi.", true, true],
];
const JUDGE_TESTS = view(
  { ...RUN, results: [...RUN.results.slice(0, 5), failed(JUDGE[0][0])] },
  {
    tests: TESTS.map((t) =>
      t.id === "t6"
        ? {
            ...t,
            checks: [
              t.checks[0],
              {
                kind: "ai",
                value: "Asks for RSI to be registered on INDICATORS",
                judge: null,
              },
            ],
          }
        : t,
    ),
  },
);

// ---- Open this replay (Test-Replay) ----
const REPLAY = {
  id: "res-t6",
  name: "Names the file to fix",
  version: 7,
  status: "failed",
  at: ago(0),
  duration_s: 41,
  cost_usd: 0.07,
  gets: GETS,
  answer:
    "Changes requested: rsi() in core/indicators.py isn’t registered, so the builder can’t list it. Add it to INDICATORS and to the list test.",
  files: [],
  checks: [
    { kind: "must_say", value: "Changes requested", met: true, reason: null },
    {
      kind: "must_name_file",
      value: "core/indicators.py",
      met: true,
      reason: null,
    },
    {
      kind: "ai",
      value: AI_FIX,
      met: false,
      reason:
        "It names the file but no line. Something like core/indicators.py:118 was expected.",
    },
  ],
  error: null,
};

// ---- Save as v8 (Test-SaveNudge / -SaveNudgeTwo) and History (Set-Checked) ----
const NUDGE = {
  count: 6,
  agents: [{ node_id: "n-rev", name: "Reviewer", count: 6 }],
  sub: "You changed the Reviewer’s instructions. The Reviewer has 6 tests.",
  option: "Save and run the Reviewer’s 6 tests",
  estimate: { cost_usd: 0.4, minutes: 4 },
};
const NUDGE_TWO = {
  count: 9,
  agents: [
    { node_id: "n-rev", name: "Reviewer", count: 6 },
    { node_id: "n-eng", name: "Engineer", count: 3 },
  ],
  sub: "You changed the Reviewer and the Engineer. They have 9 tests.",
  option: "Save and run their 9 tests",
  estimate: { cost_usd: 0.6, minutes: 6 },
};
const ROW_TESTS = {
  7: { passed: 6, total: 6, running: false },
  6: { passed: 5, total: 6, running: false },
  5: { passed: 4, total: 6, running: false },
};

/** The team canvas (versions.mjs's boards' canvas) with the Reviewer's tests and its chip. */
function canvas(
  desktop,
  {
    tests = view(RUN),
    chip = CHIP.passed,
    chips = {},
    versions = {},
    extra = {},
  } = {},
) {
  const base = teamRoutes(desktop, versions.changes ?? 0);
  const graphKey = `GET /api/teams/${TEAM_ID}/graph`;
  const versionsKey = `GET /api/teams/${TEAM_ID}/versions`;
  const all = { "n-rev": chip, ...chips };
  return {
    ...base,
    [graphKey]: {
      ...base[graphKey],
      nodes: base[graphKey].nodes.map((n) =>
        n.id in all ? { ...n, tests: all[n.id] } : n,
      ),
    },
    [versionsKey]: {
      ...base[versionsKey],
      tests: versions.tests ?? null,
      versions: base[versionsKey].versions.map((v) => ({
        ...v,
        tests: ROW_TESTS[v.number] ?? null,
      })),
    },
    [`GET ${BASE}`]: tests.watch ? watching(...tests.watch) : { ...tests },
    [`GET ${BASE}/from-round`]: FROM_ROUND,
    [`POST ${BASE}/file/check`]: FILE_CHECK,
    [`GET ${BASE}/:id/answers`]: {
      answers: JUDGE.map(([text], i) => ({
        text,
        from: `Run #12 · round ${i + 1}`,
      })),
    },
    [`POST ${BASE}/:id/judge`]: (req) => {
      const body = req.postDataJSON();
      const ai = new Map(JUDGE.map(([text, , a]) => [text, a]));
      return {
        json: {
          rows: body.labels.map((l) => ({
            ...l,
            ai: ai.get(l.answer) ?? l.you,
            reason: "",
          })),
          agree: 9,
          total: 10,
          trusted: true,
          ai: { available: true, left: 176, limit: 200 },
        },
      };
    },
    [`GET ${BASE}/results/:id`]: REPLAY,
    [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: { runs: [], run: null },
    ...extra,
  };
}
/** A tests view that reads `first` once, then `then` (a run this tab watches end). */
// A run this tab watches end: `first` for the page's first 1.5 s (StrictMode reads twice on mount),
// `then` once the 2 s poll reads again. Each render (web, Desktop) gets its own clock.
const watch = (first, then) => ({ watch: [first, then] });
const watching = (first, then) => {
  let since = 0;
  return () => {
    since ||= Date.now();
    return { json: Date.now() - since < 1500 ? first : then };
  };
};
const drawer = (page) =>
  page.getByRole("complementary", { name: "Reviewer settings" });
const settle = async (page) => {
  await page.mouse.move(700, 880);
  await page.waitForTimeout(250);
};
const board = (
  name,
  { path = `/#/teams/${TEAM_ID}?node=n-rev&tab=tests`, then, ...opts } = {},
) =>
  pair(name, {
    path,
    routes: canvas(false, opts),
    desktopRoutes: canvas(true, opts),
    init: STILL,
    steps: async (page) => {
      await canvasReady(page);
      if (path.includes("node="))
        await drawer(page).or(page.getByRole("dialog")).first().waitFor();
      await page.waitForTimeout(250);
      await then?.(page);
    },
  });
const listed = async (page) => {
  await drawer(page).getByText("6 tests").waitFor();
  await settle(page);
};
const results =
  (text = "5 of 6 passed") =>
  async (page) => {
    await drawer(page).getByText(text).waitFor({ timeout: 6000 });
    await settle(page);
  };
const failedRow = (page) =>
  drawer(page)
    .getByRole("listitem")
    .filter({ hasText: "Names the file to fix" });
const newTest = async (page) => {
  const dialog = page.getByRole("dialog", { name: "New test from round 1" });
  await dialog.waitFor();
  await dialog
    .getByLabel("Test name")
    .fill("Catches an unregistered indicator");
  await page.evaluate(() => document.activeElement?.blur());
  return dialog;
};
const pickFile = async (page) => {
  await page
    .locator(".nd-foot [data-testid=test-file]")
    .setInputFiles({
      name: "reviewer-examples.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("task,expected\n"),
    });
};

// ---- The run view (Test-FromRun / -RoundMenuOff): run #12 done, the Reviewer's rounds ----
const answers = {
  1: "RSI isn’t registered on INDICATORS, so the builder can’t list it.",
  2: "Default length should be 14, not 20.",
  3: "RSI is registered, bounded 0–100 and tested.",
};
function runView(blocked) {
  const routes = boardRoutes("Live-Done");
  const key = `GET /api/runs/${RUN_ID}/graph`;
  routes[key] = {
    ...routes[key],
    nodes: routes[key].nodes.map((n) =>
      n.id === "n-rev"
        ? {
            ...n,
            invocations: n.invocations.map((inv) => ({
              ...inv,
              outcome_detail: answers[inv.iteration],
            })),
          }
        : n,
    ),
  };
  routes[`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`] = {
    runs: [],
    run: {
      run_id: RUN_ID,
      rounds: [3, 2, 1].map((i) => ({
        invocation_id: i,
        iteration: i,
        test_blocked:
          blocked && i === 1
            ? "Can’t make a test from this round (it ran before checkpoints)"
            : null,
      })),
    },
  };
  return routes;
}
const roundMenu = (blocked) => ({
  path: runPath("n-rev"),
  now: boardNow("Live-Done"),
  routes: runView(blocked),
  steps: async (page) => {
    const d = page.getByRole("complementary", { name: "Reviewer in this run" });
    await d.waitFor();
    await d.getByRole("button", { name: "More for round 1" }).click();
    const item = page.getByRole("menuitem", { name: /Make this a test/ });
    if (blocked) await page.getByText("(it ran before checkpoints)").waitFor();
    else await item.hover();
    await page.waitForTimeout(250);
  },
});

// ---- Kept-elements inventories (before and after M7) ----
const kept = (name, path, routes, steps) => [
  {
    name: `${name}-web`,
    path,
    routes: routes(false),
    init: STILL,
    steps,
    settle: 600,
  },
  {
    name: `${name}-desktop`,
    path,
    routes: routes(true),
    desktop: true,
    init: `${SEEN}${STILL}`,
    steps,
    settle: 600,
  },
];
const KEPT_ROUNDS = {
  runs: [
    {
      run_id: RUN_ID,
      idea: "Add an RSI indicator",
      rounds_count: 3,
      last_round_at: ago(31),
    },
  ],
  run: {
    run_id: RUN_ID,
    idea: "Add an RSI indicator",
    status: "completed",
    created_at: ago(60),
    live: false,
    rounds: [3, 2, 1].map((i) => ({
      invocation_id: i,
      iteration: i,
      status: "done",
      outcome: i === 3 ? "approved" : "changes_requested",
      outcome_detail: answers[i],
      started_at: ago(40 - i),
      ended_at: ago(38 - i),
      cost: {
        prompt_tokens: 11000,
        completion_tokens: 200,
        total_tokens: 11200,
        cost_usd: 0.04,
      },
      test_blocked: null,
    })),
  },
};

export default [
  ...kept(
    "kept-m7-teamcanvas",
    `/#/teams/${TEAM_ID}?node=n-rev`,
    (d) => canvas(d),
    async (p) => {
      await canvasReady(p);
      await drawer(p).waitFor();
    },
  ),
  ...kept(
    "kept-m7-drawer-runs",
    `/#/teams/${TEAM_ID}?node=n-rev&tab=runs`,
    (d) =>
      canvas(d, {
        extra: { [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: KEPT_ROUNDS },
      }),
    async (p) => {
      await canvasReady(p);
      await drawer(p).getByRole("region", { name: "Last run" }).waitFor();
    },
  ),
  ...kept(
    "kept-m7-runview-runs",
    runPath("n-rev"),
    () => runView(false),
    async (p) => {
      await p
        .getByRole("complementary", { name: "Reviewer in this run" })
        .waitFor();
      await p.waitForTimeout(300);
    },
  ),
  ...kept(
    "kept-m7-history",
    `/#/teams/${TEAM_ID}`,
    (d) => canvas(d),
    async (p) => {
      await canvasReady(p);
      await p.getByRole("button", { name: "Version history" }).click();
      await p.getByRole("complementary", { name: "History" }).waitFor();
    },
  ),

  ...board("Test-Empty", {
    tests: EMPTY,
    chip: CHIP.none,
    then: (p) => drawer(p).getByText("No tests yet").waitFor(),
  }),
  ...runPair("Test-FromRun", roundMenu(false)),
  ...board("Test-New", {
    path: `/#/teams/${TEAM_ID}?node=n-rev&tab=tests&test_from=812`,
    tests: EMPTY,
    chip: CHIP.none,
    then: newTest,
  }),
  ...board("Test-List", { then: listed }),
  ...board("Test-Running", {
    tests: view(RUNNING),
    chip: CHIP.testing,
    then: (p) => drawer(p).getByText("Running 3 of 6").waitFor(),
  }),
  ...board("Test-Results", {
    tests: watch(view(RUNNING), view(RUN)),
    then: results(),
  }),
  ...board("Test-Upload", {
    then: async (p) => {
      await listed(p);
      await pickFile(p);
      await p
        .getByRole("dialog", { name: "Add tests from a file" })
        .getByText("12 tests are ready")
        .waitFor();
    },
  }),
  ...board("Test-Judge", {
    tests: watch(view(RUNNING), JUDGE_TESTS),
    then: async (p) => {
      await results()(p);
      await failedRow(p)
        .getByRole("button", { name: "The AI check is wrong" })
        .click();
      const dialog = p.getByRole("dialog", { name: "Check the AI check" });
      await dialog.getByRole("list", { name: "Saved answers" }).waitFor();
      for (const [i, [, you]] of JUDGE.slice(0, 7).entries())
        await dialog
          .getByRole("group", { name: `You: answer ${i + 1}` })
          .getByRole("button", { name: you ? "Yes" : "No" })
          .click();
      await dialog.getByText("Agrees with you on 9 of 10").waitFor();
      await settle(p);
    },
  }),
  ...board("Test-SaveNudge", {
    versions: { changes: 1, tests: NUDGE },
    then: async (p) => {
      await listed(p);
      await p.getByRole("button", { name: "Save as v8" }).click();
      const dialog = p.getByRole("dialog", { name: "Save as v8" });
      await dialog
        .getByLabel("What changed (optional)")
        .fill("Reviewer names the file and line");
      await p.evaluate(() => document.activeElement?.blur());
      await settle(p);
    },
  }),
  ...runPair("Test-RoundMenuOff", roundMenu(true)),
  ...board("Test-AddCheck", {
    path: `/#/teams/${TEAM_ID}?node=n-rev&tab=tests&test_from=812`,
    tests: EMPTY,
    chip: CHIP.none,
    then: async (p) => {
      const dialog = await newTest(p);
      await dialog.getByRole("button", { name: "Add a check" }).click();
      await p.getByRole("menuitem", { name: /^Must not say/ }).click();
      await dialog.getByRole("button", { name: "Add a check" }).click();
      await p.getByRole("menu", { name: "Add a check" }).waitFor();
      await p.waitForTimeout(250);
    },
  }),
  ...board("Test-NoAI", {
    path: `/#/teams/${TEAM_ID}?node=n-rev&tab=tests&test_from=812`,
    tests: EMPTY,
    chip: CHIP.none,
    extra: {
      [`GET ${BASE}/from-round`]: {
        ...FROM_ROUND,
        ai: { available: false, left: 200, limit: 200 },
      },
    },
    then: newTest,
  }),
  ...board("Test-Replay", {
    tests: watch(view(RUNNING), view(RUN)),
    then: async (p) => {
      await results()(p);
      await failedRow(p)
        .getByRole("button", { name: "Open this replay" })
        .click();
      await drawer(p)
        .getByRole("region", { name: "Replay · Names the file to fix" })
        .getByText("Not met")
        .waitFor();
      await settle(p);
    },
  }),
  ...board("Test-RowMenu", {
    then: async (p) => {
      await listed(p);
      await drawer(p)
        .getByRole("button", { name: "More for Flags a missing test file" })
        .click();
      await p.getByRole("menuitem", { name: "Delete test" }).waitFor();
      await p.waitForTimeout(250);
    },
  }),
  ...board("Test-RowMenu", {
    then: async (p) => {
      await listed(p);
      await drawer(p)
        .getByRole("button", { name: "More for Flags a missing test file" })
        .click();
      await p.getByRole("menuitem", { name: "Delete test" }).click();
      await drawer(p)
        .getByRole("alertdialog", { name: "Delete test" })
        .waitFor();
      await settle(p);
    },
  }).map((s) => ({
    ...s,
    name: s.name.replace("Test-RowMenu", "Test-RowMenu-confirm"),
  })),
  ...board("Test-UploadError", {
    extra: {
      [`POST ${BASE}/file/check`]: () => ({
        status: 422,
        json: { detail: "This file can’t be read: line 3 isn’t valid JSON." },
      }),
    },
    then: async (p) => {
      await listed(p);
      await p
        .locator(".nd-foot [data-testid=test-file]")
        .setInputFiles({
          name: "reviewer-examples.jsonl",
          mimeType: "application/jsonl",
          buffer: Buffer.from("{}\n"),
        });
      await p
        .getByRole("dialog", { name: "Add tests from a file" })
        .getByText("This file can’t be read")
        .waitFor();
      await settle(p);
    },
  }),
  ...board("Test-Worse", {
    tests: watch(view(RUNNING), view(WORSE)),
    chip: CHIP.worse,
    then: async (p) => {
      await results("4 of 6 passed")(p);
      await drawer(p)
        .getByRole("button", { name: /^Says why the tests fail/ })
        .click();
      await settle(p);
    },
  }),
  ...board("Test-Stopped", {
    tests: watch(view(RUNNING), view(STOPPED)),
    chip: CHIP.stopped,
    then: results("Stopped · 2 of 6 ran"),
  }),
  ...board("Test-Queued", {
    tests: view(QUEUED),
    chip: CHIP.testing,
    then: (p) => drawer(p).getByText("Waiting to start").waitFor(),
  }),
  ...pair("Test-Focus", {
    path: `/#/teams/${TEAM_ID}?node=n-rev&tab=tests&focus=1`,
    routes: canvas(false),
    desktopRoutes: canvas(true),
    init: STILL,
    steps: async (p) => {
      await p
        .getByRole("dialog", { name: "Reviewer in focus view" })
        .getByText("6 tests")
        .waitFor();
      await settle(p);
    },
  }),
  ...board("Test-Chips", {
    path: `/#/teams/${TEAM_ID}`,
    chips: { "n-pm": CHIP.count, "n-eng": CHIP.testing },
    then: settle,
  }),
  ...board("Test-SaveNudgeTwo", {
    versions: { changes: 2, tests: NUDGE_TWO },
    then: async (p) => {
      await listed(p);
      await p.getByRole("button", { name: "Save as v8" }).click();
      const dialog = p.getByRole("dialog", { name: "Save as v8" });
      await dialog
        .getByLabel("What changed (optional)")
        .fill("Reviewer names the file and line");
      await dialog.getByText("Just save").click();
      await p.evaluate(() => document.activeElement?.blur());
      await settle(p);
    },
  }),
  ...board("Set-Checked", {
    path: `/#/teams/${TEAM_ID}`,
    then: async (p) => {
      await p.getByRole("button", { name: "Version history" }).click();
      await p
        .getByRole("complementary", { name: "History" })
        .getByText("Tests 6 of 6")
        .waitFor();
      await settle(p);
    },
  }),
];

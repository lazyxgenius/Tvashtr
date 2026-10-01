// M2 — the run view (Runs › Live-*, Prob-Stalled / -Failed / -NotifyAsk). `kept-*` scenarios capture
// the kept-elements inventory of the existing run view (brief §2.2) — website and Desktop. The board
// scenarios render each board as a website and a Desktop render (`pair`): a board drawn in Desktop
// (title strip "Tvashtr — the living canvas") is compared against its Desktop render, and its web
// render is framed 30px down; Live-Website and Live-Home are website boards, so their Desktop renders
// are framed 30px up (scenarios/panel-shell.mjs's convention).
import { homeRoutes, scrollMain } from "./home-fixtures.mjs";
import { boardNow, boardRoutes, clockAt, frozenAt, runPath, runRoutes } from "./runs-fixtures.mjs";

const seenDisclosure = () => sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");
const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';

const underTitleStrip = (page) =>
  page.addStyleTag({ content: "body { padding-top: 30px; box-sizing: border-box; }" });
const aboveTitleStrip = (page) =>
  page.addStyleTag({ content: "html { height: calc(100% + 30px); margin-top: -30px; }" });

/** Wait for the run view's Activity panel (the first poll has landed). */
const activityReady = async (page) => {
  await page.getByRole("region", { name: "Activity" }).waitFor();
  await page.waitForTimeout(300);
};
/** Open the one test run's output, as the boards draw it ("Hide output"). */
const showOutput = async (page) => {
  await activityReady(page);
  await page.getByRole("button", { name: "Show output" }).first().click();
};

/**
 * A board as a website render and a Desktop render. `desktopBoard` = the board is drawn in Desktop
 * (the comparison is the Desktop render; the web render is framed under the title strip).
 */
function pair(board, { desktopBoard = true, path = runPath(), routes, steps, init = "", now }) {
  now ??= boardNow(board);
  const frame = (f) => async (p) => {
    await f(p);
    await steps?.(p);
  };
  return [
    {
      name: `${board}-web`,
      path,
      routes,
      init: frozenAt(now, init),
      steps: desktopBoard ? frame(underTitleStrip) : steps,
      settle: 600,
    },
    {
      name: `${board}-desktop`,
      path,
      routes,
      desktop: true,
      init: frozenAt(now, `${SEEN}${init}`),
      steps: desktopBoard ? steps : frame(aboveTitleStrip),
      settle: 600,
    },
  ];
}

// ---- Live-Home: Home's Running now cards with their live line, and Needs you's "Run stalled" ----
const HOME_NOW = "10:42:20";
const at = (s) => new Date(Date.parse(clockAt(HOME_NOW)) - s * 1000).toISOString();
const chip = (id, label, role_name, kind, state, loops_with = null) => ({
  node_id: id,
  origin_node_id: null,
  role_name,
  label,
  kind,
  state,
  loops_with,
});
const homeRun = (id, teamId, teamName, idea, status, ageS, extra) => ({
  run_id: id,
  idea,
  status,
  created_at: at(ageS),
  repo_path: null,
  status_group: status === "awaiting_human" ? "needs_you" : "running",
  updated_at: at(4),
  github_repo: "lazyxgenius/trade_mcp",
  base_ref: "main",
  subpath: null,
  target: { kind: "github", label: "lazyxgenius/trade_mcp", base_ref: "main", subpath: null },
  pr_url: null,
  pr_number: null,
  ship_branch: null,
  budget_cap_usd: 5,
  desktop_target: false,
  library_team_id: teamId,
  retry_of_run_id: null,
  team: { id: teamId, name: teamName },
  spent_usd: 0.4,
  awaiting: null,
  failure: null,
  ...extra,
});
const live = (label, live_state, activity, lastS, startedS = lastS) => ({
  label,
  live_state,
  activity,
  last_event_at: at(lastS),
  activity_started_at: at(startedS),
});
const HOME_RUNS = [
  homeRun("r-12", "t-ind", "Indicator sprint team", "Add an RSI indicator", "awaiting_human", 64, {
    spent_usd: 0.06,
    live_state: "needs_you",
    live: live("Approval gate", "needs_you", "Waiting for you to approve the spec", 14),
    awaiting: {
      task_id: 12,
      kind: "prd_approval",
      title: "Approve the spec",
      gate_node_id: "n-prd",
      gate_role: "Approval gate",
      next_role: "Engineer",
      since: at(14),
    },
    progress: [
      chip("n-pm", "Product manager", "pm", "completion", "done"),
      chip("n-prd", "Approval gate", "prd_approval", "gate", "waiting"),
      chip("n-eng", "Engineer", "engineer", "agent", "idle"),
      chip("n-rev", "Reviewer", "reviewer", "agent", "idle", "n-eng"),
      chip("n-ship", "Ship", "ship", "terminal", "idle"),
    ],
  }),
  homeRun("r-docs", "t-docs", "Docs team", "Write the API guide", "running", 400, {
    live_state: "working",
    live: live("Writer", "working", "Editing docs/api.md", 4),
    progress: [
      chip("d-pm", "Product manager", "pm", "completion", "done"),
      chip("d-gate", "Approval gate", "prd_approval", "gate", "done"),
      chip("d-w", "Writer", "writer", "agent", "active"),
      chip("d-ship", "Ship", "ship", "terminal", "idle"),
    ],
  }),
  homeRun("r-stall", "t-bug", "Bugfix squad", "Fix the flaky login test", "running", 1082, {
    live_state: "stalled",
    live: live("Engineer", "stalled", "Asked the model for the next step", 310),
    progress: [
      chip("b-pm", "Product manager", "pm", "completion", "done"),
      chip("b-gate", "Approval gate", "prd_approval", "gate", "done"),
      chip("b-eng", "Engineer", "engineer", "agent", "active"),
      chip("b-rev", "Reviewer", "reviewer", "agent", "idle", "b-eng"),
      chip("b-ship", "Ship", "ship", "terminal", "idle"),
    ],
  }),
  homeRun("r-res", "t-res", "Research pod", "Compare three charting libraries", "running", 552, {
    live_state: "quiet",
    live: live("Reviewer", "quiet", "Asked the model for the next step", 100),
    progress: [
      chip("q-pm", "Product manager", "pm", "completion", "done"),
      chip("q-gate", "Approval gate", "prd_approval", "gate", "done"),
      chip("q-eng", "Engineer", "engineer", "agent", "done"),
      chip("q-rev", "Reviewer", "reviewer", "agent", "active", "q-eng"),
      chip("q-ship", "Ship", "ship", "terminal", "idle"),
    ],
  }),
];
const HOME_INBOX = [
  {
    key: "gate:12",
    kind: "approval",
    since: at(14),
    team: { id: "t-ind", name: "Indicator sprint team" },
    run: {
      id: "r-12",
      idea: "Add an RSI indicator",
      status: "awaiting_human",
      spent_usd: 0.06,
      budget_cap_usd: 5,
    },
    task: {
      id: 12,
      kind: "prd_approval",
      title: "Approve the spec",
      blocking: true,
      gate_node_id: "n-prd",
      gate_role: "Approval gate",
      next_role: "Engineer",
    },
    document_id: "d-spec",
  },
  {
    key: "run_stalled:r-stall",
    kind: "run_stalled",
    since: at(310),
    team: { id: "t-bug", name: "Bugfix squad" },
    run: {
      id: "r-stall",
      idea: "Fix the flaky login test",
      status: "running",
      created_at: at(1082),
      target: null,
      library_team_id: "t-bug",
    },
    node: { id: "n-eng", label: "Engineer", iteration: 1 },
    live: {
      live_state: "stalled",
      last_event_at: at(310),
      activity: "Asked the model for the next step",
      activity_started_at: at(310),
      retry: null,
      backup_model: null,
    },
  },
];
const HOME_ROUTES = homeRoutes({
  "GET /api/inbox": { count: HOME_INBOX.length, items: HOME_INBOX },
  "GET /api/runs": { runs: HOME_RUNS, next_cursor: null },
});
// The board reads "Good morning" (the Home scenarios' 9am).
const MORNING = `Date.prototype.getHours = function getHours() { return 9; };
  try { localStorage.setItem("tvashtr.home.lastTeam", "t-ind"); } catch { /* ignore */ }`;

export default [
  { name: "kept-runview-web", path: runPath(), routes: runRoutes("working"), settle: 900 },
  {
    name: "kept-runview-desktop",
    path: runPath(),
    routes: runRoutes("working"),
    desktop: true,
    init: seenDisclosure,
    settle: 900,
  },
  {
    name: "kept-runview-drawer-web",
    path: runPath("n-eng"),
    routes: runRoutes("working"),
    settle: 900,
  },
  ...pair("Live-Working", { routes: boardRoutes("Live-Working"), steps: showOutput }),
  ...pair("Live-NeedsYou", { routes: boardRoutes("Live-NeedsYou"), steps: activityReady }),
  ...pair("Live-Command", { routes: boardRoutes("Live-Command"), steps: activityReady }),
  ...pair("Live-Retrying", { routes: boardRoutes("Live-Retrying"), steps: activityReady }),
  ...pair("Live-Quiet", { routes: boardRoutes("Live-Quiet"), steps: activityReady }),
  ...pair("Live-Done", { routes: boardRoutes("Live-Done"), steps: activityReady }),
  ...pair("Live-Website", {
    desktopBoard: false,
    routes: boardRoutes("Live-Website"),
    steps: showOutput,
  }),
  ...pair("Live-AgentSteps", {
    path: runPath("n-eng"),
    routes: boardRoutes("Live-AgentSteps"),
    steps: async (page) => {
      await activityReady(page);
      await page.getByRole("button", { name: "Hide activity" }).click();
    },
  }),
  ...pair("Prob-Stalled", { routes: boardRoutes("Prob-Stalled"), steps: activityReady }),
  ...pair("Prob-Failed", { routes: boardRoutes("Prob-Failed"), steps: activityReady }),
  // The account hasn't answered yet: the bell asks on its own, once (R10).
  ...pair("Prob-NotifyAsk", {
    routes: boardRoutes("Prob-NotifyAsk", { asked: false }),
    steps: async (page) => {
      // The click on "Show output" dismisses the dialog the bell opened on its own; the bell opens
      // it again.
      await showOutput(page);
      const ask = page.getByRole("dialog", { name: "Notifications" });
      if (!(await ask.isVisible()))
        await page.getByRole("button", { name: "Notifications" }).click();
      await ask.waitFor();
    },
  }),
  // Home is drawn as a website board; its moment is the Needs-you board's (the gate waits 14 s).
  ...pair("Live-Home", {
    desktopBoard: false,
    path: "/#/home",
    routes: HOME_ROUTES,
    init: MORNING,
    now: HOME_NOW,
    // The board draws Needs you and Running now without the composer above them: scroll the page
    // so they sit where the board puts them.
    steps: scrollMain(206),
  }),
];

/**
 * Scene 8.1's Home (sample mode, Desktop) and its website half: the film account some days in.
 * Copied from scripts/design-parity/scenarios/home-fixtures.mjs (runsRoute, homeRoutes),
 * runs-live.mjs (Running now's live line) and desk4.mjs (Home-DesktopSpend: the $5.00 budget),
 * rewritten to video/story.json. Everything else is the live base (live-base.json).
 *
 * Money: only API-key spend is dollars. Every step ran on the Claude or Grok subscription ($0.00 of
 * key money) except the hero run's Engineer after 3.5's switch to the DeepSeek backup (retrying.mjs:
 * $0.03). The TRIX run's Fixer never ran: a stalled step on the Desktop runner can't be interrupted,
 * so the stall sweep fails the run instead of taking the failure path (stall_sweep._can_interrupt).
 * Running now's budget meter says "on keys" on the Desktop (M-desk-4).
 *
 * Not here: the V1 proof run (F5). It ran on a team built without the domain step, which the next
 * buildFilmTeam renames "… (earlier)" (film.mjs retireTeams), so it isn't one of this team's runs.
 */
import { GRAPH, TEAM_ID, ago, live, liveRoutes, story } from "./base.mjs";
import { RUN_ID as HERO_RUN_ID } from "./retrying.mjs";

const TEAM = { id: TEAM_ID, name: story.team.name };
const REPO = story.repo.full_name;
const H = 3600;
const D = 24 * H;

// Run ids look like the server's (uuid4); ship branches are `tvashtr/<run id>` (worktree.py).
const R = {
  dema: "7c41e0b2-93d5-4f6a-b1e8-2a9d04c35f17",
  tema: "e2b86f19-0c4d-4a37-9e52-6f1d8a7b3c90",
  chandeB: "41f0a9c7-6b2e-4d18-8c95-d37e2b10f6a4",
  chandeA: "9d3c5e81-2f7a-4b06-a4d9-81c6e0f27b35",
  vortexB: "b58e2d40-7a19-4c63-9f0e-5c2a81d4e76b",
  vortexA: "2a7f6c93-d8e1-4b5a-8037-e4b9150c6d28",
  trixResumed: "c9e14b75-3d60-4f28-b7a1-0e85f2d93c46",
  trix: "5f2d8a06-e4b3-4c91-a6f7-93b0c1e2d548",
  hull: HERO_RUN_ID, // 3.5's hero run (retrying.mjs), so the sample scenes share one id
};
// Placeholders after the last real one (#50, 2026-10-03) and the F5 proof run's (#51 if it ships).
const PR = { hull: 52, trixResumed: 53 };
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

// ---- The progress strip, as run_views._progress builds it from the film team's graph ----

const G = GRAPH();
const ROLE = { pm: "PM", architect: "Architect", engineer: "Engineer", reviewer: "Reviewer", ship: "Ship", stop: "Stop", domain_query: "Domain" };
const GATE = { prd_approval: "Approval", ship_approval: "Ship approval", review_escalation: "Escalation", budget_approval: "Budget" };
/** run_failure.node_label: an agent's title, a gate's kind, a role's label. */
const label = (n) => {
  const c = n.config ?? {};
  if (n.kind === "gate") return GATE[c.gate_kind] ?? (c.gate_kind ? c.gate_kind.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase()) : "Approval");
  if (["completion", "agent"].includes(n.kind) && c.title?.trim()) return c.title.trim();
  return ROLE[n.role_name] ?? n.role_name;
};
const isLoop = (e) => e.conditions?.loop_limit !== undefined || e.conditions?.when === "changes_requested";
const fwd = G.edges.filter((e) => !["escalation", "failure"].includes(e.edge_type) && !isLoop(e));
// walk_order: what the root reaches on forward edges, no stop terminal, left to right (a line here).
const root = G.nodes.find((n) => !G.edges.some((e) => e.target_node_id === n.id));
const reached = new Set([root.id]);
for (const q = [root.id]; q.length; ) {
  const from = q.pop();
  for (const e of fwd)
    if (e.source_node_id === from && !reached.has(e.target_node_id)) {
      reached.add(e.target_node_id);
      q.push(e.target_node_id);
    }
}
const STRIP = G.nodes
  .filter((n) => reached.has(n.id) && n.config?.terminal_kind !== "stop")
  .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
const LOOPS = Object.fromEntries(G.edges.filter(isLoop).map((e) => [e.source_node_id, e.target_node_id]));

/** The strip with every step before `role` done, `role` in `state`, the rest idle. */
const progress = (role, state) => {
  const at = STRIP.findIndex((n) => n.role_name === role);
  return STRIP.map((n, i) => ({
    node_id: n.id,
    origin_node_id: null,
    role_name: n.role_name,
    label: label(n),
    kind: n.kind,
    state: i < at ? "done" : i === at ? state : "idle",
    loops_with: LOOPS[n.id] ?? null,
    carried: false,
  }));
};

// ---- The runs, newest first (GET /api/runs rows: run_views.list_owner_runs) ----

const GROUP = { running: "running", pending: "running", awaiting_human: "needs_you", completed: "completed", failed: "failed", cancelled: "stopped" };
const run = (id, idea, status, ageS, extra = {}) => ({
  run_id: id,
  idea,
  status,
  created_at: ago(ageS),
  repo_path: null,
  status_group: GROUP[status],
  updated_at: ago(status === "running" ? 9 : ageS - 25 * 60),
  github_repo: REPO,
  base_ref: story.repo.branch,
  subpath: story.repo.folder,
  target: { kind: "github", label: REPO, base_ref: story.repo.branch, subpath: story.repo.folder },
  pr_url: null,
  pr_number: null,
  ship_branch: `tvashtr/${id}`,
  budget_cap_usd: story.budget_usd,
  desktop_target: true,
  library_team_id: TEAM_ID,
  retry_of_run_id: null,
  team_version_number: 7,
  started_from: null,
  team: TEAM,
  spent_usd: 0,
  awaiting: null,
  failure: null,
  live_state: { running: "working", completed: "done", failed: "failed" }[status] ?? null,
  live: null,
  ...extra,
});
const shipped = (n) => ({ pr_url: prUrl(n), pr_number: n });
// A task-set compare (M9): both versions run each task, never ship, no folder (compare.py).
const lane = (id, idea, ageS, version) =>
  run(id, idea, "completed", ageS, {
    subpath: null,
    target: { kind: "github", label: REPO, base_ref: story.repo.branch, subpath: null },
    team_version_number: version,
  });
const [vortex, chande] = story.task_set.tasks;

// The next run, started from the hero run's PR branch (5.1), on the Desktop's subscriptions.
const dema = run(R.dema, story.runs.next, "running", 4 * 60 + 12, {
  base_ref: `tvashtr/${R.hull}`,
  target: { kind: "github", label: REPO, base_ref: `tvashtr/${R.hull}`, subpath: story.repo.folder },
  team_version_number: 8,
  live: { label: "Engineer", live_state: "working", activity: "Used Read", last_event_at: ago(4), activity_started_at: ago(4) },
  progress: progress("engineer", "active"),
});

export const RUNS = [
  dema,
  // A run on a local folder: the Desktop picked ~/code/trade_mcp; it ships to a branch, no PR.
  run(R.tema, "Add a TEMA indicator", "completed", 1 * H + 40 * 60, {
    github_repo: null,
    target: { kind: "desktop_folder", label: "~/code/trade_mcp", base_ref: story.repo.branch, subpath: story.repo.folder },
    team_version_number: 8,
  }),
  lane(R.chandeB, chande, 3 * H + 5 * 60, 8),
  lane(R.chandeA, chande, 3 * H + 5 * 60, 7),
  lane(R.vortexB, vortex, 3 * H + 31 * 60, 8),
  lane(R.vortexA, vortex, 3 * H + 31 * 60, 7),
  // 4.2: resumed from the failed run's last good step, then shipped.
  run(R.trixResumed, story.runs.stall, "completed", 1 * D + 2 * H, shipped(PR.trixResumed)),
  // 4.1: the Engineer went quiet, stalled, failed (the stall sweep's words at 4.1's shortened
  // timer, video/stack/up FAIL=180); no Fixer, no key spend (see the header).
  run(R.trix, story.runs.stall, "failed", 1 * D + 3 * H, {
    failure: {
      code: "stalled",
      message: "The Engineer stopped responding: no update for 3 minutes",
      node_id: null,
      origin_node_id: null,
      node_role: "Engineer",
      provider: null,
      target: "desktop",
    },
  }),
  // The hero run (ch. 3): its Engineer switched to the DeepSeek backup once (3.5), key spend.
  run(R.hull, story.runs.hero, "completed", 2 * D + 5 * H, { ...shipped(PR.hull), spent_usd: 0.03 }),
];
/** Key spend of the runs started since `start` (the server sums cost rows by time; close enough). */
const keySpend = (start = new Date(0)) =>
  Math.round(RUNS.filter((r) => new Date(r.created_at) >= start).reduce((s, r) => s + r.spent_usd, 0) * 100) / 100;
const KEY_SPEND = keySpend();

// The Engineer (Claude Code on the Desktop) keeps working: each Home poll (5 s while a run runs)
// sees a newer event, worded as live_state.activity_line words a Claude Code tool call or result.
const STEPS = ["Used Read", "Asked the model for the next step", "Used Edit", "Asked the model for the next step"];
let polls = 0;

/** GET /api/runs: `status=active` → Running now; `q` → ⌘K; a status filter; `limit` + `cursor`. */
function runsRoute(req) {
  const u = new URL(req.url());
  const status = u.searchParams.get("status") ?? "all";
  if (status === "active") {
    const at = ago(2 + (polls % 3));
    Object.assign(dema.live, { activity: STEPS[polls++ % STEPS.length], last_event_at: at, activity_started_at: at });
  }
  const q = (u.searchParams.get("q") ?? "").toLowerCase();
  let list =
    status === "active"
      ? RUNS.filter((r) => ["pending", "running", "awaiting_human"].includes(r.status))
      : status === "all"
        ? RUNS
        : RUNS.filter((r) => r.status_group === status);
  if (q) list = list.filter((r) => `${r.idea} ${r.team.name}`.toLowerCase().includes(q));
  const from = Number(u.searchParams.get("cursor") ?? 0);
  const limit = Number(u.searchParams.get("limit") ?? 50);
  const page = list.slice(from, from + limit);
  const withProgress = u.searchParams.get("include") === "progress";
  return {
    json: {
      runs: page.map(({ progress: p, ...r }) => (withProgress ? { ...r, progress: p ?? [] } : r)),
      next_cursor: from + limit < list.length ? String(from + limit) : null,
    },
  };
}

// ---- The team, Needs you, spend ----

const teams = live("GET /api/teams");
const team = teams.teams[0];
Object.assign(team, {
  created_at: ago(5 * D),
  last_active_at: dema.updated_at,
  last_run: { status: dema.status, at: dema.created_at, run_id: dema.run_id, idea: dema.idea, updated_at: dema.updated_at, pr_url: null },
  spend_usd: KEY_SPEND,
  run_count: RUNS.length,
  active_run_count: 1,
  awaiting_run_count: 0,
});

// The one item live Needs you holds for this account: no Anthropic / xAI key for the website.
const inbox = live("GET /api/inbox?surface=desktop");
for (const i of inbox.items) i.since = team.created_at;

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));

export default function homeRoutes() {
  const routes = liveRoutes();
  // The live capture's empty run pages and inbox answer by exact query; Home's own answers replace them.
  for (const k of Object.keys(routes)) if (/^GET \/api\/(runs|inbox)\?/.test(k)) delete routes[k];
  return {
    ...routes,
    "GET /api/teams": teams,
    "GET /api/inbox": inbox,
    "GET /api/runs": runsRoute,
    // The composer's repo picker: the GitHub App's repo (private on GitHub, default branch main).
    "GET /api/github/repos": {
      repos: [{ name: REPO.split("/")[1], full_name: REPO, private: true, default_branch: story.repo.branch, html_url: `https://github.com/${REPO}` }],
      installation_count: 1,
    },
    // Off camera (only the Options popover lists them). Real trade_mcp also has ~50 older dev
    // branches `tvashtr/<id>`; folders and counts are trade_mcp@main's (gh api git/trees).
    "GET /api/github/repos/:o/:r/branches": {
      default_branch: story.repo.branch,
      branches: [story.repo.branch, "feat/crypto-data-mcp", ...[R.hull, R.trixResumed].map((id) => `tvashtr/${id}`)],
      truncated: false,
    },
    "GET /api/github/repos/:o/:r/subpaths": {
      ref: story.repo.branch,
      subpaths: [["core", 9], ["docs", 6], ["scripts", 3], ["servers", 17], ["tests", 27], ["web", 186]].map(([path, file_count]) => ({ path, file_count })),
      truncated: false,
    },
    "GET /api/spend": {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      month: { label: today.toLocaleString("en", { month: "long" }), start: monthStart.toISOString(), total_usd: keySpend(monthStart) },
      week: { start: weekStart.toISOString(), total_usd: keySpend(weekStart) },
      // spend.py lists only teams that spent this month.
      by_team: keySpend(monthStart) ? [{ team_id: TEAM_ID, name: TEAM.name, total_usd: keySpend(monthStart) }] : [],
      other_usd: 0,
      default_run_budget_usd: story.budget_usd,
    },
  };
}

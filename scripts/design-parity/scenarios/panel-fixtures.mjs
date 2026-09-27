// Shared fixtures for the agent panel + canvas chrome parity scenarios (slice F5). Not a scenario
// file itself. The data mirrors the design's sample data: the "Indicator sprint team" canvas
// (Product manager → PRD approval → Engineer → Reviewer → Ship, with the Escalation gate and Stop),
// the Reviewer's 38-line instructions, 2 skills + 2 tool servers ("Skills & tools 4") and 3 notes
// ("Memory 3").
export const now = Date.now();
export const ago = (min) => new Date(now - min * 60_000).toISOString();

export const TEAM_ID = "t-ind";
export const TEAM_NAME = "Indicator sprint team";

export const REVIEWER_PROMPT = [
  "You are the Reviewer on a software team. The engineer's build is in your current working directory. Review it — do NOT improve it.",
  "",
  "Do these steps in order:",
  "1. Inspect the files in your current working directory (the engineer's build).",
  "2. Run the repository's tests.  PREFER pytest:",
  "     python -m pytest -q",
  "   If pytest is unavailable or collects no tests, fall back to EXACTLY this command…",
  "3. Write REVIEW_VERDICT.json containing EXACTLY this JSON and nothing else:",
  '     {"verdict": "approved" | "changes_requested", "reasons": "…"}',
  "",
  "STRICT RULES:",
  "- You are REVIEWING, not editing. Never change a file in the build.",
  "- Judge the build against the spec, not against your own taste.",
  "- A failing test is always changes_requested.",
  "- A missing feature from the spec is always changes_requested.",
  "- Style nits alone are never a reason to reject.",
  "",
  "What to check, in order:",
  "1. Every behaviour the spec asks for exists and is wired up.",
  "2. New functions are registered where the app lists them.",
  "3. The tests cover the new behaviour, not just the happy path.",
  "4. Nothing unrelated to the spec was changed.",
  "5. Errors are handled the way the rest of the code handles them.",
  "",
  "How to write the reasons:",
  "- One to three short, specific sentences.",
  "- Name the file and the function when you can.",
  "- Say what is missing, not how you would write it.",
  "",
  "Examples:",
  '- "The tests ran, but the new function is not registered on INDICATORS."',
  '- "RSI is computed on closing prices, but the spec asks for typical price."',
  "",
  "When you are unsure, prefer changes_requested with a clear reason.",
  "Never approve a build whose tests you could not run.",
  "",
  "When you finish, write the verdict file and stop.",
  "Do not open a pull request yourself.",
].join("\n");

const PM_PROMPT = [
  "You are the PM on a software team. Write a concise mini-PRD (3-5 sentences) for the idea.",
  "",
  "Say what the feature does, who it is for, and how we will know it works.",
  "Keep it short: the engineer builds from it and the reviewer checks against it.",
].join("\n");

const ENGINEER_PROMPT = [
  "Read the PRD below and create or edit the files in your current working directory to build it.",
  "",
  "Write tests for the new behaviour and run them before you finish.",
].join("\n");

const lastRun = (outcome, min, iteration = 3) => ({
  outcome,
  outcome_detail: null,
  run_id: "r-rsi",
  iteration,
  started_at: ago(min + 2),
  status: "done",
  ended_at: ago(min),
});

export const REVIEWER_SKILLS = [
  { type: "inline", name: "house-style", content: "# House style", mode: "always" },
  { type: "repo", url: "https://github.com/org/skills", ref: "main", filter: "pytest-review" },
];
export const REVIEWER_TOOLS = {
  mcpServers: {
    fetch: { command: "uvx", args: ["mcp-server-fetch"] },
    github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    },
  },
};

export const NODES = {
  pm: {
    id: "n-pm",
    role_name: "pm",
    kind: "completion",
    model: "xai/grok-4.7",
    engine: null,
    prompt: PM_PROMPT,
    position: { x: 60, y: 250 },
    edits_allowed: false,
    config: { title: "Product manager", description: "Drafts the spec" },
    tool_config: null,
    skills: null,
    last_run: lastRun("prd_written", 31, 1),
  },
  prd: {
    id: "n-prd",
    role_name: "prd_approval",
    kind: "gate",
    model: null,
    engine: null,
    prompt: null,
    position: { x: 262, y: 272 },
    config: { gate_kind: "prd_approval", title: "Approve the PRD", description: "" },
    last_run: null,
  },
  stop: {
    id: "n-stop",
    role_name: "stop",
    kind: "terminal",
    model: null,
    engine: null,
    prompt: null,
    position: { x: 291, y: 392 },
    config: { terminal_kind: "stop" },
    last_run: null,
  },
  eng: {
    id: "n-eng",
    role_name: "engineer",
    kind: "agent",
    model: "anthropic/claude-sonnet-4",
    engine: "openhands",
    prompt: ENGINEER_PROMPT,
    position: { x: 430, y: 120 },
    edits_allowed: true,
    config: { title: "Engineer", description: "Writes & ships it" },
    tool_config: null,
    skills: null,
    last_run: lastRun("built", 36, 3),
  },
  rev: {
    id: "n-rev",
    role_name: "reviewer",
    kind: "agent",
    model: "xai/grok-4.7",
    engine: "openhands",
    prompt: REVIEWER_PROMPT,
    position: { x: 660, y: 250 },
    edits_allowed: false,
    config: { title: "Reviewer", description: "Checks against the spec" },
    tool_config: REVIEWER_TOOLS,
    skills: REVIEWER_SKILLS,
    last_run: lastRun("changes_requested", 31, 3),
  },
  esc: {
    id: "n-esc",
    role_name: "review_escalation",
    kind: "gate",
    model: null,
    engine: null,
    prompt: null,
    position: { x: 446, y: 470 },
    config: { gate_kind: "review_escalation", title: "Escalate the review", description: "" },
    last_run: null,
  },
  ship: {
    id: "n-ship",
    role_name: "ship",
    kind: "terminal",
    model: null,
    engine: null,
    prompt: null,
    position: { x: 880, y: 420 },
    config: { terminal_kind: "ship" },
    last_run: null,
  },
};

const edge = (id, s, t, conditions = null, edge_type = "default") => ({
  id,
  source_node_id: NODES[s].id,
  target_node_id: NODES[t].id,
  edge_type,
  conditions,
});

export const EDGES = [
  edge("e-pm-prd", "pm", "prd"),
  edge("e-prd-eng", "prd", "eng", { when: "approved" }),
  edge("e-prd-stop", "prd", "stop", { when: "rejected" }),
  edge("e-eng-rev", "eng", "rev"),
  edge("e-rev-ship", "rev", "ship", { when: "approved" }),
  edge("e-rev-eng", "rev", "eng", { loop_limit: 3 }),
  edge("e-eng-esc", "eng", "esc", null, "escalation"),
  edge("e-esc-ship", "esc", "ship", { when: "approved" }),
  edge("e-esc-stop", "esc", "stop", { when: "rejected" }),
];

export const graph = (nodes = Object.values(NODES)) => ({
  team_graph_id: TEAM_ID,
  name: TEAM_NAME,
  nodes,
  edges: EDGES,
});

// The served provider catalogue (control_plane/teams.py) — only what the panel reads.
export const CATALOGUE = [
  {
    provider: "openai",
    thinker_default: "openai/gpt-4.1-mini",
    worker_default: "openai/gpt-4o-mini",
    thinker_presets: ["openai/gpt-4.1-mini"],
    worker_presets: ["openai/gpt-4o-mini"],
    label: "OpenAI",
    model_labels: { "openai/gpt-4.1-mini": "GPT-4.1 mini", "openai/gpt-4o-mini": "GPT-4o mini" },
    subscription: null,
    byok_probed: true,
  },
  {
    provider: "anthropic",
    thinker_default: "anthropic/claude-sonnet-5",
    worker_default: "anthropic/claude-sonnet-5",
    thinker_presets: ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"],
    worker_presets: ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"],
    label: "Anthropic",
    model_labels: {
      "anthropic/claude-sonnet-5": "Claude Sonnet 5",
      "anthropic/claude-sonnet-4": "Claude Sonnet 4",
    },
    subscription: "claude",
    byok_probed: false,
  },
  {
    provider: "xai",
    thinker_default: "xai/grok-4.7",
    worker_default: "xai/grok-4.7",
    thinker_presets: ["xai/grok-4.7"],
    worker_presets: ["xai/grok-4.7"],
    label: "xAI",
    model_labels: { "xai/grok-4.7": "Grok 4.7" },
    subscription: "grok",
    byok_probed: false,
  },
];

const key = (provider) => ({ provider, key_last4: "1234", created_at: ago(60 * 24 * 10) });
const sub = (provider, connected) => ({
  provider,
  connected,
  state: connected ? "connected" : "disconnected",
  runner_fresh: connected,
  account_hint: null,
  source: connected ? "harness" : null,
  checked_at: ago(1),
});

const note = (id, content, extra = {}) => ({
  id,
  content,
  polarity: "require",
  repo_key: "lazyxgenius/trade_mcp",
  node_id: "n-rev",
  tier: "node",
  pinned: false,
  status: "active",
  confirmation_count: 1,
  source_run_id: "r-rsi",
  source_invocation_id: 1,
  embedding_dim: null,
  valid_from: null,
  invalid_at: null,
  created_at: ago(60 * 24 * 3),
  updated_at: ago(60 * 24 * 3),
  ...extra,
});

/**
 * The API the canvas page reads. `keys` = providers with an API key; `subs` = the subscriptions
 * the server mirror reports connected + runner fresh.
 */
export function panelRoutes({ nodes, keys = ["xai", "anthropic"], subs = [], over = {} } = {}) {
  return {
    "GET /api/config": {
      hosted_mode: true,
      github_install_url: "https://github.com/apps/tvashtr/installations/new",
      github_manage_url: "https://github.com/apps/tvashtr/installations/new",
      provider_catalogue: CATALOGUE,
      provider_directory: [],
      default_run_budget_usd: 5,
    },
    "GET /api/teams": {
      teams: [
        {
          team_graph_id: TEAM_ID,
          name: TEAM_NAME,
          created_at: ago(60 * 24 * 20),
          node_count: 7,
          last_run: null,
          spend_usd: 4.82,
        },
      ],
    },
    [`GET /api/teams/${TEAM_ID}/graph`]: graph(nodes),
    [`GET /api/teams/${TEAM_ID}/validate`]: { errors: [], warnings: [], runnable: true },
    "GET /api/providers": { providers: keys.map(key) },
    "GET /api/engines/subscriptions": {
      subscriptions: ["claude", "grok", "codex"].map((p) => sub(p, subs.includes(p))),
    },
    "GET /api/memories": (req) => {
      const q = new URL(req.url()).searchParams;
      // The Reviewer's notes (Panel-EntryAgent draws the same "Memory 3" on the Product manager).
      if (!["n-rev", "n-pm"].includes(q.get("node_id"))) return { json: { memories: [] } };
      if (q.get("status") === "pending_review") {
        return {
          json: {
            memories: [
              note("m-3", "Check the indicator is listed on INDICATORS.", {
                status: "pending_review",
              }),
            ],
          },
        };
      }
      return {
        json: {
          memories: [
            note("m-1", "Run pytest with -q so the output fits the verdict.", { pinned: true }),
            note("m-2", "The indicator registry lives in indicators/__init__.py."),
          ],
        },
      };
    },
    "GET /api/secrets": { secrets: [] },
    "GET /api/tool-library": { tools: [] },
    "GET /api/tool-catalog": { tools: [] },
    "GET /api/skill-library": { skills: [] },
    "GET /api/skill-presets": { skills: [] },
    ...over,
  };
}

/**
 * The drawer-alone boards (Panel-*, Flow-*) are the 384px aside by itself: hide the canvas chrome
 * and pin the aside to the viewport's left edge at full height.
 */
export async function isolateDrawer(page) {
  await page.addStyleTag({
    content: `
      .tv-titlebar, .cv-bar, .cv-canvas { display: none !important; }
      .nd-drawer--dock {
        position: fixed !important; inset: 0 auto 0 0 !important; width: 384px !important;
        height: 100vh !important; box-shadow: none !important; border-left: 0 !important;
      }
    `,
  });
}

/** Wait until the drawer shows its tabs (the graph and the counts have loaded). */
export async function drawerReady(page, name = "Reviewer") {
  await page.getByRole("complementary", { name: `${name} settings` }).waitFor();
  await page.waitForTimeout(250);
}

// Shared fixtures for the Toolkit › Skills + Memory parity scenarios (slice F4). Not a scenario file
// itself: toolkit-skills-memory-skills.mjs (and later -memory.mjs) import it. The data mirrors the
// design's sample data (Toolkit-Skills, Toolkit-SkillPresets, TkF-Presets-*).
export const now = Date.now();
export const ago = (min) => new Date(now - min * 60_000).toISOString();

// The page's clock stays at the moment these fixtures were built, so "Just now" stays "Just now"
// however long a sweep takes. Desktop's once-per-session subscription notice is already seen (the
// design's frames don't draw it, and it would cover the toasts). Init scripts are serialized: a
// string with the time inlined.
export const frozenClock = `(() => {
  const offset = ${now} - Date.now();
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + offset;
  try {
    sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");
  } catch {
    /* ignore */
  }
})();`;

// The design's dates ("Sep 23", "Sep 21", "Sep 24"), at midday UTC so every time zone agrees.
const day = (d) => `2026-09-${String(d).padStart(2, "0")}T12:00:00+00:00`;

export const skill = (
  id,
  name,
  source,
  { agents = 0, teams = 0, updated = day(20) } = {},
) => ({
  id,
  name,
  source,
  created_at: day(10),
  updated_at: updated,
  usage: { agents, teams },
});

export const inline = (name, content, mode = "always", triggers) => ({
  type: "inline",
  name,
  content,
  mode,
  ...(triggers ? { triggers } : {}),
});

// Toolkit-SkillEditor: house-style's SKILL.md as the editor shows it.
export const HOUSE_STYLE_MD =
  "# House style\n\nWrite review notes in plain words.\n- Lead with the verdict, then the reasons.\n- Name files and functions in `code`.\n- One reason per line, most important first.\n- Never suggest changes you did not verify.";

// TkF-NewSkill-2…5: the skill the flow writes.
export const API_CONVENTIONS_MD =
  "# API conventions\n\n- Routes are nouns: /api/runs, /api/teams.\n- Return 422 for bad input, with a message a person can read.\n- Every new endpoint checks the session first.";

export const SKILLS = {
  houseStyle: skill(
    "s-house",
    "house-style",
    inline("house-style", HOUSE_STYLE_MD),
    { agents: 2, teams: 1, updated: day(23) },
  ),
  pytestReview: skill(
    "s-pytest",
    "pytest-review",
    {
      type: "repo",
      url: "https://github.com/org/skills",
      ref: "main",
      filter: "pytest-review",
      mode: "agent",
    },
    { agents: 1, teams: 1, updated: day(21) },
  ),
  security: skill(
    "s-sec",
    "security-checklist",
    inline(
      "security-checklist",
      "# Security checklist\n\nWhen you review code that touches auth:\n- Tokens and secrets are never logged.",
      "trigger",
      ["auth", "secrets"],
    ),
    { updated: day(24) },
  ),
};

// Toolkit-Skills: the three rows the design draws (oldest first, as the API sends them).
export const LIBRARY = [
  SKILLS.security,
  SKILLS.houseStyle,
  SKILLS.pytestReview,
];

export const YAGNI_MD =
  "# YAGNI\n\nMake the smallest change that solves the asked problem.\n- Don’t add options nobody asked for.\n- Don’t build for a future that isn’t in the spec.\n- If you’re unsure, leave it out and say so.";

const preset = (key, title, description, content) => ({
  key,
  name: key,
  title,
  description,
  access: "free",
  badge: "Free",
  attachable: true,
  source: { type: "inline", name: key, content, mode: "always" },
});

export const PRESETS = [
  preset(
    "caveman",
    "Caveman (terse)",
    "Ultra-compressed output style that keeps technical substance.",
    "# Caveman\n\nTerse output. Keep the technical substance.",
  ),
  preset(
    "tdd",
    "TDD discipline",
    "Red → green → refactor. Smallest code that makes the failing test pass.",
    "# TDD\n\nWrite the failing test first.",
  ),
  preset(
    "yagni",
    "YAGNI",
    "Smallest change that solves the asked problem, no speculative extras.",
    YAGNI_MD,
  ),
];

// Toolkit-SkillPresets: Caveman and TDD are already in the library ("In your skills"), and the
// tab still counts three skills.
export const PRESET_LIBRARY = [
  skill("s-cave", "caveman", PRESETS[0].source, { updated: day(22) }),
  skill("s-tdd", "tdd", PRESETS[1].source, { updated: day(22) }),
  SKILLS.houseStyle,
];

// Who uses each skill (GET /api/skill-library/{id} `used_by`): house-style is on for the Reviewer
// and the Engineer of the Indicator sprint team (TkF-SkillMenu-2).
const usage = (role) => ({
  node_id: `n-${role}`,
  role_name: role,
  title: null,
  team_id: "t-indicator",
  team_name: "Indicator sprint team",
});
export const USED_BY = {
  "s-house": [usage("reviewer"), usage("engineer")],
  "s-pytest": [usage("reviewer")],
};

// Add from GitHub (TkF-FromRepo-2): what lazyxgenius/skills holds at main, in the design's order.
// pytest-review is already in the library (the design's own table lists it), so it comes back
// `in_library` and the sheet leaves it out.
export const SCAN = {
  repo: "lazyxgenius/skills",
  url: "https://github.com/lazyxgenius/skills",
  ref: "main",
  sha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
  short_sha: "1a2b3c4",
  skills: [
    "pytest-review",
    "house-style-py",
    "api-conventions",
    "commit-messages",
  ].map((name) => ({
    name,
    path: `skills/${name}/SKILL.md`,
    description: null,
    in_library: LIBRARY.some((s) => s.name === name),
  })),
};

// "Turn on for agents…" (undesigned; the geometry mirrors TkF-AddTool-6): every agent by team.
const pickerAgent = (
  role,
  { kind = "agent", edits = true, on = false } = {},
) => ({
  node_id: `n-${role}`,
  role_name: role,
  title: null,
  kind,
  edits_allowed: edits,
  enabled: on,
  overridden: false,
  mode: null,
  triggers: null,
});
export const AGENT_TEAMS = (id) => [
  {
    team_id: "t-indicator",
    team_name: "Indicator sprint team",
    agents: [
      pickerAgent("pm", { kind: "completion", edits: false }),
      pickerAgent("engineer", { on: id === "s-house" }),
      pickerAgent("reviewer", { on: id === "s-house" || id === "s-pytest" }),
    ],
  },
  {
    team_id: "t-docs",
    team_name: "Docs team",
    agents: [pickerAgent("writer")],
  },
];

export const skillsRoutes = ({
  library = LIBRARY,
  presets = PRESETS,
  onCreate,
} = {}) => ({
  "GET /api/teams": { teams: [] },
  "GET /api/skill-library": () => ({ json: { skills: library } }),
  "GET /api/skill-presets": { skills: presets },
  "POST /api/skill-library": (req) => {
    const body = JSON.parse(req.postData() ?? "{}");
    const created = skill(`s-${body.name}`, body.name, body.source, {
      updated: ago(0),
    });
    onCreate?.(created);
    return { json: created };
  },
  "GET /api/skill-library/:id": (req) => {
    const id = new URL(req.url()).pathname.split("/").pop();
    const found = library.find((s) => s.id === id);
    return found
      ? { json: { ...found, used_by: USED_BY[id] ?? [] } }
      : { status: 404, json: { detail: "skill not found in your library" } };
  },
  "GET /api/skill-library/:id/agents": (req) => {
    const id = new URL(req.url()).pathname.split("/").at(-2);
    return { json: { teams: AGENT_TEAMS(id) } };
  },
  "DELETE /api/skill-library/:id": (req) => {
    const id = new URL(req.url()).pathname.split("/").pop();
    const i = library.findIndex((s) => s.id === id);
    if (i >= 0) library.splice(i, 1);
    return { json: { removed_from_agents: (USED_BY[id] ?? []).length } };
  },
  "POST /api/skill-library/scan": (req) => {
    const body = JSON.parse(req.postData() ?? "{}");
    return body.url === SCAN.url
      ? { json: SCAN }
      : {
          status: 404,
          json: {
            detail: {
              code: "repo_not_found",
              message:
                "We couldn’t find that repo. Check the name, or install the GitHub App on it if it’s private.",
            },
          },
        };
  },
  "POST /api/skill-library/import": (req) => {
    const body = JSON.parse(req.postData() ?? "{}");
    const added = body.skills
      .filter((name) => !library.some((s) => s.name === name))
      .map((name) =>
        skill(
          `s-${name}`,
          name,
          {
            type: "repo",
            url: body.url,
            ref: body.ref,
            filter: name,
            mode: body.mode,
            resolved_sha: body.sha,
          },
          { updated: ago(0) },
        ),
      );
    library.push(...added);
    const skipped = body.skills.filter((n) => !added.some((a) => a.name === n));
    return { json: { added, skipped } };
  },
});

// ---- Toolkit › Memory (Toolkit-MemoryInbox, TkF-Review-*, TkF-Inbox-*) ----

const REVIEWER = {
  node_id: "n-rev",
  role_name: "reviewer",
  title: null,
  team_id: "t-ind",
  team_name: "Indicator sprint team",
};

const runSource = (over = {}) => ({
  kind: "run",
  run_id: "r-rsi",
  run_title: "Add an RSI indicator",
  run_status: "completed",
  run_succeeded: true,
  round: 3,
  agent_role: "reviewer",
  team_name: "Indicator sprint team",
  node_id: "n-rev",
  ...over,
});

export const memoryRow = (id, content, polarity, over = {}) => ({
  id,
  content,
  polarity,
  repo_key: "lazyxgenius/trade_mcp",
  repo_label: "lazyxgenius/trade_mcp",
  node_id: null,
  tier: "repo",
  pinned: false,
  status: "pending_review",
  confirmation_count: 1,
  source_run_id: "r-rsi",
  source_invocation_id: 4812,
  source_node_id: "n-rev",
  superseded_by: null,
  embedding_dim: 1536,
  valid_from: ago(31),
  invalid_at: null,
  edited_at: null,
  created_at: ago(31),
  updated_at: ago(31),
  agent: null,
  source: runSource(),
  source_iteration: 3,
  ...over,
});

// The Inbox's two memories: the Reviewer's SHOULD (31m ago) and a failed run's MUST NOT caution.
export const MEM_SHOULD = memoryRow(
  "m-should",
  "Check web/lib/engine-facts.ts whenever the Python indicator list changes; the two must stay in sync.",
  "prefer",
  { node_id: "n-rev", tier: "node", agent: REVIEWER },
);
export const MEM_MUST_NOT = memoryRow(
  "m-mustnot",
  "Don’t edit files under web/generated/; they are rebuilt from the Python source.",
  "forbid",
  {
    valid_from: day(23),
    created_at: day(23),
    updated_at: day(23),
    source: runSource({
      run_id: "r-fail",
      run_title: "Wire the indicator page",
      run_status: "failed",
      run_succeeded: false,
      round: 2,
    }),
    source_iteration: 2,
  },
);

// ---- The Active tab (Toolkit-MemoryActive, TkF-Filters-*) ----
const ACCOUNT = {
  repo_key: null,
  repo_label: null,
  tier: "account",
  node_id: null,
};
const MANUAL = {
  kind: "manual",
  run_id: null,
  run_title: null,
  run_status: null,
  run_succeeded: null,
  round: null,
  agent_role: null,
  team_name: null,
  node_id: null,
};
const active = (id, content, polarity, over = {}) =>
  memoryRow(id, content, polarity, { status: "active", ...over });

// The design's four rows, pinned first then newest: the pinned MUST (confirmed 3×), the Reviewer's
// SHOULD (Sep 24), a CONTEXT note you added for every repo (Sep 20), a MAY learned twice (Sep 18).
export const ACT_MUST = active(
  "a-must",
  "Run the tests with python -m pytest -q -p no:cacheprovider.",
  "require",
  {
    pinned: true,
    confirmation_count: 3,
    created_at: day(25),
    valid_from: day(25),
  },
);
export const ACT_SHOULD = active(
  "a-should",
  "Approve only when the registry test and the TypeScript mirror list the same indicators.",
  "prefer",
  {
    node_id: "n-rev",
    tier: "node",
    agent: REVIEWER,
    created_at: day(24),
    valid_from: day(24),
  },
);
export const ACT_CONTEXT = active(
  "a-context",
  "The team ships to a Fly.io preview before the human merge gate.",
  "context",
  {
    ...ACCOUNT,
    source_run_id: null,
    source_node_id: null,
    source: MANUAL,
    created_at: day(20),
    valid_from: day(20),
  },
);
export const ACT_MAY = active(
  "a-may",
  "Use uvx to run Python MCP servers locally.",
  "allow",
  {
    ...ACCOUNT,
    confirmation_count: 2,
    created_at: day(18),
    valid_from: day(18),
  },
);

// "Active 14": ten older memories below the four the design draws (none a SHOULD, so filtering to
// SHOULD reads "1 of 14").
const OLDER = [
  ["Keep indicator names lowercase with underscores.", "require"],
  ["Every new indicator gets a registry test.", "require"],
  ["Prefer pandas vectorised maths over Python loops.", "allow"],
  ["The MCP server entry point is src/trade_mcp/server.py.", "context"],
  ["Indicators return a DataFrame with the input's index.", "require"],
  ["Don’t add a dependency without asking in the PR.", "avoid"],
  ["Never commit .env files.", "forbid"],
  ["Tests use fixtures from tests/fixtures/ohlcv.csv.", "context"],
  ["CI runs on Python 3.12.", "context"],
  ["Docs live in docs/indicators/, one page per indicator.", "allow"],
].map(([content, polarity], i) =>
  active(`a-old-${i}`, content, polarity, {
    created_at: day(16 - i),
    valid_from: day(16 - i),
  }),
);
export const ACTIVE_ROWS = [
  ACT_MUST,
  ACT_SHOULD,
  ACT_CONTEXT,
  ACT_MAY,
  ...OLDER,
];

// GET /api/memory/repos — sorted by label, like the backend; the page lists repos with memories
// first (trade_mcp, then cryptoground-mcp, as the design draws them).
export const MEMORY_REPOS = [
  {
    repo_key: "lazyxgenius/cryptoground-mcp",
    label: "lazyxgenius/cryptoground-mcp",
    memory_count: 0,
    pending_count: 0,
    last_run_at: day(24),
  },
  {
    repo_key: "lazyxgenius/trade_mcp",
    label: "lazyxgenius/trade_mcp",
    memory_count: 12,
    pending_count: 2,
    last_run_at: day(25),
  },
];

/**
 * A small stateful memory backend: Keep / Discard / Undo move rows between the Inbox and the
 * counts (the design's "Active 14", "Archive 3"), the review switch remembers its value.
 */
export const memoryRoutes = ({
  pending = [MEM_SHOULD, MEM_MUST_NOT],
  active = 14,
  activeRows = null,
  archive = 3,
  review = true,
} = {}) => {
  const state = {
    pending: [...pending],
    away: new Map(),
    // With rows, the Active tab lists them and the count follows them.
    rows: activeRows ? [...activeRows] : null,
    active,
    archive,
    review,
  };
  const activeCount = () => (state.rows ? state.rows.length : state.active);
  const row = (id) => state.rows?.find((x) => x.id === id);
  const put = (m) => {
    state.rows = state.rows.map((x) => (x.id === m.id ? m : x));
    return { json: m };
  };
  const idAt = (req, fromEnd) =>
    new URL(req.url()).pathname.split("/").at(fromEnd);
  const take = (id) => {
    const m = state.pending.find((x) => x.id === id);
    if (m) {
      state.pending = state.pending.filter((x) => x.id !== id);
      state.away.set(id, m);
    }
    return m;
  };
  const gone = { status: 404, json: { detail: "memory not found" } };
  return {
    "GET /api/teams": { teams: [] },
    "GET /api/memories": (req) => {
      const status = new URL(req.url()).searchParams.get("status");
      const list =
        status === "pending_review"
          ? state.pending
          : status === "active"
            ? (state.rows ?? [])
            : [];
      return { json: { memories: list } };
    },
    "GET /api/memory/repos": { repos: MEMORY_REPOS },
    "POST /api/memories/:id/pin": (req) => {
      const m = row(idAt(req, -2));
      return m ? put({ ...m, pinned: true }) : gone;
    },
    "POST /api/memories/:id/unpin": (req) => {
      const m = row(idAt(req, -2));
      return m ? put({ ...m, pinned: false }) : gone;
    },
    "PATCH /api/memories/:id": (req) => {
      const m = row(idAt(req, -1));
      if (!m) return gone;
      const patch = JSON.parse(req.postData() ?? "{}");
      return put({ ...m, ...patch, edited_at: ago(0), updated_at: ago(0) });
    },
    "DELETE /api/memories/:id": (req) => {
      const m = row(idAt(req, -1));
      if (!m) return gone;
      state.rows = state.rows.filter((x) => x.id !== m.id);
      return { status: 204, json: null };
    },
    "GET /api/memories/counts": () => ({
      json: {
        inbox: state.pending.length,
        active: activeCount(),
        archive: state.archive,
      },
    }),
    "GET /api/memory/review-mode": () => ({
      json: { review_mode: state.review },
    }),
    "PATCH /api/memory/review-mode": (req) => {
      state.review = JSON.parse(req.postData() ?? "{}").review_mode === true;
      return { json: { review_mode: state.review } };
    },
    "POST /api/memories/:id/promote": (req) => {
      const m = take(idAt(req, -2));
      if (!m) return gone;
      state.active += 1;
      if (state.rows) state.rows.push({ ...m, status: "active" });
      return { json: { ...m, status: "active", action: "promote" } };
    },
    "POST /api/memories/:id/reject": (req) => {
      const m = take(idAt(req, -2));
      if (!m) return gone;
      state.archive += 1;
      return { json: { ...m, status: "rejected", invalid_at: ago(0) } };
    },
    "POST /api/memories/:id/requeue": (req) => {
      const m = state.away.get(idAt(req, -2));
      if (!m) return gone;
      state.away.delete(m.id);
      state.pending.push(m);
      return {
        json: { ...m, action: "requeue", restored: [], unmerged_from: null },
      };
    },
  };
};

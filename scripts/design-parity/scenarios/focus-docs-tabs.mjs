// F6 group G4 — the focus view's tabs: Focus-Skills (the list beside the picked skill), Focus-Memory
// (the filter rail beside the notes) and Focus-Runs (the rounds rail beside a round), each as a
// website and a Desktop render.
import { NODES, TEAM_ID, graph } from "./panel-fixtures.mjs";
import {
  FOCUS_NODES,
  desktop,
  seenDisclosure,
  underTitleStrip,
  web,
} from "./panel-advanced.mjs";
import { SHELVES, SKILLS, TOOLS } from "./panel-skills.mjs";
import { HISTORY, RSI } from "./focus-docs-fixtures.mjs";

const REV = NODES.rev.id;
const GRAPH = `GET /api/teams/${TEAM_ID}/graph`;
const HISTORY_ROUTE = `GET /api/teams/${TEAM_ID}/nodes/${REV}/runs`;
const REPO = "lazyxgenius/trade_mcp";
const tabAt = (tab) => `/#/teams/${TEAM_ID}?node=${REV}&tab=${tab}&focus=1`;

// ---- Focus-Skills -------------------------------------------------------------------------------

// The design's house-style SKILL.md; the Engineer carries the same skill ("Used by Reviewer,
// Engineer").
const HOUSE_STYLE = [
  "# House style",
  "",
  "Write review notes in plain words.",
  "- Lead with the verdict, then the reasons.",
  "- Name files and functions in `code`.",
  "- One reason per line, most important first.",
  "- Never suggest changes you did not verify.",
].join("\n");
const withHouseStyle = (skills) =>
  skills.map((s) => (s.type === "inline" ? { ...s, content: HOUSE_STYLE } : s));
const SKILLS_NODES = FOCUS_NODES.map((n) => {
  if (n.id === REV)
    return { ...n, skills: withHouseStyle(SKILLS), tool_config: TOOLS };
  if (n.id === NODES.eng.id)
    return { ...n, skills: withHouseStyle(SKILLS.slice(0, 1)) };
  return n;
});

// ---- Focus-Memory -------------------------------------------------------------------------------

const memory = (id, content, polarity, extra = {}) => ({
  id,
  content,
  polarity,
  repo_key: REPO,
  repo_label: REPO,
  node_id: REV,
  tier: "node",
  pinned: false,
  status: "active",
  confirmation_count: 1,
  source_run_id: "r-rsi",
  created_at: "2026-09-22T12:00:00Z",
  updated_at: "2026-09-22T12:00:00Z",
  source: {
    kind: "run",
    run_id: "r-rsi",
    run_title: "Add an RSI indicator",
    round: 3,
  },
  ...extra,
});
// The Reviewer's own notes: one waiting, two on the repo (the first pinned, confirmed 3×) and one
// not tied to a repo that you added.
const PENDING = [
  memory(
    "m-new",
    "Check web/lib/engine-facts.ts whenever the Python indicator list changes; the two must stay in sync.",
    "prefer",
    { status: "pending_review", created_at: "2026-09-25T12:00:00Z" },
  ),
];
const OWN = [
  memory(
    "m-1",
    "Run the tests with python -m pytest -q -p no:cacheprovider.",
    "require",
    {
      pinned: true,
      confirmation_count: 3,
      created_at: "2026-09-21T12:00:00Z",
      source: {
        kind: "run",
        run_id: "r-rsi",
        run_title: "Add an RSI indicator",
        round: 2,
      },
    },
  ),
  memory(
    "m-2",
    "Approve only when the registry test and the TypeScript mirror list the same indicators.",
    "prefer",
  ),
  memory(
    "m-3",
    "The team ships to a Fly.io preview before the human merge gate.",
    "context",
    {
      repo_key: null,
      repo_label: null,
      created_at: "2026-09-20T12:00:00Z",
      source: { kind: "manual", run_id: null, run_title: null, round: null },
    },
  ),
];
// The account's other memories: six on the repo ("This repo (6)"), nine account-wide ("Account (9)").
const REPO_NOTES = Array.from({ length: 6 }, (_, i) =>
  memory(`r-${i}`, `Repo lesson ${i + 1}.`, "context", {
    node_id: null,
    tier: "repo",
  }),
);
const ACCOUNT_NOTES = Array.from({ length: 9 }, (_, i) =>
  memory(`a-${i}`, `Account lesson ${i + 1}.`, "context", {
    node_id: null,
    repo_key: null,
    repo_label: null,
    tier: "account",
  }),
);
const memories = (req) => {
  const q = new URL(req.url()).searchParams;
  const status = q.get("status");
  const node = q.get("node_id");
  if (node && node !== REV) return { json: { memories: [] } };
  if (status === "pending_review")
    return { json: { memories: node ? PENDING : [] } };
  return {
    json: { memories: node ? OWN : [...OWN, ...REPO_NOTES, ...ACCOUNT_NOTES] },
  };
};

// ---- Focus-Runs ---------------------------------------------------------------------------------

// Round 3 as the design draws it: given the spec v3, build-notes v2, two lessons and house-style;
// it wrote its verdict; on the Grok subscription, 18.2k tokens in, 1.1k out, 2m 14s.
const VERDICT =
  "No new indicator was added: `core/indicators.py` `INDICATORS`, `web/lib/strategies/indicators.ts` and " +
  "`TestRegistry.test_list_indicators_returns_twenty_eight` still list the same 28 names, and " +
  "`web/lib/engine-facts.ts` still sets `indicator_count` to 28. Specify the indicator name, formula, " +
  "parameters and outputs, then register the function on `INDICATORS` and update the registry test and " +
  "the TypeScript mirror so all three list the same set.";
const [round3, round2, round1] = HISTORY.run.rounds;
const ended = Date.now() - 31 * 60_000;
const ROUND_3 = {
  ...round3,
  outcome_detail: VERDICT,
  started_at: new Date(ended - 134_000).toISOString(),
  ended_at: new Date(ended).toISOString(),
  cost: {
    prompt_tokens: 18_200,
    completion_tokens: 1_100,
    total_tokens: 19_300,
    cost_usd: 0,
  },
  runs_on: { via: "subscription", provider: "grok" },
  given: {
    documents: [
      {
        document_id: "d-spec",
        name: "spec",
        version_no: 3,
        is_shared_spec: true,
      },
      {
        document_id: "d-notes",
        name: "build-notes",
        version_no: 2,
        is_shared_spec: false,
      },
    ],
    memory: [
      { id: "m-1", polarity: "require" },
      { id: "m-2", polarity: "prefer" },
    ],
    skills: [
      { type: "inline", name: "house-style", mode: "always", triggers: [] },
      { type: "repo", name: "pytest-review", mode: null, triggers: [] },
      {
        type: "library",
        name: "security-checklist",
        mode: "trigger",
        triggers: ["auth"],
      },
    ],
  },
  produced: {
    verdict: {
      file: "REVIEW_VERDICT.json",
      verdict: "changes_requested",
      reasons: VERDICT,
    },
    documents: [],
    files: ["REVIEW_VERDICT.json"],
  },
};
// The run it worked on carries its memory repo (B2); one earlier run, approved on Sep 22.
const FOCUS_HISTORY = {
  runs: [
    { ...HISTORY.runs[0], repo_key: REPO, repo_label: REPO },
    { ...HISTORY.runs[1], repo_key: REPO, repo_label: REPO },
  ],
  run: {
    ...RSI,
    repo_key: REPO,
    repo_label: REPO,
    rounds: [ROUND_3, round2, round1],
  },
};

// ---- Scenarios ----------------------------------------------------------------------------------

// Focus-Memory answers with its own notes; the other boards keep F5's (2 kept + 1 waiting =
// "Memory 3", as they draw it).
const over = (nodes = FOCUS_NODES, notes) => ({
  [GRAPH]: graph(nodes),
  ...SHELVES,
  [HISTORY_ROUTE]: FOCUS_HISTORY,
  ...(notes ? { "GET /api/memories": notes } : {}),
});

/**
 * A Desktop board as a website render (30px down) and a Desktop render. `keys`: the Desktop render
 * keeps API keys too (an agent on a Desktop subscription adds the PANEL-103 note, not drawn).
 */
function boards(name, { tab, nodes, notes, ready, keys = false }) {
  const steps = async (p) => {
    const dialog = p.getByRole("dialog", { name: "Reviewer in focus view" });
    await dialog.waitFor();
    await ready(dialog);
    await p.waitForTimeout(300);
    await p.mouse.move(0, 0);
  };
  return [
    {
      name: `${name}-web`,
      path: tabAt(tab),
      routes: web(over(nodes, notes)),
      steps: async (p) => {
        await underTitleStrip(p);
        await steps(p);
      },
    },
    {
      name: `${name}-desktop`,
      path: tabAt(tab),
      routes: keys ? web(over(nodes, notes)) : desktop(over(nodes, notes)),
      desktop: true,
      init: seenDisclosure,
      steps,
    },
  ];
}

export default [
  ...boards("Focus-Skills", {
    tab: "skills",
    nodes: SKILLS_NODES,
    keys: true,
    ready: (d) => d.getByText("Reviewer, Engineer").waitFor(),
  }),
  ...boards("Focus-Memory", {
    tab: "memory",
    notes: memories,
    ready: async (d) => {
      await d.getByText("Not repo-specific · 1").waitFor();
      await d.getByText("Account (9)").waitFor();
      await d.getByText("This repo (6)").waitFor();
    },
  }),
  ...boards("Focus-Runs", {
    tab: "runs",
    ready: (d) => d.getByText("$0.00 · Grok subscription").waitFor(),
  }),
];

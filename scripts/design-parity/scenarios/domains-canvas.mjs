// The Query domain node and an agent's Domains on the team canvas (group G12), website and Desktop:
//   query-node → Dm-QueryNode (Docs team, the Query domain node selected, its Setup saved)
//   step-4     → DmF-Step-4 (Add step from the domain's Use in teams tab lands on the canvas + toast)
//   step-5     → DmF-Step-5 (after run 14: the card says Answered, the drawer's Last run tab)
//   canvas-1   → DmF-Canvas-1 (+ opens Add to canvas; Query domain is the last item)
//   canvas-2   → DmF-Canvas-2 (a new unconnected node needs a domain; the Domain list open)
//   canvas-3   → DmF-Canvas-3 (Support docs picked: the title and question follow; Save focused)
//   canvas-4   → DmF-Canvas-4 (saved but no way out: the card's badge and the canvas banner)
//   agent-access → Dm-AgentAccess (Indicator sprint team, Product manager's Tools with Domains)
// These boards are drawn on F5's rebuilt canvas chrome (header, toolbar, 172px cards, the 384px
// drawer shell with its tabs); today's App draws the old chrome, so their lines are `# needs-F5`.
// The Domains parts (drawer body, checklist, card lines) are what this file exercises.
import { D, DOMAINS, SUPPORT_FILES, domainsRoutes, pair } from "./domains-fixtures.mjs";

const T = {
  docs: "d4427ab6-2d4d-4ab9-b925-bd7e107ce3a4",
  sprint: "5e0f6a3b-7c1d-4e2f-9a8b-1c2d3e4f5a6b",
};
const N = {
  pm: "caf4bd86-8193-44b4-9d45-e70e6a644956",
  dq: "0f1e2d3c-4b5a-4968-8776-655443322110",
  writer: "40de840c-643d-45f0-be48-eb36b543068b",
  reviewer: "1390b92b-9033-430c-8409-610b63a4d3ae",
  ship: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  sprintPm: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
  engineer: "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f",
  sprintReviewer: "f5a6b7c8-d9e0-4f1a-8b3c-4d5e6f7a8b9c",
  sprintShip: "a6b7c8d9-e0f1-4a2b-9c3d-4e5f6a7b8c9d",
};

const agentNode = (id, role_name, x, model, over = {}) => ({
  id,
  role_name,
  kind: role_name === "pm" ? "completion" : "agent",
  model,
  engine: role_name === "pm" ? null : "openhands",
  prompt: `You are the ${role_name}.`,
  position: { x, y: 290 },
  edits_allowed: role_name !== "pm" && role_name !== "reviewer",
  config: {},
  tool_config: null,
  skills: null,
  last_run: null,
  ...over,
});
const shipNode = (id, x) => ({
  id,
  role_name: "ship",
  kind: "terminal",
  model: null,
  engine: null,
  prompt: null,
  position: { x, y: 300 },
  config: { terminal_kind: "ship" },
  last_run: null,
});
const LOOKUP = {
  domain_id: D.support,
  title: "Look up support docs",
  pass_to_spec: true,
  on_no_answer: "continue",
};
const queryNode = (config, over = {}) => ({
  id: N.dq,
  role_name: "domain_query",
  kind: "domain_query",
  model: null,
  engine: null,
  prompt: config.domain_id ? "What do our support docs say about {idea}?" : "{idea}",
  position: { x: 292, y: 290 },
  edits_allowed: false,
  config,
  tool_config: null,
  skills: null,
  last_run: null,
  ...over,
});
const edge = (source, target) => ({
  id: `${source.slice(0, 8)}-${target.slice(0, 8)}`,
  source_node_id: source,
  target_node_id: target,
  edge_type: "work",
  conditions: null,
});

const PM = agentNode(N.pm, "pm", 60, "xai/grok-4.7");
const WRITER = agentNode(N.writer, "writer", 524, "anthropic/claude-sonnet-5", {
  config: { title: "Writer", description: "Writes the docs change" },
});
const REVIEWER = agentNode(N.reviewer, "reviewer", 756, "xai/grok-4.7");

/** The Docs team: PM → [Query domain] → Writer → Reviewer → Ship. */
function docsGraph(dq, { connected = true, exit = true } = {}) {
  const edges = [edge(N.writer, N.reviewer), edge(N.reviewer, N.ship)];
  if (!dq || !connected) edges.push(edge(N.pm, N.writer));
  else {
    edges.push(edge(N.pm, N.dq));
    if (exit) edges.push(edge(N.dq, N.writer));
  }
  return {
    team_graph_id: T.docs,
    name: "Docs team",
    nodes: [PM, ...(dq ? [dq] : []), WRITER, REVIEWER, shipNode(N.ship, 988)],
    edges,
  };
}

const VALID = { errors: [], warnings: [], runnable: true };
const NO_EXIT = {
  errors: [
    {
      code: "no_exit",
      message: "This Query domain node has no outgoing connection — add a 'Then →' edge.",
      node_id: N.dq,
      edge_id: null,
    },
  ],
  warnings: [],
  runnable: false,
};

const byName = Object.fromEntries(SUPPORT_FILES.map((f) => [f.filename, f]));
const passage = (name, number, piece, pieces, page, excerpt) => ({
  number,
  document_id: byName[name]?.document_id ?? `f-${name}`,
  filename: name,
  chunk_id: `c-${name}-${piece}`,
  piece_number: piece,
  pieces_in_file: pieces,
  page,
  excerpt,
});
const RUN_14 = {
  runs: [{ run_id: "r-14", status: "completed" }],
  run: {
    run_id: "r-14",
    number: 14,
    idea: "a self-serve refund button",
    status: "completed",
    rounds: [
      {
        invocation_id: 901,
        iteration: 1,
        status: "done",
        outcome: "answered",
        outcome_detail: "Refunds are requested from Billing → Refunds within 30 days [1].",
        cost: { cost_usd: 0.0012 },
        domain: {
          question: "What do our support docs say about a self-serve refund button?",
          answer_text:
            "Refunds are requested from Billing → Refunds within 30 days [1]. Annual plans are prorated after that [2].",
          covered: true,
          sources: [
            passage(
              "refund-policy.md",
              1,
              3,
              42,
              null,
              "Customers may request a full refund within 30 days of their original purchase date. Requests are made from Billing → Refunds or by writing to support",
            ),
            passage(
              "billing-faq.pdf",
              2,
              17,
              86,
              4,
              "For annual subscriptions cancelled after the first 30 days, we refund the unused whole months on a prorated basis. Refunds are issued to the original payment method and usually arrive within 5–10 business days",
            ),
          ],
          citations: [],
          latency_ms: 1900,
          cost_usd: 0.0012,
          spec_section: "What the docs say",
        },
      },
    ],
  },
};
const NEVER_RAN = { runs: [], run: null };

// Keys for every model on the boards, so the canvas isn't blocked on a missing provider.
const PROVIDERS = ["openai", "anthropic", "xai"].map((provider) => ({
  provider,
  key_last4: "3f9a",
  created_at: "2026-09-01T10:00:00Z",
}));

function canvasRoutes({ graph, validity = VALID, runs = NEVER_RAN, extra = {} }) {
  return {
    ...domainsRoutes({ domains: DOMAINS, providers: PROVIDERS }),
    "GET /api/teams": { teams: [{ team_graph_id: graph.team_graph_id, name: graph.name }] },
    [`GET /api/teams/${graph.team_graph_id}/graph`]: graph,
    [`GET /api/teams/${graph.team_graph_id}/validate`]: validity,
    [`GET /api/teams/${graph.team_graph_id}/runs`]: { runs: [] },
    "GET /api/teams/:t/nodes/:n/runs": runs,
    "PATCH /api/teams/:t/nodes/:n": {},
    "GET /api/engines/subscriptions": { subscriptions: [] },
    "GET /api/secrets": { secrets: [] },
    "GET /api/tool-library": { tools: [] },
    "GET /api/tool-catalog": { tools: [] },
    "GET /api/skill-library": { skills: [] },
    "GET /api/skill-presets": { skills: [] },
    "GET /api/memories": { memories: [] },
    ...extra,
  };
}

// F5's drawer is the "Node settings" aside; today's agent editor is named after the agent.
const drawer = (page) =>
  page.locator('aside[aria-label="Node settings"], aside[aria-label$=" editor"]').first();

/** Select a node: F5's App opens it from `?node=`; today's opens it on a click. */
async function select(page, title) {
  if (await drawer(page).isVisible()) return;
  await page.locator(".react-flow__node").filter({ hasText: title }).first().click();
  await drawer(page).waitFor();
}

const settled = async (page) => {
  await drawer(page).getByText("Saved — this drives the next run you launch.").waitFor();
  await page.mouse.move(0, 0);
};

export default [
  ...pair("query-node", {
    path: `/#/teams/${T.docs}?node=${N.dq}`,
    routes: canvasRoutes({ graph: docsGraph(queryNode(LOOKUP)) }),
    steps: async (page) => {
      await select(page, "Look up support docs");
      await settled(page);
    },
  }),
  ...pair("step-4", {
    path: `/#/domains/${D.support}/teams`,
    routes: {
      ...canvasRoutes({ graph: docsGraph(queryNode(LOOKUP)) }),
      [`GET /api/domains/${D.support}`]: { ...DOMAINS[0], last_question_at: null },
      [`GET /api/domains/${D.support}/documents`]: { documents: SUPPORT_FILES },
      [`GET /api/domains/${D.support}/usage`]: { steps: [], agents: [] },
      [`GET /api/domains/${D.support}/step-places`]: {
        teams: [
          {
            team_id: T.docs,
            name: "Docs team",
            path: ["Product manager", "Writer", "Reviewer"],
            places: [{ after_node_id: N.pm, after: "Product manager", next: "Writer" }],
          },
        ],
      },
      [`POST /api/domains/${D.support}/steps`]: {
        node_id: N.dq,
        team_id: T.docs,
        title: "Look up support docs",
        after: { node_id: N.pm, title: "Product manager" },
        connected_to: { node_id: N.writer, title: "Writer" },
      },
    },
    steps: async (page) => {
      await page.getByRole("button", { name: "Add as a step in a team" }).click();
      await page.getByRole("option", { name: /^Docs team/ }).click();
      await page.getByRole("button", { name: "Add step", exact: true }).click();
      await page.getByText("Added after Product manager. Connected to Writer.").waitFor();
      await select(page, "Look up support docs");
      await settled(page);
    },
  }),
  ...pair("step-5", {
    path: `/#/teams/${T.docs}?node=${N.dq}`,
    routes: canvasRoutes({
      graph: docsGraph(
        queryNode(LOOKUP, {
          last_run: {
            outcome: "answered",
            outcome_detail: null,
            run_id: "r-14",
            iteration: 1,
            started_at: "2026-09-27T09:00:00Z",
          },
        }),
      ),
      runs: RUN_14,
    }),
    steps: async (page) => {
      await select(page, "Look up support docs");
      await drawer(page).getByRole("tab", { name: "Last run" }).click();
      await drawer(page).getByText("Added to the spec · section “What the docs say”").waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("canvas-1", {
    path: `/#/teams/${T.docs}`,
    routes: canvasRoutes({ graph: docsGraph(null) }),
    steps: async (page) => {
      // Today's palette opens on hover (a click toggles it); F5's opens on a click.
      const add = page.getByRole("button", { name: "Add to canvas" });
      await add.hover();
      if (!(await page.getByRole("menu", { name: "Add to canvas" }).isVisible())) await add.click();
      await page.getByRole("menu", { name: "Add to canvas" }).waitFor();
    },
  }),
  ...pair("canvas-2", {
    path: `/#/teams/${T.docs}?node=${N.dq}`,
    routes: canvasRoutes({
      graph: docsGraph(
        queryNode({ domain_id: null, pass_to_spec: true, on_no_answer: "continue" }),
        { connected: false },
      ),
    }),
    steps: async (page) => {
      await select(page, "Query domain");
      await drawer(page).getByRole("button", { name: /^Domain / }).click();
      await drawer(page).getByRole("listbox", { name: "Domain" }).waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("canvas-3", {
    path: `/#/teams/${T.docs}?node=${N.dq}`,
    routes: canvasRoutes({
      graph: docsGraph(
        queryNode({ domain_id: null, pass_to_spec: true, on_no_answer: "continue" }),
        { connected: false },
      ),
    }),
    steps: async (page) => {
      await select(page, "Query domain");
      await drawer(page).getByRole("button", { name: /^Domain / }).click();
      await drawer(page).getByRole("option", { name: /^Support docs/ }).click();
      await drawer(page).getByLabel("If the domain has no answer").focus();
      await page.keyboard.press("Tab");
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("canvas-4", {
    path: `/#/teams/${T.docs}?node=${N.dq}`,
    routes: canvasRoutes({
      graph: docsGraph(queryNode(LOOKUP), { exit: false }),
      validity: NO_EXIT,
    }),
    steps: async (page) => {
      await page.getByText("No way out").first().waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("agent-access", {
    path: `/#/teams/${T.sprint}?node=${N.sprintPm}&tab=tools`,
    routes: canvasRoutes({
      graph: {
        team_graph_id: T.sprint,
        name: "Indicator sprint team",
        nodes: [
          agentNode(N.sprintPm, "pm", 80, "xai/grok-4.7", {
            tool_config: {
              mcpServers: {
                github: {
                  url: "https://api.githubcopilot.com/mcp/",
                  headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
                },
              },
            },
          }),
          agentNode(N.engineer, "engineer", 330, "anthropic/claude-sonnet-5"),
          agentNode(N.sprintReviewer, "reviewer", 580, "xai/grok-4.7"),
          shipNode(N.sprintShip, 830),
        ],
        edges: [
          edge(N.sprintPm, N.engineer),
          edge(N.engineer, N.sprintReviewer),
          edge(N.sprintReviewer, N.sprintShip),
        ],
      },
    }),
    steps: async (page) => {
      await select(page, "Product manager");
      // Today's Tools section is a closed <details>; F5's is the drawer's Tools tab.
      const details = drawer(page).locator("details", {
        has: page.locator("summary", { hasText: /^Tools/ }),
      });
      if ((await details.count()) && !(await details.evaluate((d) => d.open))) {
        await details.locator("summary").click();
      }
      const label = drawer(page).getByText("Support docs", { exact: true });
      await label.scrollIntoViewIfNeeded();
      await label.click();
      await page.mouse.move(0, 0);
    },
  }),
];

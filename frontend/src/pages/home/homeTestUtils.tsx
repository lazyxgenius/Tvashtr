/**
 * Test helpers for the Home sections (slice F1a): a fetch mock keyed by "METHOD /path" that records
 * every call, sample data mirroring the design, and a render of the whole Home page.
 */
import { render } from "@testing-library/react";
import { vi } from "vitest";

import type { AuthUser, TeamSummary } from "../../lib/api";
import { __resetHomeConfigForTests } from "../../lib/api/home";
import type { RunListRow } from "../../lib/api/runs";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { ToastProvider } from "../../design-system/components";
import { __resetHomeDataForTests } from "./homeData";
import { HomePage } from "./HomePage";

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

// Any JSON body, a Response, or a function of the request producing either.
type Reply = unknown;

/** Answer fetches from `routes` ("GET /api/inbox", patterns with :id allowed); record calls. */
export function mockApi(routes: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  const all: Record<string, Reply> = {
    "GET /health": { status: "ok", db: "ok" },
    "GET /api/auth/me": { id: "u1", email: "lazyx@tvashtr.dev", display_name: "Lazyx" },
    ...routes,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        "http://localhost",
      );
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      const key = `${method} ${url.pathname}`;
      let reply = all[key];
      if (reply === undefined) {
        for (const [k, v] of Object.entries(all)) {
          const [m, p] = k.split(" ");
          if (m === method && new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`).test(url.pathname)) {
            reply = v;
            break;
          }
        }
      }
      if (reply === undefined)
        return new Response(JSON.stringify({ detail: "no fixture" }), { status: 404 });
      const out =
        typeof reply === "function"
          ? await (reply as (u: URL, b: unknown) => unknown)(url, body)
          : reply;
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

export function jsonError(status: number, detail: unknown): Response {
  return new Response(JSON.stringify({ detail }), { status });
}

export function resetHomeState(): void {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  __resetHomeDataForTests();
  __resetHomeConfigForTests();
  localStorage.clear();
  delete document.documentElement.dataset.tvashtrDesktop;
  delete window.tvashtrDesktop;
}

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const ready = { ready: true, missing_providers: [] as string[], missing_nodes: [] as string[] };

export const TEAMS: TeamSummary[] = [
  {
    team_graph_id: "t-ind",
    name: "Indicator sprint team",
    created_at: ago(5000),
    node_count: 6,
    last_run: { status: "awaiting_human", at: ago(26), run_id: "r-rsi" },
    spend_usd: 4.82,
    run_count: 7,
    readiness: {
      website: { ready: false, missing_providers: ["anthropic", "xai"], missing_nodes: ["pm"] },
      desktop: { ...ready, routed_subscriptions: ["claude", "grok"] },
      subscriptions_connected: ["claude", "grok"],
    },
  },
  {
    team_graph_id: "t-docs",
    name: "Docs team",
    created_at: ago(5000),
    node_count: 3,
    last_run: { status: "running", at: ago(11), run_id: "r-docs" },
    spend_usd: 1.37,
    run_count: 3,
    readiness: {
      website: ready,
      desktop: { ...ready, routed_subscriptions: [] },
      subscriptions_connected: [],
    },
  },
  {
    team_graph_id: "t-bug",
    name: "Bugfix squad",
    created_at: ago(5000),
    node_count: 4,
    last_run: { status: "failed", at: ago(660), run_id: "r-flaky" },
    spend_usd: 0.64,
    run_count: 4,
    readiness: {
      website: { ready: false, missing_providers: ["xai"], missing_nodes: ["engineer"] },
      desktop: { ...ready, routed_subscriptions: ["grok"] },
      subscriptions_connected: ["grok"],
    },
  },
];

export function runRow(over: Partial<RunListRow>): RunListRow {
  return {
    run_id: "r",
    idea: "An idea",
    status: "running",
    created_at: ago(11),
    repo_path: null,
    status_group: "running",
    updated_at: ago(11),
    github_repo: "lazyxgenius/trade_mcp",
    base_ref: "main",
    subpath: null,
    target: { kind: "github", label: "lazyxgenius/trade_mcp", base_ref: "main", subpath: null },
    pr_url: null,
    pr_number: null,
    ship_branch: null,
    budget_cap_usd: 5,
    desktop_target: false,
    library_team_id: "t-docs",
    retry_of_run_id: null,
    team: { id: "t-docs", name: "Docs team" },
    spent_usd: 0.42,
    awaiting: null,
    failure: null,
    ...over,
  };
}

export const RSI_RUN = runRow({
  run_id: "r-rsi",
  idea: "Add an RSI indicator with tests",
  status: "awaiting_human",
  status_group: "needs_you",
  created_at: ago(26),
  library_team_id: "t-ind",
  team: { id: "t-ind", name: "Indicator sprint team" },
  spent_usd: 1.21,
  awaiting: {
    task_id: 812,
    kind: "prd_approval",
    title: "Approve the PRD",
    gate_node_id: "g",
    gate_role: "Approval",
    next_role: "Engineer",
    since: ago(26),
  },
  progress: [
    {
      node_id: "p",
      origin_node_id: null,
      role_name: "pm",
      label: "PM",
      kind: "completion",
      state: "done",
      loops_with: null,
    },
    {
      node_id: "g",
      origin_node_id: null,
      role_name: "prd_gate",
      label: "Approval",
      kind: "gate",
      state: "waiting",
      loops_with: null,
    },
    {
      node_id: "e",
      origin_node_id: null,
      role_name: "engineer",
      label: "Engineer",
      kind: "agent",
      state: "idle",
      loops_with: null,
    },
    {
      node_id: "r",
      origin_node_id: null,
      role_name: "reviewer",
      label: "Reviewer",
      kind: "agent",
      state: "idle",
      loops_with: "e",
    },
  ],
});

export const DOCS_RUN = runRow({
  run_id: "r-docs",
  idea: "Write the API reference for /runs",
});

export const INBOX_ITEMS = [
  {
    key: "gate:812",
    kind: "approval",
    since: ago(26),
    team: { id: "t-ind", name: "Indicator sprint team" },
    run: { id: "r-rsi", idea: "Add an RSI indicator with tests", status: "awaiting_human" },
    task: {
      id: 812,
      kind: "prd_approval",
      title: "Approve the PRD",
      blocking: true,
      gate_node_id: "g",
      gate_role: "Approval",
      next_role: "Engineer",
    },
    document_id: "doc-1",
  },
  {
    key: "run_failed:r-flaky",
    kind: "run_failed",
    since: ago(660),
    team: { id: "t-bug", name: "Bugfix squad" },
    run: {
      id: "r-flaky",
      idea: "Fix the flaky login test",
      status: "failed",
      ended_at: ago(660),
      target: { kind: "github", label: "lazyxgenius/trade_mcp", base_ref: "main", subpath: null },
      budget_cap_usd: 5,
      library_team_id: "t-bug",
    },
    failure: {
      code: "missing_credential",
      message: "Engineer has no xai key on the website",
      node_id: null,
      origin_node_id: null,
      node_role: "Engineer",
      provider: "xai",
      target: "website",
    },
  },
  {
    key: "setup:t-ind:website",
    kind: "setup_gap",
    since: ago(3000),
    team: { id: "t-ind", name: "Indicator sprint team" },
    target: "website",
    missing_providers: ["anthropic", "xai"],
    missing_nodes: ["PM"],
    desktop_covers: ["claude", "grok"],
  },
  {
    key: "memories",
    kind: "memories",
    since: ago(4000),
    count: 2,
    learned_by: ["Reviewer"],
    repos: ["lazyxgenius/trade_mcp"],
  },
];

export const SPEND = {
  tz: "UTC",
  month: { label: "September", start: ago(30000), total_usd: 15.93 },
  week: { start: ago(4000), total_usd: 6.19 },
  by_team: [
    { team_id: "t-full", name: "Full feature squad", total_usd: 9.1 },
    { team_id: "t-ind", name: "Indicator sprint team", total_usd: 4.82 },
  ],
  other_usd: 0,
  default_run_budget_usd: 5,
};

/** The routes a normal Home load needs. */
export function homeRoutes(over: Record<string, Reply> = {}): Record<string, Reply> {
  return {
    "GET /api/teams": { teams: TEAMS },
    "GET /api/config": {
      hosted_mode: true,
      github_install_url: "https://github.com/apps/tvashtr/installations/new",
      github_manage_url: "https://github.com/apps/tvashtr/installations/new",
      provider_catalogue: [],
      provider_directory: [
        {
          provider: "anthropic",
          monogram: "A",
          name: "Anthropic",
          label: "Claude models",
          example_model: "anthropic/claude-sonnet-5",
          subscription: "claude",
          embeddings: false,
          hint: null,
        },
        {
          provider: "xai",
          monogram: "X",
          name: "xAI",
          label: "Grok models",
          example_model: "xai/grok-4.7",
          subscription: "grok",
          embeddings: false,
          hint: null,
        },
      ],
      default_run_budget_usd: 5,
    },
    "GET /api/inbox": { count: INBOX_ITEMS.length, items: INBOX_ITEMS },
    "GET /api/runs": (url: URL) =>
      url.searchParams.get("status") === "active"
        ? { runs: [RSI_RUN, DOCS_RUN], next_cursor: null }
        : { runs: [RSI_RUN, DOCS_RUN], next_cursor: null },
    "GET /api/spend": SPEND,
    "GET /api/github/repos": {
      repos: [
        {
          name: "trade_mcp",
          full_name: "lazyxgenius/trade_mcp",
          private: false,
          default_branch: "main",
          html_url: "",
        },
      ],
      installation_count: 1,
    },
    "GET /api/github/repos/:o/:r/branches": {
      default_branch: "main",
      branches: ["main", "dev"],
      truncated: false,
    },
    "GET /api/github/repos/:o/:r/subpaths": {
      ref: "main",
      subpaths: [{ path: "web", file_count: 3 }],
      truncated: false,
    },
    ...over,
  };
}

export const USER: AuthUser = { id: "u1", email: "lazyx@tvashtr.dev", display_name: "Lazyx" };

export function renderHome() {
  return render(
    <ToastProvider>
      <HomePage user={USER} />
    </ToastProvider>,
  );
}

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// Focus-Runs (FOCUS-62..70): the rounds rail and earlier runs beside the picked round's verdict,
// what it was given and produced, and its cost.

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const round = (iteration: number, min: number, over: Record<string, unknown> = {}) => ({
  invocation_id: 800 + iteration,
  iteration,
  status: "done",
  outcome: "changes_requested",
  outcome_detail: `Round ${iteration}: the \`INDICATORS\` list is unchanged.`,
  started_at: ago(min + 2),
  ended_at: ago(min),
  cost: null,
  model_used: "xai/grok-4.7",
  runs_on: { via: "api_key", provider: "xai" },
  given: null,
  produced: null,
  ...over,
});
const ROUND_3 = round(3, 31, {
  started_at: new Date(Date.parse(ago(31)) - 134_000).toISOString(),
  cost: { prompt_tokens: 18_200, completion_tokens: 1_100, total_tokens: 19_300, cost_usd: 0 },
  runs_on: { via: "subscription", provider: "grok" },
  given: {
    documents: [
      { document_id: "d1", name: "spec", version_no: 3, is_shared_spec: true },
      { document_id: "d2", name: "build-notes", version_no: 2, is_shared_spec: false },
    ],
    memory: [
      { id: "m1", polarity: "prefer" },
      { id: "m2", polarity: "require" },
    ],
    skills: [
      { type: "inline", name: "house-style", mode: "always" },
      { type: "repo", name: "pytest-review", mode: null },
    ],
  },
  produced: {
    verdict: {
      file: "REVIEW_VERDICT.json",
      verdict: "changes_requested",
      reasons: "No new indicator was added: the list is unchanged.",
    },
    documents: [],
    files: ["REVIEW_VERDICT.json"],
  },
  connectors: {
    used: [{ connection_id: "c1", name: "Supabase", slug: "supabase", reads: 2, writes: 0 }],
    calls: [
      {
        connection_id: "c1",
        name: "Supabase",
        tool: "execute_sql",
        write: false,
        ok: true,
        blocked: false,
        forwarded: true,
        arg: "SELECT count(*) FROM indicator_values",
        at: "2026-09-30T10:04:00+00:00",
        duration_ms: 312,
        result_url: null,
      },
    ],
    total_calls: 2,
    skipped: [{ connection_id: "c4", name: "Sentry", reason: "its sign-in expired" }],
  },
});
const HISTORY = {
  runs: [
    { run_id: "r1", idea: "Add an RSI indicator", rounds_count: 3, last_round_at: ago(31) },
    {
      run_id: "r0",
      idea: "Fix the MACD label",
      rounds_count: 1,
      last_outcome: "approved",
      last_status: "done",
      last_round_at: "2026-09-22T10:00:00Z",
    },
  ],
  run: {
    run_id: "r1",
    idea: "Add an RSI indicator",
    rounds: [ROUND_3, round(2, 44), round(1, 58)],
  },
};
const EARLIER = {
  runs: HISTORY.runs,
  run: {
    run_id: "r0",
    idea: "Fix the MACD label",
    rounds: [
      round(1, 5000, {
        outcome: "approved",
        outcome_detail: "Looks right.",
        cost: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000, cost_usd: 0.012 },
      }),
    ],
  },
};
const ran: TeamGraphNode["last_run"] = {
  run_id: "r1",
  iteration: 3,
  outcome: "changes_requested",
  outcome_detail: null,
  started_at: ago(33),
};

let history: unknown = HISTORY;
beforeEach(() => {
  history = HISTORY;
  setProviderCatalogue(CATALOGUE);
  stubFetch(
    () => reviewer(),
    (url) => {
      if (url === "/api/teams/t1/nodes/n-rev/runs?run_id=r0") return json(EARLIER);
      if (url.startsWith("/api/teams/t1/nodes/n-rev/runs")) return json(history);
      return undefined;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderRuns(
  onOpenRun = vi.fn(),
  lastRun: TeamGraphNode["last_run"] = ran,
  onOpenToolkit?: NodeEditorProps["onOpenToolkit"],
) {
  const saved = reviewer({ last_run: lastRun });
  render(
    <NodeEditor
      teamId="t1"
      node={saved}
      nodes={[pm, engineer, saved, ship]}
      edges={edges}
      isEntry={false}
      cover={{ byok: new Set(["xai"]), subs: {} }}
      tab="runs"
      onTabChange={vi.fn()}
      focus
      onFocusChange={vi.fn()}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={onOpenRun}
      onOpenToolkit={onOpenToolkit}
    />,
  );
  return within(screen.getByRole("dialog", { name: "Reviewer in focus view" }));
}

describe("Focus view › Runs", () => {
  it("shows the newest round in full: verdict, what it was given and produced, its cost", async () => {
    const onOpenRun = vi.fn();
    const view = renderRuns(onOpenRun);
    const rail = within(await view.findByRole("complementary", { name: "Rounds" }));
    expect(rail.getByText("Run “Add an RSI indicator”")).toBeInTheDocument();
    expect(rail.getByRole("button", { name: /^Round 3/ })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByText("Round 3 · 31m ago")).toBeInTheDocument();

    const verdict = within(view.getByRole("region", { name: "Verdict" }));
    expect(verdict.getByText("INDICATORS", { selector: "code" })).toBeInTheDocument();
    const given = within(view.getByRole("region", { name: "What it was given" }));
    expect(given.getByText("Shared spec")).toHaveTextContent("Shared spec v3");
    expect(given.getByText("build-notes")).toHaveTextContent("build-notes v2");
    expect(given.getByText("2 memory notes")).toHaveTextContent("2 memory notes MUST · SHOULD");
    expect(given.getByText("house-style")).toHaveTextContent("house-style always on");
    expect(given.queryByText(/pytest-review/)).toBeNull();
    const produced = within(view.getByRole("region", { name: "What it produced" }));
    expect(produced.getByText(/REVIEW_VERDICT\.json/).textContent).toBe(
      'REVIEW_VERDICT.json\n{\n  "verdict": "changes_requested",\n  "reasons": "No new indicator was added…"\n}',
    );
    const cost = within(view.getByRole("region", { name: "Cost" }));
    for (const part of ["18.2k tokens in", "1.1k out", "$0.00 · Grok subscription", "2m 14s"])
      expect(cost.getByText(part)).toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Open this run on the canvas" }));
    expect(onOpenRun).toHaveBeenCalledWith("r1");
  });

  it("says what the round called through connectors and what it ran without (CnF-Run-1, CnF-Expired-2)", async () => {
    const onOpenToolkit = vi.fn();
    const view = renderRuns(vi.fn(), ran, onOpenToolkit);
    const card = within(await view.findByRole("region", { name: "Connectors" }));
    expect(card.getByRole("note")).toHaveTextContent("Ran without Sentry: its sign-in expired.");
    expect(card.getByRole("group", { name: "Connectors used this round" })).toHaveTextContent(
      "Supabase · 2 reads",
    );
    expect(within(card.getByRole("list", { name: "Calls" })).getByText("execute_sql")).toBeTruthy();
    // "Sign in" leaves through the page, which asks about an unsaved draft first.
    expect(fireEvent.click(card.getByRole("link", { name: "Sign in" }))).toBe(false);
    expect(onOpenToolkit).toHaveBeenLastCalledWith({ page: "connector", connectorId: "c4" });

    // A round that used none has no Connectors card.
    const rail = within(view.getByRole("complementary", { name: "Rounds" }));
    fireEvent.click(rail.getByRole("button", { name: /^Round 2/ }));
    expect(view.getByText("Round 2 · 44m ago")).toBeInTheDocument();
    expect(view.queryByRole("region", { name: "Connectors" })).toBeNull();
  });

  it("picks an older round, then an earlier run (its rounds replace the rail's)", async () => {
    const onOpenRun = vi.fn();
    const view = renderRuns(onOpenRun);
    const rail = within(await view.findByRole("complementary", { name: "Rounds" }));
    fireEvent.click(rail.getByRole("button", { name: /^Round 2/ }));
    expect(view.getByText("Round 2 · 44m ago")).toBeInTheDocument();
    expect(view.getByRole("region", { name: "What it produced" })).toHaveTextContent(
      "Nothing recorded for this round.",
    );
    expect(
      within(view.getByRole("region", { name: "Cost" })).getByText("xAI API key"),
    ).toBeVisible();

    expect(rail.getByText("Earlier runs")).toBeInTheDocument();
    fireEvent.click(rail.getByRole("button", { name: /^Round —\s*Approved/ }));
    expect(await rail.findByText("Run “Fix the MACD label”")).toBeInTheDocument();
    expect(rail.getByText("Other runs")).toBeInTheDocument();
    expect(view.getByText("$0.01 · xAI API key")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Open this run on the canvas" }));
    expect(onOpenRun).toHaveBeenCalledWith("r0");
  });

  it("an agent that never ran says so", async () => {
    history = { runs: [], run: null };
    const view = renderRuns(vi.fn(), null);
    expect(await view.findByText("This agent hasn’t run yet")).toBeInTheDocument();
  });
});

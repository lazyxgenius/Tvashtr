import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The Runs tab (Web-Runs, Flow-Runs-1/2, Panel-RunsEmpty).

const SUPABASE_CALL = {
  connection_id: "c1",
  name: "Supabase",
  tool: "execute_sql",
  write: false,
  ok: true,
  blocked: false,
  arg: "SELECT count(*) FROM indicator_values",
  at: "2026-09-30T10:04:00+00:00",
  duration_ms: 312,
  result_url: null,
};
// Round 3 read Supabase and ran without Sentry; round 2 wrote to Linear; round 1 used nothing.
const CONNECTORS: Record<number, unknown> = {
  3: {
    used: [{ connection_id: "c1", name: "Supabase", slug: "supabase", reads: 3, writes: 0 }],
    calls: [SUPABASE_CALL],
    total_calls: 3,
    skipped: [{ connection_id: "c4", name: "Sentry", reason: "its sign-in expired" }],
  },
  2: {
    used: [{ connection_id: "c3", name: "Linear", slug: "linear", reads: 0, writes: 1 }],
    calls: [
      { ...SUPABASE_CALL, connection_id: "c3", name: "Linear", tool: "create_issue", write: true },
    ],
    total_calls: 1,
    skipped: [],
  },
};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const round = (iteration: number, min: number, detail: string) => ({
  invocation_id: 800 + iteration,
  iteration,
  status: "done",
  outcome: "changes_requested",
  outcome_detail: detail,
  started_at: ago(min + 2),
  ended_at: ago(min),
  cost: { prompt_tokens: 16000, completion_tokens: 900, total_tokens: 16900, cost_usd: 0 },
  connectors: CONNECTORS[iteration] ?? null,
});
const LONG = `No new indicator was added: \`INDICATORS\` ${"still lists the same names ".repeat(20)}`;
const HISTORY = {
  runs: [{ run_id: "r1", idea: "Add RSI", rounds_count: 3, last_round_at: ago(31) }],
  run: {
    run_id: "r1",
    idea: "Add RSI",
    rounds: [
      round(3, 31, LONG),
      round(2, 44, "The tests ran, but the new function is not registered."),
      round(1, 58, "Nothing yet."),
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

let fetchMock: ReturnType<typeof vi.fn>;
let fail = false;
beforeEach(() => {
  setProviderCatalogue(CATALOGUE);
  fail = false;
  fetchMock = stubFetch(
    () => reviewer(),
    (url) =>
      url.startsWith("/api/teams/t1/nodes/n-rev/runs")
        ? fail
          ? json({ detail: "boom" }, 500)
          : json(HISTORY)
        : undefined,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetNodeTemplates();
  setProviderCatalogue([]);
  __resetBackendStatusForTests();
});

function renderRuns(saved: TeamGraphNode, over: Partial<NodeEditorProps> = {}) {
  const props: NodeEditorProps = {
    teamId: "t1",
    node: saved,
    nodes: [pm, engineer, saved, ship],
    edges,
    isEntry: false,
    cover: { byok: new Set(["xai"]), subs: {} },
    tab: "runs",
    onTabChange: vi.fn(),
    focus: false,
    onFocusChange: vi.fn(),
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  render(<NodeEditor {...props} />);
  return props;
}

describe("Runs tab", () => {
  it("shows the last round with code spans, cut with Show all", async () => {
    renderRuns(reviewer({ last_run: ran }));
    const card = within(await screen.findByRole("region", { name: "Last run" }));
    expect(card.getByText("Changes requested")).toBeInTheDocument();
    expect(card.getByText(/Round 3 · 31m ago/)).toBeInTheDocument();
    expect(card.getByText("INDICATORS").tagName).toBe("CODE");
    fireEvent.click(card.getByRole("button", { name: "Show all" }));
    expect(card.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("an earlier round expands in place to its detail, tokens, cost and time", async () => {
    const props = renderRuns(reviewer({ last_run: ran }));
    const toggle = await screen.findByRole("button", { name: /^Round 2/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const item = within(toggle.closest("li") as HTMLElement);
    expect(item.getByText("The tests ran, but the new function is not registered.")).toBeVisible();
    expect(item.getByText("16.9k tokens")).toBeInTheDocument();
    expect(item.getByText("$0.00")).toBeInTheDocument();
    expect(item.getByText("44m ago")).toBeInTheDocument();
    fireEvent.click(item.getByRole("button", { name: "Open in focus view" }));
    expect(props.onFocusChange).toHaveBeenCalledWith(true);
  });

  it("the last round says what it ran without inside the card, then what it called (CnF-Expired-2)", async () => {
    renderRuns(reviewer({ last_run: ran }));
    const card = await screen.findByRole("region", { name: "Last run" });
    const skipped = within(card).getByRole("note");
    expect(skipped).toHaveTextContent("Ran without Sentry: its sign-in expired.");
    expect(within(skipped).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors/c4",
    );
    // The chips and the calls come after the card, before the earlier rounds.
    const used = screen.getByRole("group", { name: "Connectors used this round" });
    expect(card.contains(used)).toBe(false);
    expect(used).toHaveTextContent("Supabase · 3 reads");
    const calls = screen.getByRole("list", { name: "Calls" });
    expect(within(calls).getByText("execute_sql")).toBeInTheDocument();
    const following = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(following(card, used)).toBe(true);
    expect(following(calls, screen.getByText("Earlier rounds"))).toBe(true);
  });

  it("an earlier round shows its own connectors when opened, and a round without any shows none", async () => {
    renderRuns(reviewer({ last_run: ran }));
    const two = await screen.findByRole("button", { name: /^Round 2/ });
    expect(screen.queryByText("Linear · 1 write")).toBeNull();
    fireEvent.click(two);
    const item = within(two.closest("li") as HTMLElement);
    expect(item.getByText("Linear · 1 write")).toBeInTheDocument();
    expect(item.getByText("create_issue")).toBeInTheDocument();
    expect(item.getByText("Write")).toBeInTheDocument();
    const one = screen.getByRole("button", { name: /^Round 1/ });
    fireEvent.click(one);
    const first = within(one.closest("li") as HTMLElement);
    expect(first.queryByText("Calls")).toBeNull();
    expect(first.queryByRole("note")).toBeNull();
  });

  it("an agent that never ran says so without asking the server", () => {
    renderRuns(reviewer({ last_run: null }));
    expect(screen.getByText("This agent hasn’t run yet")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/runs"))).toBe(false);
  });

  it("a failed load offers Retry", async () => {
    fail = true;
    renderRuns(reviewer({ last_run: ran }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load this agent’s runs.");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("region", { name: "Last run" })).toBeInTheDocument();
  });
});

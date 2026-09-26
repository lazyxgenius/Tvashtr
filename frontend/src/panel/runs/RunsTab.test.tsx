import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setProviderCatalogue, type TeamGraphNode } from "../../lib/api";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { CATALOGUE, edges, engineer, json, pm, reviewer, ship, stubFetch } from "../editorTestKit";
import { NodeEditor, type NodeEditorProps } from "../NodeEditor";
import { resetNodeTemplates } from "../setup/useNodeTemplates";

// The Runs tab (Web-Runs, Flow-Runs-1/2, Panel-RunsEmpty).

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

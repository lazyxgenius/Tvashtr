import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphNode, NodeInvocation, RunRow } from "../../lib/api";
import { RunNodeDrawer } from "./RunNodeDrawer";

// M7 (Test-FromRun) in the run view: each round's ⋯ — Make this a test (the team's agent, its New
// test dialog on that round) and Copy the answer. The five tabs stay five.

const inv = (iteration: number, over: Partial<NodeInvocation> = {}): NodeInvocation => ({
  invocation_id: 810 + iteration,
  iteration,
  status: "done",
  outcome: "changes_requested",
  outcome_detail: `Round ${iteration}: register rsi.`,
  started_at: "2026-01-01T00:00:00Z",
  ended_at: "2026-01-01T00:01:00Z",
  context_manifest: null,
  cost: null,
  ...over,
});
const node = (invocations: NodeInvocation[]): GraphNode => ({
  id: "c-rev",
  role_name: "reviewer",
  kind: "agent",
  model: "xai/grok-4.7",
  engine: "openhands",
  prompt: null,
  position: { x: 0, y: 0 },
  config: { title: "Reviewer" },
  status: "done",
  iteration: 2,
  invocations,
});
const run: RunRow = {
  id: "r1",
  team_graph_id: "g1",
  idea: "x",
  status: "completed",
  pm_document_id: null,
  ship_commit_sha: null,
  ship_tag: null,
  cost_total_usd: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ run_id: "r1", events: [] })))),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(invocations: NodeInvocation[], onMakeTest?: (id: number) => void) {
  render(
    <RunNodeDrawer
      node={node(invocations)}
      nodes={[]}
      edges={[]}
      runId={null}
      run={run}
      workflowStatus={null}
      tab="runs"
      onTabChange={vi.fn()}
      onClose={vi.fn()}
      onMakeTest={onMakeTest}
    />,
  );
  return screen.getByRole("complementary", { name: "Reviewer in this run" });
}

describe("RunNodeDrawer — M7 round ⋯", () => {
  it("five tabs still; Make this a test hands the round's invocation to the team's agent", () => {
    const onMakeTest = vi.fn();
    const d = renderDrawer([inv(1), inv(2)], onMakeTest);
    expect(
      within(d)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Setup", "Skills & tools", "Memory", "Runs", "Docs"]);
    fireEvent.click(within(d).getByRole("button", { name: "More for round 1" }));
    const menu = within(d).getByRole("menu", { name: "More for round 1" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Make this a testnew", "Copy the answer"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Make this a test/ }));
    expect(onMakeTest).toHaveBeenCalledWith(811);
  });

  it("Copy the answer copies and says so in the drawer", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const d = renderDrawer([inv(1)]);
    fireEvent.click(within(d).getByRole("button", { name: "More for round 1" }));
    // No team agent to test (it left the team): only Copy.
    expect(within(d).queryByRole("menuitem", { name: /Make this a test/ })).toBeNull();
    fireEvent.click(within(d).getByRole("menuitem", { name: "Copy the answer" }));
    await waitFor(() =>
      expect(d.querySelector(".nd-toast-host")).toHaveTextContent("Answer copied"),
    );
    expect(writeText).toHaveBeenCalledWith("Round 1: register rsi.");
  });

  it("a round with nothing to offer has no ⋯", () => {
    const d = renderDrawer([inv(1, { invocation_id: undefined, outcome_detail: null })], vi.fn());
    expect(within(d).queryByRole("button", { name: "More for round 1" })).toBeNull();
  });
});

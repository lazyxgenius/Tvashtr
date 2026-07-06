import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphNode, NodeInvocation, RunRow } from "../lib/api";
import { SidePanel } from "./SidePanel";

// Option A: the run-view panel is keyed on the node's KIND (not a hardcoded role) and surfaces a
// uniform "Last run" brief (the per-node `outcome_detail`) for ANY agent/thinker node — incl. a
// topology-authored CUSTOM node. The Reviewer's §14.1 per-round verdict history must stay identical.

const EMPTY_SPEC_HINT = "No spec yet. Start a run and the product manager drafts the first one.";

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "test-model",
    engine: "openhands",
    prompt: null,
    position: { x: 0, y: 0 },
    config: null,
    status: "done",
    iteration: 1,
    invocations: [],
    ...over,
  };
}

function inv(over: Partial<NodeInvocation> & Pick<NodeInvocation, "iteration">): NodeInvocation {
  return {
    status: "done",
    outcome: null,
    outcome_detail: null,
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
    context_manifest: null,
    cost: null,
    ...over,
  };
}

describe("SidePanel — generalized 'Last run' brief by node kind (Option A)", () => {
  it("renders a CUSTOM thinker's brief + the PRD body (NOT an empty event feed)", () => {
    const node = gnode({
      id: "n-arch",
      role_name: "architect", // a topology-authored custom role — no hardcoded TITLES entry
      kind: "completion",
      invocations: [
        inv({
          iteration: 2,
          outcome: "prd_written",
          outcome_detail: "Refined the spec (version 2).",
        }),
      ],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    // the custom role is title-cased into the header
    expect(screen.getByText("Architect")).toBeInTheDocument();
    // its per-node work-brief renders (this is the bug fix — a custom node showed a raw feed before)
    expect(screen.getByText("Refined the spec (version 2).")).toBeInTheDocument();
    // the kind-specific body is the PRD view (its empty hint), NOT the event feed
    expect(screen.getByText(EMPTY_SPEC_HINT)).toBeInTheDocument();
    expect(container.querySelector(".tv-feed__note")).toBeNull();
  });

  it("renders an Engineer worker's files-changed brief + the event feed (NOT the PRD)", () => {
    const brief = "Built the feature — changed 2 file(s): greeting.txt, main.py";
    const node = gnode({
      id: "n-eng",
      role_name: "engineer",
      kind: "agent",
      invocations: [inv({ iteration: 1, outcome: "built", outcome_detail: brief })],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText(brief)).toBeInTheDocument();
    // the kind-specific body is the event feed, NOT the PRD empty hint
    expect(container.querySelector(".tv-feed__note")).not.toBeNull();
    expect(screen.queryByText(EMPTY_SPEC_HINT)).toBeNull();
  });

  it("renders the Reviewer per-round verdicts identical to the §14.1 view", () => {
    const reason = "Missing the overdue-check pure function.";
    const node = gnode({
      id: "n-rev",
      role_name: "reviewer",
      kind: "agent",
      invocations: [
        inv({ iteration: 1, outcome: "changes_requested", outcome_detail: reason }),
        inv({ iteration: 2, outcome: "approved", outcome_detail: null }),
      ],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    const round1 = screen.getByText("Round 1");
    const round2 = screen.getByText("Round 2");
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(round1.compareDocumentPosition(round2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the reasons render once, UNDER the changes_requested round only (NOT the approved one)
    expect(screen.getAllByText(reason)).toHaveLength(1);
    const changesLi = screen.getByText("Changes requested").closest("li");
    const approvedLi = screen.getByText("Approved").closest("li");
    expect(within(changesLi as HTMLElement).getByText(reason)).toBeInTheDocument();
    expect((approvedLi as HTMLElement).querySelector(".tv-verdict__reasons")).toBeNull();
    // the §14.1 verdict tones still drive the styling (sage = approved, coral = changes)
    expect(container.querySelector(".tv-verdict--changes")).not.toBeNull();
    expect(container.querySelector(".tv-verdict--approved")).not.toBeNull();
  });
});

// ---- F1c Decision 2: the run-view subtitle is STATUS-based (from the SAME derived status the node
// card uses), reading what the node is doing right now — not a role blurb. ----

function runRow(over: Partial<RunRow> = {}): RunRow {
  return {
    id: "r1",
    team_graph_id: "g1",
    idea: "x",
    status: "running",
    pm_document_id: null,
    ship_commit_sha: null,
    ship_tag: null,
    cost_total_usd: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("SidePanel — F1c status-based subtitle (Decision 2)", () => {
  it("maps the node's live run status → the subtitle (Working now / Finished / Not reached yet)", () => {
    // A running node in an in-flight run → "Working now". runId=null keeps the EventFeed body inert
    // (no network) — the subtitle is a pure function of node.status + run + workflowStatus.
    const running = gnode({ id: "n-eng", role_name: "engineer", kind: "agent", status: "running" });
    const { rerender } = render(
      <SidePanel
        node={running}
        runId={null}
        run={runRow({ status: "running" })}
        workflowStatus="PENDING"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Working now")).toBeInTheDocument();

    // A completed node → "Finished" (done is sticky, independent of the run).
    rerender(
      <SidePanel
        node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent", status: "done" })}
        runId={null}
        run={null}
        workflowStatus={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Finished")).toBeInTheDocument();

    // An idle / never-reached node → "Not reached yet" (it did not fail — it was simply not reached).
    rerender(
      <SidePanel
        node={gnode({ id: "n-eng", role_name: "engineer", kind: "agent", status: "idle" })}
        runId={null}
        run={null}
        workflowStatus={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Not reached yet")).toBeInTheDocument();
  });
});

// ---- M-ledger C6: the run-view panel surfaces each worker round's cost + context-manifest (via the
// generalized "Last run" brief), and passes the selected node into EventFeed so the feed scopes to
// it. Re-pointed (not gutted) — the Option A / Decision-2 tests above stand. ----
describe("SidePanel — C6 per-round ledger + node-scoped feed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("surfaces a worker round's per-round cost + context-manifest in the 'Last run' brief", () => {
    const node = gnode({
      id: "n-eng",
      role_name: "engineer",
      kind: "agent",
      invocations: [
        inv({
          iteration: 1,
          outcome: "built",
          outcome_detail: "Built it.",
          cost: {
            prompt_tokens: 1240,
            completion_tokens: 320,
            total_tokens: 1560,
            cost_usd: 0.0041,
          },
          context_manifest: {
            parts: [
              { name: "system", tokens: 900 },
              { name: "spec", tokens: 2100 },
            ],
            total_tokens: 3000,
            budget: 8000,
            handle_used: true,
          },
        }),
      ],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    expect(screen.getByText("1,240 in / 320 out · $0.0041")).toBeInTheDocument();
    expect(container.querySelector(".tv-manifest")).not.toBeNull();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Spec offloaded to SPEC.md")).toBeInTheDocument();
  });

  it("passes the selected node into EventFeed → the feed scopes to that node's events only", async () => {
    const events = [
      {
        seq: 1,
        kind: "action",
        payload: { thought: "engineer step one" },
        created_at: "2026-01-01T00:00:00Z",
        invocation_id: 10,
        node_id: "n-eng",
        iteration: 1,
      },
      {
        seq: 1,
        kind: "action",
        payload: { thought: "OTHER node step" },
        created_at: "2026-01-01T00:00:00Z",
        invocation_id: 20,
        node_id: "n-other",
        iteration: 1,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ run_id: "r1", events }),
        } as unknown as Response),
      ),
    );
    const node = gnode({ id: "n-eng", role_name: "engineer", kind: "agent", status: "done" });
    render(
      <SidePanel
        node={node}
        runId="r1"
        run={runRow({ status: "completed" })}
        workflowStatus={null}
        onClose={() => {}}
      />,
    );
    // the selected node's step renders under a Round header; the OTHER node's step never does
    expect(await screen.findByText("engineer step one")).toBeInTheDocument();
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.queryByText("OTHER node step")).toBeNull();
  });
});

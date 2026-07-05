import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphNode, RunEvent, RunRow } from "../lib/api";
import { EventFeed } from "./EventFeed";

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id">): GraphNode {
  return {
    role_name: "engineer",
    kind: "agent",
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

function ev(
  over: Partial<RunEvent> & Pick<RunEvent, "seq" | "invocation_id" | "node_id" | "iteration">,
): RunEvent {
  return {
    kind: "action",
    payload: {},
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function runRow(over: Partial<RunRow> = {}): RunRow {
  return {
    id: "r1",
    team_graph_id: "g1",
    idea: "x",
    status: "completed", // terminal ⇒ EventFeed fetches once, no 2s poll interval in the test
    pm_document_id: null,
    ship_commit_sha: null,
    ship_tag: null,
    cost_total_usd: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function stubEvents(events: RunEvent[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ run_id: "r1", events }),
        } as unknown as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Two invocations of the SELECTED node — seq REPEATS across rounds (1,2 then 1,2), the exact case
// where the old `key={seq}` stops being unique — plus an event for a DIFFERENT node that must not
// leak into this node's feed.
const events: RunEvent[] = [
  ev({ seq: 1, invocation_id: 10, node_id: "n-eng", iteration: 1, payload: { thought: "r1 step alpha" } }),
  ev({ seq: 2, invocation_id: 10, node_id: "n-eng", iteration: 1, payload: { thought: "r1 step beta" } }),
  ev({ seq: 1, invocation_id: 11, node_id: "n-eng", iteration: 2, payload: { thought: "r2 step gamma" } }),
  ev({ seq: 2, invocation_id: 11, node_id: "n-eng", iteration: 2, payload: { thought: "r2 step delta" } }),
  ev({ seq: 3, invocation_id: 99, node_id: "n-other", iteration: 1, payload: { thought: "OTHER node step" } }),
];

describe("EventFeed (M-ledger C6) — node-scoped, round-grouped, uniquely keyed", () => {
  it("shows ONLY the selected node's events, grouped under ordered Round headers", async () => {
    stubEvents(events);
    const { container } = render(
      <EventFeed node={gnode({ id: "n-eng" })} runId="r1" run={runRow()} workflowStatus={null} />,
    );

    // all four of the selected node's steps render (across two rounds), each as a distinct row —
    // proof no row was dropped/merged by a key collision on the repeated seq values.
    expect(await screen.findByText("r1 step alpha")).toBeInTheDocument();
    expect(screen.getByText("r1 step beta")).toBeInTheDocument();
    expect(screen.getByText("r2 step gamma")).toBeInTheDocument();
    expect(screen.getByText("r2 step delta")).toBeInTheDocument();
    expect(container.querySelectorAll(".tv-feed__row")).toHaveLength(4);

    // the DIFFERENT node's event is scoped out
    expect(screen.queryByText("OTHER node step")).toBeNull();

    // grouped under "Round 1" / "Round 2" headers, ascending
    const r1 = screen.getByText("Round 1");
    const r2 = screen.getByText("Round 2");
    expect(r1.compareDocumentPosition(r2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keys rows uniquely across rounds — no React duplicate-key warning despite repeated seq", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubEvents(events);
    render(<EventFeed node={gnode({ id: "n-eng" })} runId="r1" run={runRow()} workflowStatus={null} />);
    await screen.findByText("r2 step delta");
    const dupKeyWarned = errSpy.mock.calls.some((c) => String(c[0]).includes("same key"));
    expect(dupKeyWarned).toBe(false);
  });

  it("shows the empty-activity note when the selected node has no events (though the run has some)", async () => {
    stubEvents(events); // events belong to n-eng / n-other only
    render(<EventFeed node={gnode({ id: "n-nobody" })} runId="r1" run={runRow()} workflowStatus={null} />);
    expect(await screen.findByText(/No activity yet/)).toBeInTheDocument();
  });
});

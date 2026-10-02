import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActivityAgent } from "../../../lib/api/activity";
import type { GraphData } from "../../../lib/api";
import { NowBar } from "./NowBar";

const NOW = Date.parse("2026-10-02T10:45:24Z");
const at = (s: number) => new Date(NOW - s * 1000).toISOString();

const agent = (over: Partial<ActivityAgent>): ActivityAgent => ({
  node_id: "n",
  origin_node_id: null,
  label: "Agent",
  kind: "agent",
  iteration: 1,
  rounds_limit: null,
  live_state: "waiting",
  activity: null,
  last_event_at: null,
  activity_started_at: null,
  retry: null,
  backup_model: null,
  model: null,
  ...over,
});

const AGENTS: ActivityAgent[] = [
  agent({
    node_id: "n-pm",
    label: "Product manager",
    kind: "completion",
    live_state: "done",
    activity: "Wrote the spec (v2)",
    last_event_at: at(180),
  }),
  agent({
    node_id: "n-prd",
    label: "Approval gate",
    kind: "gate",
    live_state: "done",
    activity: "You approved",
    last_event_at: at(120),
  }),
  agent({
    node_id: "n-eng",
    label: "Engineer",
    live_state: "running_command",
    activity: "Running tests · tests/test_indicators.py",
    last_event_at: at(4),
  }),
  agent({ node_id: "n-rev", label: "Reviewer", live_state: "waiting" }),
  // The server names an ending by its kind: "stop" / "ship".
  agent({ node_id: "n-stop", label: "Stop", kind: "stop", live_state: "waiting" }),
  agent({ node_id: "n-ship", label: "Ship", kind: "ship", live_state: "waiting" }),
];

const GRAPH = {
  nodes: [
    { id: "n-pm", kind: "completion", config: {} },
    { id: "n-prd", kind: "gate", config: { gate_kind: "prd_approval" } },
    { id: "n-eng", kind: "agent", config: {} },
    { id: "n-rev", kind: "agent", config: {} },
    { id: "n-stop", kind: "terminal", config: { terminal_kind: "stop" } },
    { id: "n-ship", kind: "terminal", config: { terminal_kind: "ship" } },
  ],
  edges: [
    {
      id: "e1",
      source_node_id: "n-pm",
      target_node_id: "n-prd",
      edge_type: "default",
      conditions: null,
    },
    {
      id: "e2",
      source_node_id: "n-prd",
      target_node_id: "n-eng",
      edge_type: "default",
      conditions: null,
    },
    {
      id: "e3",
      source_node_id: "n-eng",
      target_node_id: "n-rev",
      edge_type: "default",
      conditions: null,
    },
    {
      id: "e4",
      source_node_id: "n-rev",
      target_node_id: "n-ship",
      edge_type: "default",
      conditions: null,
    },
  ],
} as unknown as GraphData;

describe("NowBar", () => {
  it("shows one chip per agent with its state, current activity and how long ago", () => {
    render(<NowBar agents={AGENTS} graph={GRAPH} now={NOW} onSelect={() => {}} />);
    const bar = screen.getByRole("region", { name: "Now" });
    const eng = within(bar).getByRole("button", { name: /^Engineer/ });
    expect(eng).toHaveTextContent("Running a command");
    expect(eng).toHaveTextContent("Running tests · tests/test_indicators.py");
    expect(eng).toHaveTextContent("4 s ago");
    expect(within(bar).getByRole("button", { name: /^Product manager/ })).toHaveTextContent(
      "DoneWrote the spec (v2)3m ago",
    );
  });

  it("says what a waiting agent waits for, and Ship is 'Not yet'", () => {
    render(<NowBar agents={AGENTS} graph={GRAPH} now={NOW} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /^Reviewer/ })).toHaveTextContent(
      "WaitingStarts after the Engineer",
    );
    expect(screen.getByRole("button", { name: /^Ship/ })).toHaveTextContent("Not yet");
  });

  it("leaves out the Stop ending", () => {
    render(<NowBar agents={AGENTS} graph={GRAPH} now={NOW} onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Stop/ })).toBeNull();
  });

  it("selects an agent when its chip is clicked", () => {
    const onSelect = vi.fn();
    render(<NowBar agents={AGENTS} graph={GRAPH} now={NOW} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /^Engineer/ }));
    expect(onSelect).toHaveBeenCalledWith("n-eng");
  });

  it("a decided gate says when, in local time; an open one doesn't", () => {
    const d = new Date(at(120));
    const hhmm = [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, "0")).join(":");
    const open = agent({
      node_id: "n-gate2",
      label: "Ship gate",
      kind: "gate",
      live_state: "needs_you",
      activity: "Waiting for you",
      last_event_at: at(30),
    });
    render(<NowBar agents={[...AGENTS, open]} graph={GRAPH} now={NOW} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /^Approval gate/ })).toHaveTextContent(
      `DoneYou approved · ${hhmm}2m ago`,
    );
    expect(screen.getByRole("button", { name: /^Ship gate/ })).toHaveTextContent(
      "Needs youWaiting for you30 s ago",
    );
  });

  it("a run that ended: an agent it never reached says Not reached", () => {
    for (const status of ["completed", "failed", "cancelled", "rejected", "over_budget"]) {
      const { unmount } = render(
        <NowBar agents={AGENTS} graph={GRAPH} status={status} now={NOW} onSelect={() => {}} />,
      );
      // Prob-Failed draws it in the state slot ("Reviewer Not reached"), not as a waiting line.
      const chip = screen.getByRole("button", { name: /^Reviewer/ });
      expect(chip.querySelector(".lv-chip__state")).toHaveTextContent("Not reached");
      expect(chip).not.toHaveTextContent("Waiting");
      unmount();
    }
  });
});

describe("NowBar — M3 a resumed run (Prob-Resumed)", () => {
  const carried = (text: string) => ({ from_run_id: "r-12", number: 12, text });
  const graph: GraphData = {
    ...GRAPH,
    nodes: GRAPH.nodes.map((n) =>
      n.id === "n-pm"
        ? { ...n, carried: carried("From run #12") }
        : n.id === "n-prd"
          ? { ...n, carried: carried("Approved in run #12") }
          : n.id === "n-rev"
            ? { ...n, carried: carried("From run #12") }
            : n,
    ),
  };
  const agents = AGENTS.map((a) =>
    a.node_id === "n-pm"
      ? { ...a, live_state: "carried_over" as const, activity: "From run #12 · spec v2" }
      : a.node_id === "n-prd"
        ? { ...a, live_state: "carried_over" as const, activity: "Approved in run #12" }
        : a.node_id === "n-rev"
          ? { ...a, activity: "Round 1 notes carried over" }
          : a,
  );

  it("carried steps say Carried over and where they were done, with no time", () => {
    render(<NowBar agents={agents} graph={graph} now={NOW} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /^Product manager/ })).toHaveTextContent(
      /^Product managerCarried overFrom run #12 · spec v2$/,
    );
    // A carried gate keeps the server's words (no "· 10:43" of a gate decided in this run).
    expect(screen.getByRole("button", { name: /^Approval gate/ })).toHaveTextContent(
      /^Approval gateCarried overApproved in run #12$/,
    );
  });

  it("a step that runs again after its carried rounds waits with its carried notes, never Not reached", () => {
    for (const status of ["running", "failed"]) {
      const { unmount } = render(
        <NowBar agents={agents} graph={graph} status={status} now={NOW} onSelect={() => {}} />,
      );
      const chip = screen.getByRole("button", { name: /^Reviewer/ });
      expect(chip).toHaveTextContent("WaitingRound 1 notes carried over");
      expect(chip).not.toHaveTextContent(/Not reached|Starts after/);
      unmount();
    }
  });
});

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
    activity: "You approved · 10:43",
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
  agent({ node_id: "n-stop", label: "Stop", kind: "terminal", live_state: "waiting" }),
  agent({ node_id: "n-ship", label: "Ship", kind: "terminal", live_state: "waiting" }),
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
});

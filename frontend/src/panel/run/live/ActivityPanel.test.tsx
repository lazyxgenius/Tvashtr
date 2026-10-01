import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActivityLine, PinnedCallout, RunActivity } from "../../../lib/api/activity";
import { ActivityPanel, type ActivityActions } from "./ActivityPanel";

const T = (h: number, m: number, s: number) => new Date(2026, 9, 2, h, m, s).toISOString();

const line = (id: string, over: Partial<ActivityLine>): ActivityLine => ({
  id,
  at: T(10, 43, 0),
  node_id: "n-eng",
  label: "Engineer",
  iteration: 1,
  kind: "message",
  text: id,
  tone: "neutral",
  refs: {},
  ...over,
});

const LINES: ActivityLine[] = [
  line("started", {
    node_id: null,
    label: "Run",
    kind: "started",
    text: "Started on lazyxgenius/trade_mcp, branch main",
    at: T(10, 41, 2),
  }),
  line("spec", {
    node_id: "n-pm",
    label: "Product manager",
    kind: "wrote_doc",
    text: "Wrote the spec (v2)",
    refs: { document_id: "d-spec", version: 2 },
    at: T(10, 42, 5),
  }),
  line("gate", {
    node_id: "n-prd",
    label: "Approval gate",
    kind: "gate_approved",
    text: "You approved the spec",
    tone: "ok",
    at: T(10, 43, 10),
  }),
  line("read", {
    kind: "read",
    text: "Read 6 files in core/ and tests/",
    refs: { files: ["core/a.py", "tests/b.py"] },
    at: T(10, 43, 31),
  }),
  line("edit", {
    kind: "edited",
    text: "Edited core/indicators.py",
    refs: { file: "core/indicators.py", added: 48, removed: 3 },
    at: T(10, 44, 2),
  }),
  line("tests", {
    kind: "tests",
    text: "Ran the tests: 3 failed, 38 passed",
    tone: "danger",
    refs: {
      command: "python -m pytest -q tests/test_indicators.py",
      output_tail: ["....F..F", "3 failed, 38 passed in 4.21s"],
      passed: 38,
      failed: 3,
    },
    at: T(10, 44, 40),
  }),
  line("edit2", {
    kind: "edited",
    text: "Edited core/indicators.py",
    refs: { file: "core/indicators.py", added: 6, removed: 2 },
    at: T(10, 45, 12),
  }),
  line("again", {
    kind: "command",
    text: "Running the tests again",
    refs: { command: "python -m pytest -q", running: true, started_at: T(10, 45, 20) },
    at: T(10, 45, 20),
  }),
];

const activity = (over: Partial<RunActivity> = {}): RunActivity => ({
  run_id: "r-12",
  status: "running",
  live_state: "running_command",
  cursor: "c",
  total: LINES.length,
  agents: [
    {
      node_id: "n-pm",
      origin_node_id: null,
      label: "Product manager",
      kind: "completion",
      iteration: 1,
      rounds_limit: null,
      live_state: "done",
      activity: null,
      last_event_at: null,
      activity_started_at: null,
      retry: null,
      backup_model: null,
      model: null,
    },
    {
      node_id: "n-prd",
      origin_node_id: null,
      label: "Approval gate",
      kind: "gate",
      iteration: 1,
      rounds_limit: null,
      live_state: "done",
      activity: null,
      last_event_at: null,
      activity_started_at: null,
      retry: null,
      backup_model: null,
      model: null,
    },
    {
      node_id: "n-eng",
      origin_node_id: null,
      label: "Engineer",
      kind: "agent",
      iteration: 1,
      rounds_limit: 3,
      live_state: "running_command",
      activity: null,
      last_event_at: null,
      activity_started_at: null,
      retry: null,
      backup_model: null,
      model: null,
    },
    {
      node_id: "n-ship",
      origin_node_id: null,
      label: "Ship",
      kind: "terminal",
      iteration: 0,
      rounds_limit: null,
      live_state: "waiting",
      activity: null,
      last_event_at: null,
      activity_started_at: null,
      retry: null,
      backup_model: null,
      model: null,
    },
  ],
  lines: LINES,
  pinned: null,
  summary: null,
  ...over,
});

const actions = (): ActivityActions => ({
  onViewChange: vi.fn(),
  onOpenDocument: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onReviewSpec: vi.fn(),
  onSwitchBackup: vi.fn(),
  onStop: vi.fn(),
  onRetryFromStart: vi.fn(),
});

const NOW = Date.parse(T(10, 45, 24));

describe("ActivityPanel", () => {
  it("shows the run's last steps in plain words and hides the earlier ones behind a button", () => {
    render(<ActivityPanel activity={activity()} now={NOW} actions={actions()} />);
    const panel = screen.getByRole("region", { name: "Activity" });
    expect(within(panel).getByText("8 steps")).toBeInTheDocument();
    expect(within(panel).queryByText("Wrote the spec (v2)")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Show 2 earlier steps" }));
    expect(within(panel).getByText("Wrote the spec (v2)")).toBeInTheDocument();
  });

  it("filters to one agent and back to all", () => {
    render(<ActivityPanel activity={activity()} now={NOW} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 earlier steps" }));
    fireEvent.click(screen.getByRole("button", { name: "Product manager" }));
    expect(screen.getByText("Wrote the spec (v2)")).toBeInTheDocument();
    expect(screen.queryByText("Ran the tests: 3 failed, 38 passed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Ran the tests: 3 failed, 38 passed")).toBeInTheDocument();
  });

  it("shows an edit's counts with View change, and a test run's output on demand", () => {
    const a = actions();
    render(<ActivityPanel activity={activity()} now={NOW} actions={a} />);
    expect(screen.getByText("+48")).toBeInTheDocument();
    expect(screen.getByText("−3")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "View change" })[0]);
    expect(a.onViewChange).toHaveBeenCalledWith("n-eng");
    fireEvent.click(screen.getByRole("button", { name: "Show output" }));
    expect(screen.getByText(/3 failed, 38 passed in 4.21s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide output" }));
    expect(screen.queryByText(/in 4.21s/)).toBeNull();
  });

  it("a running command says it is live and how long it has run", () => {
    render(<ActivityPanel activity={activity()} now={NOW} actions={actions()} />);
    expect(screen.getByText("live · 4 s")).toBeInTheDocument();
  });

  it("pins a waiting gate with its buttons", () => {
    const a = actions();
    const pinned: PinnedCallout = {
      kind: "gate",
      node_id: "n-prd",
      label: "Approval gate",
      title: "The approval gate is waiting for you",
      body: "Read the spec, then approve or reject it.",
      task_id: 12,
      backup_model: null,
    };
    render(<ActivityPanel activity={activity({ pinned })} now={NOW} actions={a} />);
    expect(screen.getByText("The approval gate is waiting for you")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(a.onApprove).toHaveBeenCalledWith(12);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(a.onReject).toHaveBeenCalledWith(12);
    fireEvent.click(screen.getByRole("button", { name: "Review the spec" }));
    expect(a.onReviewSpec).toHaveBeenCalled();
  });

  it("pins a retry with the switch and Stop run; a failed run with Retry from the start", () => {
    const a = actions();
    const { rerender } = render(
      <ActivityPanel
        activity={activity({
          pinned: {
            kind: "retrying",
            node_id: "n-eng",
            label: "Engineer",
            title: "The Engineer’s model is busy",
            body: "Tvashtr tries once more in 20 seconds.",
            task_id: null,
            backup_model: "openai/gpt-4.1-mini",
          },
        })}
        now={NOW}
        actions={a}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch to the backup model now" }));
    expect(a.onSwitchBackup).toHaveBeenCalledWith("n-eng");
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    expect(a.onStop).toHaveBeenCalled();
    rerender(
      <ActivityPanel
        activity={activity({
          status: "failed",
          pinned: {
            kind: "failed",
            node_id: "n-eng",
            label: "Engineer",
            title: "Engineer failed: the model didn’t answer after 3 tries",
            body: "Impact: nothing was shipped.",
            task_id: null,
            backup_model: null,
          },
        })}
        now={NOW}
        actions={a}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry from the start" }));
    expect(a.onRetryFromStart).toHaveBeenCalled();
    // Resume arrives with M3 (no dead buttons).
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });

  it("lists every agent a person sees, reached or not; a gate only once the run reaches it", () => {
    const base = activity().agents[2];
    const agents = [
      ...activity().agents,
      { ...base, node_id: "n-rev", label: "Reviewer", live_state: "waiting" as const },
      {
        ...base,
        node_id: "n-esc",
        label: "Escalation gate",
        kind: "gate",
        live_state: "waiting" as const,
      },
    ];
    render(<ActivityPanel activity={activity({ agents })} now={NOW} actions={actions()} />);
    expect(screen.getByRole("button", { name: "Reviewer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Escalation gate" })).toBeNull();
  });

  it("sets where an agent is now in bold, its command as code, its running output in view", () => {
    const lines = LINES.map((l) =>
      l.id === "again" ? { ...l, refs: { ...l.refs, output_tail: ["tests/a.py .... [ 41%]"] } } : l,
    );
    render(<ActivityPanel activity={activity({ lines })} now={NOW} actions={actions()} />);
    expect(screen.getByText("Running the tests again")).toHaveClass("lv-now-line");
    expect(screen.getByText("You approved the spec")).not.toHaveClass("lv-now-line");
    expect(screen.getByText(/tests\/a.py/)).toBeInTheDocument();
  });

  it("hides and shows itself", () => {
    render(<ActivityPanel activity={activity()} now={NOW} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide activity" }));
    expect(screen.queryByText("Ran the tests: 3 failed, 38 passed")).toBeNull();
    expect(screen.getByText("8 steps · hidden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show activity" }));
    expect(screen.getByText("Ran the tests: 3 failed, 38 passed")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActivityLine, PinnedCallout, RunActivity } from "../../../lib/api/activity";
import { ApiDetailError } from "../../../lib/api/runs";
import { routeToHash } from "../../../lib/nav";
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

const STALLED: PinnedCallout = {
  kind: "stalled",
  node_id: "n-eng",
  label: "Engineer",
  title: "Engineer stopped responding",
  body: "No update for 6 minutes.",
  task_id: null,
  backup_model: null,
};

describe("ActivityPanel", () => {
  it("shows the run's last steps in plain words and hides the earlier ones behind a button", () => {
    render(<ActivityPanel activity={activity()} now={NOW} actions={actions()} />);
    const panel = screen.getByRole("region", { name: "Activity" });
    expect(within(panel).getByText("8 steps")).toBeInTheDocument();
    expect(within(panel).queryByText("Wrote the spec (v2)")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Show 2 earlier steps" }));
    expect(within(panel).getByText("Wrote the spec (v2)")).toBeInTheDocument();
  });

  it("following the live end, keeps it in view when the list's box changes size", () => {
    // E.g. "Resume run #12" opens beside it: the callout above wraps and the list gets shorter.
    const resized: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          resized.push(() => cb([], this));
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      render(<ActivityPanel activity={activity()} now={NOW} actions={actions()} />);
      const list = screen.getByRole("region", { name: "Activity" }).querySelector("ol");
      if (!list) throw new Error("no step list");
      Object.defineProperty(list, "scrollHeight", { configurable: true, value: 600 });
      list.scrollTop = 0;
      resized.forEach((tick) => tick());
      expect(list.scrollTop).toBe(600);
    } finally {
      vi.unstubAllGlobals();
    }
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
      gate_kind: "prd_approval",
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
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Stop this run?" })).getByRole("button", {
        name: "Stop run",
      }),
    );
    expect(a.onStop).toHaveBeenCalledTimes(1);
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
      { ...base, node_id: "n-stop", label: "Stop", kind: "stop" },
    ];
    render(<ActivityPanel activity={activity({ agents })} now={NOW} actions={actions()} />);
    expect(screen.getByRole("button", { name: "Reviewer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Escalation gate" })).toBeNull();
    // An ending is never a filter, whatever the server calls it.
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
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

  it("Stop run asks first, with Home's Stop confirmation; Keep running does nothing", () => {
    const a = actions();
    render(
      <ActivityPanel
        activity={activity({ pinned: STALLED })}
        now={NOW}
        actions={a}
        teamName="Bugfix squad"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    const ask = screen.getByRole("alertdialog", { name: "Stop this run?" });
    expect(ask).toHaveTextContent(
      "Bugfix squad stops now and the run is marked Stopped. Anything already pushed stays on its branch. You can resume it later from the step it stopped at.",
    );
    expect(a.onStop).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Keep running" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(a.onStop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Stop this run?" })).getByRole("button", {
        name: "Stop run",
      }),
    );
    expect(a.onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("the pinned buttons wait while an action is on its way", () => {
    render(
      <ActivityPanel activity={activity({ pinned: STALLED })} now={NOW} actions={actions()} busy />,
    );
    expect(screen.getByRole("button", { name: "Stop run" })).toBeDisabled();
  });

  it("offers the backup switch only when the retry names a backup", () => {
    render(
      <ActivityPanel
        activity={activity({
          pinned: {
            ...STALLED,
            kind: "retrying",
            title: "Engineer is retrying",
            backup_model: null,
          },
        })}
        now={NOW}
        actions={actions()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Switch to the backup model now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
  });

  it("says why a switch didn't happen, under the callout's buttons", async () => {
    const a = actions();
    a.onSwitchBackup = vi.fn(() =>
      Promise.reject(new ApiDetailError(409, "nothing to switch", "nothing to switch")),
    );
    render(
      <ActivityPanel
        activity={activity({
          pinned: {
            ...STALLED,
            kind: "retrying",
            title: "Engineer is retrying",
            backup_model: "openai/gpt-4.1-mini",
          },
        })}
        now={NOW}
        actions={a}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch to the backup model now" }));
    const said = await screen.findByText("nothing to switch");
    expect(said).toHaveAttribute("role", "status");
  });

  it("a verdict's notes: Read notes only when it has reasons, one per line", () => {
    const verdict = (id: string, reasons: string[]) =>
      line(id, {
        node_id: "n-rev",
        label: "Reviewer",
        kind: "verdict",
        text: id,
        tone: "warn",
        refs: { verdict: "changes_requested", reasons },
      });
    const { container } = render(
      <ActivityPanel
        activity={activity({
          lines: [verdict("Approved", []), verdict("Asked for 2 fixes", ["a", "b"])],
        })}
        now={NOW}
        actions={actions()}
      />,
    );
    const notes = screen.getAllByRole("button", { name: "Read notes" });
    expect(notes).toHaveLength(1);
    expect(screen.getByText("Asked for 2 fixes").closest("li")).toContainElement(notes[0]);
    fireEvent.click(notes[0]);
    expect(container.querySelector(".lv-out")?.textContent).toBe("a\nb");
  });

  it("Review the spec only on the spec's gate, and only when the run has a spec", () => {
    const gate: PinnedCallout = {
      kind: "gate",
      node_id: "n-ship-gate",
      label: "Ship gate",
      title: "The ship gate is waiting for you",
      body: "Approve to ship.",
      task_id: 13,
      backup_model: null,
      gate_kind: "ship_approval",
    };
    const { rerender } = render(
      <ActivityPanel activity={activity({ pinned: gate })} now={NOW} actions={actions()} />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review the spec" })).toBeNull();

    const noSpec = { ...actions(), onReviewSpec: undefined };
    rerender(
      <ActivityPanel
        activity={activity({ pinned: { ...gate, gate_kind: "prd_approval" } })}
        now={NOW}
        actions={noSpec}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review the spec" })).toBeNull();
  });
});

describe("ActivityPanel — M3 Resume from here", () => {
  const FAILED: PinnedCallout = {
    kind: "failed",
    node_id: "n-eng",
    label: "Engineer",
    title: "Engineer failed: the model didn’t answer after 3 tries",
    body: "Impact: nothing was shipped.",
    task_id: null,
    backup_model: null,
    resume: { invocation_id: 105, label: "Engineer, round 2" },
    safe: "your approved spec (v2) and the Engineer’s round 1 changes are saved",
  };

  it("the Failed callout: Resume from <step> beside Retry, with the Safe / Next copy (Prob-Failed)", () => {
    const a = { ...actions(), onResume: vi.fn(() => Promise.resolve()) };
    render(<ActivityPanel activity={activity({ pinned: FAILED })} now={NOW} actions={a} />);
    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent(
      "Impact: nothing was shipped. Safe: your approved spec (v2) and the Engineer’s round 1 changes are saved. Next: resume from Engineer, round 2. Tvashtr skips the work that is done, so you don’t pay for it again.",
    );
    const buttons = within(callout).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Resume from Engineer, round 2",
      "Retry from the start",
    ]);
    fireEvent.click(buttons[0]);
    expect(a.onResume).toHaveBeenCalledWith(105);
  });

  it("the Stalled callout: Resume from the last finished step opens the pick, before Stop run", () => {
    const a = { ...actions(), onResume: vi.fn(() => Promise.resolve()) };
    render(
      <ActivityPanel
        activity={activity({
          pinned: {
            ...STALLED,
            resume: { invocation_id: 104, label: "Engineer, round 2" },
            safe: "the spec, your approval and the round 1 changes are saved",
          },
        })}
        now={NOW}
        actions={a}
      />,
    );
    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent(
      "No update for 6 minutes. The spec, your approval and the round 1 changes are saved.",
    );
    const buttons = within(callout).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Resume from the last finished step",
      "Stop run",
    ]);
    fireEvent.click(buttons[0]);
    expect(a.onResume).toHaveBeenCalledWith("pick");
  });

  it("no Resume button without the server's resume (an older server, a folder run)", () => {
    const a = { ...actions(), onResume: vi.fn(() => Promise.resolve()) };
    render(
      <ActivityPanel
        activity={activity({ pinned: { ...FAILED, resume: null, safe: null } })}
        now={NOW}
        actions={a}
      />,
    );
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
    expect(screen.getByRole("status")).not.toHaveTextContent(/Safe:|Next:/);
  });

  it("shows why Resume isn't offered when it refuses", async () => {
    const a = {
      ...actions(),
      onResume: vi.fn(() => Promise.reject(new Error("The run finished"))),
    };
    render(<ActivityPanel activity={activity({ pinned: FAILED })} now={NOW} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume from Engineer, round 2" }));
    expect(await screen.findByText("The run finished")).toBeInTheDocument();
  });

  it("a resumed run: carried lines muted with 'from run #12', then the Resumed line (Prob-Resumed)", () => {
    const lines: ActivityLine[] = [
      line("c:1:a", {
        node_id: "n-pm",
        label: "Product manager",
        kind: "carried",
        text: "Wrote the spec (v2)",
        from_run: { run_id: "r-12", number: 12 },
        at: T(10, 42, 5),
      }),
      line("c:1:b", {
        kind: "carried",
        text: "Round 1 · edited 2 files",
        from_run: { run_id: "r-12", number: 12 },
        at: T(10, 46, 12),
      }),
      line("run:resumed", {
        node_id: null,
        label: "Run",
        kind: "resumed",
        text: "Resumed from run #12 at Engineer, round 2",
        from_run: null,
        at: T(11, 2, 14),
      }),
      line("own", { text: "Read the reviewer’s notes from round 1", at: T(11, 2, 20) }),
    ];
    render(
      <ActivityPanel
        activity={activity({ lines, total: 4, number: 13 })}
        now={NOW}
        actions={actions()}
      />,
    );
    const carried = screen.getByText("Round 1 · edited 2 files").closest("li");
    expect(carried).toHaveClass("lv-line--carried");
    expect(carried).toHaveTextContent("from run #12");
    expect(screen.getAllByText("from run #12")).toHaveLength(2);
    const resumed = screen.getByText("Resumed from run #12 at Engineer, round 2");
    expect(resumed).toHaveClass("lv-now-line");
    expect(resumed.closest("li")).not.toHaveClass("lv-line--carried");
    expect(
      screen.getByText("Read the reviewer’s notes from round 1").closest("li"),
    ).not.toHaveClass("lv-line--carried");
  });
});

describe("ActivityPanel — R19 resume a stopped run (Prob-Stopped)", () => {
  const STOPPED: PinnedCallout = {
    kind: "stopped",
    node_id: "n-eng",
    label: "Engineer",
    title: "You stopped this run at Engineer, round 2",
    body: "Nothing was shipped.",
    task_id: null,
    backup_model: null,
    gate_kind: null,
    resume: { invocation_id: 105, label: "Engineer, round 2" },
    safe: "your approved spec (v2) and the Engineer’s round 1 changes are saved",
  };

  it("a neutral callout with Safe / Next and one button: Resume from <step> opens the pick", () => {
    const a = { ...actions(), onResume: vi.fn(() => Promise.resolve()) };
    render(<ActivityPanel activity={activity({ pinned: STOPPED })} now={NOW} actions={a} />);
    const callout = screen.getByRole("status");
    expect(callout).toHaveClass("lv-pin__box", "lv-pin__box--neutral");
    expect(callout).not.toHaveClass("lv-pin__box--danger");
    expect(within(callout).getByText("You stopped this run at Engineer, round 2")).toHaveClass(
      "lv-pin__title",
    );
    expect(callout).toHaveTextContent(
      "Nothing was shipped. Safe: your approved spec (v2) and the Engineer’s round 1 changes are saved. Next: resume from Engineer, round 2. Tvashtr skips the work that is done, so you don’t pay for it again.",
    );
    const buttons = within(callout).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Resume from Engineer, round 2"]);
    fireEvent.click(buttons[0]);
    expect(a.onResume).toHaveBeenCalledWith("pick");
    expect(a.onStop).not.toHaveBeenCalled();
    expect(a.onRetryFromStart).not.toHaveBeenCalled();
  });

  it("stopped callout without resume: no button (never a dead one), no Safe / Next", () => {
    const a = { ...actions(), onResume: vi.fn(() => Promise.resolve()) };
    render(
      <ActivityPanel
        activity={activity({
          pinned: { ...STOPPED, title: "You stopped this run", resume: null, safe: null },
        })}
        now={NOW}
        actions={a}
      />,
    );
    const callout = screen.getByRole("status");
    expect(callout).toHaveClass("lv-pin__box--neutral");
    expect(callout).toHaveTextContent("You stopped this run");
    expect(callout).toHaveTextContent("Nothing was shipped.");
    expect(callout).not.toHaveTextContent(/Safe:|Next:/);
    expect(within(callout).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("ActivityPanel — M10 a run started from another (Next-Started)", () => {
  const STARTED_FROM: ActivityLine[] = [
    line("run:started-from", {
      node_id: null,
      label: "Run",
      kind: "started",
      text: "Started from run #12 · brought spec v3, 2 decisions and 3 memories",
      came_along: true,
      at: T(11, 10, 2),
    }),
    line("run:started", {
      node_id: null,
      label: "Run",
      kind: "started",
      text: "Working on branch tvashtr/run-14, from pull request #42",
      at: T(11, 10, 3),
    }),
    line("pm:read-spec", {
      node_id: "n-pm",
      label: "Product manager",
      kind: "read",
      text: "Read the spec from run #12 (v3)",
      at: T(11, 10, 5),
    }),
  ];

  afterEach(() => vi.unstubAllGlobals());

  it("its first line links See what came along, which opens what run #12 brought", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            from: { run_id: "r-12", number: 12 },
            spec: { version: 3 },
            decisions: [{ title: "Spec approved", text: null }],
            memories: [{ id: "m1", content: "Register every indicator on INDICATORS" }],
            summaries: [],
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ActivityPanel
        activity={activity({ run_id: "r-14", lines: STARTED_FROM, total: 3 })}
        now={NOW}
        actions={actions()}
      />,
    );
    const first = screen.getByText(
      "Started from run #12 · brought spec v3, 2 decisions and 3 memories",
    );
    expect(first).toHaveClass("lv-now-line");
    expect(first.closest("li")).toHaveClass("lv-line--came");
    // Only that line links it; the run's own start line is as before.
    expect(screen.getAllByRole("button", { name: "See what came along" })).toHaveLength(1);
    const own = screen.getByText("Working on branch tvashtr/run-14, from pull request #42");
    expect(own).not.toHaveClass("lv-now-line");
    expect(own.closest("li")).not.toHaveClass("lv-line--came");
    fireEvent.click(
      within(first.closest("li") as HTMLElement).getByRole("button", {
        name: "See what came along",
      }),
    );
    const pop = await screen.findByRole("dialog", { name: "What came along from run #12" });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/r-14/carry", expect.anything());
    expect(pop).toHaveTextContent("Spec v3 · became this run’s starting spec");
    expect(pop).toHaveTextContent("Register every indicator on INDICATORS");
  });
});

describe("ActivityPanel — M10 the memories a run saved (Next-Finished)", () => {
  it("the line names how many and Review opens Toolkit › Memory › Inbox", () => {
    const saved = line("run:memories", {
      node_id: null,
      label: "Run",
      kind: "memories",
      text: "Saved 3 new memories from this run · review them in Toolkit",
      review_memories: true,
      at: T(11, 3, 30),
    });
    render(
      <ActivityPanel activity={{ ...activity(), lines: [saved] }} now={NOW} actions={actions()} />,
    );
    expect(
      screen.getByText("Saved 3 new memories from this run · review them in Toolkit"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(window.location.hash).toBe(routeToHash({ page: "memory", tab: "inbox" }));
  });
});

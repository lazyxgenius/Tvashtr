import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Compare, CompareSide, CompareStart } from "../../lib/api/compare";
import { useNav } from "../../lib/nav";
import { ComparePage } from "./ComparePage";

// M8 — "Compare versions" (Quality › Cmp-Start, Cmp-OneVersion, Cmp-Running, Cmp-Queued,
// Cmp-NeedsYou, Cmp-StopConfirm, Cmp-Results, Cmp-SideFailed, Cmp-Versions), the control plane
// stubbed. The page follows the address, so the harness routes like Workspace does.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const START: CompareStart = {
  team: { id: "team-1", name: "Indicator sprint team" },
  versions: [
    { number: 7, when: ago(0), runs: 1, summary: "Reviewer: stricter", current: true },
    {
      number: 6,
      when: ago(1440),
      runs: 3,
      summary: "Added the Spec approval gate",
      current: false,
    },
    { number: 5, when: ago(3 * 1440), runs: 2, summary: "Engineer: new model", current: false },
  ],
  defaults: { a: 6, b: 7 },
  changes: 1,
  target: { repo: "lazyxgenius/trade_mcp", base_ref: "main" },
  estimate: { cost_usd: 2.3, minutes: 25 },
  latest: null,
};
const ROW = {
  key: "node:tn-rev:prompt",
  node_id: "tn-rev",
  agent: "Reviewer",
  role: "reviewer",
  field: "Instructions",
  kind: "text" as const,
  removed: 1,
  added: 1,
  lines: [
    { op: "removed" as const, text: "Approve when the tests pass." },
    { op: "added" as const, text: "Approve only when every spec item is met." },
  ],
};
const line = (id: string, label: string, text: string, extra: object = {}) => ({
  id,
  at: "2026-10-02T10:31:40Z",
  node_id: label === "Run" ? null : `n-${label}`,
  label,
  iteration: 1,
  kind: "message",
  text,
  tone: "neutral" as const,
  refs: {},
  ...extra,
});
const chip = (node_id: string, label: string, state: string, role_name: string) => ({
  node_id,
  label,
  kind: role_name === "gate" ? "gate" : "agent",
  state,
  role_name,
  loops_with: null,
});
const side = (label: "A" | "B", version: number, over: Partial<CompareSide> = {}): CompareSide => ({
  label,
  version,
  run_id: `run-${label.toLowerCase()}`,
  number: label === "A" ? 12 : 13,
  status: "running",
  elapsed_s: 1150,
  cost_usd: 1.1,
  strip: [
    chip("n-pm", "Product manager", "done", "pm"),
    chip("n-eng", "Engineer", "active", "engineer"),
  ],
  current: { label: "Engineer", text: "round 3" },
  lines: [
    line("a1", "Reviewer", "Round 2 · asked to register RSI on INDICATORS"),
    line("a2", "Engineer", "Model busy. Tried again · 1 of 3", { kind: "retry", tone: "warn" }),
  ],
  gate_task_id: null,
  ...over,
});
const RUNNING: Compare = {
  id: "cmp-1",
  team_id: "team-1",
  task: "Add an RSI indicator",
  auto_approve: true,
  status: "running",
  elapsed_s: 1150,
  cost_usd: 2.02,
  created_at: ago(20),
  ended_at: null,
  waiting: null,
  sides: [
    side("A", 6),
    side("B", 7, {
      status: "finished",
      elapsed_s: 962,
      cost_usd: 0.92,
      current: { label: "Approved", text: "in round 2" },
      lines: [
        line("b1", "Run", "Finished · no pull request in a compare", { kind: "done", tone: "ok" }),
      ],
    }),
  ],
  results: null,
};
const RESULTS: Compare = {
  ...RUNNING,
  status: "finished",
  cost_usd: 2.4,
  ended_at: ago(2),
  sides: RUNNING.sides.map((s) => ({ ...s, status: "finished" })),
  results: {
    headline: "v7 did better on this task",
    rows: [
      {
        key: "result",
        label: "Result",
        a: "Approved in round 4",
        b: "Approved in round 2",
        better: "b",
        difference: "2 fewer rounds",
      },
      { key: "cost", label: "Cost", a: "$1.48", b: "$0.92", better: "b", difference: "−$0.56" },
      {
        key: "repo_tests",
        label: "Repo tests passing",
        a: "41 of 41",
        b: "41 of 41",
        better: null,
        difference: "same",
      },
    ],
    current_version: 7,
    restore: 6,
  },
};

let start: CompareStart;
let compare: Compare;
let postReply: { status: number; body: unknown };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const calls = (url: string, method = "GET") =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? "GET") === method);

beforeEach(() => {
  start = START;
  compare = RUNNING;
  postReply = { status: 201, body: { id: "cmp-9", status: "running" } };
  window.location.hash = "#/teams/team-1/compare";
  fetchMock = vi.fn<Fetch>((url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/teams/team-1/compare" && method === "POST")
      return reply(postReply.body, postReply.status);
    if (url === "/api/teams/team-1/compare") return reply(start);
    const changes = /\/compare\/changes\?a=(\d+)&b=(\d+)$/.exec(url);
    if (changes)
      return reply({
        a: Number(changes[1]),
        b: Number(changes[2]),
        rows: changes[1] === "6" ? [ROW] : [ROW, { ...ROW, key: "x", field: "Model" }],
        summary: "",
      });
    if (url.startsWith("/api/recent-tasks"))
      return reply({
        tasks: [
          { task: "Fix the MACD label", team: { id: "team-2", name: "Other" } },
          { task: "Add an RSI indicator", team: { id: "team-1", name: "Indicator sprint team" } },
        ],
      });
    if (url === "/api/compares/cmp-1/stop") return reply({ status: "stopped" });
    if (/^\/api\/compares\/cmp-\d+$/.test(url)) return reply(compare);
    if (url === "/api/teams/team-1/versions/6/restore" && method === "GET")
      return reply({ number: 6, makes: 8, current: 7, draft_saved_as: null, changes: [] });
    if (url === "/api/teams/team-1/versions/6/restore")
      return reply({ number: 8, restored_from: 6, draft_saved_as: null });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function Routed() {
  const { route } = useNav();
  if (route.page !== "compare") return <div>ELSEWHERE {window.location.hash}</div>;
  return <ComparePage teamId={route.teamId} compareId={route.compareId} tab={route.tab} />;
}
const open = (hash = "#/teams/team-1/compare") => {
  window.location.hash = hash;
  return render(<Routed />);
};
const startButton = () => screen.getByRole("button", { name: "Start compare" });

describe("Compare versions — the page", () => {
  it("has the canvas header, Back to the canvas, the title with the team's name and two tabs", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Compare versions" })).toBeInTheDocument();
    expect(await screen.findByText("Indicator sprint team")).toBeInTheDocument();
    expect(screen.getByText("the living canvas")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Compare", "Versions"]); // Task sets arrives with M9
    expect(screen.getByRole("main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to the canvas" }));
    expect(window.location.hash).toBe("#/teams/team-1");
  });

  it("opens the team's compare that is still going", async () => {
    start = { ...START, latest: { id: "cmp-1", status: "running" } };
    open();
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare/cmp-1"));
    expect(await screen.findByRole("heading", { name: /^v6 and v7 on/ })).toBeInTheDocument();
  });

  it("a finished latest compare is not reopened: the start form shows", async () => {
    start = { ...START, latest: { id: "cmp-1", status: "finished" } };
    open();
    expect(
      await screen.findByRole("heading", { name: "Run the same task on two versions" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#/teams/team-1/compare");
  });
});

describe("Compare versions — start (Cmp-Start)", () => {
  it("shows previous vs current, the captions, 1 change, the task, the repo, the checkbox and the estimate", async () => {
    open();
    await screen.findByRole("heading", { name: "Run the same task on two versions" });
    const a = screen.getByRole("combobox", { name: "Version A" });
    const b = screen.getByRole("combobox", { name: "Version B" });
    expect(a).toHaveValue("6");
    expect(b).toHaveValue("7");
    expect(
      within(a)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["v7 · now", "v6 · yesterday", "v5 · 3 days ago"]);
    expect(
      screen.getByText("Yesterday · 3 runs · Added the Spec approval gate"),
    ).toBeInTheDocument();
    expect(screen.getByText("Now · 1 run · Reviewer: stricter")).toBeInTheDocument();
    expect(screen.getByText("vs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 change" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Task" })).toHaveValue("Add an RSI indicator"),
    );
    expect(screen.getByText("lazyxgenius/trade_mcp")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    const check = screen.getByRole("checkbox", { name: /Approve gates automatically/ });
    expect(check).toBeChecked();
    expect(
      screen.getByText(
        "So both versions are treated the same. Turn this off to review each spec yourself.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/on your keys · about 25 min/)).toHaveTextContent(
      "About $2.30 on your keys · about 25 min",
    );
    expect(startButton()).toBeEnabled();
  });

  it("leaves out the repo line, the estimate and the changes link when there are none", async () => {
    start = { ...START, target: null, estimate: null, changes: 0 };
    open();
    await screen.findByRole("heading", { name: "Run the same task on two versions" });
    expect(screen.queryByText("lazyxgenius/trade_mcp")).toBeNull();
    expect(screen.queryByText(/on your keys/)).toBeNull();
    expect(screen.queryByRole("button", { name: /change/ })).toBeNull();
  });

  it("the change link opens What changed with the rows from A to B; another pair recounts", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "1 change" }));
    const dialog = await screen.findByRole("dialog", { name: "What changed in v7" });
    expect(dialog).toHaveTextContent("Compared with v6");
    expect(
      await within(dialog).findByRole("region", { name: "Reviewer › Instructions" }),
    ).toBeInTheDocument();
    expect(calls("/api/teams/team-1/compare/changes?a=6&b=7")).toHaveLength(1);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Version A" }), {
      target: { value: "5" },
    });
    expect(await screen.findByRole("button", { name: "2 changes" })).toBeInTheDocument();
  });

  it("Start compare is off with no task or the same version twice", async () => {
    open();
    const task = await screen.findByRole("textbox", { name: "Task" });
    await waitFor(() => expect(task).toHaveValue("Add an RSI indicator"));
    fireEvent.change(task, { target: { value: "   " } });
    expect(startButton()).toBeDisabled();
    fireEvent.change(task, { target: { value: "Add an RSI indicator" } });
    expect(startButton()).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Version A" }), {
      target: { value: "7" },
    });
    expect(startButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: /change/ })).toBeNull();
  });

  it("Enter while an input method is composing doesn't start the compare", async () => {
    open();
    const task = await screen.findByRole("textbox", { name: "Task" });
    await waitFor(() => expect(task).toHaveValue("Add an RSI indicator"));
    fireEvent.keyDown(task, { key: "Enter", isComposing: true });
    fireEvent.keyDown(task, { key: "Enter", keyCode: 229 });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("Start compare posts A, B, the task and the switch, then opens the compare", async () => {
    let finish: (r: Response) => void = () => undefined;
    open();
    const task = await screen.findByRole("textbox", { name: "Task" });
    await waitFor(() => expect(task).toHaveValue("Add an RSI indicator"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Approve gates automatically/ }));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    fireEvent.click(startButton());
    await waitFor(() => expect(startButton()).toBeDisabled()); // while starting
    finish(new Response(JSON.stringify({ id: "cmp-9", status: "running" }), { status: 201 }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare/cmp-9"));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      a: 6,
      b: 7,
      task: "Add an RSI indicator",
      auto_approve: false,
    });
  });

  it("shows the server's words under Start compare when it refuses", async () => {
    postReply = { status: 409, body: { detail: "Another compare of this team is running." } };
    open();
    const task = await screen.findByRole("textbox", { name: "Task" });
    await waitFor(() => expect(task).toHaveValue("Add an RSI indicator"));
    fireEvent.click(startButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another compare of this team is running.",
    );
    expect(startButton()).toBeEnabled();
    expect(window.location.hash).toBe("#/teams/team-1/compare");
  });
});

describe("Compare versions — one version (Cmp-OneVersion)", () => {
  it("B has no other version, the callout says why and Start compare is off", async () => {
    start = {
      ...START,
      versions: [{ ...START.versions[0], number: 1, runs: 0, summary: "First version" }],
      defaults: { a: null, b: 1 },
      changes: 0,
    };
    open();
    await screen.findByRole("heading", { name: "Run the same task on two versions" });
    expect(screen.getByRole("combobox", { name: "Version A" })).toHaveValue("1");
    const b = screen.getByRole("combobox", { name: "Version B" });
    expect(b).toBeDisabled();
    expect(within(b).getByRole("option")).toHaveTextContent("No other version");
    expect(screen.getByText("Now · First version")).toBeInTheDocument();
    expect(
      screen.getByText("This team has one version. Save a change as v2, then compare the two."),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });
});

describe("Compare versions — running (Cmp-Running, Cmp-Queued, Cmp-NeedsYou)", () => {
  it("shows the header, both lanes with their strip, current step and last lines", async () => {
    open("#/teams/team-1/compare/cmp-1");
    expect(
      await screen.findByRole("heading", { name: "v6 and v7 on “Add an RSI indicator”" }),
    ).toBeInTheDocument();
    expect(screen.getByText("19m 10s · $2.02 so far")).toBeInTheDocument();
    const a = screen.getByRole("region", { name: "Version A" });
    const b = screen.getByRole("region", { name: "Version B" });
    expect(within(a).getByText("v6")).toBeInTheDocument();
    expect(within(a).getByText("Running")).toBeInTheDocument();
    expect(within(a).getByText("19m 10s · $1.10")).toBeInTheDocument();
    expect(within(a).getByRole("list", { name: "Progress" })).toBeInTheDocument();
    expect(within(a).getByRole("listitem", { name: "Engineer: active" })).toBeInTheDocument();
    expect(a).toHaveTextContent("Engineer · round 3");
    expect(
      within(a).getByText("Round 2 · asked to register RSI on INDICATORS"),
    ).toBeInTheDocument();
    expect(within(a).getByText("Model busy. Tried again · 1 of 3")).toBeInTheDocument();
    expect(within(a).queryByRole("button", { name: "Open run" })).toBeNull();
    expect(within(b).getByText("Finished")).toBeInTheDocument();
    expect(within(b).getByText("16m 02s · $0.92")).toBeInTheDocument();
    expect(b).toHaveTextContent("Approved in round 2");
    expect(within(b).getByText("Finished · no pull request in a compare")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Gates are approved automatically in this compare. You can leave; Home shows it under Running now.",
      ),
    ).toBeInTheDocument();
  });

  it("queued: Waiting, both lanes wait for a free slot", async () => {
    compare = {
      ...RUNNING,
      status: "waiting",
      elapsed_s: 0,
      cost_usd: 0,
      waiting: { in_use: 3, limit: 3 },
      sides: RUNNING.sides.map((s) => ({
        ...s,
        status: "waiting",
        run_id: null,
        number: null,
        elapsed_s: 0,
        cost_usd: 0,
        current: null,
        lines: [],
      })),
    };
    open("#/teams/team-1/compare/cmp-1");
    await screen.findByRole("heading", { name: /^v6 and v7 on/ });
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("0s · $0.00 so far")).toBeInTheDocument();
    for (const name of ["Version A", "Version B"]) {
      const lane = screen.getByRole("region", { name });
      expect(within(lane).getByText("Waiting for a free slot")).toBeInTheDocument();
      expect(
        within(lane).getByText("Starts when 2 of your 3 run slots are free"),
      ).toBeInTheDocument();
      expect(within(lane).getByText("3 runs are using your slots now.")).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Stop compare" })).toBeInTheDocument();
    // Review fix (Cmp-Queued): Home doesn't list a compare that hasn't started.
    const foot = screen.getByText(/You can leave;/);
    expect(foot).toHaveTextContent(
      "You can leave; it starts on its own when two of your run slots are free.",
    );
    expect(foot).not.toHaveTextContent("Home shows it");
  });

  it("a lane that failed before any round reads its word alone (no dangling separator)", async () => {
    compare = {
      ...RUNNING,
      sides: [
        { ...RUNNING.sides[0], status: "failed", current: { label: "Failed", text: "" } },
        RUNNING.sides[1],
      ],
    };
    open("#/teams/team-1/compare/cmp-1");
    const lane = await screen.findByRole("region", { name: "Version A" });
    expect(lane.textContent).not.toMatch(/Failed ·/);
  });

  it("the Stop dialog opens fresh: the last attempt's error is gone", async () => {
    open("#/teams/team-1/compare/cmp-1");
    fireEvent.click(await screen.findByRole("button", { name: "Stop compare" }));
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Couldn’t stop it." }), { status: 409 }),
      ),
    );
    let dialog = screen.getByRole("alertdialog", { name: "Stop this compare?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop compare" }));
    await waitFor(() => expect(dialog).toHaveTextContent("Couldn’t stop it."));
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep running" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop compare" }));
    dialog = screen.getByRole("alertdialog", { name: "Stop this compare?" });
    expect(dialog).not.toHaveTextContent("Couldn’t stop it.");
  });

  it("needs you: the lane's Open run opens its run; the footnote says you approve each gate", async () => {
    compare = {
      ...RUNNING,
      auto_approve: false,
      sides: [
        side("A", 6, {
          status: "needs_you",
          current: { label: "Spec approval", text: "waiting for you" },
          gate_task_id: 41,
        }),
        side("B", 7),
      ],
    };
    open("#/teams/team-1/compare/cmp-1");
    const a = await screen.findByRole("region", { name: "Version A" });
    expect(within(a).getByText("Needs you")).toBeInTheDocument();
    expect(a).toHaveTextContent("Spec approval · waiting for you");
    expect(
      within(screen.getByRole("region", { name: "Version B" })).queryByRole("button", {
        name: "Open run",
      }),
    ).toBeNull();
    expect(
      screen.getByText(
        "You approve each gate yourself in this compare. You can leave; Home shows it under Running now.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(a).getByRole("button", { name: "Open run" }));
    expect(window.location.hash).toBe("#/teams/team-1/runs/run-a");
  });

  it("Stop compare asks first (Cmp-StopConfirm); Keep running keeps it, Stop compare stops it", async () => {
    open("#/teams/team-1/compare/cmp-1");
    fireEvent.click(await screen.findByRole("button", { name: "Stop compare" }));
    let dialog = screen.getByRole("alertdialog", { name: "Stop this compare?" });
    expect(dialog).toHaveTextContent(
      "Both runs stop now and are marked Stopped. Nothing ships in a compare.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep running" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls("/api/compares/cmp-1/stop", "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Stop compare" }));
    dialog = screen.getByRole("alertdialog", { name: "Stop this compare?" });
    compare = {
      ...RUNNING,
      status: "stopped",
      sides: RUNNING.sides.map((s) => ({ ...s, status: "stopped" })),
    };
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop compare" }));
    await waitFor(() => expect(calls("/api/compares/cmp-1/stop", "POST")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findAllByText("Stopped")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Stop compare" })).toBeNull();
  });
});

describe("Compare versions — results (Cmp-Results, Cmp-SideFailed)", () => {
  it("shows the headline, the table with the better values marked, Restore and Done", async () => {
    compare = RESULTS;
    open("#/teams/team-1/compare/cmp-1");
    expect(
      await screen.findByRole("heading", { name: "v7 did better on this task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Same task, same repo, at the same time · finished 2 minutes ago · $2.40 in all",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Results" });
    const result = within(table).getByRole("row", { name: /^Result/ });
    expect(result).toHaveTextContent("Approved in round 4");
    expect(within(result).getByText("Approved in round 2").closest("td")).toHaveClass(
      "cmp-res__cell--better",
    );
    expect(within(result).getByText("Approved in round 4").closest("td")).not.toHaveClass(
      "cmp-res__cell--better",
    );
    expect(within(result).getByText("2 fewer rounds")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /^Repo tests passing/ })).toHaveTextContent(
      "same",
    );
    expect(within(table).getByRole("columnheader", { name: "Difference" })).toBeInTheDocument();
    const openRuns = within(table).getAllByRole("button", { name: "Open run" });
    expect(openRuns).toHaveLength(2);
    expect(screen.getByText("v7 is your current version.")).toBeInTheDocument();
    // Not built: the task-set callout (M9) and "Compare the code" (no board says where it goes).
    expect(screen.queryByText("One task is a small sample")).toBeNull();
    expect(screen.queryByText("Compare the code")).toBeNull();

    fireEvent.click(openRuns[1]);
    expect(window.location.hash).toBe("#/teams/team-1/runs/run-b");
  });

  it("Restore v6 opens M5's Restore and restores; Done goes back to the canvas", async () => {
    compare = RESULTS;
    open("#/teams/team-1/compare/cmp-1");
    fireEvent.click(await screen.findByRole("button", { name: "Restore v6" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore v6?" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Restore as v8" }));
    await waitFor(() =>
      expect(calls("/api/teams/team-1/versions/6/restore", "POST")).toHaveLength(1),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(window.location.hash).toBe("#/teams/team-1");
  });

  it("no Restore when the better version is the current one", async () => {
    compare = { ...RESULTS, results: { ...RESULTS.results!, restore: null } };
    open("#/teams/team-1/compare/cmp-1");
    await screen.findByRole("table", { name: "Results" });
    expect(screen.queryByRole("button", { name: /^Restore/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("one side failed: the headline says so and its result reads as failed", async () => {
    compare = {
      ...RESULTS,
      results: {
        ...RESULTS.results!,
        headline: "v6 finished; v7 failed on this task",
        rows: [
          {
            key: "result",
            label: "Result",
            a: "Approved in round 4",
            b: "Failed: the Engineer stopped responding",
            better: "a",
            difference: "—",
          },
        ],
      },
    };
    open("#/teams/team-1/compare/cmp-1");
    expect(
      await screen.findByRole("heading", { name: "v6 finished; v7 failed on this task" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed: the Engineer stopped responding").closest("td")).toHaveClass(
      "cmp-res__cell--failed",
    );
  });
});

describe("Compare versions — Versions tab (Cmp-Versions)", () => {
  it("lists the versions; Compare with the current one fills A and B on the Compare tab", async () => {
    open("#/teams/team-1/compare?tab=versions");
    expect(await screen.findByRole("heading", { name: "Versions" })).toBeInTheDocument();
    expect(
      screen.getByText("Pick a version to run it against v7 on the same task."),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute("aria-selected", "true");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("v7");
    expect(within(rows[0]).getByText("Current")).toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    expect(rows[1]).toHaveTextContent("Added the Spec approval gate");
    expect(within(rows[1]).getByText("3 runs")).toBeInTheDocument();
    fireEvent.click(within(rows[2]).getByRole("button", { name: "Compare with v7" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare"));
    expect(await screen.findByRole("combobox", { name: "Version A" })).toHaveValue("5");
    expect(screen.getByRole("combobox", { name: "Version B" })).toHaveValue("7");
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveAttribute("aria-selected", "true");
  });

  it("the tabs move between Compare and Versions", async () => {
    open();
    fireEvent.click(await screen.findByRole("tab", { name: "Versions" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/compare?tab=versions"));
    expect(await screen.findByRole("heading", { name: "Versions" })).toBeInTheDocument();
  });
});

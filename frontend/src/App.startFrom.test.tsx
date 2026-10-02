import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import App from "./App";
import type { NextInfo } from "./lib/api/startFrom";

// M10 — Start a new run from this one on the real <App/> (the control plane stubbed): a Done run's
// "Start the next run from this" opens the dialog and Start run opens the new run; a refusal stays
// in the dialog; the new run's bar says "From run #12", its first Activity line links what came
// along and its PM card reads "From spec v3 of run #12"; an ended run's ⋯ downloads the run log.

const T = (h: number, m: number) => new Date(2026, 9, 2, h, m).toISOString();

const NEXT: NextInfo = {
  available: true,
  reason: null,
  run: { id: "run-12", number: 12, idea: "Add an RSI indicator" },
  spec: { version: 3 },
  decisions: [{ title: "Spec approved", text: null }],
  memories: [{ id: "m1", content: "Register every indicator on INDICATORS" }],
  pending_memories: 0,
  summaries: [{ agent: "Product manager", text: "Wrote the RSI spec (v3)." }],
  pr: { number: 42, branch: "tvashtr/run-12", merged: false },
  start_from: [
    { value: "pr", label: "tvashtr/run-12 (pull request #42)" },
    { value: "main", label: "main" },
  ],
  default_start: "pr",
  team: { id: "team-1", version: 7 },
};

const SUMMARY = {
  pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
  pr_number: 42,
  rounds: 3,
  elapsed_s: 1358,
  cost_usd: 1.12,
  branch: "tvashtr/run-12",
  base_ref: "main",
  tests_passed: 41,
};

interface RunFixture {
  status: string;
  extra?: Record<string, unknown>;
  lines?: unknown[];
  total?: number;
  pmLive?: { live_state: string; activity: string } | null;
}

let runs: Record<string, RunFixture>;
let nextReply: { status: number; body: unknown };
let postReply: { status: number; body: unknown };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  window.location.hash = "";
  runs = {
    "run-12": { status: "completed", total: 31 },
    "run-14": {
      status: "running",
      extra: {
        started_from: {
          run_id: "run-12",
          number: 12,
          summary: "brought spec v3, 2 decisions and 3 memories",
        },
      },
      lines: [
        {
          id: "run:started-from",
          at: T(11, 10),
          node_id: null,
          label: "Run",
          iteration: null,
          kind: "started",
          text: "Started from run #12 · brought spec v3, 2 decisions and 3 memories",
          tone: "neutral",
          refs: {},
          came_along: true,
        },
      ],
      total: 5,
      pmLive: { live_state: "working", activity: "From spec v3 of run #12" },
    },
  };
  nextReply = { status: 200, body: NEXT };
  postReply = { status: 201, body: { run_id: "run-14", number: 14 } };
  fetchMock = vi.fn<Fetch>((url, init) => {
    const m = /^\/api\/runs\/(run-\d+)(\/[a-z]+)?/.exec(url);
    const id = m?.[1] ?? "";
    const r = runs[id];
    if (!r) return reply({});
    const route = m?.[2] ?? "";
    const done = r.status === "completed";
    if (route === "/next")
      return init?.method === "POST"
        ? reply(postReply.body, postReply.status)
        : reply(nextReply.body, nextReply.status);
    if (route === "/carry")
      return reply({
        from: { run_id: "run-12", number: 12 },
        spec: { version: 3 },
        decisions: [{ title: "Spec approved", text: null }],
        memories: [{ id: "m1", content: "Register every indicator on INDICATORS" }],
        summaries: [],
      });
    if (route === "/log") return Promise.resolve(new Response("run #12 · log\n"));
    if (route === "")
      return reply({
        run_id: id,
        workflow_status: done ? "SUCCESS" : "PENDING",
        costs: [],
        run: {
          id,
          team_graph_id: "g",
          idea: done ? "Add an RSI indicator" : "Add a MACD indicator",
          status: r.status,
          pm_document_id: null,
          ship_commit_sha: null,
          ship_tag: null,
          cost_total_usd: 1.12,
          created_at: T(10, 41),
          updated_at: T(11, 3),
          library_team_id: "team-1",
          number: Number(id.slice(4)),
          ...r.extra,
        },
      });
    if (route === "/activity")
      return reply({
        run_id: id,
        status: r.status,
        live_state: done ? "done" : "working",
        cursor: "c",
        total: r.total ?? 0,
        agents: [],
        lines: r.lines ?? [],
        pinned: null,
        summary: done ? SUMMARY : null,
      });
    if (route === "/graph")
      return reply({
        run_id: id,
        team_graph_id: "g",
        nodes: [
          {
            id: "n-pm",
            role_name: "pm",
            kind: "agent",
            model: "xai/grok-4.7",
            engine: null,
            prompt: "Drafts the spec",
            position: { x: 0, y: 0 },
            config: null,
            status: r.pmLive ? "running" : "done",
            iteration: 1,
            invocations: [],
            live: r.pmLive
              ? {
                  ...r.pmLive,
                  last_event_at: new Date().toISOString(),
                  activity_started_at: null,
                  retry: null,
                  backup_model: null,
                }
              : undefined,
          },
        ],
        edges: [],
      });
    if (route === "/tasks") return reply({ run_id: id, tasks: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

const posts = () =>
  fetchMock.mock.calls.filter(
    ([u, init]) => u === "/api/runs/run-12/next" && init?.method === "POST",
  );

async function openDialog() {
  render(<App teamId="team-1" initialRunId="run-12" />);
  fireEvent.click(await screen.findByRole("button", { name: "Start the next run from this" }));
  const dialog = await screen.findByRole("dialog", { name: "Start a new run from run #12" });
  fireEvent.change(within(dialog).getByLabelText("What should the team do next?"), {
    target: { value: "Add a MACD indicator, registered on INDICATORS the same way as RSI." },
  });
  return dialog;
}

describe("App — M10 Start a new run from this one", () => {
  it("a Done run: Start run sends the choices and opens the new run", async () => {
    const dialog = await openDialog();
    // Open pull request stays as it was.
    expect(screen.getByRole("link", { name: "Open pull request #42" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^What the agents learned/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/runs/run-14"));
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1]?.body as string)).toEqual({
      task: "Add a MACD indicator, registered on INDICATORS the same way as RSI.",
      carry: { spec: true, decisions: true, memories: false, summaries: true },
      start_from: "pr",
    });
  });

  it("a refusal (422 / 429) shows its reason in the dialog and the person stays on the run", async () => {
    postReply = {
      status: 429,
      body: {
        detail: {
          code: "owner_concurrency_limit",
          message:
            "You have 3 runs going, the most at once. Start this one when one of them finishes.",
        },
      },
    };
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You have 3 runs going, the most at once. Start this one when one of them finishes.",
    );
    expect(window.location.hash).toBe("");
    postReply = { status: 422, body: { detail: "Say what the team should do next." } };
    fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Say what the team should do next.",
    );
    expect(screen.getByRole("dialog", { name: "Start a new run from run #12" })).toBe(dialog);
  });

  it("no button when the run can't start the next one (no dead buttons)", async () => {
    nextReply = { status: 200, body: { ...NEXT, available: false, reason: "Not on GitHub" } };
    render(<App teamId="team-1" initialRunId="run-12" />);
    expect(await screen.findByRole("link", { name: "Open pull request #42" })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === "/api/runs/run-12/next")).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "Start the next run from this" })).toBeNull();
  });

  it("the new run: From run #12 in the bar, what came along in Activity, the PM card's spec", async () => {
    render(<App teamId="team-1" initialRunId="run-14" />);
    expect(await screen.findByRole("link", { name: "From run #12" })).toHaveAttribute(
      "href",
      "#/teams/team-1/runs/run-12",
    );
    // Additive: the run bar keeps its own controls.
    for (const name of ["Cancel run", "Running…"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // A running run has no ⋯ (the boards draw it on ended runs).
    expect(screen.queryByRole("button", { name: "More for this run" })).toBeNull();
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(
      await within(activity).findByText(
        "Started from run #12 · brought spec v3, 2 decisions and 3 memories",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(activity).getByRole("button", { name: "See what came along" }));
    const pop = await screen.findByRole("dialog", { name: "What came along from run #12" });
    expect(pop).toHaveTextContent("Register every indicator on INDICATORS");
    expect(await screen.findByText("From spec v3 of run #12")).toBeInTheDocument();
  });

  it("an ended run's ⋯ downloads the run log, with the Activity's step count", async () => {
    URL.createObjectURL = vi.fn(() => "blob:run-log");
    URL.revokeObjectURL = vi.fn();
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    render(<App teamId="team-1" initialRunId="run-12" />);
    await screen.findByRole("button", { name: "Start the next run from this" });
    fireEvent.click(screen.getByRole("button", { name: "More for this run" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download the run log" }));
    const dialog = await screen.findByRole("dialog", { name: "Download the run log" });
    expect(await within(dialog).findByLabelText("Preview")).toHaveTextContent("run #12 · log");
    expect(dialog).toHaveTextContent("About 1 KB · 31 steps");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));
    expect(saved).toEqual(["run-12.txt"]);
  });
});

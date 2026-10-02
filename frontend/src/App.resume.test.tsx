import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import App from "./App";
import type { ResumeInfo } from "./lib/api/resume";

// M3 — Resume from here on the real <App/> (the control plane stubbed): the callouts open the pick
// panel or the confirm, "Resume run" starts the new run and opens it, a refusal shows its reason,
// Home's `?resume=1` opens the panel, and a resumed run's bar links back.

const RUN = "run-12";
const T = (h: number, m: number) => new Date(2026, 9, 2, h, m).toISOString();

const CONFIRM = {
  title: "Resume from Engineer, round 2?",
  step_label: "Engineer, round 2",
  kept: [{ text: "Spec v2", at: null }],
  runs_again: ["Engineer · round 2"],
  skips_cost_usd: 0.56,
  skips_s: 480,
};
const INFO: ResumeInfo = {
  run_id: RUN,
  number: 12,
  next_number: 13,
  available: true,
  reason: null,
  stops_run: false,
  points: [
    {
      invocation_id: 101,
      node_id: "n-pm",
      origin_node_id: null,
      label: "Product manager",
      kind: "agent",
      iteration: 1,
      title: "Product manager",
      text: "Wrote the spec (v2)",
      at: T(10, 42),
      cost_usd: 0.06,
      state: "kept",
      resumable: true,
      confirm: { ...CONFIRM, title: "Resume from Product manager?" },
    },
    {
      invocation_id: 105,
      node_id: "n-eng",
      origin_node_id: null,
      label: "Engineer",
      kind: "agent",
      iteration: 2,
      title: "Engineer · round 2",
      text: "Failed: the model didn’t answer",
      at: T(10, 59),
      cost_usd: 0.28,
      state: "suggested",
      resumable: true,
      confirm: CONFIRM,
    },
  ],
};

const pinned = (kind: "failed" | "stalled") => ({
  kind,
  node_id: "n-eng",
  label: "Engineer",
  title: kind === "failed" ? "Engineer failed" : "The Engineer may be stuck",
  body: "Nothing was shipped.",
  task_id: null,
  backup_model: null,
  resume: { invocation_id: 105, label: "Engineer, round 2" },
  safe: "your approved spec (v2) is saved",
});

let runStatus: string;
let runExtra: Record<string, unknown>;
let pin: unknown;
let postReply: { status: number; body: unknown };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  window.location.hash = "";
  runStatus = "failed";
  runExtra = {};
  pin = pinned("failed");
  postReply = { status: 201, body: { run_id: "run-13", number: 13 } };
  fetchMock = vi.fn<Fetch>((url, init) => {
    if (url === `/api/runs/${RUN}/resume`)
      return init?.method === "POST" ? reply(postReply.body, postReply.status) : reply(INFO);
    if (url === `/api/runs/${RUN}`)
      return reply({
        run_id: RUN,
        workflow_status: runStatus === "failed" ? "ERROR" : "PENDING",
        costs: [],
        run: {
          id: RUN,
          team_graph_id: "g",
          idea: "Add an RSI indicator",
          status: runStatus,
          pm_document_id: null,
          ship_commit_sha: null,
          ship_tag: null,
          cost_total_usd: 0.84,
          created_at: T(10, 41),
          updated_at: T(10, 59),
          library_team_id: "team-1",
          ...runExtra,
        },
      });
    if (url.startsWith(`/api/runs/${RUN}/activity`))
      return reply({
        run_id: RUN,
        status: runStatus,
        live_state: runStatus,
        cursor: "c",
        total: 0,
        agents: [],
        lines: [],
        pinned: pin,
        summary: null,
      });
    if (url === `/api/runs/${RUN}/graph`)
      return reply({ run_id: RUN, team_graph_id: "g", nodes: [], edges: [] });
    if (url === `/api/runs/${RUN}/tasks`) return reply({ run_id: RUN, tasks: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const posts = () =>
  fetchMock.mock.calls.filter(
    ([u, init]) => u === `/api/runs/${RUN}/resume` && init?.method === "POST",
  );

describe("App — M3 Resume from here", () => {
  it("the Failed callout's Resume opens the confirm; Resume run starts run #13 and opens it", async () => {
    render(<App teamId="team-1" initialRunId={RUN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume from Engineer, round 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Resume from Engineer, round 2?" });
    expect(dialog).toHaveTextContent("This starts run #13. It picks up where run #12 stopped.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Resume run" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/team-1/runs/run-13"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0][1]?.body).toBe(JSON.stringify({ invocation_id: 105 }));
  });

  it("a refusal shows its reason in the dialog and the person stays on the run", async () => {
    postReply = {
      status: 429,
      body: { detail: "You have 3 runs going. Wait for one to finish, then resume." },
    };
    render(<App teamId="team-1" initialRunId={RUN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume from Engineer, round 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Resume from Engineer, round 2?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resume run" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You have 3 runs going. Wait for one to finish, then resume.",
    );
    expect(window.location.hash).toBe("");
  });

  it("the Stalled callout's Resume opens the pick panel; its Resume from here opens the confirm", async () => {
    runStatus = "running";
    pin = pinned("stalled");
    render(<App teamId="team-1" initialRunId={RUN} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Resume from the last finished step" }),
    );
    const panel = await screen.findByRole("complementary", { name: "Resume run #12" });
    fireEvent.click(within(panel).getAllByRole("button", { name: "Resume from here" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Resume from Product manager?" });
    // Cancel goes back to the panel.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Resume run #12" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Resume run #12" })).toBeNull();
  });

  it("Home's ?resume=1 opens the run view with the pick panel, once", async () => {
    const opened = vi.fn();
    render(<App teamId="team-1" initialRunId={RUN} resume onResumeOpened={opened} />);
    expect(
      await screen.findByRole("complementary", { name: "Resume run #12" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  });

  it("a resumed run's bar links to the run it resumed", async () => {
    runStatus = "running";
    pin = null;
    runExtra = {
      number: 13,
      resumed_from: { run_id: "run-11", number: 12, step_label: "Engineer, round 2" },
    };
    render(<App teamId="team-1" initialRunId={RUN} />);
    const link = await screen.findByRole("link", { name: "Resumed from #12" });
    expect(link).toHaveAttribute("href", "#/teams/team-1/runs/run-11");
    expect(link.closest("[role=toolbar]")).not.toBeNull();
  });
});

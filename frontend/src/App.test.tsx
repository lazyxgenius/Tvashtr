import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type {
  GraphData,
  GraphNode,
  HumanTask,
  RunRow,
  RunStatus,
  TeamGraphData,
  TeamGraphNode,
} from "./lib/api";

// The KEYSTONE (brief §2.3.1): render the REAL <App/> under <StrictMode>, stub the whole
// control-plane fetch surface, and drive the poll with fake timers. It proves the two things
// `tsc` + the pure-unit tests cannot: (a) the POLLED graph/run state reaches the DOM (the P1.1b
// `mountedRef`-freeze class — under StrictMode's mount→unmount→remount a missing re-arm leaves
// every poll's setState silently dropped, freezing the canvas), and (b) polling STOPS once the
// run is terminal. Reverting the App mount-effect's `mountedRef.current = true` makes this RED.
//
// The start-click here uses fireEvent (not user-event): user-event deadlocks against vitest's
// fake timers, and this test must drive virtual time for the poll. The realistic user-event
// sequence is exercised where interaction IS the subject (team authoring, provider gate).

const RUN_ID = "run-keystone-1";

type Phase = "running" | "completed";

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "test-model",
    engine: "openhands",
    prompt: null,
    position: { x: 0, y: 0 },
    config: null,
    status: "idle",
    iteration: 0,
    invocations: [],
    ...over,
  };
}

function tnode(
  over: Partial<TeamGraphNode> & Pick<TeamGraphNode, "id" | "role_name" | "kind">,
): TeamGraphNode {
  return {
    model: "openai/gpt-4o-mini",
    engine: null,
    prompt: "default behavior",
    position: { x: 0, y: 0 },
    config: null,
    ...over,
  };
}

// The persistent authored team the canvas opens to (P1.8b): two agent nodes + a gate control node.
function teamGraph(): TeamGraphData {
  return {
    team_graph_id: "team-1",
    name: "Indicator sprint team",
    nodes: [
      tnode({ id: "tn-pm", role_name: "pm", kind: "completion", prompt: "PM behavior" }),
      tnode({
        id: "tn-eng",
        role_name: "engineer",
        kind: "agent",
        engine: "openhands",
        prompt: "ENGINEER behavior — edit me",
      }),
      tnode({
        id: "tn-gate",
        role_name: "prd_gate",
        kind: "gate",
        model: null,
        prompt: null,
        position: { x: 220, y: 0 },
        config: { gate_kind: "prd_approval", title: "Approve the PRD", description: "Approve." },
      }),
    ],
    edges: [],
  };
}

// PM completes first; the engineer runs then finishes; the ship terminal reaches "done" only
// once the run completes — so "Done"/"Shipped" on the canvas is strictly a POLLED-state signal.
function graphFor(phase: Phase): GraphData {
  const done = phase === "completed";
  return {
    run_id: RUN_ID,
    team_graph_id: "g1",
    resolution_warnings: runWarnings,
    nodes: [
      gnode({ id: "n-pm", role_name: "pm", kind: "completion", status: "done" }),
      gnode({
        id: "n-eng",
        role_name: "engineer",
        kind: "agent",
        prompt: "ENGINEER behavior",
        origin_node_id: "tn-eng",
        status: done ? "done" : "running",
      }),
      gnode({ id: "n-rev", role_name: "reviewer", kind: "agent", status: done ? "done" : "idle" }),
      gnode({
        id: "n-ship",
        role_name: "ship",
        kind: "terminal",
        config: { terminal_kind: "ship" },
        status: done ? "done" : "idle",
      }),
    ],
    edges: [],
  };
}

function runStatusFor(phase: Phase): RunStatus {
  const completed = phase === "completed";
  const run: RunRow = {
    id: RUN_ID,
    team_graph_id: "g1",
    idea: "idea",
    status: completed ? "completed" : "running",
    pm_document_id: null,
    ship_commit_sha: completed ? "abc123def456" : null,
    ship_tag: completed ? `ship-${RUN_ID}` : null,
    cost_total_usd: completed ? 0.0123 : null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    run_id: RUN_ID,
    workflow_status: completed ? "SUCCESS" : "PENDING",
    run,
    costs: [],
  };
}

let phase: Phase;
let fetchMock: ReturnType<typeof vi.fn>;
// The run's pending tasks the poll returns (default empty → the tasks drawer renders null). A test
// that needs the drawer to render seeds a pending task here before launching.
let extraTasks: HumanTask[];
// What the run went without (`resolution_warnings` on its graph).
let runWarnings: NonNullable<GraphData["resolution_warnings"]>;
// M2: what GET /api/runs/{id}/activity answers (null → an older server's empty body).
let activityReply: unknown;

beforeEach(() => {
  phase = "running";
  extraTasks = [];
  runWarnings = [];
  activityReply = null;
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";
    if (url === "/health") return Promise.resolve(jsonOk({ status: "ok", db: "ok" }));
    if (url === "/api/teams")
      return Promise.resolve(
        jsonOk({
          teams: [
            {
              team_graph_id: "team-1",
              name: "My team",
              created_at: "2026-01-01T00:00:00Z",
              node_count: 3,
            },
          ],
        }),
      );
    if (url === "/api/templates")
      return Promise.resolve(
        jsonOk({
          templates: [
            { template: "review_loop", name: "PM → Engineer ↔ Reviewer", description: "reviews" },
            { template: "two_node", name: "PM → Engineer", description: "no review" },
          ],
        }),
      );
    // The current team's authored graph (matched BEFORE the generic run-graph `/graph` below).
    if (url === "/api/teams/team-1/graph") return Promise.resolve(jsonOk(teamGraph()));
    // P1.8d: the team's holistic-validity verdict — a clean, runnable team.
    if (url.endsWith("/validate"))
      return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
    if (url === "/api/runs" && method === "POST")
      return Promise.resolve(jsonOk({ run_id: RUN_ID }));
    if (url.endsWith("/graph")) return Promise.resolve(jsonOk(graphFor(phase)));
    if (url.endsWith("/tasks"))
      return Promise.resolve(jsonOk({ run_id: RUN_ID, tasks: extraTasks }));
    if (url === `/api/runs/${RUN_ID}`) return Promise.resolve(jsonOk(runStatusFor(phase)));
    // Credential preflight: team fixtures use openai/* models — seed a matching BYOK key so
    // existing Run-enabled tests stay green unless a case overrides the mock.
    if (url === "/api/providers")
      return Promise.resolve(
        jsonOk({
          providers: [
            { provider: "openai", key_last4: "test", created_at: "2026-01-01T00:00:00Z" },
          ],
        }),
      );
    if (url === "/api/engines/subscriptions") return Promise.resolve(jsonOk({ subscriptions: [] }));
    if (url.startsWith("/api/spike/run-events/"))
      return Promise.resolve(jsonOk({ run_id: RUN_ID, events: [] }));
    if (url.startsWith(`/api/runs/${RUN_ID}/activity`))
      return Promise.resolve(jsonOk(activityReply ?? {}));
    return Promise.resolve(jsonOk({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Count the run-snapshot polls (GET /api/runs/{id} exactly — not /graph or /tasks).
function runStatusCalls(): number {
  return fetchMock.mock.calls.filter((c) => {
    const url = urlOf(c[0] as RequestInfo | URL);
    return url === `/api/runs/${RUN_ID}`;
  }).length;
}

describe("App — poll lifecycle (keystone)", () => {
  it("polls the live graph to the canvas under StrictMode and STOPS once terminal", async () => {
    vi.useFakeTimers();
    // Runs are launched from Home's composer now; the canvas opens a run by its address
    // (#/teams/<team>/runs/<run>), which mounts App on that run.
    render(
      <StrictMode>
        <App teamId="team-1" initialRunId={RUN_ID} />
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The canvas left the empty landing state (a graph is mounted).
    expect(screen.queryByText("Nothing on the loom yet")).toBeNull();

    // Poll a couple of intervals in the running phase — the engineer card reads "● Working…".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    expect(screen.getAllByText("● Working…").length).toBeGreaterThan(0);
    expect(runStatusCalls()).toBeGreaterThan(0);

    // The run reaches a terminal status. The NEXT poll must (a) reflect it on the canvas + banner
    // and (b) be the last poll.
    phase = "completed";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });

    // (a) the POLLED terminal state reached the DOM — banner "Shipped" + a "Done" node. Under the
    //     mountedRef freeze, `run` stays null and the polled graph is dropped, so neither appears.
    expect(screen.getAllByText("Shipped").length).toBeGreaterThan(0);
    expect(screen.getAllByText("✓ Done").length).toBeGreaterThan(0);

    // (b) polling STOPPED at terminal: no further GET /api/runs/{id} once settled. Under the
    //     freeze, `terminal` never flips (run never set) so the interval would poll forever.
    const settledCalls = runStatusCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(runStatusCalls()).toBe(settledCalls);
  });
});

describe("App — the agent drawer (F5)", () => {
  function nodeCard(label: string): Element {
    const card = screen
      .getAllByText(label)
      .map((el) => el.closest(".react-flow__node"))
      .find((el): el is Element => el !== null);
    expect(card).toBeTruthy();
    return card as Element;
  }

  it("opens '<Name> settings' for an agent (Setup first) and the gate's own body for a gate", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // "Product manager" is unique to the node card (the palette uses the short "PM").
    await screen.findByText("Product manager");
    expect(screen.queryByRole("complementary", { name: "Engineer settings" })).toBeNull();

    fireEvent.click(nodeCard("Engineer"));
    const panel = await screen.findByRole("complementary", { name: "Engineer settings" });
    expect(within(panel).getByRole("tab", { name: "Setup" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const instructions = within(panel).getByRole<HTMLTextAreaElement>("textbox", {
      name: /^Instructions/,
    });
    expect(instructions.value).toContain("ENGINEER behavior");
    // The catalogue no longer lists gpt-4o-mini, so the button shows the whole slug (no provider
    // tile) and the soft unknown-model warning says what that means.
    expect(
      within(panel).getByRole("button", { name: "Model openai/gpt-4o-mini" }),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/^No provider matches/)).toHaveTextContent(
      "No provider matches openai/gpt-4o-mini. It will fail at run time",
    );
    expect(within(panel).getByText("All changes saved")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Engineer settings" })).toBeNull(),
    );

    // A gate keeps its own editable body in the same shell, without tabs or instructions.
    fireEvent.click(nodeCard("PRD approval"));
    const gatePanel = await screen.findByRole("complementary", {
      name: "Approve the PRD settings",
    });
    expect(within(gatePanel).getByRole("button", { name: "Secret leak scan" })).toBeInTheDocument();
    expect(within(gatePanel).getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(within(gatePanel).queryByRole("tab")).toBeNull();
    expect(within(gatePanel).queryByRole("textbox", { name: /^Instructions/ })).toBeNull();
  });

  it("keeps the open tab when another agent is selected, and opens the focus view and docks back", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText("Product manager");
    fireEvent.click(nodeCard("Engineer"));
    let panel = await screen.findByRole("complementary", { name: "Engineer settings" });
    fireEvent.click(within(panel).getByRole("tab", { name: "Runs" }));
    expect(within(panel).getByRole("tab", { name: "Runs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(nodeCard("Product manager"));
    panel = await screen.findByRole("complementary", { name: "Product manager settings" });
    expect(within(panel).getByRole("tab", { name: "Runs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Focus mode" }));
    const dialog = await screen.findByRole("dialog", { name: "Product manager in focus view" });
    expect(screen.queryByRole("complementary", { name: "Product manager settings" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Dock to the side" }));
    await screen.findByRole("complementary", { name: "Product manager settings" });
  });

  it("follows the address: node, tab and focus come in as props and go out through onNodeRoute", async () => {
    const onNodeRoute = vi.fn();
    const { rerender } = render(
      <App teamId="team-1" node="tn-eng" tab="memory" onNodeRoute={onNodeRoute} />,
    );
    const panel = await screen.findByRole("complementary", { name: "Engineer settings" });
    expect(within(panel).getByRole("tab", { name: "Memory" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(within(panel).getByRole("tab", { name: "Docs" }));
    expect(onNodeRoute).toHaveBeenLastCalledWith({ node: "tn-eng", tab: "docs", focus: undefined });
    fireEvent.click(within(panel).getByRole("tab", { name: "Setup" }));
    // Setup is the default, so it leaves the address clean.
    expect(onNodeRoute).toHaveBeenLastCalledWith({
      node: "tn-eng",
      tab: undefined,
      focus: undefined,
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    expect(onNodeRoute).toHaveBeenLastCalledWith({
      node: undefined,
      tab: undefined,
      focus: undefined,
    });

    // Back/forward change the props; the drawer follows.
    rerender(<App teamId="team-1" onNodeRoute={onNodeRoute} />);
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Engineer settings" })).toBeNull(),
    );
  });

  it("the run view opens the same tabbed drawer on Runs, its place in the address (Q20)", async () => {
    const onNodeRoute = vi.fn();
    const { rerender } = render(
      <App teamId="team-1" initialRunId={RUN_ID} onNodeRoute={onNodeRoute} />,
    );
    await screen.findByText("Product manager");
    fireEvent.click(nodeCard("Engineer"));
    // Runs is the run view's default tab, so it stays out of the address.
    expect(onNodeRoute).toHaveBeenLastCalledWith({
      node: "n-eng",
      tab: undefined,
      focus: undefined,
    });

    rerender(<App teamId="team-1" initialRunId={RUN_ID} node="n-eng" onNodeRoute={onNodeRoute} />);
    const panel = await screen.findByRole("complementary", { name: "Engineer in this run" });
    expect(within(panel).getByRole("tab", { name: "Runs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(panel).getByTitle("See the last run")).toHaveTextContent("Running");
    expect(within(panel).getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Changes" })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("tab", { name: "Setup" }));
    expect(onNodeRoute).toHaveBeenLastCalledWith({ node: "n-eng", tab: "setup", focus: undefined });
    rerender(
      <App
        teamId="team-1"
        initialRunId={RUN_ID}
        node="n-eng"
        tab="setup"
        onNodeRoute={onNodeRoute}
      />,
    );
    const setup = within(screen.getByRole("complementary", { name: "Engineer in this run" }));
    const instructions = setup.getByRole<HTMLTextAreaElement>("textbox", { name: /^Instructions/ });
    expect(instructions.value).toBe("ENGINEER behavior");
    expect(instructions).toHaveAttribute("readonly");
    // "Edit on the team": the team's canvas with the agent this run copied, on Setup.
    fireEvent.click(setup.getByRole("button", { name: "Edit on the team" }));
    expect(window.location.hash).toBe("#/teams/team-1?node=tn-eng");
    window.location.hash = "";

    fireEvent.click(setup.getByRole("button", { name: "Close panel" }));
    expect(onNodeRoute).toHaveBeenLastCalledWith({
      node: undefined,
      tab: undefined,
      focus: undefined,
    });
  });

  it("lists what the run went without under the toolbar, not inside its one 56px line", async () => {
    runWarnings = [
      { source_kind: "connector", name: "Acme", reason: "its sign-in expired" },
      { source_kind: "connector", name: "a connector", reason: "it was disconnected" },
    ];
    render(<App teamId="team-1" initialRunId={RUN_ID} />);
    const banner = await screen.findByRole("status", { name: "Resolution warnings" });
    // Inside the toolbar a banner of more than one line spills over the header and under the
    // canvas, and Open Connectors can't be clicked.
    expect(banner.closest(".cv-bar")).toBeNull();
    expect(banner.parentElement).toHaveClass("cv-warnings");
    expect(banner.parentElement?.nextElementSibling).toHaveClass("cv-main");
    expect(within(banner).getByRole("link", { name: "Open Connectors" })).toHaveAttribute(
      "href",
      "#/toolkit/connectors",
    );
  });

  it("the run view's PM drawer: Runs first, the shared spec under Docs, Open then Edit (the J3 e2e path)", async () => {
    const served = fetchMock.getMockImplementation() as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    const author = { kind: "agent", node_id: "n-pm", role_name: "pm", label: "Product manager" };
    const latest = { version_no: 1, created_at: "2026-01-01T00:00:00Z", author, note: null };
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url === `/api/runs/${RUN_ID}/documents`)
        return Promise.resolve(
          jsonOk({
            run: { run_id: RUN_ID, idea: "idea", status: "awaiting_human", created_at: "" },
            documents: [
              {
                id: "d-spec",
                name: "spec",
                is_shared_spec: true,
                latest_version: latest,
                written_by: [{ ...author, clone_node_id: "n-pm" }],
                read_by: [],
              },
            ],
          }),
        );
      if (url === "/api/documents/d-spec")
        return Promise.resolve(
          jsonOk({
            id: "d-spec",
            name: "spec",
            run_id: RUN_ID,
            is_shared_spec: true,
            editable: true,
            versions: [{ ...latest, id: "v1", content: "# The spec" }],
          }),
        );
      return served(input, init);
    });
    render(<App teamId="team-1" initialRunId={RUN_ID} />);
    await screen.findByText("Product manager");
    fireEvent.click(nodeCard("Product manager"));
    const drawer = await screen.findByRole("complementary", { name: /in this run$/ });
    expect(within(drawer).getByRole("tab", { name: "Runs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Not on Runs: the documents live under Docs.
    expect(within(drawer).queryByText("Shared spec")).toBeNull();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Docs" }));
    const card = (await within(drawer).findByText("Shared spec")).closest("li") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    const viewer = await screen.findByRole("dialog", { name: "Shared spec" });
    expect(await within(viewer).findByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("no 'Edit on the team' for an agent deleted from the team since the run; it says so", async () => {
    const served = fetchMock.getMockImplementation() as (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url === "/api/teams/team-1/graph" || !url.endsWith("/graph")) return served(input, init);
      const graph = graphFor(phase);
      graph.nodes = graph.nodes.map((n) =>
        n.id === "n-eng" ? { ...n, origin_node_id: "tn-deleted" } : n,
      );
      return Promise.resolve(jsonOk(graph));
    });
    render(
      <App teamId="team-1" initialRunId={RUN_ID} node="n-eng" tab="setup" onNodeRoute={vi.fn()} />,
    );
    const setup = within(
      await screen.findByRole("complementary", { name: "Engineer in this run" }),
    );
    expect(
      await setup.findByText(
        "This run uses a copy of the team from when it started. This agent is no longer on the team.",
      ),
    ).toBeInTheDocument();
    expect(setup.queryByRole("button", { name: "Edit on the team" })).toBeNull();
  });
});

describe("App — the drawer asks before dropping unsaved changes (F5 G2)", () => {
  function nodeCard(label: string): Element {
    const card = screen
      .getAllByText(label)
      .map((el) => el.closest(".react-flow__node"))
      .find((el): el is Element => el !== null);
    expect(card).toBeTruthy();
    return card as Element;
  }

  async function dirtyEngineer(onBack = vi.fn()) {
    render(<App teamId="team-1" node="tn-eng" onBackToDashboard={onBack} />);
    const panel = await screen.findByRole("complementary", { name: "Engineer settings" });
    fireEvent.click(within(panel).getByRole("switch", { name: "Images" }));
    expect(within(panel).getByText("1 unsaved change")).toBeInTheDocument();
    return { panel, onBack };
  }

  it("the model picker's 'Add a provider' asks first, then opens Engines › API keys (F5 G4)", async () => {
    const { panel } = await dirtyEngineer();
    const model = within(panel).getByRole("region", { name: "Model" });
    fireEvent.click(within(model).getByRole("button", { name: "Model openai/gpt-4o-mini" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Add a provider" }));
    const dialog = within(panel).getByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(window.location.hash).toBe("#/engines/keys");
    window.location.hash = "";
  });

  it("a link to Connectors from Skills & tools asks first, then opens Connectors", async () => {
    const { panel } = await dirtyEngineer();
    fireEvent.click(within(panel).getByRole("tab", { name: /^Skills & tools/ }));
    // No connections in this fixture: the checklist points to Connectors.
    const link = await within(panel).findByRole("link", { name: "Open Connectors" });
    expect(fireEvent.click(link)).toBe(false);
    const dialog = within(panel).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(dialog).toHaveTextContent("Save your changes to Engineer?");
    expect(window.location.hash).not.toContain("connectors");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(window.location.hash).toBe("#/toolkit/connectors");
    window.location.hash = "";
  });

  it("selecting another agent asks first; Keep editing stays, Discard moves on", async () => {
    const { panel } = await dirtyEngineer();
    fireEvent.click(nodeCard("Product manager"));
    const dialog = within(panel).getByRole("alertdialog", { name: "Unsaved changes" });
    expect(dialog).toHaveTextContent("Save your changes to Engineer?");
    expect(dialog).toHaveAccessibleDescription("You changed images.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("complementary", { name: "Engineer settings" })).toBeInTheDocument();

    fireEvent.click(nodeCard("Product manager"));
    fireEvent.click(
      within(within(panel).getByRole("alertdialog")).getByRole("button", { name: "Discard" }),
    );
    await screen.findByRole("complementary", { name: "Product manager settings" });
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === "PATCH")).toBe(false);
  });

  it("Close and Back to teams ask too", async () => {
    const { panel, onBack } = await dirtyEngineer();
    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    fireEvent.click(
      within(within(panel).getByRole("alertdialog")).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.getByRole("complementary", { name: "Engineer settings" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to teams" }));
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(
      within(within(panel).getByRole("alertdialog")).getByRole("button", { name: "Discard" }),
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("Delete agent (⋯) deletes the node and closes the drawer", async () => {
    render(<App teamId="team-1" node="tn-eng" />);
    const panel = await screen.findByRole("complementary", { name: "Engineer settings" });
    fireEvent.click(within(panel).getByRole("button", { name: "More actions" }));
    fireEvent.click(within(panel).getByRole("menuitem", { name: /^Delete agent/ }));
    const dialog = within(panel).getByRole("alertdialog", { name: "Delete Engineer?" });
    expect(dialog).toHaveTextContent("Past runs keep their results.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete agent" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Engineer settings" })).toBeNull(),
    );
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          urlOf(c[0] as RequestInfo | URL) === "/api/teams/team-1/nodes/tn-eng" &&
          (c[1] as RequestInit)?.method === "DELETE",
      ),
    ).toBe(true);
  });
});

// ---- F-canvas-fidelity-1: the canvas SCREEN SHELL (Part A rail / Part B header / Part C toolbar) ----

describe("App — Run opens Home's composer", () => {
  it("asks Home for a new run on this team instead of launching from the canvas", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const run = await screen.findByRole("button", { name: "Run this team" });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    expect(window.location.hash).toBe("#/home");
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          urlOf(c[0] as RequestInfo | URL) === "/api/runs" &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
    window.location.hash = "";
  });
});

describe("App — F-canvas-fidelity-1 screen shell", () => {
  it("Part A: NO 'Your teams' rail while authoring; the tasks drawer appears once a run starts", async () => {
    vi.useFakeTimers();
    // Seed a pending blocker so the run's tasks drawer has something to show (empty ⇒ it renders null).
    extraTasks = [
      {
        id: 1,
        run_id: RUN_ID,
        kind: "gate_approval",
        priority: "high_blocker",
        blocking: true,
        topic: null,
        title: "Approve the PRD",
        description: "Approve to let the engineers build.",
        status: "pending",
        resolution: null,
        resolution_note: null,
        created_at: "2026-01-01T00:00:00Z",
        resolved_at: null,
      },
    ];
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // Let the persistent team load (enables Run) — the keystone's fake-timer pattern.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Authoring (Run this team present) but the author teams rail is GONE and no tasks drawer yet.
    expect(screen.getByRole("button", { name: "Run this team" })).toBeInTheDocument();
    expect(screen.queryByText("Your teams")).toBeNull();
    expect(screen.queryByText("Tasks for Human")).toBeNull();
    unmount();

    // Open a run (Home launches it; its address mounts App on the run) → the run view takes over.
    render(
      <StrictMode>
        <App teamId="team-1" initialRunId={RUN_ID} />
      </StrictMode>,
    );
    // Advance past a poll interval so the run's pending task is fetched and delivered to the drawer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Part A keeps the run-mode left panel: the tasks drawer now renders.
    expect(screen.getByText("Tasks for Human")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("Part B: the header avatar (email initial) hides the email + Log out until clicked; Log out calls onLogout", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <StrictMode>
        <App user={{ id: "u1", email: "ada@studio.dev" }} onLogout={onLogout} />
      </StrictMode>,
    );
    await screen.findByText("Product manager");

    // The account avatar shows the email's initial; the raw email + a Log out control are NOT shown yet
    // (replacing the old always-visible raw email + Log out text).
    const avatar = screen.getByRole("button", { name: "Account" });
    expect(avatar).toHaveTextContent("A");
    expect(screen.queryByText("ada@studio.dev")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /log out/i })).toBeNull();

    // Click → the profile menu reveals the email + a Log out control that calls onLogout.
    await user.click(avatar);
    expect(screen.getByText("ada@studio.dev")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /log out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("Part C: toolbar = Back to teams + Run + the team name + spend ($0.00) + 'Connected'", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <StrictMode>
        <App onBackToDashboard={onBack} />
      </StrictMode>,
    );
    await screen.findByText("Product manager");

    // The back arrow returns to the teams (Home).
    const back = screen.getByRole("button", { name: "Back to teams" });

    expect(screen.getByRole("button", { name: "Run this team" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "A/B compare" })).toBeNull();
    expect(screen.queryByRole("group", { name: "View mode" })).toBeNull();

    // The team's name from the graph, the always-on spend ("$0.00" while idle) and the backend
    // status with its label; the old drag hint line is GONE.
    expect(await screen.findByText("Indicator sprint team")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText(/Drag from a node.*edge to wire it/i)).toBeNull();

    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("blocks Run and surfaces missing providers with an Engines escape hatch", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    // Override the default openai BYOK seed: account has no keys for the team's openai models.
    fetchMock.mockImplementation((input: RequestInfo | URL): Promise<Response> => {
      const url = urlOf(input);
      if (url === "/health") return Promise.resolve(jsonOk({ status: "ok", db: "ok" }));
      if (url === "/api/teams")
        return Promise.resolve(
          jsonOk({
            teams: [
              {
                team_graph_id: "team-1",
                name: "My team",
                created_at: "2026-01-01T00:00:00Z",
                node_count: 3,
              },
            ],
          }),
        );
      if (url === "/api/templates")
        return Promise.resolve(
          jsonOk({
            templates: [
              { template: "review_loop", name: "PM → Engineer ↔ Reviewer", description: "reviews" },
              { template: "two_node", name: "PM → Engineer", description: "no review" },
            ],
          }),
        );
      if (url === "/api/teams/team-1/graph") return Promise.resolve(jsonOk(teamGraph()));
      if (url.endsWith("/validate"))
        return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
      if (url === "/api/providers") return Promise.resolve(jsonOk({ providers: [] }));
      if (url === "/api/engines/subscriptions")
        return Promise.resolve(jsonOk({ subscriptions: [] }));
      return Promise.resolve(jsonOk({}));
    });

    render(
      <StrictMode>
        <App onBackToDashboard={onBack} />
      </StrictMode>,
    );
    await screen.findByText("Product manager");

    // Run stays, disabled, and the warn callout says why — no more "Configure providers" swap.
    // Hosted (no Desktop dataset): only an API key can cover openai.
    const run = await screen.findByRole("button", { name: "Run this team" });
    await waitFor(() => expect(run).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Configure providers" })).toBeNull();
    const banner = screen.getByTestId("run-blocked");
    expect(banner).toHaveTextContent("Can’t run on the website yet. No API key for openai.");
    // openai has no Desktop subscription, so the callout doesn't mention one.
    expect(banner).not.toHaveTextContent(/Subscriptions only work/i);

    await user.click(within(banner).getByRole("button", { name: "Open Engines" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenLastCalledWith("engines");
  });
});

describe("App — M2 live run view", () => {
  it("adds the Now bar and the Activity panel to the run view, keeping its toolbar", async () => {
    activityReply = {
      run_id: RUN_ID,
      status: "running",
      live_state: "running_command",
      cursor: "c1",
      total: 1,
      agents: [
        {
          node_id: "n-eng",
          origin_node_id: null,
          label: "Engineer",
          kind: "agent",
          iteration: 1,
          rounds_limit: 3,
          live_state: "running_command",
          activity: "Running tests · tests/test_indicators.py",
          last_event_at: new Date().toISOString(),
          activity_started_at: null,
          retry: null,
          backup_model: null,
          model: null,
        },
      ],
      lines: [
        {
          id: "ev:1",
          at: new Date().toISOString(),
          node_id: "n-eng",
          label: "Engineer",
          iteration: 1,
          kind: "edited",
          text: "Edited core/indicators.py",
          tone: "neutral",
          refs: { file: "core/indicators.py", added: 48, removed: 3 },
        },
      ],
      pinned: null,
      summary: null,
    };
    render(<App teamId="team-1" initialRunId={RUN_ID} />);
    const now = await screen.findByRole("region", { name: "Now" });
    expect(now).toHaveTextContent("Running a command");
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(activity).toHaveTextContent("+48");
    // Additive: the run view's own toolbar controls are all still there.
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Running…" })).toBeInTheDocument();
  });
});

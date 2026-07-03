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
// sequence is exercised where interaction IS the subject (the A/B toggle below, team authoring).

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
    nodes: [
      gnode({ id: "n-pm", role_name: "pm", kind: "completion", status: "done" }),
      gnode({
        id: "n-eng",
        role_name: "engineer",
        kind: "agent",
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

beforeEach(() => {
  phase = "running";
  extraTasks = [];
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
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Let the persistent team load so "Run this team" is enabled (the launch needs its id).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Run the team: "Run this team" now OPENS the launch panel (Slice 2); the panel's Run fires the
    // greenfield launch -> POST /api/runs -> getGraph -> the poll effect arms. (Sync acts for the
    // clicks; the async advance flushes the handleLaunch fetch microtasks.)
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run this team" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Greenfield launch posts ONLY { team_graph_id } — byte-for-byte the prior behavior (the brief's
    // hard contract: empty idea + toggle off ⇒ the server default idea, the API smokes untouched).
    const postCall = fetchMock.mock.calls.find(
      (c) =>
        urlOf(c[0] as RequestInfo | URL) === "/api/runs" &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      team_graph_id: "team-1",
    });

    // The canvas left the empty landing state (a graph is mounted).
    expect(screen.queryByText("Nothing on the loom yet")).toBeNull();

    // Poll a couple of intervals in the running phase — the engineer node reads "Working…".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    expect(screen.getAllByText("Working…").length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);

    // (b) polling STOPPED at terminal: no further GET /api/runs/{id} once settled. Under the
    //     freeze, `terminal` never flips (run never set) so the interval would poll forever.
    const settledCalls = runStatusCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(runStatusCalls()).toBe(settledCalls);
  });
});

describe("App — single-run <-> A/B mode toggle (state-only)", () => {
  it("mounts the A/B surface on toggle and restores the single-run tree losslessly", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Single-run surface is up; the A/B surface is not.
    expect(await screen.findByRole("button", { name: "Run this team" })).toBeInTheDocument();
    expect(screen.queryByText(/One idea, two team configs/)).toBeNull();

    // Toggle to A/B compare: the comparison surface mounts; the single-run controls are replaced.
    await user.click(screen.getByRole("button", { name: "A/B compare" }));
    expect(screen.getByText(/One idea, two team configs/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run this team" })).toBeNull();

    // Toggle back: the single-run tree returns (lossless — the underlying state was preserved).
    await user.click(screen.getByRole("button", { name: "Single run" }));
    expect(screen.getByRole("button", { name: "Run this team" })).toBeInTheDocument();
    expect(screen.queryByText(/One idea, two team configs/)).toBeNull();
  });
});

describe("App — persistent team authoring (P1.8b)", () => {
  it("opens the editable panel for an agent node + a READ-ONLY drawer for a gate (F1c Decision 4)", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // The canvas opens to the persistent team (no run): the agent + gate nodes render. ("Product
    // manager" is unique to the node card — the palette uses the short "PM" — so it's the safe wait.)
    await screen.findByText("Product manager");
    expect(screen.getByText("Product manager")).toBeInTheDocument();
    // No editable panel before a node is selected.
    expect(screen.queryByLabelText("Engineer editor")).toBeNull();

    // Click the ENGINEER agent NODE (not the palette preset chip of the same label) -> the editable
    // panel opens with its prompt + a model field.
    const engineerNode = screen
      .getAllByText("Engineer")
      .map((el) => el.closest(".react-flow__node"))
      .find((el): el is Element => el !== null);
    expect(engineerNode).toBeTruthy();
    fireEvent.click(engineerNode as Element);

    const panel = await screen.findByLabelText("Engineer editor");
    const promptBox = within(panel).getByRole<HTMLTextAreaElement>("textbox", { name: /prompt/i });
    expect(promptBox.value).toContain("ENGINEER behavior");
    // The model field carries the node's model (the panel now also has a Provider select combobox).
    expect(within(panel).getByRole<HTMLInputElement>("combobox", { name: "Model" }).value).toBe(
      "openai/gpt-4o-mini",
    );

    // Close the panel back to a CLEAN state, then click a GATE node. F1c Decision 4: a gate now OPENS
    // a READ-ONLY checkpoint drawer (not the agent editor) — its title/description shown, but NO prompt
    // field and NO Save (persisting gate copy is a §15 backend follow-on). Asserting from the closed
    // state distinguishes "the gate opened its read-only drawer" from "an earlier agent panel lingered".
    fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByLabelText("Engineer editor")).toBeNull());

    const gateNode = screen.getByText("PRD approval").closest(".react-flow__node");
    fireEvent.click(gateNode as Element);
    // The gate's OWN config title is in the drawer's aria-label — proving the read-only view mounted,
    // distinct from any agent "…editor".
    const gatePanel = await screen.findByLabelText("Approve the PRD checkpoint");
    expect(within(gatePanel).getByText(/A checkpoint pauses the run/i)).toBeInTheDocument();
    expect(within(gatePanel).queryByRole("textbox", { name: /prompt/i })).toBeNull();
    expect(within(gatePanel).queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText("Engineer editor")).toBeNull();
  });
});

// ---- F1c Decision 1: the dock⇄pop-up toggle is a SESSION-STICKY viewing preference (App state) ----

describe("App — F1c sticky dock⇄pop-up panelMode (Decision 1)", () => {
  it("the toggle flips drawer↔modal (scrim appears) and the mode HOLDS across close/reopen + reselect", async () => {
    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText("Product manager");

    // Open the Engineer node's drawer — DOCKED (no scrim, a fresh mount starts docked).
    const engineerNode = screen
      .getAllByText("Engineer")
      .map((el) => el.closest(".react-flow__node"))
      .find((el): el is Element => el !== null);
    fireEvent.click(engineerNode as Element);
    await screen.findByLabelText("Engineer editor");
    expect(container.querySelector(".tv-scrim")).toBeNull();

    // Toggle to pop-up (modal): a click-to-close scrim appears.
    fireEvent.click(screen.getByRole("button", { name: "Open as a pop-up" }));
    expect(container.querySelector(".tv-scrim")).not.toBeNull();

    // Close the drawer, then reopen the SAME node → STILL modal (sticky across close/reopen).
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByLabelText("Engineer editor")).toBeNull());
    fireEvent.click(engineerNode as Element);
    await screen.findByLabelText("Engineer editor");
    expect(container.querySelector(".tv-scrim")).not.toBeNull();

    // Select a DIFFERENT node (PM) → STILL modal (sticky across reselect).
    const pmNode = screen.getByText("Product manager").closest(".react-flow__node");
    fireEvent.click(pmNode as Element);
    await screen.findByLabelText("Product manager editor");
    expect(container.querySelector(".tv-scrim")).not.toBeNull();

    // Dock it back → the scrim is gone (the same session preference, flipped).
    fireEvent.click(screen.getByRole("button", { name: "Dock to the side" }));
    expect(container.querySelector(".tv-scrim")).toBeNull();
  });
});

// ---- F-canvas-fidelity-1: the canvas SCREEN SHELL (Part A rail / Part B header / Part C toolbar) ----

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
    render(
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

    // Launch a run (fireEvent under fake timers, like the keystone) → the run view takes over.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run this team" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
    });
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

  it("Part C: toolbar = back arrow + Run (before the toggle) + always-on spend ($0.00) + status dot, no hint line", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <StrictMode>
        <App onBackToDashboard={onBack} />
      </StrictMode>,
    );
    await screen.findByText("Product manager");

    // The back-to-dashboard arrow (replaces the header's "← Dashboard" text button) — wired.
    const back = screen.getByRole("button", { name: "Back to dashboard" });

    // Run this team comes BEFORE the Single | A/B toggle (design order — the reverse of before).
    const run = screen.getByRole("button", { name: "Run this team" });
    const ab = screen.getByRole("button", { name: "A/B compare" });
    expect(run.compareDocumentPosition(ab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The always-on spend ("$0.00" while idle) + the backend status dot; the old drag hint line is GONE.
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /backend/i })).toBeInTheDocument();
    expect(screen.queryByText(/Drag from a node.*edge to wire it/i)).toBeNull();

    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

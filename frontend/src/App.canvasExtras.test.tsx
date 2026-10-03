import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import App from "./App";
import { ToastProvider } from "./design-system/components";

// M11 on the real <App/> (the control plane stubbed, `docs/superpowers/plans/api/canvas-extras.md`):
// "Use this path…" PATCHes the edge and the time limit PATCHes the agent; Tidy saves positions with
// one Undo (never a version); groups PUT the layout; a spec approval gate's drawer approves with the
// edited spec in one POST to the resolve route.

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Fetch>;
let team: Record<string, unknown>;
let edgePatch: { status: number; body: unknown };
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const calls = (method: string, url: string) =>
  fetchMock.mock.calls
    .filter(([u, init]) => u === url && (init?.method ?? "GET") === method)
    .map(([, init]) => (init?.body ? (JSON.parse(init.body as string) as unknown) : null));

const node = (id: string, role_name: string, kind: string, x: number, y: number, config = {}) => ({
  id,
  role_name,
  kind,
  model: kind === "gate" || kind === "terminal" ? null : "openai/gpt-4o-mini",
  engine: null,
  prompt: null,
  position: { x, y },
  config,
});
const edge = (id: string, s: string, t: string, over = {}) => ({
  id,
  source_node_id: s,
  target_node_id: t,
  edge_type: "default",
  conditions: null,
  ...over,
});
const teamGraph = (over: Record<string, unknown> = {}) => ({
  team_graph_id: "team-1",
  name: "Indicator sprint team",
  nodes: [
    node("pm", "pm", "completion", 0, 0),
    node("eng", "engineer", "agent", 600, 200),
    node("rev", "reviewer", "agent", 300, 400),
    node("ask", "gate", "gate", 900, 600, { gate_kind: "gate_approval", title: "Ask me" }),
  ],
  edges: [edge("e1", "pm", "eng"), edge("e2", "eng", "rev"), edge("e3", "eng", "ask")],
  ...over,
});

beforeEach(() => {
  window.location.hash = "";
  team = teamGraph();
  edgePatch = { status: 200, body: {} };
  fetchMock = vi.fn<Fetch>((url, init) => {
    const method = init?.method ?? "GET";
    if (url === "/api/teams") return reply({ teams: [{ team_graph_id: "team-1", name: "x" }] });
    if (url === "/api/teams/team-1/graph") return reply(team);
    if (url === "/api/teams/team-1/validate")
      return reply({ errors: [], warnings: [], runnable: true });
    if (url.startsWith("/api/teams/team-1/edges/") && method === "PATCH")
      return reply(edgePatch.body, edgePatch.status);
    if (url === "/api/teams/team-1/layout" && method === "PUT")
      return reply(JSON.parse(init?.body as string));
    if (url === "/api/teams/team-1/runs") return reply({ runs: [] });
    return reply({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const renderTeam = async () => {
  render(
    <ToastProvider>
      <App teamId="team-1" onBackToDashboard={vi.fn()} />
    </ToastProvider>,
  );
  await screen.findByTestId("rf__edge-e3");
};
const pathMenu = (edgeId: string) => {
  fireEvent.click(screen.getByTestId(`rf__edge-${edgeId}`));
  return within(screen.getByRole("menu", { name: "Use this path" }));
};

describe("App — M11 the failure path", () => {
  it("If it fails or times out PATCHes the edge's use and reads the team again", async () => {
    await renderTeam();
    const reads = calls("GET", "/api/teams/team-1/graph").length;
    fireEvent.click(pathMenu("e3").getByRole("menuitem", { name: "If it fails or times out" }));
    await waitFor(() =>
      expect(calls("PATCH", "/api/teams/team-1/edges/e3")).toEqual([{ role: "failure" }]),
    );
    await waitFor(() =>
      expect(calls("GET", "/api/teams/team-1/graph").length).toBeGreaterThan(reads),
    );
  });

  it("a refusal says so in the server's words", async () => {
    edgePatch = { status: 409, body: { detail: "The Engineer already has a failure path" } };
    await renderTeam();
    fireEvent.click(pathMenu("e2").getByRole("menuitem", { name: "If it fails or times out" }));
    expect(await screen.findByText("The Engineer already has a failure path")).toBeInTheDocument();
  });

  it("the failure path's Time limit PATCHes the agent's time_limit_s", async () => {
    team = teamGraph({
      nodes: [
        node("pm", "pm", "completion", 0, 0),
        node("eng", "engineer", "agent", 600, 200, { time_limit_s: 600 }),
        node("rev", "reviewer", "agent", 300, 400),
        node("ask", "gate", "gate", 900, 600, { gate_kind: "gate_approval", title: "Ask me" }),
      ],
      edges: [
        edge("e1", "pm", "eng"),
        edge("e2", "eng", "rev"),
        edge("e3", "eng", "ask", { edge_type: "failure" }),
      ],
    });
    await renderTeam();
    const m = pathMenu("e3");
    fireEvent.click(m.getByRole("menuitem", { name: /Time limit/ }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Time limit" })).getByRole("menuitemradio", {
        name: "30 min",
      }),
    );
    await waitFor(() =>
      expect(calls("PATCH", "/api/teams/team-1/nodes/eng")).toEqual([{ time_limit_s: 1800 }]),
    );
  });
});

describe("App — M11 Tidy and groups (positions and labels only, never a version)", () => {
  it("Tidy saves every node's position; Undo saves the old ones back", async () => {
    await renderTeam();
    fireEvent.click(screen.getByRole("button", { name: "Tidy" }));
    await waitFor(() => expect(calls("POST", "/api/teams/team-1/positions")).toHaveLength(1));
    const [first] = calls("POST", "/api/teams/team-1/positions") as {
      positions: Record<string, { x: number }>;
    }[];
    expect(Object.keys(first.positions).sort()).toEqual(["ask", "eng", "pm", "rev"]);
    expect(first.positions.eng.x).toBeLessThan(first.positions.rev.x);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls("POST", "/api/teams/team-1/positions")).toHaveLength(2));
    expect(calls("POST", "/api/teams/team-1/positions")[1]).toEqual({
      positions: {
        pm: { x: 0, y: 0 },
        eng: { x: 600, y: 200 },
        rev: { x: 300, y: 400 },
        ask: { x: 900, y: 600 },
      },
    });
    expect(calls("POST", "/api/teams/team-1/versions")).toHaveLength(0);
  });

  it("reads the groups from the graph's layout; Fold PUTs the layout and shows one box", async () => {
    const group = { id: "g1", label: "Build", node_ids: ["eng", "rev"], folded: false };
    team = teamGraph({ layout: { groups: [group] } });
    await renderTeam();
    fireEvent.click(await screen.findByRole("button", { name: "Fold Build" }));
    await waitFor(() =>
      expect(calls("PUT", "/api/teams/team-1/layout")).toEqual([
        { groups: [{ ...group, folded: true }] },
      ]),
    );
    expect(await screen.findByRole("group", { name: "Build, folded" })).toHaveTextContent(
      "Build2 agents",
    );
    expect(calls("POST", "/api/teams/team-1/versions")).toHaveLength(0);
  });
});

describe("App — M11 Approve with my edits", () => {
  const RUN = "run-12";
  let tasks: unknown[];
  beforeEach(() => {
    tasks = [
      {
        id: 7,
        run_id: RUN,
        kind: "prd_approval",
        priority: "high_blocker",
        blocking: true,
        topic: `gate:${RUN}:n-gate`,
        title: "Approve the spec",
        description: "",
        status: "pending",
        resolution: null,
        resolution_note: null,
        created_at: "2026-10-03T10:42:06Z",
        resolved_at: null,
      },
    ];
    const base = fetchMock.getMockImplementation() as Fetch;
    fetchMock.mockImplementation((url, init) => {
      if (url === `/api/runs/${RUN}`)
        return reply({
          run_id: RUN,
          workflow_status: "PENDING",
          costs: [],
          run: {
            id: RUN,
            team_graph_id: "g",
            idea: "Add an RSI indicator",
            status: "awaiting_human",
            pm_document_id: "doc-1",
            ship_commit_sha: null,
            ship_tag: null,
            cost_total_usd: 0.06,
            created_at: "2026-10-03T10:41:00Z",
            updated_at: "2026-10-03T10:42:06Z",
            library_team_id: "team-1",
          },
        });
      if (url === `/api/runs/${RUN}/tasks`) return reply({ run_id: RUN, tasks });
      if (url === `/api/runs/${RUN}/graph`)
        return reply({
          run_id: RUN,
          team_graph_id: "g",
          nodes: [
            {
              ...node("n-pm", "pm", "completion", 0, 0),
              status: "done",
              iteration: 1,
              invocations: [],
            },
            {
              ...node("n-gate", "prd_gate", "gate", 300, 0, { gate_kind: "prd_approval" }),
              status: "running",
              iteration: 0,
              invocations: [],
            },
            {
              ...node("n-eng", "engineer", "agent", 600, 0),
              status: "idle",
              iteration: 0,
              invocations: [],
            },
          ],
          edges: [edge("a", "n-pm", "n-gate"), edge("b", "n-gate", "n-eng")],
        });
      if (url === "/api/documents/doc-1")
        return reply({
          id: "doc-1",
          name: "spec",
          title: "Shared spec",
          doc_type: "prd",
          run_id: RUN,
          is_shared_spec: true,
          editable: true,
          versions: [
            {
              id: "v2",
              version_no: 2,
              content: "# Add an RSI indicator\n\n- Default length: 20",
              created_at: "2026-10-03T10:42:00Z",
            },
          ],
        });
      if (url === `/api/runs/${RUN}/tasks/7/resolve`) {
        tasks = [];
        return reply({ run_id: RUN, task_id: 7, decision: "approve", resolution: "approved" });
      }
      return base(url, init);
    });
  });

  it("the waiting spec gate opens its drawer; one click approves with the edited spec", async () => {
    const { container } = render(
      <ToastProvider>
        <App teamId="team-1" initialRunId={RUN} />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-id="n-gate"] .rf-gate--awaiting')).not.toBeNull(),
    );
    fireEvent.click(container.querySelector('[data-id="n-gate"]') as HTMLElement);
    const drawer = within(await screen.findByRole("complementary", { name: "Spec v2" }));
    expect(
      drawer.getByText("Your edits become spec v3. The Engineer starts from it."),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    const pm = document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor };
    act(() => {
      pm.editor.commands.setContent("# Add an RSI indicator\n\n- Default length: 14");
    });
    fireEvent.click(drawer.getByRole("button", { name: "Approve with my edits" }));
    await waitFor(() => expect(calls("POST", `/api/runs/${RUN}/tasks/7/resolve`)).toHaveLength(1));
    const [body] = calls("POST", `/api/runs/${RUN}/tasks/7/resolve`) as {
      decision: string;
      edited_spec: string;
    }[];
    expect(body.decision).toBe("approve");
    expect(body.edited_spec).toContain("Default length: 14");
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Spec v2" })).toBeNull(),
    );
  });
});

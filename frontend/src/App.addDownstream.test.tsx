import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { TeamGraphData, TeamGraphNode } from "./lib/api";

// F1b (brief acceptance a): drive the inline "+" through the REAL <App/> and prove the full
// handleAddDownstream orchestration — createTeamNode with a position + the picked body, THEN
// createTeamEdge with { source_node_id, target_node_id: <new id>, role: "forward" } (the FORWARD
// EDGE, not just the node), THEN the new node auto-selected (the existing side panel opens on it).

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

const NEW_NODE = tnode({
  id: "tn-new",
  role_name: "worker",
  kind: "agent",
  engine: "openhands",
  prompt: "default behavior",
  position: { x: 600, y: 0 },
});

// The refetched team includes the new node + its forward edge ONLY after the add POST lands, so the
// panel that opens on `tn-new` finds it in the graph.
let added = false;
function teamGraph(): TeamGraphData {
  const base: TeamGraphNode[] = [
    tnode({ id: "tn-pm", role_name: "pm", kind: "completion", prompt: "PM behavior" }),
    tnode({
      id: "tn-eng",
      role_name: "engineer",
      kind: "agent",
      engine: "openhands",
      prompt: "ENGINEER behavior",
      position: { x: 300, y: 0 },
    }),
  ];
  return {
    team_graph_id: "team-1",
    nodes: added ? [...base, NEW_NODE] : base,
    edges: added
      ? [
          {
            id: "e-new",
            source_node_id: "tn-eng",
            target_node_id: "tn-new",
            edge_type: "default",
            conditions: null,
          },
        ]
      : [],
  };
}

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  added = false;
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
              node_count: 2,
            },
          ],
        }),
      );
    if (url === "/api/templates") return Promise.resolve(jsonOk({ templates: [] }));
    if (url === "/api/teams/team-1/graph") return Promise.resolve(jsonOk(teamGraph()));
    if (url.endsWith("/validate"))
      return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
    if (url === "/api/teams/team-1/nodes" && method === "POST") {
      added = true;
      return Promise.resolve(jsonOk(NEW_NODE));
    }
    if (url === "/api/teams/team-1/edges" && method === "POST")
      return Promise.resolve(
        jsonOk({
          id: "e-new",
          source_node_id: "tn-eng",
          target_node_id: "tn-new",
          edge_type: "default",
          conditions: null,
        }),
      );
    return Promise.resolve(jsonOk({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bodyOf(url: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(
    (c) =>
      urlOf(c[0] as RequestInfo | URL) === url &&
      (c[1] as RequestInit | undefined)?.method === "POST",
  );
  return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
}

describe("App — inline '+' adds a downstream node with a FORWARD edge (F1b)", () => {
  it("posts the node (position + kind), THEN a forward edge to it, THEN selects it", async () => {
    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // The persistent team is on the canvas.
    await screen.findByText("Product manager");

    // Click the "+" on the Engineer (worker) node → the inline kind picker opens → pick Worker.
    // F-canvas-fidelity-2: the affordances now render on hover (state-driven, not CSS), so hover first.
    const engNode = container.querySelector('[data-id="tn-eng"]') as HTMLElement;
    fireEvent.mouseOver(engNode);
    fireEvent.click(within(engNode).getByRole("button", { name: "Add a downstream node" }));
    const picker = screen.getByRole("dialog", { name: "Add a downstream node" });
    fireEvent.click(within(picker).getByText("Worker"));

    // The forward EDGE POST lands (the key proof — not just the node).
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            urlOf(c[0] as RequestInfo | URL) === "/api/teams/team-1/edges" &&
            (c[1] as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );

    // 1. createTeamNode was called with the picked body AND a computed position (right of source).
    expect(bodyOf("/api/teams/team-1/nodes")).toEqual({
      node_kind: "worker",
      position: { x: 600, y: 0 },
    });
    // 2. createTeamEdge forward-connected the source to the NEW node id.
    expect(bodyOf("/api/teams/team-1/edges")).toEqual({
      source_node_id: "tn-eng",
      target_node_id: "tn-new",
      role: "forward",
    });
    // 3. the new node is auto-selected → the existing editable side panel opens on it.
    const panel = await screen.findByRole("textbox", { name: /prompt/i });
    expect(panel).toBeInTheDocument();
  });
});

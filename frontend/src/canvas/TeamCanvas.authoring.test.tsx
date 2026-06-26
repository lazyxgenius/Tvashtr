import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HumanTask, TeamGraphData, TeamGraphNode } from "../lib/api";

// P1.8d-fix1 regression — the authoring-canvas infinite render loop.
//
// ROOT CAUSE: `App` rendered the canvas with `tasks={authoring ? [] : tasks}`. In authoring
// (`runId === null`) that is a FRESH `[]` array literal on EVERY App render. `TeamCanvas`'s in-place
// node-refresh effect lists `tasks` in its dependency array, so each new `[]` re-fired the effect →
// `setNodes(...)` (always-new node objects) → … and in a real browser (async ResizeObserver +
// rAF-driven `fitView`) that feedback closes into "Maximum update depth exceeded", hanging the tab.
// The symptom-level proof (no hang, nodes render) is the real-browser Playwright check; jsdom can't
// reproduce the rAF feedback (the existing App authoring test renders the editable canvas fine), so
// THIS test pins the deterministic ROOT CAUSE: App must hand the canvas a STABLE empty-tasks
// reference across re-renders. It FAILS on the pre-fix code (a new `[]` each render) and PASSES once
// `tasks={authoring ? EMPTY_TASKS : tasks}` uses a module-level constant.
//
// We mock TeamCanvas to capture the exact `tasks` reference it receives on every render, then force
// several App re-renders (the mount-load cascade + a node selection) and assert the reference never
// changes while authoring.

const captured = vi.hoisted(() => ({ tasksRefs: [] as HumanTask[][] }));

vi.mock("./TeamCanvas", () => ({
  TeamCanvas: ({
    tasks,
    editable,
    onSelectNodeId,
  }: {
    tasks: HumanTask[];
    editable?: boolean;
    onSelectNodeId?: (id: string | null) => void;
  }) => {
    // Only the authoring view is under test (the run view legitimately passes the live `tasks`).
    if (editable) captured.tasksRefs.push(tasks);
    return (
      <button type="button" data-testid="force-select" onClick={() => onSelectNodeId?.("tn-eng")}>
        canvas-stub
      </button>
    );
  },
}));

import App from "../App";

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

function teamGraph(): TeamGraphData {
  return {
    team_graph_id: "team-1",
    nodes: [
      tnode({ id: "tn-pm", role_name: "pm", kind: "completion", prompt: "PM behavior" }),
      tnode({ id: "tn-eng", role_name: "engineer", kind: "agent", engine: "openhands" }),
      tnode({
        id: "tn-ship",
        role_name: "ship",
        kind: "terminal",
        model: null,
        prompt: null,
        position: { x: 480, y: 0 },
        config: { terminal_kind: "ship" },
      }),
    ],
    edges: [
      {
        id: "e1",
        source_node_id: "tn-pm",
        target_node_id: "tn-eng",
        edge_type: "default",
        conditions: null,
      },
      {
        id: "e2",
        source_node_id: "tn-eng",
        target_node_id: "tn-ship",
        edge_type: "default",
        conditions: null,
      },
    ],
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

beforeEach(() => {
  captured.tasksRefs = [];
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
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
    if (url === "/api/templates") return Promise.resolve(jsonOk({ templates: [] }));
    if (url === "/api/teams/team-1/graph") return Promise.resolve(jsonOk(teamGraph()));
    if (url.endsWith("/validate"))
      return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
    return Promise.resolve(jsonOk({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App authoring canvas — stable empty-tasks reference (P1.8d-fix1 root cause)", () => {
  it("passes the SAME tasks reference to the editable canvas across re-renders", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    // Let the mount cascade settle (loadTeams → setCurrentTeamId → loadTeam → setTeamGraph/validity):
    // each of those App re-renders evaluates `tasks={authoring ? [] : tasks}` afresh.
    await screen.findByTestId("force-select");
    await act(async () => {
      await Promise.resolve();
    });

    // Force one more App re-render via a node selection (sets selectedNodeId) — another render, so
    // another chance for a fresh `[]` to leak through pre-fix.
    act(() => {
      fireEvent.click(screen.getByTestId("force-select"));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Sanity: the canvas rendered across multiple authoring re-renders (else the test proves nothing).
    expect(captured.tasksRefs.length).toBeGreaterThan(1);
    // Every authoring render must carry the SAME empty-tasks reference. Pre-fix this set has >1
    // distinct `[]` literals (the loop's fuel); post-fix it collapses to the single EMPTY_TASKS const.
    const distinct = new Set(captured.tasksRefs);
    expect(
      distinct.size,
      `expected one stable empty-tasks reference; saw ${distinct.size} distinct arrays across ${captured.tasksRefs.length} renders`,
    ).toBe(1);
    // …and it is in fact empty (we didn't accidentally stabilize a non-empty array).
    expect([...distinct][0]).toHaveLength(0);
  });
});

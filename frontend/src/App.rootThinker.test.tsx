import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { TeamGraphNode } from "./lib/api";
import { __resetBackendStatusForTests } from "./lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "./lib/workspaceStatus";

// Review finding 3: the palette offers no Thinker and the drawer has no capability control, so a
// team whose first node is an Agent (worker) had no way out of `root_not_thinker` in the UI. The
// "Can't run yet" callout now offers the one fix: make that Agent the starting thinker.

const ROOT_MSG =
  "The first node must be a thinker — it writes the shared spec the rest of the team reads. " +
  "Make it a thinker, or start from one.";

function node(over: Partial<TeamGraphNode> & Pick<TeamGraphNode, "id" | "kind">): TeamGraphNode {
  return {
    role_name: over.kind,
    model: "openai/gpt-4o-mini",
    engine: null,
    prompt: "do the work",
    position: { x: 0, y: 0 },
    config: null,
    ...over,
  };
}

const SHIP = node({
  id: "tn-ship",
  kind: "terminal",
  model: null,
  prompt: null,
  config: { terminal_kind: "ship" },
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

let root: TeamGraphNode;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  __resetWorkspaceStatusForTests();
  __resetBackendStatusForTests();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://localhost").pathname;
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ url, method, body });
      if (url === "/health") return Promise.resolve(jsonOk({ status: "ok", db: "ok" }));
      if (url === "/api/teams")
        return Promise.resolve(jsonOk({ teams: [{ team_graph_id: "team-1", name: "My team" }] }));
      if (url === "/api/teams/team-1/graph")
        return Promise.resolve(
          jsonOk({
            team_graph_id: "team-1",
            name: "My team",
            nodes: [root, SHIP],
            edges: [
              {
                id: "e1",
                source_node_id: root.id,
                target_node_id: "tn-ship",
                role: "forward",
                label: null,
                loop_limit: null,
              },
            ],
          }),
        );
      if (url.endsWith("/validate"))
        return Promise.resolve(
          jsonOk(
            root.kind === "completion"
              ? { errors: [], warnings: [], runnable: true }
              : {
                  errors: [
                    {
                      code: "root_not_thinker",
                      message: ROOT_MSG,
                      node_id: root.id,
                      edge_id: null,
                    },
                  ],
                  warnings: [],
                  runnable: false,
                },
          ),
        );
      if (url === `/api/teams/team-1/nodes/${root.id}` && method === "PATCH") {
        root = { ...root, kind: "completion" };
        return Promise.resolve(jsonOk(root));
      }
      if (url === "/api/providers")
        return Promise.resolve(
          jsonOk({ providers: [{ provider: "openai", key_last4: "test", created_at: "" }] }),
        );
      if (url === "/api/engines/subscriptions")
        return Promise.resolve(jsonOk({ subscriptions: [] }));
      return Promise.resolve(jsonOk({}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App — an Agent at the start can be made the starting thinker (finding 3)", () => {
  it("offers the fix in the callout and PATCHes only the capability", async () => {
    root = node({ id: "tn-eng", kind: "agent", engine: "openhands" });
    render(<App teamId="team-1" />);
    const banner = await screen.findByTestId("run-blocked");
    expect(banner).toHaveTextContent(ROOT_MSG);

    fireEvent.click(within(banner).getByRole("button", { name: "Make it the starting thinker" }));

    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PATCH")).toEqual([
        { url: "/api/teams/team-1/nodes/tn-eng", method: "PATCH", body: { capability: "thinker" } },
      ]),
    );
    // The team is read again: the finding is gone, so is the callout.
    await waitFor(() => expect(screen.queryByTestId("run-blocked")).toBeNull());
  });

  it("offers nothing for a Query domain at the start (it can't become a thinker)", async () => {
    root = node({
      id: "tn-dq",
      kind: "domain_query",
      model: null,
      prompt: "{idea}",
      config: { domain_id: null, pass_to_spec: true, on_no_answer: "continue" },
    });
    render(<App teamId="team-1" />);
    const banner = await screen.findByTestId("run-blocked");
    expect(banner).toHaveTextContent(ROOT_MSG);
    expect(
      within(banner).queryByRole("button", { name: "Make it the starting thinker" }),
    ).toBeNull();
  });
});

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { TeamGraphData, TeamGraphNode } from "./lib/api";
import type { SubscriptionStatus } from "./lib/engines";

// M-subs-desktop: on Tvashtr Desktop a node on an anthropic/… or xai/… model runs on the user's OWN
// Claude/Grok CLI. The FE gate lets Run through when a fresh subscription covers the node; Run then
// opens Home's composer, whose Desktop launch tells the server it is desktop-targeted (else the
// hosted preflight refuses it with 422 subscription_only and the run never reaches the user's CLI).

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function tnode(
  over: Partial<TeamGraphNode> & Pick<TeamGraphNode, "id" | "role_name" | "kind">,
): TeamGraphNode {
  return {
    model: "anthropic/claude-sonnet-5",
    engine: null,
    prompt: "behavior",
    position: { x: 0, y: 0 },
    config: null,
    ...over,
  };
}

function subscriptionTeam(): TeamGraphData {
  return {
    team_graph_id: "team-1",
    nodes: [
      tnode({ id: "tn-pm", role_name: "pm", kind: "completion", model: "xai/grok-4.7" }),
      tnode({ id: "tn-eng", role_name: "engineer", kind: "agent" }),
    ],
    edges: [],
  };
}

function connected(provider: "claude" | "grok"): SubscriptionStatus & { runner_fresh: boolean } {
  return {
    provider,
    connected: true,
    state: "connected",
    account_hint: null,
    source: "harness",
    checked_at: "2026-09-24T00:00:00Z",
    runner_fresh: true,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.documentElement.dataset.tvashtrDesktop = "true";
  window.tvashtrDesktop = {
    engines: {
      getStatus: () => Promise.resolve([connected("claude"), connected("grok")]),
      connect: () => Promise.reject(new Error("unused")),
      disconnect: () => Promise.reject(new Error("unused")),
      refresh: () => Promise.reject(new Error("unused")),
    },
  };
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
              name: "Subscription team",
              created_at: "2026-01-01T00:00:00Z",
              node_count: 2,
            },
          ],
        }),
      );
    if (url === "/api/templates") return Promise.resolve(jsonOk({ templates: [] }));
    if (url === "/api/teams/team-1/graph") return Promise.resolve(jsonOk(subscriptionTeam()));
    if (url.endsWith("/validate"))
      return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
    // NO anthropic / xai API key held — the subscriptions are the only credential.
    if (url === "/api/providers") return Promise.resolve(jsonOk({ providers: [] }));
    if (url === "/api/engines/subscriptions")
      return Promise.resolve(jsonOk({ subscriptions: [connected("claude"), connected("grok")] }));
    if (url === "/api/runs" && method === "POST")
      return Promise.resolve(jsonOk({ run_id: "run-desktop-1" }));
    if (url === "/api/runs/run-desktop-1/graph")
      return Promise.resolve(
        jsonOk({ run_id: "run-desktop-1", team_graph_id: "g1", nodes: [], edges: [] }),
      );
    if (url === "/api/runs/run-desktop-1/tasks")
      return Promise.resolve(jsonOk({ run_id: "run-desktop-1", tasks: [] }));
    if (url === "/api/runs/run-desktop-1")
      return Promise.resolve(
        jsonOk({
          run_id: "run-desktop-1",
          workflow_status: "PENDING",
          run: {
            id: "run-desktop-1",
            team_graph_id: "g1",
            idea: "idea",
            status: "running",
            pm_document_id: null,
            ship_commit_sha: null,
            ship_tag: null,
            cost_total_usd: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
          costs: [],
        }),
      );
    return Promise.resolve(jsonOk({}));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
  delete (window as Window & { tvashtrDesktop?: unknown }).tvashtrDesktop;
});

describe("App — Desktop subscription launch (M-subs-desktop F1)", () => {
  it("lets a subscription-only team Run and hands the launch to Home's composer", async () => {
    // The launch itself (with desktop_target) now happens in Home's Start a run composer — see
    // pages/home/HomeRuns.test.tsx "marks a Desktop launch with desktop_target".
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const run = await screen.findByRole("button", { name: "Run this team" });
    await waitFor(() => expect(run).toBeEnabled());
    await act(async () => {
      fireEvent.click(run);
      await Promise.resolve();
    });
    expect(window.location.hash).toBe("#/home");
    const post = fetchMock.mock.calls.find(
      (c) =>
        urlOf(c[0] as RequestInfo | URL) === "/api/runs" &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeUndefined();
    window.location.hash = "";
  });

  it("blocks Run when the Desktop runner has not checked in (subscription not fresh)", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL): Promise<Response> => {
      const url = urlOf(input);
      if (url === "/api/teams")
        return Promise.resolve(
          jsonOk({
            teams: [
              {
                team_graph_id: "team-1",
                name: "Sub",
                created_at: "2026-01-01T00:00:00Z",
                node_count: 2,
              },
            ],
          }),
        );
      if (url === "/api/teams/team-1/graph") return Promise.resolve(jsonOk(subscriptionTeam()));
      if (url.endsWith("/validate"))
        return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
      if (url === "/api/providers") return Promise.resolve(jsonOk({ providers: [] }));
      if (url === "/api/engines/subscriptions")
        return Promise.resolve(
          jsonOk({
            subscriptions: [
              { ...connected("claude"), runner_fresh: false },
              { ...connected("grok"), runner_fresh: false },
            ],
          }),
        );
      return Promise.resolve(jsonOk({}));
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Configure providers" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run this team" })).toBeNull();
  });
});

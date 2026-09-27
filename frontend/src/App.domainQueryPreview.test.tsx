import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { TeamGraphNode } from "./lib/api";
import { __resetBackendStatusForTests } from "./lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "./lib/workspaceStatus";
import { sampleDomains } from "./pages/domains/domainsTestUtils";

// DmF-Canvas-3: the Query domain card follows its drawer's unsaved pick — the title and the domain
// show on the canvas before Save.

const DQ: TeamGraphNode = {
  id: "tn-dq",
  role_name: "domain_query",
  kind: "domain_query",
  model: null,
  engine: null,
  prompt: "{idea}",
  position: { x: 0, y: 0 },
  config: { domain_id: null, pass_to_spec: true, on_no_answer: "continue" },
};

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  __resetWorkspaceStatusForTests();
  __resetBackendStatusForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://localhost").pathname;
      if (url === "/health") return Promise.resolve(jsonOk({ status: "ok", db: "ok" }));
      if (url === "/api/teams")
        return Promise.resolve(jsonOk({ teams: [{ team_graph_id: "team-1", name: "Docs team" }] }));
      if (url === "/api/teams/team-1/graph")
        return Promise.resolve(jsonOk({ team_graph_id: "team-1", nodes: [DQ], edges: [] }));
      if (url.endsWith("/validate"))
        return Promise.resolve(jsonOk({ errors: [], warnings: [], runnable: true }));
      if (url === "/api/domains") return Promise.resolve(jsonOk({ domains: sampleDomains() }));
      if (url.endsWith("/runs")) return Promise.resolve(jsonOk({ runs: [], run: null }));
      return Promise.resolve(jsonOk({}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App — the Query domain card previews the drawer's draft (DmF-Canvas-3)", () => {
  it("shows the picked domain and the new title on the card before Save", async () => {
    const { container } = render(<App teamId="team-1" node="tn-dq" />);
    const card = await waitFor(() => {
      const el = container.querySelector('[data-id="tn-dq"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(card).getByText("Pick a domain")).toBeInTheDocument();

    const drawer = await screen.findByRole("complementary", { name: "Query domain settings" });
    const trigger = within(drawer).getByRole("button", { name: /^Domain / });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(within(drawer).getByRole("option", { name: /Support docs/ }));

    await waitFor(() =>
      expect(within(card).getByText("Look up support docs", { selector: ".rf-node__role" })),
    );
    expect(within(card).getByText("Support docs", { selector: ".rf-node__caption" })).toBeTruthy();
    // Nothing was saved: the card shows the draft, not the stored node.
    expect(within(drawer).getByText("Unsaved changes")).toBeInTheDocument();
  });
});

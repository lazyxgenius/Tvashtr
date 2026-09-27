import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../lib/workspaceStatus";
import { mockApi, sampleDomains } from "../pages/domains/domainsTestUtils";
import { TeamNodePanel } from "./TeamNodePanel";

const NODE = {
  id: "n-dq",
  role_name: "domain_query",
  kind: "domain_query",
  model: null,
  engine: null,
  prompt: "{idea}",
  position: { x: 0, y: 0 },
  config: { domain_id: null, pass_to_spec: true, on_no_answer: "continue" },
} as TeamGraphNode;

beforeEach(() => {
  __resetWorkspaceStatusForTests();
  __resetBackendStatusForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeamNodePanel domain_query", () => {
  it("shows the Query domain drawer in the panel and saves through it", async () => {
    const calls = mockApi({
      "GET /api/domains": { domains: sampleDomains() },
      "GET /api/teams/:t/nodes/:n/runs": { runs: [], run: null },
      "PATCH /api/teams/:t/nodes/:n": {},
    });
    const onSaved = vi.fn(async () => {});
    render(
      <TeamNodePanel
        teamId="team-1"
        node={NODE}
        edges={[]}
        nodes={[NODE]}
        isStartNode={false}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    const panel = screen.getByRole("complementary", { name: "Node settings" });
    expect(
      within(panel).getByText("Query domain", { selector: ".tv-panel__title" }),
    ).toBeInTheDocument();
    const trigger = within(panel).getByRole("button", { name: /^Domain / });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(within(panel).getByRole("option", { name: /Support docs/ }));
    expect(within(panel).getByText("Look up support docs")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
      domain_id: "d-support",
      title: "Look up support docs",
      prompt: "What do our support docs say about {idea}?",
    });
  });
});

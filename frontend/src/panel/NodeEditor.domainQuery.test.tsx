import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { __resetWorkspaceStatusForTests } from "../lib/workspaceStatus";
import { mockApi, sampleDomains } from "../pages/domains/domainsTestUtils";
import { NodeEditor } from "./NodeEditor";

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

function renderDrawer({ onSaved = vi.fn(), onClose = vi.fn() } = {}) {
  render(
    <NodeEditor
      teamId="team-1"
      node={NODE}
      nodes={[NODE]}
      edges={[]}
      isEntry={false}
      cover={null}
      tab="setup"
      onTabChange={vi.fn()}
      focus={false}
      onFocusChange={vi.fn()}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return screen.getByRole("complementary", { name: "Query domain settings" });
}

describe("NodeEditor — a Query domain node (Dm-QueryNode)", () => {
  it("shows the Query domain drawer in F5's shell and saves through it", async () => {
    const calls = mockApi({
      "GET /api/domains": { domains: sampleDomains() },
      "GET /api/teams/:t/nodes/:n/runs": { runs: [], run: null },
      "PATCH /api/teams/:t/nodes/:n": {},
    });
    const onSaved = vi.fn(async () => {});
    const drawer = renderDrawer({ onSaved });
    // The shell's header: the book tile, "Query domain" and the node's title; no agent tabs.
    expect(within(drawer).getByRole("heading", { name: "Query domain" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("tab", { name: /Skills & tools/ })).toBeNull();
    const trigger = within(drawer).getByRole("button", { name: /^Domain / });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(within(drawer).getByRole("option", { name: /Support docs/ }));
    // DM-101: the pick renames the node, and the header's subtitle follows the draft.
    expect(drawer.querySelector(".nd-head__desc")).toHaveTextContent("Look up support docs");
    fireEvent.click(within(drawer).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
      domain_id: "d-support",
      title: "Look up support docs",
      prompt: "What do our support docs say about {idea}?",
    });
  });

  it("closes from the header's Close", () => {
    mockApi({
      "GET /api/domains": { domains: sampleDomains() },
      "GET /api/teams/:t/nodes/:n/runs": { runs: [], run: null },
    });
    const onClose = vi.fn();
    const drawer = renderDrawer({ onClose });
    fireEvent.click(within(drawer).getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

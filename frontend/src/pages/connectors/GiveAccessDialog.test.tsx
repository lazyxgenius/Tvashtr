/**
 * "Give agents access to <name>" (CnF-Page-1): pick a team, tick its agents, Save. The agents
 * that already have it stay ticked and can't be unticked here; saving sends the full set.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectorAgent } from "../../lib/api/connectors";
import { mockApi, renderWithProviders, resetToolkitStores } from "../tools/toolsTestUtils";
import { GiveAccessDialog } from "./GiveAccessDialog";
import { connection } from "./connectorsTestUtils";

const agent = (role_name: string, over: Partial<ConnectorAgent> = {}): ConnectorAgent => ({
  node_id: `n-${role_name}`,
  role_name,
  title: null,
  kind: "agent",
  edits_allowed: role_name === "engineer",
  enabled: false,
  access: null,
  subscription: null,
  ...over,
});
const TEAMS = [
  {
    team_id: "t1",
    team_name: "Indicator sprint team",
    agents: [agent("pm"), agent("engineer"), agent("reviewer", { enabled: true, access: "read" })],
  },
  {
    team_id: "t2",
    team_name: "Docs team",
    agents: [
      agent("writer", { subscription: "claude" }),
      agent("editor", { node_id: "n-editor", enabled: true, access: "write" }),
    ],
  },
];
const usage = (node_id: string, role_name: string) => ({
  node_id,
  role_name,
  title: null,
  team_id: "t1",
  team_name: "Indicator sprint team",
  access: "read",
});

function serve(routes: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/connectors/c1/agents": { teams: TEAMS },
    "PUT /api/connectors/c1/agents": (_u: URL, body: { node_ids: string[] }) => ({
      agents: body.node_ids.map((id) => usage(id, id.slice(2))),
      agent_count: body.node_ids.length,
      team_count: 2,
    }),
    ...routes,
  });
}

function show(over = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderWithProviders(
    <GiveAccessDialog connection={connection(over)} onClose={onClose} onSaved={onSaved} />,
  );
  return { onClose, onSaved };
}
const box = (name: RegExp) => screen.getByRole<HTMLInputElement>("checkbox", { name });

beforeEach(() => resetToolkitStores());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetToolkitStores();
});

describe("GiveAccessDialog", () => {
  it("lists the first team’s agents, with the ones that have it ticked and fixed", async () => {
    serve();
    show();
    const dialog = screen.getByRole("dialog", { name: "Give agents access to Supabase" });
    expect(dialog).toHaveTextContent("Pick a team, then tick the agents that may use Supabase.");
    await screen.findByRole("checkbox", { name: /Engineer/ });
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .map((c) => c.closest("label")?.textContent),
    ).toEqual(["Product manager", "Engineer", "ReviewerAlready has access"]);
    expect(box(/Product manager/)).not.toBeChecked();
    expect(box(/Reviewer/)).toBeChecked();
    expect(box(/Reviewer/)).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Team" })).toHaveValue("t1");
    expect(dialog).toHaveTextContent("They get the connector’s access: read only.");
    // Nothing new ticked: nothing to save.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the full set: who had it, plus the ticked agents of every team", async () => {
    const calls = serve();
    const { onSaved } = show();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Engineer" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Team" }), { target: { value: "t2" } });
    expect(screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toEqual([
      "WriterRuns on your Claude plan. Connectors don’t reach plan runs yet.",
      "EditorAlready has access",
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Writer/ }));
    // The first team's tick is kept while you look at another.
    fireEvent.change(screen.getByRole("combobox", { name: "Team" }), { target: { value: "t1" } });
    expect(box(/Engineer/)).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(calls.at(-1)).toEqual({
      method: "PUT",
      path: "/api/connectors/c1/agents",
      body: { node_ids: ["n-engineer", "n-reviewer", "n-writer", "n-editor"] },
    });
    // The names of the agents that were added, in the dialog's order.
    expect(onSaved.mock.calls[0][0]).toEqual(["Engineer", "Writer"]);
    expect(onSaved.mock.calls[0][1]).toMatchObject({ agent_count: 4, team_count: 2 });
  });

  it("says a read & write connection is chosen per agent", async () => {
    serve();
    show({ access: "write" });
    await screen.findByRole("checkbox", { name: "Engineer" });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Supabase is connected with read & write, so you choose per agent. New agents start on read only.",
    );
  });

  it("keeps the dialog open with the server’s words when the save is refused", async () => {
    serve({
      "PUT /api/connectors/c1/agents": new Response(
        JSON.stringify({
          detail: { code: "not_connected", message: "Finish connecting Supabase first." },
        }),
        { status: 409 },
      ),
    });
    const { onSaved } = show();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Engineer" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Finish connecting Supabase first.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("says when the agents couldn’t load, and retries", async () => {
    let fail = true;
    mockApi({
      "GET /api/connectors/c1/agents": () =>
        fail ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 }) : { teams: TEAMS },
    });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your agents.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("checkbox", { name: "Engineer" })).toBeInTheDocument();
  });

  it("says when there are no agents yet", async () => {
    serve({ "GET /api/connectors/c1/agents": { teams: [] } });
    const { onClose } = show();
    expect(
      await screen.findByText("No agents yet. Your teams’ agents show up here."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

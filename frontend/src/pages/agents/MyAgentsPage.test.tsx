import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { SavedAgent } from "../../lib/api/myAgents";
import { type Call, jsonError, mockApi, resetHomeState } from "../home/homeTestUtils";
import { MyAgentsPage } from "./MyAgentsPage";

// M6 Toolkit › My agents (Agents-Page, Agents-Library's cards, Agents-Rename, Agents-Delete,
// Agents-UseInTeam): the cards, Update a team that is behind (with Undo), the ⋯ menu's Rename and
// Delete, Use in a team, and the empty state (the hint card only).

beforeEach(() => resetHomeState());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetHomeState();
});

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const STRICT: SavedAgent = {
  id: "a1",
  name: "Strict reviewer",
  purpose:
    "Reviews Python changes against the spec. Fails the round if a new indicator isn’t registered.",
  latest: 2,
  updated_at: ago(1500),
  built_on: "Reviewer",
  model: "xai/grok-4.7",
  skills: 2,
  tools: 1,
  file_access: "read-only",
  versions: [
    { number: 2, created_at: ago(1500), included: ["instructions"] },
    { number: 1, created_at: ago(3000), included: ["instructions"] },
  ],
  used_in: [
    { team_id: "t-ind", team_name: "Indicator sprint team", version: 2 },
    { team_id: "t-bug", team_name: "Bugfix squad", version: 1 },
  ],
  behind: [{ team_id: "t-bug", team_name: "Bugfix squad", version: 1 }],
};
const SPEC: SavedAgent = {
  ...STRICT,
  id: "a2",
  name: "Spec writer",
  purpose: "Turns a one-line idea into a one-page spec.",
  latest: 1,
  updated_at: ago(4 * 1440 + 60),
  built_on: "Product manager",
  skills: 1,
  file_access: null,
  versions: [{ number: 1, created_at: ago(5000), included: ["instructions"] }],
  used_in: [{ team_id: "t-docs", team_name: "Docs team", version: 1 }],
  behind: [],
};
const TEAMS = [
  { team_graph_id: "t-docs", name: "Docs team" },
  { team_graph_id: "t-ind", name: "Indicator sprint team" },
];

function setup(agents: SavedAgent[] = [STRICT, SPEC], over: Record<string, unknown> = {}) {
  let list = [...agents];
  const calls: Call[] = mockApi({
    "GET /api/my-agents": () => ({ agents: list }),
    "DELETE /api/my-agents/:id": (u: URL) => {
      list = list.filter((a) => !u.pathname.endsWith(a.id));
      return new Response(null, { status: 204 });
    },
    "POST /api/my-agents/:id/update-team": {
      updated: [{ node_id: "n9", before: { prompt: "v1 text" } }],
      text: "Bugfix squad now uses Strict reviewer v2",
    },
    "POST /api/teams/:t/nodes/:n/undo-agent": { id: "n9" },
    "PATCH /api/my-agents/:id": (_u: URL, body: { name: string }) => ({ ...STRICT, ...body }),
    "GET /api/teams": { teams: TEAMS },
    "POST /api/my-agents/:id/use-in-team": { team_id: "t-docs", node_id: "n-new" },
    ...over,
  });
  render(
    <ToastProvider>
      <MyAgentsPage />
    </ToastProvider>,
  );
  return calls;
}
const card = (name: string) => screen.getByRole("article", { name });

describe("Toolkit › My agents (Agents-Page)", () => {
  it("draws the head, each card and the hint", async () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "My agents" })).toBeInTheDocument();
    expect(
      screen.getByText("Agents you saved from their panels, to use in any team."),
    ).toBeInTheDocument();
    await screen.findByRole("article", { name: "Strict reviewer" });
    const c = card("Strict reviewer");
    expect(within(c).getByText("v2")).toHaveClass("ag-card__ver");
    expect(within(c).getByText(STRICT.purpose)).toBeInTheDocument();
    expect(
      within(c).getByText(
        "Built on Reviewer · xai/grok-4.7 · 2 skills · read-only · updated yesterday",
      ),
    ).toBeInTheDocument();
    expect(
      within(c).getByText("Used in Indicator sprint team (v2) and Bugfix squad (v1)"),
    ).toBeInTheDocument();
    expect(within(c).getByText("1 team is on v1")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Update Bugfix squad" })).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Use in a team" })).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "More for Strict reviewer" })).toBeInTheDocument();
    const s = card("Spec writer");
    expect(
      within(s).getByText("Built on Product manager · xai/grok-4.7 · 1 skill · updated 4 days ago"),
    ).toBeInTheDocument();
    expect(within(s).getByText("Used in Docs team (v1)")).toBeInTheDocument();
    expect(within(s).queryByRole("button", { name: /^Update/ })).toBeNull();
    expect(
      screen.getByText(
        "Save any agent from its panel: More › Save as my agent. Changing a saved agent makes a new version; teams keep theirs until you update them.",
      ),
    ).toBeInTheDocument();
  });

  it("with no saved agents: just the hint card", async () => {
    const calls = setup([]);
    await waitFor(() => expect(calls.some((c) => c.path === "/api/my-agents")).toBe(true));
    expect(await screen.findByText(/^Save any agent from its panel/)).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("Update brings the team to the latest version; the toast's Undo puts it back", async () => {
    const calls = setup();
    await screen.findByRole("article", { name: "Strict reviewer" });
    fireEvent.click(
      within(card("Strict reviewer")).getByRole("button", { name: "Update Bugfix squad" }),
    );
    const toast = await screen.findByText("Bugfix squad now uses Strict reviewer v2");
    expect(calls.find((c) => c.path === "/api/my-agents/a1/update-team")?.body).toEqual({
      team_id: "t-bug",
    });
    fireEvent.click(
      within(toast.closest(".ds-toast") as HTMLElement).getByRole("button", { name: "Undo" }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === "/api/teams/t-bug/nodes/n9/undo-agent")?.body).toEqual({
        before: { prompt: "v1 text" },
      }),
    );
  });

  it("⋯ › Rename: prefilled, saves, and shows a taken name under Name", async () => {
    const calls = setup([STRICT], {
      "PATCH /api/my-agents/:id": jsonError(409, "You already have an agent called Spec writer."),
    });
    await screen.findByRole("article", { name: "Strict reviewer" });
    fireEvent.click(screen.getByRole("button", { name: "More for Strict reviewer" }));
    const menu = screen.getByRole("menu", { name: "More for Strict reviewer" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Rename", "Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename Strict reviewer" });
    expect(dialog).toHaveClass("cv-vdlg--top");
    expect(
      within(dialog).getByText("Teams that use it keep the name they were made with."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Strict reviewer");
    expect(within(dialog).getByLabelText("What it’s for")).toHaveValue(STRICT.purpose);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Spec writer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText("You already have an agent called Spec writer."),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      name: "Spec writer",
      purpose: STRICT.purpose,
    });
  });

  it("⋯ › Delete: says what goes and what stays, then deletes", async () => {
    const calls = setup();
    await screen.findByRole("article", { name: "Strict reviewer" });
    fireEvent.click(screen.getByRole("button", { name: "More for Strict reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Strict reviewer?" });
    expect(
      within(dialog).getByText(
        "Its 2 versions are deleted. Indicator sprint team and Bugfix squad keep their agents exactly as they are.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("article", { name: "Strict reviewer" })).toBeNull(),
    );
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/my-agents/a1")).toBe(true);
    expect(screen.getByRole("article", { name: "Spec writer" })).toBeInTheDocument();
  });

  it("Delete's words for one version and no teams", async () => {
    setup([{ ...SPEC, used_in: [] }]);
    await screen.findByRole("article", { name: "Spec writer" });
    fireEvent.click(screen.getByRole("button", { name: "More for Spec writer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete Spec writer?" })).toHaveTextContent(
      "Its version is deleted.",
    );
  });

  it("Use in a team: pick the team, add it, open that team's canvas on the new agent", async () => {
    window.location.hash = "#/toolkit/agents";
    const calls = setup();
    await screen.findByRole("article", { name: "Strict reviewer" });
    fireEvent.click(within(card("Strict reviewer")).getByRole("button", { name: "Use in a team" }));
    const dialog = screen.getByRole("dialog", { name: "Use Strict reviewer in a team" });
    expect(
      within(dialog).getByText(
        "It’s added to the team as a new agent. Connect it with arrows on the canvas.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("v2 · Reviewer · xai/grok-4.7")).toBeInTheDocument();
    const team = within(dialog).getByLabelText<HTMLSelectElement>("Team");
    await within(team).findByRole("option", { name: "Indicator sprint team" });
    expect(team.value).toBe("t-docs");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t-docs?node=n-new"));
    expect(calls.find((c) => c.path === "/api/my-agents/a1/use-in-team")?.body).toEqual({
      team_id: "t-docs",
    });
  });
});

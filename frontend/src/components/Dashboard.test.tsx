import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import * as api from "../lib/api";
import { Dashboard } from "./Dashboard";

vi.mock("./BackendDot", () => ({ BackendDot: () => null }));
vi.mock("../lib/api", () => ({
  getTeams: vi.fn(),
  listProviders: vi.fn(),
  addProvider: vi.fn(),
  removeProvider: vi.fn(),
  deleteTeam: vi.fn(),
  getTemplates: vi.fn(),
  createTeam: vi.fn(),
  listSecrets: vi.fn().mockResolvedValue([]),
  addSecret: vi.fn(),
  removeSecret: vi.fn(),
  // C7.C: the dashboard now mounts the Tool + Skill library shelves, which fetch on mount.
  listToolLibrary: vi.fn().mockResolvedValue([]),
  listSkillLibrary: vi.fn().mockResolvedValue([]),
}));

const m = api as unknown as {
  getTeams: Mock;
  listProviders: Mock;
  addProvider: Mock;
  removeProvider: Mock;
  deleteTeam: Mock;
  getTemplates: Mock;
  createTeam: Mock;
};

const USER = { id: "u1", email: "op@tvashtr.local" };

// A minimal TeamSummary; override the run/spend fields per test.
function team(over: Record<string, unknown> = {}) {
  return {
    team_graph_id: "t1",
    name: "My team",
    created_at: "2026-03-14T00:00:00Z",
    node_count: 7,
    last_run: null,
    spend_usd: 0,
    ...over,
  };
}

afterEach(() => vi.clearAllMocks());

function setup(over: { teams?: unknown[]; providers?: unknown[]; templates?: unknown[] } = {}) {
  m.getTeams.mockResolvedValue(over.teams ?? []);
  m.listProviders.mockResolvedValue(over.providers ?? []);
  m.getTemplates.mockResolvedValue(over.templates ?? []);
  const onOpenTeam = vi.fn();
  const onLogout = vi.fn();
  render(<Dashboard user={USER} onLogout={onLogout} onOpenTeam={onOpenTeam} />);
  return { onOpenTeam, onLogout };
}

describe("Dashboard", () => {
  it("shows the empty-state prompts for a fresh account (no teams, no providers)", async () => {
    setup({ teams: [], providers: [] });
    expect(await screen.findByText(/Create your first team/i)).toBeInTheDocument();
    expect(screen.getByText(/Add your provider API keys/i)).toBeInTheDocument();
  });

  it("lists the account's teams + providers, and opens a team on click", async () => {
    const { onOpenTeam } = setup({
      teams: [team({ last_run: { status: "completed", at: "x", run_id: "r1" }, spend_usd: 1.5 })],
      providers: [{ provider: "openrouter", key_last4: "9abc", created_at: "x" }],
    });
    // Provider shown as `provider · •••• last4`, secret never present.
    expect(await screen.findByText("openrouter")).toBeInTheDocument();
    expect(screen.getByText(/•••• 9abc/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open My team" }));
    expect(onOpenTeam).toHaveBeenCalledWith("t1");
  });

  it("maps each team's latest-run status to a pill + shows its spend, and the stat strip totals", async () => {
    setup({
      teams: [
        team({
          team_graph_id: "a",
          name: "Ran team",
          node_count: 7,
          last_run: { status: "completed", at: "x", run_id: "r1" },
          spend_usd: 1.5,
        }),
        team({
          team_graph_id: "b",
          name: "Live team",
          node_count: 6,
          last_run: { status: "running", at: "x", run_id: "r2" },
          spend_usd: 0.25,
        }),
        team({
          team_graph_id: "c",
          name: "Fresh team",
          node_count: 5,
          last_run: null,
          spend_usd: 0,
        }),
      ],
    });

    // Status pills (mapped, human labels) + per-row spend.
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Not run yet")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.getByText("$0.25")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();

    // The stat strip: 3 teams · 1 active (the running one) · $1.75 total. (Node counts are 7/6/5
    // and spends are distinct, so the stat numbers "3" / "1" / "$1.75" are each unique text.)
    expect(screen.getByText("Teams in your library")).toBeInTheDocument();
    expect(screen.getByText("Active runs")).toBeInTheDocument();
    expect(screen.getByText("Total spend")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("$1.75")).toBeInTheDocument();
  });

  it("adds a provider key (calls addProvider, then refreshes the list)", async () => {
    setup({ providers: [] });
    await screen.findByText(/Add your provider API keys/i);
    m.addProvider.mockResolvedValue({ provider: "openai", key_last4: "7890" });
    m.listProviders.mockResolvedValueOnce([
      { provider: "openai", key_last4: "7890", created_at: "x" },
    ]);

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-secret-7890" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));

    await waitFor(() => expect(m.addProvider).toHaveBeenCalledWith("openai", "sk-secret-7890"));
    expect(await screen.findByText("openai")).toBeInTheDocument();
  });

  it("removes a provider (calls removeProvider)", async () => {
    setup({ providers: [{ provider: "groq", key_last4: "1111", created_at: "x" }] });
    const removeBtn = await screen.findByRole("button", { name: "Remove groq" });
    m.listProviders.mockResolvedValueOnce([]);
    fireEvent.click(removeBtn);
    await waitFor(() => expect(m.removeProvider).toHaveBeenCalledWith("groq"));
  });

  it("New team → the picker shows Blank + the templates → pick one + a name → creates + opens it", async () => {
    const { onOpenTeam } = setup({
      teams: [],
      templates: [
        { template: "review_loop", name: "Review loop", description: "PM → Engineer ⇄ Reviewer." },
        { template: "two_node", name: "Two node", description: "PM → Engineer." },
      ],
    });
    await screen.findByText(/Create your first team/i);

    fireEvent.click(screen.getByRole("button", { name: "New team" }));

    // The Blank card the FE adds + the server templates.
    expect(await screen.findByText("Blank")).toBeInTheDocument();
    expect(await screen.findByText("Review loop")).toBeInTheDocument();
    expect(screen.getByText("Two node")).toBeInTheDocument();

    // Name it + pick the review_loop card.
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "My squad" } });
    fireEvent.click(screen.getByRole("button", { name: /Review loop/ }));

    m.createTeam.mockResolvedValue({
      team_graph_id: "new1",
      name: "My squad",
      created_at: "x",
      node_count: 6,
      last_run: null,
      spend_usd: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(m.createTeam).toHaveBeenCalledWith("review_loop", "My squad"));
    await waitFor(() => expect(onOpenTeam).toHaveBeenCalledWith("new1"));
  });

  it("delete → confirm names the team; Cancel is a no-op, Delete removes + reloads", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Delete My team" }));

    // The confirm pop-up names the team; Cancel closes it with no delete call.
    expect(await screen.findByText("Delete My team?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Delete My team?")).not.toBeInTheDocument());
    expect(m.deleteTeam).not.toHaveBeenCalled();

    // Re-open + confirm Delete → deleteTeam(id) + a reload (getTeams called again).
    fireEvent.click(screen.getByRole("button", { name: "Delete My team" }));
    await screen.findByText("Delete My team?");
    m.getTeams.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(m.deleteTeam).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(m.getTeams).toHaveBeenCalledTimes(2)); // initial load + post-delete reload
  });

  it("delete confirm warns when a run is in progress", async () => {
    setup({
      teams: [team({ last_run: { status: "running", at: "x", run_id: "r1" }, spend_usd: 0.1 })],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Delete My team" }));
    expect(
      await screen.findByText(/A run is in progress — deleting will stop it/),
    ).toBeInTheDocument();
  });

  // A11y (Filler-A): the delete-confirm dialog is a trapped modal while `confirmTeam` is set.
  it("moves focus into the delete-confirm dialog when it opens", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Delete My team" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete My team" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("closes the delete-confirm dialog on Escape (no delete fired)", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Delete My team" }));
    await screen.findByRole("dialog", { name: "Delete My team" });

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(m.deleteTeam).not.toHaveBeenCalled();
  });
});

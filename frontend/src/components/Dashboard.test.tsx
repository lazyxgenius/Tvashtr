import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import * as api from "../lib/api";
import { Dashboard } from "./Dashboard";

vi.mock("./BackendDot", () => ({ BackendDot: () => null }));
vi.mock("../lib/api", () => ({
  getTeams: vi.fn(),
  listRuns: vi.fn(),
  listProviders: vi.fn(),
  addProvider: vi.fn(),
  removeProvider: vi.fn(),
  createTeam: vi.fn(),
}));

const m = api as unknown as {
  getTeams: Mock;
  listRuns: Mock;
  listProviders: Mock;
  addProvider: Mock;
  removeProvider: Mock;
  createTeam: Mock;
};

const USER = { id: "u1", email: "op@tvashtr.local" };

afterEach(() => vi.clearAllMocks());

function setup(
  over: {
    teams?: unknown[];
    runs?: unknown[];
    providers?: unknown[];
  } = {},
) {
  m.getTeams.mockResolvedValue(over.teams ?? []);
  m.listRuns.mockResolvedValue(over.runs ?? []);
  m.listProviders.mockResolvedValue(over.providers ?? []);
  const onOpenTeam = vi.fn();
  const onLogout = vi.fn();
  render(<Dashboard user={USER} onLogout={onLogout} onOpenTeam={onOpenTeam} />);
  return { onOpenTeam, onLogout };
}

describe("Dashboard", () => {
  it("shows the empty-state prompts for a fresh account (no providers, no runs)", async () => {
    setup({ teams: [], providers: [], runs: [] });
    expect(await screen.findByText(/Add your provider API keys/i)).toBeInTheDocument();
    expect(screen.getByText(/No runs yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Create your first team/i)).toBeInTheDocument();
  });

  it("lists teams, providers, and runs, and opens a team on click", async () => {
    const { onOpenTeam } = setup({
      teams: [{ team_graph_id: "t1", name: "My team", created_at: "x", node_count: 7 }],
      providers: [{ provider: "openrouter", key_last4: "9abc", created_at: "x" }],
      runs: [
        {
          run_id: "r1",
          idea: "build greeting",
          status: "completed",
          created_at: "x",
          repo_path: null,
        },
      ],
    });
    // Provider shown as `provider · •••• last4`, secret never present.
    expect(await screen.findByText("openrouter")).toBeInTheDocument();
    expect(screen.getByText(/•••• 9abc/)).toBeInTheDocument();
    expect(screen.getByText("build greeting")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /My team/ }));
    expect(onOpenTeam).toHaveBeenCalledWith("t1");
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

  it("creates a team and opens it", async () => {
    const { onOpenTeam } = setup({ teams: [] });
    await screen.findByText(/Create your first team/i);
    m.createTeam.mockResolvedValue({
      team_graph_id: "new1",
      name: "New team",
      created_at: "x",
      node_count: 7,
    });
    fireEvent.click(screen.getByRole("button", { name: "+ New team" }));
    await waitFor(() => expect(m.createTeam).toHaveBeenCalledWith("review_loop", "New team"));
    expect(onOpenTeam).toHaveBeenCalledWith("new1");
  });
});

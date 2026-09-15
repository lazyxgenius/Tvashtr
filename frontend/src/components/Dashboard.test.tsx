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
  listSubscriptionStatuses: vi.fn().mockResolvedValue([]),
  putSubscriptionStatus: vi.fn(),
  deleteSubscriptionStatus: vi.fn(),
  // M-runnable: the provider datalist derives from the served catalogue; this mock stands in for it.
  providerSuggestions: vi.fn(() => [
    "openrouter",
    "nvidia_nim",
    "openai",
    "gemini",
    "groq",
    "deepseek",
  ]),
  deleteTeam: vi.fn(),
  renameTeam: vi.fn(),
  getTeamRuns: vi.fn(),
  getTemplates: vi.fn(),
  createTeam: vi.fn(),
  listSecrets: vi.fn().mockResolvedValue([]),
  addSecret: vi.fn(),
  removeSecret: vi.fn(),
  // C7.C: the dashboard now mounts the Tool + Skill library shelves, which fetch on mount.
  listToolLibrary: vi.fn().mockResolvedValue([]),
  listSkillLibrary: vi.fn().mockResolvedValue([]),
  // M-memory S5a: the Memory shelf fetches its facts + review-mode on mount.
  listMemories: vi.fn().mockResolvedValue([]),
  getReviewMode: vi.fn().mockResolvedValue(false),
}));

const m = api as unknown as {
  getTeams: Mock;
  listProviders: Mock;
  addProvider: Mock;
  removeProvider: Mock;
  deleteTeam: Mock;
  renameTeam: Mock;
  getTeamRuns: Mock;
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

// One row in a team's run-history drill-down; override per test.
function run(over: Record<string, unknown> = {}) {
  return {
    run_id: "r1",
    status: "completed",
    idea: "Build a greeting",
    created_at: "2026-03-14T00:00:00Z",
    cost_total_usd: 0.5,
    ...over,
  };
}

function setup(
  over: {
    teams?: unknown[];
    providers?: unknown[];
    templates?: unknown[];
    runs?: unknown[];
  } = {},
) {
  m.getTeams.mockResolvedValue(over.teams ?? []);
  m.listProviders.mockResolvedValue(over.providers ?? []);
  m.getTemplates.mockResolvedValue(over.templates ?? []);
  m.getTeamRuns.mockResolvedValue(over.runs ?? []);
  const onOpenTeam = vi.fn();
  const onOpenRun = vi.fn();
  const onLogout = vi.fn();
  render(
    <Dashboard user={USER} onLogout={onLogout} onOpenTeam={onOpenTeam} onOpenRun={onOpenRun} />,
  );
  return { onOpenTeam, onOpenRun, onLogout };
}

function goEngines() {
  fireEvent.click(screen.getByRole("button", { name: "Engines" }));
}

function goTools() {
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));
}

function goHome() {
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
}

describe("Dashboard", () => {
  it("shows the empty-state prompts for a fresh account (no teams); Engines lives on its own page", async () => {
    setup({ teams: [], providers: [] });
    expect(await screen.findByText(/Create your first team/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Engines/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /MCP secrets/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /tool library/i })).not.toBeInTheDocument();
    goEngines();
    expect(await screen.findByRole("region", { name: /Engines/i })).toBeInTheDocument();
  });

  it("lists the account's teams on Home and opens a team on click", async () => {
    const { onOpenTeam } = setup({
      teams: [team({ last_run: { status: "completed", at: "x", run_id: "r1" }, spend_usd: 1.5 })],
      providers: [{ provider: "openrouter", key_last4: "9abc", created_at: "x" }],
    });
    expect(await screen.findByText("My team")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open My team" }));
    expect(onOpenTeam).toHaveBeenCalledWith("t1");
  });

  it("nav switches Home / Engines / Tools; Home never mounts Engines or Tools shelves", async () => {
    setup({
      teams: [team()],
      providers: [{ provider: "openrouter", key_last4: "9abc", created_at: "x" }],
    });
    expect(await screen.findByText("My team")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Engines/i })).not.toBeInTheDocument();

    goEngines();
    expect(await screen.findByRole("region", { name: /Engines/i })).toBeInTheDocument();
    expect(screen.getByText("openrouter")).toBeInTheDocument();
    expect(screen.queryByText("My team")).not.toBeInTheDocument();

    goTools();
    expect(await screen.findByRole("region", { name: /MCP secrets/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /tool library/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Engines/i })).not.toBeInTheDocument();

    goHome();
    expect(await screen.findByText("My team")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Engines/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /MCP secrets/i })).not.toBeInTheDocument();
  });

  it("initialView=engines lands on the Engines page (Open Engines deep-link)", async () => {
    m.getTeams.mockResolvedValue([]);
    m.listProviders.mockResolvedValue([]);
    m.getTemplates.mockResolvedValue([]);
    m.getTeamRuns.mockResolvedValue([]);
    render(
      <Dashboard
        user={USER}
        onLogout={vi.fn()}
        onOpenTeam={vi.fn()}
        initialView="engines"
      />,
    );
    expect(await screen.findByRole("region", { name: /Engines/i })).toBeInTheDocument();
    expect(screen.queryByText(/Create your first team/i)).not.toBeInTheDocument();
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
    goEngines();
    await screen.findByRole("region", { name: /Engines/i });
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
    goEngines();
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

  // ---- Rename a team (inline, on the row) -------------------------------------------------

  it("rename → the inline editor saves the new name and refetches the list", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Rename My team" }));

    const input = screen.getByLabelText<HTMLInputElement>("New team name");
    expect(input.value).toBe("My team"); // pre-filled, so a small correction is a small edit
    fireEvent.change(input, { target: { value: "Renamed team" } });
    m.renameTeam.mockResolvedValue({ ...team(), name: "Renamed team" });
    m.getTeams.mockResolvedValueOnce([team({ name: "Renamed team" })]);
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(m.renameTeam).toHaveBeenCalledWith("t1", "Renamed team"));
    await waitFor(() => expect(m.getTeams).toHaveBeenCalledTimes(2)); // initial + post-rename
    expect(await screen.findByText("Renamed team")).toBeInTheDocument();
  });

  it("rename → Enter submits without needing the Save button", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Rename My team" }));

    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "Via Enter" } });
    m.renameTeam.mockResolvedValue({ ...team(), name: "Via Enter" });
    fireEvent.keyDown(screen.getByLabelText("New team name"), { key: "Enter" });

    await waitFor(() => expect(m.renameTeam).toHaveBeenCalledWith("t1", "Via Enter"));
  });

  it("rename → Cancel closes the editor and never calls renameTeam", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Rename My team" }));
    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "Discarded" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));

    await waitFor(() => expect(screen.queryByLabelText("New team name")).not.toBeInTheDocument());
    expect(m.renameTeam).not.toHaveBeenCalled();
    expect(screen.getByText("My team")).toBeInTheDocument();
  });

  it("rename → a blank name is refused client-side (no request fired)", async () => {
    setup({ teams: [team()] });
    fireEvent.click(await screen.findByRole("button", { name: "Rename My team" }));

    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(m.renameTeam).not.toHaveBeenCalled());
    expect(screen.getByLabelText("New team name")).toBeInTheDocument(); // still open to fix
  });

  // ---- Per-run history drill-down ------------------------------------------------------------

  it("drill-down → expanding a team row lists its runs with status, spend and idea", async () => {
    setup({
      teams: [team({ last_run: { status: "completed", at: "x", run_id: "r2" }, spend_usd: 1.75 })],
      runs: [
        run({ run_id: "r2", idea: "Newest idea", status: "completed", cost_total_usd: 1.25 }),
        run({ run_id: "r1", idea: "Older idea", status: "failed", cost_total_usd: 0.5 }),
      ],
    });

    fireEvent.click(await screen.findByRole("button", { name: "Show runs for My team" }));

    await waitFor(() => expect(m.getTeamRuns).toHaveBeenCalledWith("t1"));
    expect(await screen.findByText("Newest idea")).toBeInTheDocument();
    expect(screen.getByText("Older idea")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument(); // the run row's own status pill
    expect(screen.getByText("$1.25")).toBeInTheDocument();
  });

  it("drill-down → a run row opens the run view by run_id", async () => {
    const { onOpenRun } = setup({
      teams: [team()],
      runs: [run({ run_id: "run-42", idea: "Ship it" })],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show runs for My team" }));

    fireEvent.click(await screen.findByRole("button", { name: "Open run: Ship it" }));

    // The owning team rides along: the run view lives on that team's canvas.
    expect(onOpenRun).toHaveBeenCalledWith("run-42", "t1");
  });

  it("drill-down → a never-run team shows an empty state, not an error", async () => {
    setup({ teams: [team()], runs: [] });

    fireEvent.click(await screen.findByRole("button", { name: "Show runs for My team" }));

    expect(await screen.findByText(/hasn't run yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/i)).not.toBeInTheDocument();
  });

  it("drill-down → a FAILED history fetch is distinguishable from a never-run team", async () => {
    // Without a panel-local failure state both paths leave `teamRuns` at [], so a 500 would tell a
    // user with a dozen runs — authoritatively — that their team has never run.
    setup({ teams: [team()] });
    m.getTeamRuns.mockRejectedValueOnce(new Error("GET /api/teams/t1/runs -> 500"));

    fireEvent.click(await screen.findByRole("button", { name: "Show runs for My team" }));

    expect(await screen.findByText(/Couldn't load this team's runs/i)).toBeInTheDocument();
    expect(screen.queryByText(/hasn't run yet/i)).not.toBeInTheDocument();
  });

  it("drill-down → a failed fetch does not poison the next team's panel", async () => {
    setup({
      teams: [
        team({ team_graph_id: "a", name: "Team A" }),
        team({ team_graph_id: "b", name: "Team B" }),
      ],
    });
    m.getTeamRuns
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([run({ idea: "B is fine" })]);

    fireEvent.click(await screen.findByRole("button", { name: "Show runs for Team A" }));
    expect(await screen.findByText(/Couldn't load this team's runs/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show runs for Team B" }));

    expect(await screen.findByText("B is fine")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load this team's runs/i)).not.toBeInTheDocument();
  });

  it("drill-down → collapsing hides the run list again", async () => {
    setup({ teams: [team()], runs: [run({ idea: "Transient" })] });
    fireEvent.click(await screen.findByRole("button", { name: "Show runs for My team" }));
    expect(await screen.findByText("Transient")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide runs for My team" }));

    await waitFor(() => expect(screen.queryByText("Transient")).not.toBeInTheDocument());
  });

  it("drill-down → a slow response for one team never lands under another", async () => {
    // THE RACE: expand A, then expand B before A's fetch resolves. `expandedId` inside A's fetch
    // closure is stale, so a mount-only guard would happily render A's runs under B's name.
    setup({
      teams: [
        team({ team_graph_id: "a", name: "Team A" }),
        team({ team_graph_id: "b", name: "Team B" }),
      ],
    });
    let resolveA!: (rows: unknown[]) => void;
    m.getTeamRuns
      .mockImplementationOnce(() => new Promise<unknown[]>((res) => (resolveA = res)))
      .mockResolvedValueOnce([run({ run_id: "b1", idea: "B's own run" })]);

    fireEvent.click(await screen.findByRole("button", { name: "Show runs for Team A" }));
    fireEvent.click(screen.getByRole("button", { name: "Show runs for Team B" }));
    expect(await screen.findByText("B's own run")).toBeInTheDocument();

    resolveA([run({ run_id: "a1", idea: "A's stale run" })]); // arrives late, for a row now closed

    await waitFor(() => expect(screen.queryByText("A's stale run")).not.toBeInTheDocument());
    expect(screen.getByText("B's own run")).toBeInTheDocument();
  });

  it("drill-down → is collapsed by default (no history request on mount)", async () => {
    setup({ teams: [team()] });
    await screen.findByText("My team");

    expect(m.getTeamRuns).not.toHaveBeenCalled();
  });

  // M-legible item 3: deepseek is the product's OWN default agent model, so the remedy screen must
  // suggest the one provider a default run most needs.
  it("offers deepseek — the default agent model — in the provider datalist (M-legible)", async () => {
    setup({ providers: [] });
    goEngines();
    await screen.findByRole("region", { name: /Engines/i });
    const option = document.querySelector('#tv-provider-list option[value="deepseek"]');
    expect(option).not.toBeNull();
  });

  // ---- Failed-team recovery (UX polish #2) ----------------------------------------------------

  it("failed team shows View last run / Retry and the last-run error when the payload has one", async () => {
    const { onOpenTeam, onOpenRun } = setup({
      teams: [
        team({
          last_run: {
            status: "failed",
            at: "2026-03-14T00:00:00Z",
            run_id: "r-fail",
            error: "No API key for openrouter",
          },
        }),
      ],
    });

    expect(await screen.findByText("No API key for openrouter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View last run of My team" }));
    expect(onOpenRun).toHaveBeenCalledWith("r-fail", "t1");

    fireEvent.click(screen.getByRole("button", { name: "Retry My team" }));
    expect(onOpenTeam).toHaveBeenCalledWith("t1");
  });

  it("failed status pill opens the last run", async () => {
    const { onOpenRun } = setup({
      teams: [
        team({
          last_run: { status: "failed", at: "2026-03-14T00:00:00Z", run_id: "r-fail" },
        }),
      ],
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Failed — view last run of My team" }),
    );
    expect(onOpenRun).toHaveBeenCalledWith("r-fail", "t1");
  });

  it("completed teams do not show failed-recovery actions", async () => {
    setup({
      teams: [team({ last_run: { status: "completed", at: "x", run_id: "r1" } })],
    });
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View last run/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retry /i })).not.toBeInTheDocument();
  });

  // ---- Distinguishing team names (UX polish #3) ----------------------------------------------

  it("shows a secondary id snippet so two identically named teams are distinguishable", async () => {
    setup({
      teams: [
        team({
          team_graph_id: "aaaaaaaa-1111-1111-1111-111111111111",
          name: "New team",
        }),
        team({
          team_graph_id: "bbbbbbbb-2222-2222-2222-222222222222",
          name: "New team",
        }),
      ],
    });
    expect(await screen.findAllByRole("button", { name: "Open New team" })).toHaveLength(2);
    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText(/bbbbbbbb/)).toBeInTheDocument();
  });
});

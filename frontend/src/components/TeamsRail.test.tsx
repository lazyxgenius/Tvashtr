import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Template, TeamSummary } from "../lib/api";
import { TeamsRail } from "./TeamsRail";

// P1.8b team library: the left teams rail. Plain component (no React Flow / no timers), so
// user-event is safe. Covers: render + highlight the current team; select hands the id up; the
// `+ New team` picker + the create flow; and the per-row delete confirm.

const TEAMS: TeamSummary[] = [
  { team_graph_id: "t-a", name: "Team A", created_at: "2026-01-01T00:00:00Z", node_count: 7 },
  { team_graph_id: "t-b", name: "Team B", created_at: "2026-01-02T00:00:00Z", node_count: 5 },
];

const TEMPLATES: Template[] = [
  { template: "two_node", name: "PM → Engineer", description: "No review step." },
  { template: "review_loop", name: "PM → Engineer ↔ Reviewer", description: "Adds a Reviewer." },
];

function renderRail(over: Partial<Parameters<typeof TeamsRail>[0]> = {}) {
  const props = {
    teams: TEAMS,
    currentTeamId: "t-a",
    templates: TEMPLATES,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  render(<TeamsRail {...props} />);
  return props;
}

describe("TeamsRail", () => {
  it("renders every team and highlights the current one", () => {
    renderRail({ currentTeamId: "t-b" });
    expect(screen.getByText("Team A")).toBeInTheDocument();
    expect(screen.getByText("Team B")).toBeInTheDocument();
    // The current team's row is marked aria-current; the other is not.
    expect(screen.getByText("Team B").closest("button")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Team A").closest("button")).toHaveAttribute("aria-current", "false");
  });

  it("hands the selected team id up", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderRail();
    await user.click(screen.getByText("Team B"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("t-b");
  });

  it("opens the template picker and creates a team from a chosen preset + name", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderRail();

    // The picker is closed until + New team.
    expect(screen.queryByLabelText("New team from a template")).toBeNull();
    await user.click(screen.getByRole("button", { name: /New team/ }));
    const picker = screen.getByLabelText("New team from a template");

    // Both presets render with their descriptions; Create is gated until a name is typed.
    expect(within(picker).getByText("PM → Engineer")).toBeInTheDocument();
    expect(within(picker).getByText("PM → Engineer ↔ Reviewer")).toBeInTheDocument();
    const create = within(picker).getByRole("button", { name: "Create team" });
    expect(create).toBeDisabled();

    // Choose the review_loop preset and name it, then create.
    await user.click(within(picker).getByText("PM → Engineer ↔ Reviewer"));
    await user.type(within(picker).getByRole("textbox"), "My shipping team");
    expect(create).toBeEnabled();
    await user.click(create);

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("review_loop", "My shipping team");
  });

  it("defaults the picker to the first template when none is clicked", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderRail();
    await user.click(screen.getByRole("button", { name: /New team/ }));
    const picker = screen.getByLabelText("New team from a template");
    await user.type(within(picker).getByRole("textbox"), "Quick team");
    await user.click(within(picker).getByRole("button", { name: "Create team" }));
    // templates[0] is two_node — chosen by default with no explicit click.
    expect(onCreate).toHaveBeenCalledWith("two_node", "Quick team");
  });

  it("requires a confirm before deleting a team", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderRail();

    // The delete icon does not delete immediately — it reveals an inline confirm.
    await user.click(screen.getByRole("button", { name: "Delete Team A" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    // Cancel backs out without deleting.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();

    // Confirm actually deletes the right team.
    await user.click(screen.getByRole("button", { name: "Delete Team A" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("t-a");
  });
});

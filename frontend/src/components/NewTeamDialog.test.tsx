import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import * as api from "../lib/api";
import { NewTeamDialog } from "./NewTeamDialog";

// Only the two calls NewTeamDialog makes; `getTemplates` resolves empty so just the FE-added Blank
// card shows (the picker content is covered by Dashboard.test.tsx — here we exercise create()).
vi.mock("../lib/api", () => ({
  createTeam: vi.fn(),
  getTemplates: vi.fn(),
}));

const m = api as unknown as { createTeam: Mock; getTemplates: Mock };

afterEach(() => vi.clearAllMocks());

function renderDialog() {
  m.getTemplates.mockResolvedValue([]);
  const onOpenTeam = vi.fn();
  const onClose = vi.fn();
  render(<NewTeamDialog onOpenTeam={onOpenTeam} onClose={onClose} />);
  return { onOpenTeam, onClose };
}

describe("NewTeamDialog", () => {
  it("creates the selected starting point and opens the new team", async () => {
    const { onOpenTeam } = renderDialog();
    m.createTeam.mockResolvedValue({
      team_graph_id: "new1",
      name: "Launch squad",
      created_at: "x",
      node_count: 1,
      last_run: null,
      spend_usd: 0,
    });

    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Launch squad" } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(m.createTeam).toHaveBeenCalledWith("blank", "Launch squad"));
    await waitFor(() => expect(onOpenTeam).toHaveBeenCalledWith("new1"));
  });

  it("does not default the name to New team and refuses a blank name", async () => {
    renderDialog();
    const input = screen.getByLabelText<HTMLInputElement>("Team name");
    expect(input.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(m.createTeam).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/name/i);

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(m.createTeam).not.toHaveBeenCalled();
  });

  it("surfaces an error and re-enables the button when create() fails (the mounted guard path)", async () => {
    const { onOpenTeam } = renderDialog();
    m.createTeam.mockRejectedValue(new Error("network down"));

    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Will fail" } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    // Still mounted, so `if (mountedRef.current)` lets the catch's set-states through: the error
    // shows and the button re-enables. (The guard only suppresses these AFTER unmount.)
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't create the team/);
    expect(screen.getByRole("button", { name: "Create team" })).toBeEnabled();
    expect(onOpenTeam).not.toHaveBeenCalled();
  });

  // A11y (Filler-A): the shared modal focus-trap is wired in (always active for this dialog).
  it("moves focus into the dialog when it opens", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "New team" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("closes on Escape", async () => {
    const { onClose } = renderDialog();
    await screen.findByRole("dialog", { name: "New team" });

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

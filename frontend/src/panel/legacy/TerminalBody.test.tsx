import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../../lib/api";
import { TerminalBody } from "./TerminalBody";

afterEach(() => vi.unstubAllGlobals());

describe("TerminalBody", () => {
  it("flips Ship / Stop live, and Save PATCHes terminal_kind", async () => {
    const node: TeamGraphNode = {
      id: "n-ship",
      role_name: "ship",
      kind: "terminal",
      model: null,
      engine: null,
      prompt: null,
      position: { x: 0, y: 0 },
      config: { terminal_kind: "ship" },
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(node) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<TerminalBody teamId="team-1" node={node} onSaved={onSaved} />);

    const ship = screen.getByRole("button", { name: "Ship it" });
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(ship).toHaveAttribute("aria-pressed", "true");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.click(stop);
    expect(stop).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/teams/team-1/nodes/n-ship");
    expect(JSON.parse(init.body as string)).toEqual({ terminal_kind: "stop" });
  });
});

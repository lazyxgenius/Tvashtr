import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../../lib/api";
import { DomainQueryBody } from "./DomainQueryBody";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    listDomains: vi.fn(() =>
      Promise.resolve([
        {
          domain_id: "dom-1",
          name: "Support",
          template: "support",
          config: {},
          status: "ready",
          doc_count: 2,
          created_at: "x",
          updated_at: "x",
        },
      ]),
    ),
    updateDomainQueryNode: vi.fn(() => Promise.resolve({})),
  };
});

const { updateDomainQueryNode } = await import("../../lib/api");

const node: TeamGraphNode = {
  id: "n-dq",
  role_name: "domain_query",
  kind: "domain_query",
  model: null,
  engine: null,
  prompt: "{idea}",
  position: { x: 0, y: 0 },
  config: { domain_id: null },
};

describe("DomainQueryBody", () => {
  it("saves domain_id + prompt", async () => {
    const user = userEvent.setup();
    render(<DomainQueryBody teamId="team-1" node={node} onSaved={() => {}} />);
    await screen.findByRole("option", { name: "Support" });
    await user.selectOptions(screen.getByLabelText("Domain"), "dom-1");
    // fireEvent: userEvent treats `{…}` as special key sequences.
    fireEvent.change(screen.getByLabelText(/prompt/i), { target: { value: "Explain {idea}" } });
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(updateDomainQueryNode).toHaveBeenCalledWith(
        "team-1",
        "n-dq",
        expect.objectContaining({ domain_id: "dom-1", prompt: "Explain {idea}" }),
      ),
    );
  });

  it("shows the Query domain discoverability hint", async () => {
    render(<DomainQueryBody teamId="team-1" node={node} onSaved={() => {}} />);
    const hint = await screen.findByTestId("domains-query-hint");
    expect(hint.textContent).toMatch(/Query domain/i);
    expect(hint.textContent).toMatch(/Chat|Domains MCP/i);
  });
});

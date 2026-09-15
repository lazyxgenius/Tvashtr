import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TeamNodePanel } from "./TeamNodePanel";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listDomains: vi.fn(async () => [
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
    updateDomainQueryNode: vi.fn(async (_t, _n, body) => ({
      id: "n-dq",
      role_name: "domain_query",
      kind: "domain_query",
      model: null,
      engine: null,
      prompt: body.prompt ?? "{idea}",
      position: { x: 0, y: 0 },
      config: { domain_id: body.domain_id ?? null },
    })),
  };
});

const { updateDomainQueryNode } = await import("../lib/api");

describe("TeamNodePanel domain_query", () => {
  it("saves domain_id + prompt", async () => {
    const user = userEvent.setup();
    const node = {
      id: "n-dq",
      role_name: "domain_query",
      kind: "domain_query",
      model: null,
      engine: null,
      prompt: "{idea}",
      position: { x: 0, y: 0 },
      config: { domain_id: null },
    };
    render(
      <TeamNodePanel
        teamId="team-1"
        node={node as any}
        edges={[]}
        isStartNode={false}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    // Wait until listDomains populates the select (exact "Domain" avoids the drawer title).
    await screen.findByRole("option", { name: "Support" });
    await user.selectOptions(screen.getByLabelText("Domain"), "dom-1");
    const prompt = screen.getByLabelText(/prompt/i);
    // fireEvent: userEvent treats `{…}` as special key sequences.
    fireEvent.change(prompt, { target: { value: "Explain {idea}" } });
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(updateDomainQueryNode).toHaveBeenCalledWith(
        "team-1",
        "n-dq",
        expect.objectContaining({ domain_id: "dom-1", prompt: "Explain {idea}" }),
      ),
    );
  });
});

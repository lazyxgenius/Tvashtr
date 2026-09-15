import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "../lib/api";
import { NewDomainDialog } from "./NewDomainDialog";

vi.mock("../lib/api", () => ({
  createDomain: vi.fn(),
  getDomainTemplates: vi.fn(),
}));

const m = api as unknown as { createDomain: Mock; getDomainTemplates: Mock };

describe("NewDomainDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getDomainTemplates.mockResolvedValue([
      { template: "support", name: "Support", description: "Help docs" },
    ]);
    m.createDomain.mockResolvedValue({
      domain_id: "d1",
      name: "Support docs",
      template: "support",
      config: {},
      status: "empty",
      doc_count: 0,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    });
  });

  it("creates with selected template and name", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<NewDomainDialog onCreated={onCreated} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/domain name/i), "Support docs");
    await user.click(await screen.findByRole("button", { name: /Support/i }));
    await user.click(screen.getByRole("button", { name: /Create domain/i }));
    await waitFor(() => expect(m.createDomain).toHaveBeenCalledWith("support", "Support docs"));
    expect(onCreated).toHaveBeenCalledWith("d1");
  });

  it("requires a name", async () => {
    const user = userEvent.setup();
    render(<NewDomainDialog onCreated={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Create domain/i }));
    expect(m.createDomain).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

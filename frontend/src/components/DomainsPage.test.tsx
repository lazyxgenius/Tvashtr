import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "../lib/api";
import { DomainsPage } from "./DomainsPage";

vi.mock("../lib/api", () => ({
  listDomains: vi.fn(),
  getDomainTemplates: vi.fn(),
  createDomain: vi.fn(),
  getDomain: vi.fn(),
  updateDomain: vi.fn(),
  deleteDomain: vi.fn(),
}));

const m = api as unknown as {
  listDomains: Mock;
  getDomainTemplates: Mock;
  getDomain: Mock;
};

describe("DomainsPage list", () => {
  beforeEach(() => {
    m.listDomains.mockResolvedValue([]);
    m.getDomainTemplates.mockResolvedValue([
      { template: "blank", name: "Blank", description: "Default config" },
    ]);
  });

  it("shows empty state and opens new-domain dialog", async () => {
    const user = userEvent.setup();
    render(<DomainsPage />);
    expect(await screen.findByText(/No domains yet/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /New domain/i }));
    expect(screen.getByRole("dialog", { name: /New domain/i })).toBeTruthy();
  });

  it("lists domains and opens detail on click", async () => {
    const user = userEvent.setup();
    m.listDomains.mockResolvedValue([
      {
        domain_id: "d1",
        name: "Support docs",
        template: "support",
        config: { embedding: { model: "text-embedding-3-small" } },
        status: "empty",
        doc_count: 0,
        created_at: "2026-09-15T00:00:00Z",
        updated_at: "2026-09-15T00:00:00Z",
      },
    ]);
    m.getDomain.mockResolvedValue({
      domain_id: "d1",
      name: "Support docs",
      template: "support",
      config: {
        chunking: { strategy: "fixed", size: 600, overlap: 100 },
        embedding: { model: "text-embedding-3-small" },
        retrieval: { top_k: 8, mode: "dense" },
        generation: { model: null },
      },
      status: "empty",
      doc_count: 0,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    });
    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    await waitFor(() => expect(m.getDomain).toHaveBeenCalledWith("d1"));
    expect(await screen.findByRole("tab", { name: /Overview/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Config/i })).toBeTruthy();
  });
});

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
  listDomainDocuments: vi.fn(),
  uploadDomainDocument: vi.fn(),
  deleteDomainDocument: vi.fn(),
  ingestDomain: vi.fn(),
}));

const m = api as unknown as {
  listDomains: Mock;
  getDomainTemplates: Mock;
  getDomain: Mock;
  listDomainDocuments: Mock;
  uploadDomainDocument: Mock;
  deleteDomainDocument: Mock;
  ingestDomain: Mock;
};

describe("DomainsPage list", () => {
  beforeEach(() => {
    m.listDomains.mockResolvedValue([]);
    m.getDomainTemplates.mockResolvedValue([
      { template: "blank", name: "Blank", description: "Default config" },
    ]);
    m.listDomainDocuments.mockResolvedValue([]);
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

describe("DomainsPage delete confirm", () => {
  const detail = {
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
  };

  beforeEach(() => {
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
    m.getDomain.mockResolvedValue(detail);
    m.listDomainDocuments.mockResolvedValue([]);
    (api.deleteDomain as Mock).mockResolvedValue(undefined);
    m.listDomains.mockClear();
    m.getDomain.mockClear();
    m.listDomainDocuments.mockClear();
    (api.deleteDomain as Mock).mockClear();
  });

  it("does not delete when confirm is cancelled", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    await screen.findByRole("button", { name: /Delete domain/i });
    await user.click(screen.getByRole("button", { name: /Delete domain/i }));
    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete this domain? This cannot be undone.",
    );
    expect(api.deleteDomain).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("deletes when confirm is accepted", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    m.listDomains
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValue([]);
    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    await user.click(await screen.findByRole("button", { name: /Delete domain/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteDomain).toHaveBeenCalledWith("d1"));
    confirmSpy.mockRestore();
  });
});

describe("DomainsPage Documents tab", () => {
  beforeEach(() => {
    m.listDomains.mockResolvedValue([]);
    m.getDomainTemplates.mockResolvedValue([
      { template: "blank", name: "Blank", description: "Default config" },
    ]);
    m.listDomainDocuments.mockResolvedValue([]);
    m.ingestDomain.mockResolvedValue(undefined);
  });

  it("shows Documents tab with ingest and no Chat tab", async () => {
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
      status: "indexing",
      doc_count: 1,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    });
    m.listDomainDocuments.mockResolvedValue([
      {
        document_id: "doc1",
        domain_id: "d1",
        filename: "notes.txt",
        content_type: "text/plain",
        byte_size: 5,
        ingest_status: "pending",
        error_message: null,
        version: 1,
        created_at: "2026-09-15T00:00:00Z",
        updated_at: "2026-09-15T00:00:00Z",
      },
    ]);
    m.ingestDomain.mockResolvedValue({
      domain_id: "d1",
      workflow_id: "wf1",
      status: "indexing",
    });

    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    await user.click(await screen.findByRole("tab", { name: /Documents/i }));
    expect(await screen.findByText("notes.txt")).toBeTruthy();
    expect(screen.getByText(/pending/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Ingest/i }));
    await waitFor(() => expect(m.ingestDomain).toHaveBeenCalledWith("d1"));
    expect(screen.queryByRole("tab", { name: /Chat/i })).toBeNull();
  });
});

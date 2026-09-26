import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNewDomain,
  domainFileUrl,
  getDomainDetail,
  getDomainFilePieces,
  listDomainFiles,
  normalizeDomainDetail,
  normalizeDomainFile,
  rereadDomainFiles,
} from "./domains";

/** The URL of the n-th fetch call. */
function urlOf(mock: ReturnType<typeof answer>, n: number): string {
  const input = mock.mock.calls[n]?.[0];
  return typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "");
}

function answer(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Domains clients (G2)", () => {
  it("defaults an old or odd file answer instead of failing", () => {
    expect(normalizeDomainFile({ filename: "x.md" })).toBeNull();
    const f = normalizeDomainFile({
      document_id: "d1",
      filename: "notes.PDF",
      ingest_status: "error",
      problem: { message: "No text found." },
      pieces: "12",
    });
    expect(f).toMatchObject({
      kind: "PDF",
      phase: "needs_attention",
      pieces: null,
      problem: { kind: "other", message: "No text found.", fix: null },
      matched: null,
    });
    expect(
      normalizeDomainFile({ document_id: "d2", filename: "a.md", ingest_status: "indexing" }),
    ).toMatchObject({ phase: "reading", kind: "MD" });
  });

  it("derives the detail keys an older backend lacks", () => {
    const d = normalizeDomainDetail({
      domain_id: "x",
      name: "Support docs",
      state: "ready",
      files: { total: 2, ready: 2 },
      reading_model: { key_saved: true },
    });
    expect(d?.setup).toEqual({ key: true, files_read: true, tested: false, used: false });
    expect(d?.answer_model.resolved).toBeNull();
    expect(normalizeDomainDetail({ name: "no id" })).toBeNull();
  });

  it("reports a missing domain as a 404 ApiError", async () => {
    answer({ detail: "domain not found" }, 404);
    await expect(getDomainDetail("gone")).rejects.toMatchObject({ status: 404 });
  });

  it("sends search and filter, and reads the counts", async () => {
    const fetchMock = answer({
      documents: [{ document_id: "d1", filename: "refund-policy.md", phase: "ready", pieces: 42 }],
      counts: { all: 14, ready: 13, reading: 0, needs_attention: 1 },
      total_pieces: 1212,
    });
    const list = await listDomainFiles("dom", { q: " refund ", status: "needs_attention" });
    expect(urlOf(fetchMock, 0)).toBe("/api/domains/dom/documents?q=refund&status=needs_attention");
    expect(list.counts).toEqual({ all: 14, ready: 13, reading: 0, needs_attention: 1 });
    expect(list.total_pieces).toBe(1212);
    expect(list.documents[0]).toMatchObject({ filename: "refund-policy.md", pieces: 42 });
    await listDomainFiles("dom");
    expect(urlOf(fetchMock, 1)).toBe("/api/domains/dom/documents");
  });

  it("pages pieces and re-reads files", async () => {
    const fetchMock = answer({
      document: { document_id: "d1", filename: "a.md", phase: "ready" },
      pieces: [{ number: 1, chars: 5, page: null, text: "hello" }, { number: "bad" }],
      total: 1,
      used_in_answers: { count: 2, of: 20 },
    });
    const p = await getDomainFilePieces("dom", "d1", { q: "hi", offset: 50, limit: 50 });
    expect(urlOf(fetchMock, 0)).toBe(
      "/api/domains/dom/documents/d1/pieces?q=hi&offset=50&limit=50",
    );
    expect(p.pieces).toEqual([{ number: 1, chars: 5, page: null, text: "hello" }]);
    expect(p.used_in_answers).toEqual({ count: 2, of: 20 });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ reading: 1, state: "started" }), { status: 202 }),
    );
    await expect(rereadDomainFiles("dom", { document_ids: ["d1"] })).resolves.toEqual({
      reading: 1,
      state: "started",
    });
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ document_ids: ["d1"] });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "This domain is already re-reading." }), {
        status: 409,
      }),
    );
    await expect(rereadDomainFiles("dom")).rejects.toThrow("This domain is already re-reading.");
    expect(domainFileUrl("dom", "d1")).toBe("/api/domains/dom/documents/d1/file");
  });
});

describe("Domains clients (G3)", () => {
  it("creates a domain and validates the summary it answers with", async () => {
    const mock = answer({
      domain_id: "d-new",
      name: "Support docs",
      state: "empty",
      reading_model: { slug: "openai/text-embedding-3-small", provider: "openai", key_saved: true },
    });
    const d = await createNewDomain({ name: "Support docs", template: "support" });
    expect(d).toMatchObject({ domain_id: "d-new", name: "Support docs", state: "empty" });
    expect(d.setup.key).toBe(true);
    expect(urlOf(mock, 0)).toContain("/api/domains");
    const init = mock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Support docs", template: "support" });
  });

  it("carries the server's copy on a name clash", async () => {
    answer({ detail: "You already have a domain named “Support docs”." }, 409);
    await expect(
      createNewDomain({ name: "Support docs", template: "support" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "You already have a domain named “Support docs”.",
    });
  });

  it("falls back to the backend-down copy", async () => {
    answer("oops", 500);
    await expect(createNewDomain({ name: "X", template: "blank" })).rejects.toMatchObject({
      status: 500,
      message: "Couldn’t create the domain — is the backend running?",
    });
  });
});

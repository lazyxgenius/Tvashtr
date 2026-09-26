import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNewDomain,
  deleteDomainFile,
  domainFileUrl,
  duplicateDomain,
  getDomainDetail,
  getDomainFilePieces,
  listDomainFiles,
  normalizeDomainAnswer,
  normalizeDomainDetail,
  normalizeDomainFile,
  normalizeTestCase,
  normalizeTestRun,
  removeDomain,
  renameDomain,
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

describe("Domains clients (G4)", () => {
  it("renames and carries the server's copy on a clash", async () => {
    const mock = answer({ domain_id: "dom", name: "Q3 2026 filings" });
    await renameDomain("dom", "Q3 2026 filings");
    expect(urlOf(mock, 0)).toContain("/api/domains/dom");
    expect(mock.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(mock.mock.calls[0]?.[1]?.body as string)).toEqual({
      name: "Q3 2026 filings",
    });
    mock.mockRestore();
    answer({ detail: "You already have a domain named “Support docs”." }, 409);
    await expect(renameDomain("dom", "Support docs")).rejects.toMatchObject({
      status: 409,
      message: "You already have a domain named “Support docs”.",
    });
  });

  it("duplicates and validates the copy's summary", async () => {
    const mock = answer({ domain_id: "d-copy", name: "Support docs copy", state: "empty" });
    const d = await duplicateDomain("dom");
    expect(d).toMatchObject({ domain_id: "d-copy", name: "Support docs copy" });
    expect(urlOf(mock, 0)).toContain("/api/domains/dom/duplicate");
    expect(JSON.parse(mock.mock.calls[0]?.[1]?.body as string)).toEqual({});
  });

  it("deletes a domain and reads what it tidied", async () => {
    const mock = answer({ domain_id: "dom", deleted: true, steps_cleared: 1, agents_cleared: 2 });
    await expect(removeDomain("dom")).resolves.toEqual({ steps_cleared: 1, agents_cleared: 2 });
    expect(mock.mock.calls[0]?.[1]?.method).toBe("DELETE");
    mock.mockRestore();
    answer({ domain_id: "dom", deleted: true });
    await expect(removeDomain("dom")).resolves.toEqual({ steps_cleared: 0, agents_cleared: 0 });
  });

  it("deletes a file with keepalive, and a file already gone counts as deleted", async () => {
    const mock = answer({ document_id: "d1", deleted: true });
    await deleteDomainFile("dom", "d1", { keepalive: true });
    expect(urlOf(mock, 0)).toContain("/api/domains/dom/documents/d1");
    expect(mock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE", keepalive: true });
    mock.mockRestore();
    answer({ detail: "document not found" }, 404);
    await expect(deleteDomainFile("dom", "d1")).resolves.toBeUndefined();
    vi.restoreAllMocks();
    answer("oops", 500);
    await expect(deleteDomainFile("dom", "d1")).rejects.toMatchObject({ status: 500 });
  });
});

describe("Domains clients (G6)", () => {
  it("normalizeDomainAnswer reads new answers and degrades old rows", () => {
    const cite = { document_id: "d1", filename: "a.md", ordinal: 2, excerpt: "x" };
    const fresh = normalizeDomainAnswer({
      message_id: "m",
      content: "raw [3]",
      answer_text: "raw [1]",
      covered: false,
      sources: [{ ...cite, number: 1, piece_number: 3, pieces_in_file: 9, page: 2 }],
      searched: [cite, { bogus: true }],
      used_history: true,
      model_label: "OpenAI gpt-4o-mini",
      latency_ms: 2100,
    });
    expect(fresh).toMatchObject({
      covered: false,
      answer_text: "raw [1]",
      used_history: true,
      model_label: "OpenAI gpt-4o-mini",
      latency_ms: 2100,
    });
    expect(fresh?.sources[0]).toMatchObject({
      number: 1,
      piece_number: 3,
      pieces_in_file: 9,
      page: 2,
    });
    expect(fresh?.searched).toHaveLength(1);
    expect(fresh?.searched[0]).toMatchObject({ number: 1, piece_number: 3, page: null });

    // A row from before the Ask revamp: its text, the first two citations, no meta.
    const old = normalizeDomainAnswer({ content: "Old answer [1]", citations: [cite, cite, cite] });
    expect(old).toMatchObject({ covered: true, answer_text: "Old answer [1]", used_history: null });
    expect(old?.sources.map((s) => s.number)).toEqual([1, 2]);
    expect(normalizeDomainAnswer({ nope: 1 })).toBeNull();
  });
});

describe("Quality shapes", () => {
  it("normalizes a test question, old rows without expected_files too", () => {
    const fresh = normalizeTestCase({
      case_id: "c1",
      question: "Q?",
      expected_files: [
        { document_id: "d1", filename: "a.md", exists: true },
        { document_id: "d2", filename: null, exists: false },
        { nope: 1 },
      ],
      expected_keywords: ["x", 3],
    });
    expect(fresh).toEqual({
      case_id: "c1",
      question: "Q?",
      expected_files: [
        { document_id: "d1", filename: "a.md", exists: true },
        { document_id: "d2", filename: null, exists: false },
      ],
      expected_keywords: ["x"],
      ordinal: 0,
    });
    expect(
      normalizeTestCase({ case_id: "c", question: "Q", expected_citation_doc_ids: ["d9"] })
        ?.expected_files,
    ).toEqual([{ document_id: "d9", filename: null, exists: false }]);
    expect(normalizeTestCase({ question: "no id" })).toBeNull();
  });

  it("normalizes a test run: list items have no results, a full run has them", () => {
    const item = normalizeTestRun({ run_id: "r1", status: "weird", progress: { done: 2 } });
    expect(item).toMatchObject({
      status: "completed",
      progress: { done: 2, total: 0 },
      hit_at_k: null,
      results: null,
    });
    const full = normalizeTestRun({
      run_id: "r1",
      status: "running",
      scores: {
        per_case: [
          {
            case_id: "c1",
            hit: false,
            keyword_hit: "?",
            top: [{ filename: "a.md", excerpt: "…" }],
          },
          { nope: 1 },
        ],
      },
    });
    expect(full?.results).toEqual([
      {
        case_id: "c1",
        hit: false,
        keyword_hit: null,
        error: null,
        top: [{ number: 1, document_id: "", filename: "a.md", excerpt: "…" }],
      },
    ]);
    expect(normalizeTestRun({})).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain eval client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainEvalCases hits GET eval/cases", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ cases: [] }), { status: 200 }),
    );
    const rows = await api.listDomainEvalCases("d1");
    expect(rows).toEqual([]);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/cases",
    );
  });

  it("createDomainEvalCase posts question", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          case_id: "c1",
          domain_id: "d1",
          question: "Q?",
          expected_answer: null,
          expected_citation_doc_ids: [],
          expected_keywords: ["refund"],
          ordinal: 0,
          created_at: "2026-09-15T00:00:00Z",
        }),
        { status: 200 },
      ),
    );
    const row = await api.createDomainEvalCase("d1", {
      question: "Q?",
      expected_keywords: ["refund"],
    });
    expect(row.case_id).toBe("c1");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/cases",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("runDomainEval posts /eval", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: "r1",
          domain_id: "d1",
          status: "completed",
          scores: { hit_at_k: 1, keyword_hit: 1, cases_total: 1, per_case: [] },
          error_message: null,
          created_at: "2026-09-15T00:00:00Z",
          completed_at: "2026-09-15T00:00:01Z",
        }),
        { status: 200 },
      ),
    );
    const run = await api.runDomainEval("d1");
    expect(run.status).toBe("completed");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/api/domains/d1/eval");
  });

  it("getLatestDomainEvalRun hits runs/latest", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ run_id: "r1", status: "completed", scores: null }), {
        status: 200,
      }),
    );
    await api.getLatestDomainEvalRun("d1");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/runs/latest",
    );
  });

  it("deleteDomainEvalCase sends DELETE", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await api.deleteDomainEvalCase("d1", "c1");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/cases/c1",
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });
});

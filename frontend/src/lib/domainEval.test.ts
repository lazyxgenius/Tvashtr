import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain eval client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainEvalCases hits GET eval/cases", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ cases: [] }), { status: 200 }));
    const rows = await api.listDomainEvalCases("d1");
    expect(rows).toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/domains/d1/eval/cases");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain document client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainDocuments hits GET documents", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ documents: [] }), { status: 200 }),
    );
    const rows = await api.listDomainDocuments("d1");
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/domains/d1/documents");
  });
});

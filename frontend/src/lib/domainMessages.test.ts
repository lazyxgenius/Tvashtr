import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain messages client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainMessages hits GET messages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    );
    const rows = await api.listDomainMessages("d1");
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/domains/d1/messages");
  });

  it("askDomain posts question", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: "Hi",
          citations: [],
          message_id: "m1",
          user_message_id: "m0",
          latency_ms: 10,
        }),
        { status: 200 },
      ),
    );
    const result = await api.askDomain("d1", "Hello?");
    expect(result.answer).toBe("Hi");
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/domains/d1/ask");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("Hello?");
  });
});

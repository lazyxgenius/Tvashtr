import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetHomeConfigForTests, getInbox } from "./home";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetHomeConfigForTests();
});

describe("getInbox", () => {
  it("shares one request between callers that ask at the same time", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ count: 1, items: [{ key: "memories", kind: "memories" }] })),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([getInbox("website"), getInbox("website")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.count).toBe(1);
    expect(b).toBe(a);
    // Once it has answered, the next ask fetches again.
    await getInbox("website");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops item kinds it doesn't know", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              count: 2,
              items: [
                { key: "memories", kind: "memories" },
                { key: "x", kind: "something_new" },
              ],
            }),
          ),
        ),
      ),
    );
    expect((await getInbox("desktop")).count).toBe(1);
  });
});

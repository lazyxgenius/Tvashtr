import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASK_POLL_MS, askNode } from "./api";

// M-desk-routes (D5): an Ask from Tvashtr Desktop about a Desktop-routed node is answered there —
// POST 202 {ask_id}, then GET …/asks/{ask_id} every 2 s until the answer. The website is unchanged.

const URL_ASK = "/api/runs/r1/nodes/n1/ask";
const URL_GET = "/api/runs/r1/nodes/n1/asks/ask-1";
const HISTORY = [{ role: "user" as const, content: "Why did you change README.md?" }];
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.tvashtrDesktop;
});

describe("askNode", () => {
  it("the website posts the messages only and gets the answer back", async () => {
    const fetchMock = vi.fn<Fetch>(() => reply({ answer: "Because of the task." }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(askNode("r1", "n1", HISTORY)).resolves.toEqual({ answer: "Because of the task." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ messages: HISTORY });
  });

  it("from the Desktop it posts desktop_target and polls every 2 s until the answer", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const polls: string[] = [];
    let status = "queued";
    const fetchMock = vi.fn<Fetch>((url) => {
      if (url === URL_ASK) return reply({ ask_id: "ask-1", status: "queued" }, 202);
      polls.push(url);
      return reply(
        status === "completed"
          ? { ask_id: "ask-1", status, answer: "It added the line.", error: null }
          : { ask_id: "ask-1", status, answer: null, error: null },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const answer = askNode("r1", "n1", HISTORY);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      messages: HISTORY,
      desktop_target: true,
    });
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS);
    expect(polls).toEqual([URL_GET]);
    status = "running";
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS);
    status = "completed";
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS);
    await expect(answer).resolves.toEqual({ answer: "It added the line." });
    expect(polls).toHaveLength(3);
  });

  it("a Desktop Ask that fails throws its own words (askError)", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const offline = "Tvashtr Desktop went offline — reopen it and retry.";
    vi.stubGlobal(
      "fetch",
      vi.fn<Fetch>((url) =>
        url === URL_ASK
          ? reply({ ask_id: "ask-1", status: "queued" }, 202)
          : reply({ ask_id: "ask-1", status: "failed", answer: null, error: offline }),
      ),
    );
    const answer = askNode("r1", "n1", HISTORY);
    const caught = answer.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS);
    expect(await caught).toMatchObject({ askError: offline });
  });

  it("from the Desktop a node answered with a key still answers at once (no ask_id)", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const fetchMock = vi.fn<Fetch>(() => reply({ answer: "On a key." }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(askNode("r1", "n1", HISTORY)).resolves.toEqual({ answer: "On a key." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a poll refused (4xx) ends the Ask with an error instead of polling forever", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const fetchMock = vi.fn<Fetch>((url) =>
      url === URL_ASK ? reply({ ask_id: "ask-1", status: "queued" }, 202) : reply({}, 403),
    );
    vi.stubGlobal("fetch", fetchMock);
    const caught = askNode("r1", "n1", HISTORY).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS);
    expect(await caught).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a server that keeps failing (5xx) is asked again for about a minute, then gives up", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const fetchMock = vi.fn<Fetch>((url) =>
      url === URL_ASK ? reply({ ask_id: "ask-1", status: "queued" }, 202) : reply({}, 502),
    );
    vi.stubGlobal("fetch", fetchMock);
    const caught = askNode("r1", "n1", HISTORY).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS * 10);
    expect(fetchMock.mock.calls.length).toBe(11); // still asking after a blip
    await vi.advanceTimersByTimeAsync(ASK_POLL_MS * 30);
    expect(await caught).toBeInstanceOf(Error);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../backendStatus";
import {
  getNodeRuns,
  getNodeTemplates,
  listNodeMemories,
  NodeSaveError,
  patchAgentNode,
  previewNodeContext,
} from "./nodes";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

describe("getNodeTemplates", () => {
  it("returns the templates and drops rows without a key or prompt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          templates: [
            {
              key: "reviewer",
              title: "Reviewer",
              description: "Checks against the spec",
              role_name: "reviewer",
              node_kind: "worker",
              edits_allowed: false,
              writes_to: null,
              verdict_labels: ["approved", "changes_requested"],
              prompt: "You are the Reviewer",
            },
            { key: "broken" },
            "nonsense",
          ],
        }),
      ),
    );
    const rows = await getNodeTemplates();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "reviewer", node_kind: "worker", edits_allowed: false });
    expect(rows[0].verdict_labels).toEqual(["approved", "changes_requested"]);
  });

  it("an unexpected answer is an empty list, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ nope: true })),
    );
    await expect(getNodeTemplates()).resolves.toEqual([]);
  });
});

describe("getNodeRuns", () => {
  it("passes run_id and limit and normalises the rounds", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      json({
        runs: [{ run_id: "r1", idea: "Add RSI", status: "completed", rounds_count: 3 }, { x: 1 }],
        run: {
          run_id: "r1",
          idea: "Add RSI",
          status: "completed",
          live: false,
          rounds: [
            {
              invocation_id: 812,
              iteration: 2,
              status: "done",
              outcome: "changes_requested",
              cost: { total_tokens: 16900, cost_usd: 0 },
              runs_on: { via: "subscription", provider: "grok" },
              given: null,
              produced: { verdict: { verdict: "changes_requested" }, documents: [] },
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await getNodeRuns("t 1", "n1", { runId: "r1", limit: 5 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/teams/t%201/nodes/n1/runs?run_id=r1&limit=5");
    expect(out.runs).toHaveLength(1);
    expect(out.run?.rounds[0]).toMatchObject({
      invocation_id: 812,
      outcome: "changes_requested",
      runs_on: { via: "subscription", provider: "grok" },
    });
    expect(out.run?.rounds[0].cost?.total_tokens).toBe(16900);
    expect(out.run?.rounds[0].produced?.files).toBeNull();
  });

  it("a never-run agent is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ runs: [], run: null })),
    );
    await expect(getNodeRuns("t", "n")).resolves.toEqual({ runs: [], run: null });
  });
});

describe("previewNodeContext", () => {
  it("POSTs the draft and keeps the parts in order", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      json({
        parts: [
          { key: "node_prompt", label: "Your instructions", text: "You are", tokens: 3 },
          { key: "idea", label: "The idea", text: "", tokens: 0, placeholder: true },
        ],
        total_tokens: 3,
        notes: ["a", 2],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await previewNodeContext("t", "n", { prompt: "You are", reads_default: false });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ prompt: "You are", reads_default: false });
    expect(out.parts.map((p) => p.key)).toEqual(["node_prompt", "idea"]);
    expect(out.parts[1].placeholder).toBe(true);
    expect(out.notes).toEqual(["a"]);
    expect(out.source_run).toBeNull();
  });
});

describe("patchAgentNode", () => {
  it("sends exactly the keys it is given", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      json({ id: "n1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await patchAgentNode("t", "n1", { multimodal: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/teams/t/nodes/n1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ multimodal: true });
  });

  it("a 409 carries the server's words and the conflict kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json(
          {
            detail: "The first agent writes the shared spec the team reads, so it stays read-only.",
          },
          409,
        ),
      ),
    );
    const err = await patchAgentNode("t", "n1", { edits_allowed: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NodeSaveError);
    expect((err as NodeSaveError).kind).toBe("conflict");
    expect((err as NodeSaveError).message).toMatch(/stays read-only/);
  });

  it("a 422 is invalid; a body without detail falls back to the generic copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ detail: "Instructions can’t be empty." }, 422)),
    );
    const invalid = (await patchAgentNode("t", "n", { prompt: " " }).catch(
      (e: unknown) => e,
    )) as NodeSaveError;
    expect(invalid.kind).toBe("invalid");
    expect(invalid.message).toBe("Instructions can’t be empty.");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("boom", { status: 500 }))),
    );
    const other = (await patchAgentNode("t", "n", { prompt: "x" }).catch(
      (e: unknown) => e,
    )) as NodeSaveError;
    expect(other.kind).toBe("other");
    expect(other.message).toBe("Couldn’t save. Try again.");
  });
});

describe("listNodeMemories", () => {
  it("asks for one agent's notes with one status and drops malformed rows", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      json({
        memories: [
          { id: "m1", content: "Run pytest.", polarity: "require", status: "active" },
          { id: "m2", content: "Bad force.", polarity: "loud", status: "active" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await listNodeMemories("n-1", "pending_review");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memories?node_id=n-1&status=pending_review");
    expect(rows.map((m) => m.id)).toEqual(["m1"]);
  });

  it("an unexpected answer is a failed load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ nope: true })),
    );
    await expect(listNodeMemories("n-1", "active")).rejects.toThrow("Unexpected answer");
  });
});

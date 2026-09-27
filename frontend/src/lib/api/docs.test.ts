import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests } from "../backendStatus";
import { addDocumentVersion, DocSaveError, getDocument, listRunDocs, listTeamRuns } from "./docs";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const PM = { kind: "agent", node_id: "n-pm", role_name: "pm", label: "Product manager" };

describe("listRunDocs", () => {
  it("keeps the run, versions, writers and readers and drops rows without an id", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
      json({
        run: { run_id: "r1", idea: "Add RSI", status: "running", created_at: "t0", live: true },
        documents: [
          {
            id: "d1",
            name: "spec",
            title: "PRD",
            doc_type: "prd",
            is_shared_spec: true,
            version_count: 3,
            latest_version: {
              version_no: 3,
              created_at: "2026-09-25T10:00:00Z",
              author: PM,
              note: "Revised in round 3",
            },
            written_by: [{ node_id: "n-pm", clone_node_id: "c1", label: "Product manager" }],
            read_by: [{ node_id: "n-rev", label: "Reviewer" }, { label: "no id" }],
          },
          { name: "orphan" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await listRunDocs("r 1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r%201/documents");
    expect(out).toEqual({
      run: { run_id: "r1", idea: "Add RSI", status: "running", created_at: "t0", live: true },
      documents: [
        {
          id: "d1",
          name: "spec",
          title: "PRD",
          doc_type: "prd",
          is_shared_spec: true,
          version_count: 3,
          latest_version: {
            version_no: 3,
            created_at: "2026-09-25T10:00:00Z",
            author: PM,
            note: "Revised in round 3",
          },
          written_by: [{ node_id: "n-pm", clone_node_id: "c1", label: "Product manager" }],
          read_by: [{ node_id: "n-rev", clone_node_id: "", label: "Reviewer" }],
        },
      ],
    });
  });

  it("an unexpected answer is no documents; a 404 throws the server's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(["nope"])),
    );
    await expect(listRunDocs("r")).resolves.toEqual({ run: null, documents: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ detail: "run not found" }, 404)),
    );
    await expect(listRunDocs("r")).rejects.toThrow("run not found");
  });
});

describe("getDocument", () => {
  it("keeps the flags and sorts the versions oldest first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          id: "d1",
          name: "spec",
          title: "PRD",
          doc_type: "prd",
          run_id: "r1",
          is_shared_spec: true,
          editable: true,
          versions: [
            {
              id: "v2",
              version_no: 2,
              content: "b",
              created_at: "t2",
              author: { label: "You", kind: "human" },
              note: "Edited while the run was live",
            },
            {
              id: "v1",
              version_no: 1,
              content: "a",
              created_at: "t1",
              author: PM,
              note: "First draft",
            },
            "junk",
          ],
        }),
      ),
    );
    const doc = await getDocument("d1");
    expect(doc.editable).toBe(true);
    expect(doc.run_id).toBe("r1");
    expect(doc.versions.map((v) => [v.version_no, v.author?.label, v.note])).toEqual([
      [1, "Product manager", "First draft"],
      [2, "You", "Edited while the run was live"],
    ]);
    expect(doc.versions[1].author?.kind).toBe("human");
  });

  it("throws on an answer without an id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json({ versions: [] })),
    );
    await expect(getDocument("d1")).rejects.toThrow("Unexpected answer");
  });
});

describe("addDocumentVersion", () => {
  it("POSTs the content with the base version and returns the new version", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      json({
        id: "v4",
        version_no: 4,
        content: "x",
        created_at: "t4",
        author: { kind: "human", label: "You" },
        note: "Edited while the run was live",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const v = await addDocumentVersion("d1", "x", { baseVersionNo: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/documents/d1/versions");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      content: "x",
      base_version_no: 3,
    });
    expect(v).toMatchObject({ id: "v4", version_no: 4, note: "Edited while the run was live" });
  });

  it("a stale base is a DocSaveError with the newest version and its author", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json(
          {
            detail: {
              code: "stale_version",
              message: "Product manager saved v4 while you were editing. Compare, then save again.",
              latest_version_no: 4,
              latest_author: PM,
            },
          },
          409,
        ),
      ),
    );
    const err = await addDocumentVersion("d1", "x", { baseVersionNo: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocSaveError);
    expect(err).toMatchObject({
      kind: "stale_version",
      status: 409,
      message: "Product manager saved v4 while you were editing. Compare, then save again.",
      latestVersionNo: 4,
      latestAuthor: PM,
    });
  });

  it("a finished run, a missing document and anything else get their own kinds", async () => {
    const fail = (body: unknown, status: number) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => json(body, status)),
      );
      return addDocumentVersion("d1", "x").then(
        () => {
          throw new Error("expected a DocSaveError");
        },
        (e: unknown) => e as DocSaveError,
      );
    };
    const finished = await fail(
      {
        detail: {
          code: "run_finished",
          message: "This run has finished — edits can’t reach its agents.",
        },
      },
      409,
    );
    expect([finished.kind, finished.message]).toEqual([
      "run_finished",
      "This run has finished — edits can’t reach its agents.",
    ]);
    expect((await fail({ detail: "document not found" }, 404)).kind).toBe("not_found");
    expect((await fail({ detail: "boom" }, 500)).kind).toBe("other");
  });
});

describe("listTeamRuns", () => {
  it("keeps the runs with an id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        json({
          runs: [
            {
              run_id: "r2",
              idea: "Add RSI",
              status: "completed",
              created_at: "t2",
              updated_at: "t3",
            },
            { idea: "no id" },
          ],
        }),
      ),
    );
    await expect(listTeamRuns("t1")).resolves.toEqual([
      { run_id: "r2", idea: "Add RSI", status: "completed", created_at: "t2", updated_at: "t3" },
    ]);
  });
});

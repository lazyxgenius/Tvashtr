import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { useNav } from "../../lib/nav";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { DomainDetailPage } from "./DomainDetailPage";
import { detailView, fileItem, filesList, mockApi, sampleDomains } from "./domainsTestUtils";

const SUPPORT = detailView(sampleDomains()[0]);
const FILES = [
  fileItem("webhooks.md", { document_id: "doc-hooks", pieces: 77 }),
  fileItem("integrations.html", { document_id: "doc-int", pieces: 288 }),
  fileItem("refund-policy.md", { document_id: "doc-refund", pieces: 42 }),
];

const kase = (n: number, question: string, file: string, id: string, words: string[]) => ({
  case_id: `c${n}`,
  question,
  expected_citation_doc_ids: [id],
  expected_files: [{ document_id: id, filename: file, exists: true }],
  expected_keywords: words,
  ordinal: n,
});
const REFUND = kase(1, "How long for a refund?", "refund-policy.md", "doc-refund", ["30 days"]);
const HOOKS = kase(2, "How do I verify webhook signatures?", "webhooks.md", "doc-hooks", [
  "signature",
  "secret",
]);
const TOP = [
  {
    number: 1,
    document_id: "doc-int",
    filename: "integrations.html",
    excerpt: "…signed payloads…",
  },
  { number: 2, document_id: "doc-x", filename: "api-limits.html", excerpt: "…600 requests…" },
  { number: 3, document_id: "doc-y", filename: "troubleshooting.pdf", excerpt: "…retry 5 times…" },
];

function run(number: number, over: Record<string, unknown> = {}, results = [true, true]) {
  return {
    run_id: `r${number}`,
    number,
    status: "completed",
    created_at: "2026-09-24T10:02:00Z",
    completed_at: "2026-09-24T10:02:00Z",
    hit_at_k: 0.5,
    keyword_hit: 0.5,
    retrieval_mode: "dense",
    top_k: 8,
    config: { chunking: { size: 600 } },
    progress: { done: 2, total: 2 },
    error_message: null,
    scores: {
      per_case: [
        { case_id: "c1", hit: results[0], keyword_hit: true, top: [] },
        { case_id: "c2", hit: results[1], keyword_hit: false, top: TOP },
      ],
    },
    ...over,
  };
}

function Harness() {
  const { route } = useNav();
  if (route.page !== "domains" || !route.domainId) return <p>left the domain</p>;
  return <DomainDetailPage domainId={route.domainId} tab={route.tab} />;
}

function renderQuality() {
  window.location.hash = "#/domains/d-support/quality";
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

function routes(over: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/domains/d-support": SUPPORT,
    "GET /api/domains/d-support/documents": filesList(FILES),
    "GET /api/domains/d-support/eval/cases": { cases: [REFUND, HOOKS] },
    "GET /api/domains/d-support/eval/runs": { runs: [] },
    ...over,
  });
}

const table = () => screen.getByRole("region", { name: "Test questions" });
const sheet = () => screen.getByRole("dialog");

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Quality (Dm-Quality, DmF-Qual-1…5)", () => {
  it("with no test questions offers to add one (DmF-Qual-1)", async () => {
    routes({ "GET /api/domains/d-support/eval/cases": { cases: [] } });
    renderQuality();
    expect(await screen.findByText("Check that search finds the right files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick from Ask history" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add test question" }));
    expect(within(sheet()).getByText("Something you already know the answer to")).toBeVisible();
    expect(within(sheet()).getByText("Question 1")).toBeInTheDocument();
  });

  it("adds a test question: pick files, key words, then Add test (DmF-Qual-2/3)", async () => {
    let cases = [REFUND];
    const calls = routes({
      "GET /api/domains/d-support/eval/cases": () => ({ cases }),
      "POST /api/domains/d-support/eval/cases": () => {
        cases = [REFUND, HOOKS];
        return HOOKS;
      },
    });
    renderQuality();
    await screen.findByText("How long for a refund?");
    fireEvent.click(screen.getByRole("button", { name: "Add test question" }));
    const s = sheet();
    expect(within(s).getByText("Question 2")).toBeInTheDocument();
    fireEvent.change(within(s).getByRole("textbox", { name: "Question" }), {
      target: { value: "How do I verify webhook signatures?" },
    });
    fireEvent.click(within(s).getByRole("button", { name: "Files it should find" }));
    expect(within(s).getByText("Type to search 3 files")).toBeInTheDocument();
    const list = within(s).getByRole("listbox", { name: "Files" });
    expect(within(list).getByText("288 pieces")).toBeInTheDocument();
    // Typing searches the names; Enter picks the highlighted file.
    const trigger = within(s).getByRole("button", { name: "Files it should find" });
    fireEvent.keyDown(trigger, { key: "w" });
    fireEvent.keyDown(trigger, { key: "e" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(within(list).getByRole("option", { name: /webhooks\.md/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.mouseDown(within(s).getByText("Something you already know the answer to"));
    expect(within(s).getByRole("button", { name: "Remove webhooks.md" })).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "Add file" })).toBeInTheDocument();
    fireEvent.change(within(s).getByRole("textbox", { name: "Key words" }), {
      target: { value: "signature, secret" },
    });
    fireEvent.click(within(s).getByRole("button", { name: "Add test" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      question: "How do I verify webhook signatures?",
      expected_citation_doc_ids: ["doc-hooks"],
      expected_keywords: ["signature", "secret"],
    });
    expect(await within(table()).findByText("webhooks.md")).toBeInTheDocument();
  });

  it("shows the server's words when a test question can't be saved (OQ-26)", async () => {
    routes({
      "POST /api/domains/d-support/eval/cases": () =>
        new Response(JSON.stringify({ detail: "You can have up to 50 test questions." }), {
          status: 422,
        }),
    });
    renderQuality();
    await screen.findByText("How long for a refund?");
    fireEvent.click(screen.getByRole("button", { name: "Add test question" }));
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "Question" }), {
      target: { value: "One more?" },
    });
    fireEvent.change(within(sheet()).getByRole("textbox", { name: "Key words" }), {
      target: { value: "x" },
    });
    fireEvent.click(within(sheet()).getByRole("button", { name: "Add test" }));
    expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
      "You can have up to 50 test questions.",
    );
  });

  it("shows the latest run's scores, compared with the previous run (Dm-Quality)", async () => {
    const twoHoursAgo = {
      completed_at: new Date(Date.now() - 2 * 3600_000 - 60_000).toISOString(),
    };
    routes({
      "GET /api/domains/d-support/eval/runs": { runs: [run(5, twoHoursAgo), run(4)] },
      "GET /api/domains/d-support/eval/runs/r5": run(5, { ...twoHoursAgo, hit_at_k: 1 }, [
        true,
        true,
      ]),
      "GET /api/domains/d-support/eval/runs/r4": run(4, {}, [true, false]),
    });
    renderQuality();
    expect(await screen.findByText("100%")).toBeInTheDocument();
    // The compared run loads after the latest one.
    expect(await screen.findByText("+50 vs previous run")).toBeInTheDocument();
    expect(
      screen.getByText("Last run 2 hours ago · Meaning search · 8 passages"),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Compare with" })).toHaveDisplayValue(
      /^Previous run · Sep 24, /,
    );
    const hooksRow = within(table())
      .getByText("How do I verify webhook signatures?")
      .closest("tr")!;
    expect(within(hooksRow).getByText("fixed")).toBeInTheDocument();
    expect(within(hooksRow).getByText("Missed")).toBeInTheDocument();
  });

  it("opens a miss to show what search found (DmF-Qual-5)", async () => {
    routes({
      "GET /api/domains/d-support/eval/runs": { runs: [run(1)] },
      "GET /api/domains/d-support/eval/runs/r1": run(1, {}, [true, false]),
    });
    renderQuality();
    const toggle = await screen.findByRole("button", {
      name: "How do I verify webhook signatures?",
    });
    expect(screen.getByRole("combobox", { name: "Compare with" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "No earlier run" })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("What search found (top 3 of 8)")).toBeInTheDocument();
    expect(screen.getByText("…retry 5 times…")).toBeInTheDocument();
    expect(
      screen.getByText("webhooks.md wasn’t in the top 8. Try “Both” search."),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("What search found (top 3 of 8)")).toBeNull();
  });

  it("runs all tests: the banner and dashes while running, then the scores (DmF-Qual-4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: "idle" | "running" | "done" = "idle";
    const running = {
      ...run(1),
      status: "running",
      created_at: new Date().toISOString(),
      completed_at: null,
      hit_at_k: null,
      keyword_hit: null,
      progress: { done: 0, total: 2 },
      scores: { per_case: [] },
    };
    const calls = routes({
      "GET /api/domains/d-support/eval/runs": () => ({
        runs: state === "idle" ? [] : state === "running" ? [running] : [run(1)],
      }),
      "GET /api/domains/d-support/eval/runs/r1": run(1),
      "POST /api/domains/d-support/eval/runs": () => {
        state = "running";
        return running;
      },
    });
    renderQuality();
    await screen.findByText("Not run yet");
    fireEvent.click(screen.getByRole("button", { name: "Run all tests" }));
    expect(await screen.findByText("Running 2 tests… about 5 seconds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all tests" })).toBeDisabled();
    expect(within(table()).queryByText("Found")).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);

    state = "done";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(await screen.findAllByText("50%")).toHaveLength(2);
    expect(screen.queryByText(/^Running 2 tests/)).toBeNull();
    expect(within(table()).getAllByText("Found")).toHaveLength(3);
  });

  it("deletes a test question with Undo; the DELETE goes when Undo lapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = routes({
      "DELETE /api/domains/d-support/eval/cases/c1": new Response(null, { status: 204 }),
    });
    renderQuality();
    await screen.findByText("How long for a refund?");
    fireEvent.click(
      screen.getByRole("button", { name: "More actions for How long for a refund?" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.queryByText("How long for a refund?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("How long for a refund?")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for How long for a refund?" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/api/domains/d-support/eval/cases/c1",
    ]);
  });

  it("edits a test question (DM-78)", async () => {
    const calls = routes({
      "PATCH /api/domains/d-support/eval/cases/c2": { ...HOOKS, question: "Verify webhooks?" },
    });
    renderQuality();
    await screen.findByText("How long for a refund?");
    fireEvent.click(
      screen.getByRole("button", { name: "More actions for How do I verify webhook signatures?" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    const s = screen.getByRole("dialog", { name: "Edit test question" });
    expect(within(s).getByText("Question 2")).toBeInTheDocument();
    expect(within(s).getByRole("textbox", { name: "Key words" })).toHaveValue("signature, secret");
    fireEvent.change(within(s).getByRole("textbox", { name: "Question" }), {
      target: { value: "Verify webhooks?" },
    });
    fireEvent.click(within(s).getByRole("button", { name: "Remove webhooks.md" }));
    fireEvent.click(within(s).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      question: "Verify webhooks?",
      expected_citation_doc_ids: [],
      expected_keywords: ["signature", "secret"],
    });
  });

  it("picks a question from the Ask history with its cited files (DM-79)", async () => {
    const source = {
      number: 1,
      document_id: "doc-refund",
      filename: "refund-policy.md",
      excerpt: "Refunds within 30 days",
    };
    routes({
      "GET /api/domains/d-support/eval/cases": { cases: [] },
      "GET /api/domains/d-support/messages": {
        messages: [
          { role: "user", content: "Old question?" },
          { role: "assistant", content: "x", covered: true, answer_text: "x", sources: [] },
          { role: "user", content: "What is the refund window?" },
          {
            role: "assistant",
            content: "x",
            covered: true,
            answer_text: "30 days [1]",
            sources: [source],
          },
        ],
      },
    });
    renderQuality();
    fireEvent.click(await screen.findByRole("button", { name: "Pick from Ask history" }));
    const s = sheet();
    const picks = await within(s).findAllByRole("button", { name: /\?$/ });
    expect(picks.map((b) => b.textContent)).toEqual([
      "What is the refund window?",
      "Old question?",
    ]);
    fireEvent.click(picks[0]);
    expect(within(s).getByRole("textbox", { name: "Question" })).toHaveValue(
      "What is the refund window?",
    );
    expect(within(s).getByRole("button", { name: "Remove refund-policy.md" })).toBeInTheDocument();
    expect(within(s).queryByText("From Ask")).toBeNull();
  });
});

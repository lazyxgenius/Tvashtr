import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { useNav } from "../../lib/nav";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { DomainDetailPage } from "./DomainDetailPage";
import { detailView, fileItem, filesList, mockApi, sampleDomains } from "./domainsTestUtils";

const [support] = sampleDomains();
const SUPPORT = detailView(support);
const FILES = [
  fileItem("refund-policy.md", { document_id: "doc-refund", pieces: 42 }),
  fileItem("billing-faq.pdf", { document_id: "doc-billing", pieces: 86 }),
  fileItem("sso-setup.md", { pieces: 58 }),
  fileItem("api-limits.html", { pieces: 73 }),
  fileItem("data-export.pdf", { pieces: 142 }),
];
const passage = (n: number, name: string, id: string, piece: number, page: number | null) => ({
  number: n,
  document_id: id,
  filename: name,
  chunk_id: `c${n}`,
  ordinal: piece - 1,
  piece_number: piece,
  pieces_in_file: 42,
  page,
  excerpt: `Passage ${n} about refunds within 30 days`,
});
const REFUND = passage(1, "refund-policy.md", "doc-refund", 3, null);
const BILLING = passage(2, "billing-faq.pdf", "doc-billing", 17, 4);
const ANSWER = {
  message_id: "m2",
  answer: "raw",
  covered: true,
  answer_text: "Refunds within **30 days** [1]. Annual plans are prorated [2].",
  sources: [REFUND, BILLING],
  searched: [REFUND, BILLING, passage(3, "pricing-2026.pdf", "doc-pricing", 1, 2)],
  used_history: false,
  model_label: "OpenAI gpt-4o-mini",
  latency_ms: 1800,
};
const CHAT = [
  { message_id: "m1", role: "user", content: "How long for a refund?" },
  { ...ANSWER, role: "assistant", content: "raw" },
];

function Harness() {
  const { route } = useNav();
  if (route.page !== "domains" || !route.domainId) return <p>left the domain</p>;
  return (
    <DomainDetailPage
      domainId={route.domainId}
      tab={route.tab}
      file={route.file}
      piece={route.piece}
    />
  );
}

function renderAsk() {
  window.location.hash = "#/domains/d-support/ask";
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
    "GET /api/domains/d-support/messages": { messages: [] },
    "GET /api/providers": { providers: [{ provider: "openai" }, { provider: "openrouter" }] },
    "POST /api/domains/d-support/ask": ANSWER,
    "DELETE /api/domains/d-support/messages": new Response(null, { status: 204 }),
    "PATCH /api/domains/d-support": SUPPORT,
    "POST /api/domains/d-support/eval/cases": { case_id: "c13" },
    ...over,
  });
}

const aside = () => screen.getByRole("complementary", { name: "Sources" });
const composer = () => screen.getByPlaceholderText("Ask Support docs a question");
const answer = () => screen.getByRole("article", { name: "Answer" });

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Ask (Dm-Ask, DmF-Ask-1…4)", () => {
  it("starts empty with questions from the file names; a suggestion asks it", async () => {
    const calls = routes();
    renderAsk();
    expect(await screen.findByText("Ask Support docs anything")).toBeInTheDocument();
    expect(
      screen.getByText("Answers use only the files in Support docs. Nothing else."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled();
    expect(within(aside()).getByText("Sources show up here")).toBeInTheDocument();
    await screen.findByText("Suggested from your file names");
    const pill = screen.getByRole("button", { name: "What is the refund window?" });
    expect(screen.getByRole("button", { name: "How do I set up SSO?" })).toBeInTheDocument();

    fireEvent.click(pill);
    await screen.findByRole("article", { name: "Answer" });
    const ask = calls.find((c) => c.method === "POST" && c.path.endsWith("/ask"));
    expect(ask?.body).toEqual({ question: "What is the refund window?", use_history: true });
    expect(screen.getByText("What is the refund window?")).toBeInTheDocument();
  });

  it("shows an answer with numbered sources; a number opens its passage", async () => {
    routes({ "GET /api/domains/d-support/messages": { messages: CHAT } });
    renderAsk();
    await screen.findByRole("article", { name: "Answer" });
    expect(within(answer()).getByText("30 days").tagName).toBe("B");
    expect(within(answer()).getByText("1.8 s · OpenAI gpt-4o-mini")).toBeInTheDocument();
    expect(within(aside()).getByText("Sources for this answer")).toBeInTheDocument();
    expect(within(aside()).getByText("piece 3 of 42")).toBeInTheDocument();
    expect(within(aside()).getByText("page 4 · piece 17 of 42")).toBeInTheDocument();
    // No card is active until a number is clicked (DmF-Ask-3).
    expect(within(aside()).queryByRole("button", { name: "Copy passage" })).toBeNull();

    fireEvent.click(
      within(answer()).getAllByRole("button", { name: "Source 2: billing-faq.pdf" })[0],
    );
    const card = within(aside()).getByText("billing-faq.pdf").closest(".dm-passage") as HTMLElement;
    expect(card).toHaveClass("dm-passage--active");
    expect(within(card).getByRole("button", { name: "Open file" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Copy passage" })).toBeInTheDocument();
  });

  it("Show what search found lists every passage in rank order, and goes back", async () => {
    routes({ "GET /api/domains/d-support/messages": { messages: CHAT } });
    renderAsk();
    await screen.findByRole("article", { name: "Answer" });
    fireEvent.click(within(answer()).getByRole("button", { name: "Show what search found" }));
    expect(within(aside()).getByText("What search found")).toBeInTheDocument();
    expect(within(aside()).getByText("pricing-2026.pdf")).toBeInTheDocument();
    fireEvent.click(within(aside()).getByRole("button", { name: "Back to sources" }));
    expect(within(aside()).getByText("Sources for this answer")).toBeInTheDocument();
    expect(within(aside()).queryByText("pricing-2026.pdf")).toBeNull();
  });

  it("Open file shows the file's pieces at the passage", async () => {
    const calls = routes({
      "GET /api/domains/d-support/messages": { messages: CHAT },
      "GET /api/domains/d-support/documents/doc-refund/pieces": {
        document: FILES[0],
        pieces: [{ number: 3, chars: 600, page: null, text: "Customers may request a refund." }],
        total: 42,
        used_in_answers: { count: 1, of: 2 },
      },
    });
    renderAsk();
    await screen.findByRole("article", { name: "Answer" });
    fireEvent.click(
      within(answer()).getAllByRole("button", { name: "Source 1: refund-policy.md" })[0],
    );
    fireEvent.click(within(aside()).getByRole("button", { name: "Open file" }));
    expect(await screen.findByRole("dialog", { name: "refund-policy.md" })).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith("/documents/doc-refund/pieces"))).toBe(true);
  });

  it("Enter asks, Shift+Enter doesn't; Use earlier messages off asks alone", async () => {
    const calls = routes();
    renderAsk();
    await screen.findByText("Ask Support docs anything");
    fireEvent.change(composer(), { target: { value: "Refund window?" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(calls.some((c) => c.path.endsWith("/ask"))).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "Use earlier messages" }));
    fireEvent.keyDown(composer(), { key: "Enter" });
    await screen.findByRole("article", { name: "Answer" });
    expect(calls.find((c) => c.path.endsWith("/ask"))?.body).toEqual({
      question: "Refund window?",
      use_history: false,
    });
    expect(composer()).toHaveValue("");
    // Back on for the next test (it's kept for the session).
    fireEvent.click(screen.getByRole("switch", { name: "Use earlier messages" }));
  });

  it("says which key is missing and keeps the question", async () => {
    routes({
      "POST /api/domains/d-support/ask": new Response(
        JSON.stringify({
          detail: { message: "you have no API key for: openai", missing_providers: ["openai"] },
        }),
        { status: 422 },
      ),
    });
    renderAsk();
    await screen.findByText("Ask Support docs anything");
    fireEvent.change(composer(), { target: { value: "Refund window?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(
      await screen.findByText("Add an openai key to ask — openai reads the question."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add openai key" })).toBeInTheDocument();
    expect(composer()).toHaveValue("Refund window?");
    expect(screen.queryByRole("article", { name: "Answer" })).toBeNull();
  });

  it("names the vendor that didn't answer", async () => {
    routes({
      "POST /api/domains/d-support/ask": new Response(
        JSON.stringify({ detail: "generation failed: upstream 500" }),
        { status: 502 },
      ),
    });
    renderAsk();
    await screen.findByText("Ask Support docs anything");
    fireEvent.change(composer(), { target: { value: "Refund window?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("OpenAI didn’t answer. Try again.");
    expect(note).toHaveAttribute("title", "generation failed: upstream 500");
  });

  it("pauses while the domain re-reads its files", async () => {
    routes({ "GET /api/domains/d-support": { ...SUPPORT, state: "rereading" } });
    renderAsk();
    expect(
      await screen.findByText("Ask is paused while Support docs re-reads its files."),
    ).toBeInTheDocument();
    expect(composer()).toBeDisabled();
  });

  it("Save as test question saves the question with its cited files", async () => {
    const calls = routes({ "GET /api/domains/d-support/messages": { messages: CHAT } });
    renderAsk();
    await screen.findByRole("article", { name: "Answer" });
    fireEvent.click(within(answer()).getByRole("button", { name: "Save as test question" }));
    expect(await screen.findByText("Saved as test question 13")).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith("/eval/cases"))?.body).toEqual({
      question: "How long for a refund?",
      expected_citation_doc_ids: ["doc-refund", "doc-billing"],
    });
  });
});

describe("Clear chat (DM-67, OQ-12)", () => {
  it("empties the thread at once; Undo brings it back without deleting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = routes({ "GET /api/domains/d-support/messages": { messages: CHAT } });
    renderAsk();
    await screen.findByRole("article", { name: "Answer" });
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(screen.queryByRole("article", { name: "Answer" })).toBeNull();
    expect(screen.getByText("Chat cleared.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("article", { name: "Answer" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("deletes the chat when the toast closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = routes({ "GET /api/domains/d-support/messages": { messages: CHAT } });
    renderAsk();
    await screen.findByRole("article", { name: "Answer" });
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.path.endsWith("/messages"))).toBe(true),
    );
    expect(screen.getByText("Ask Support docs anything")).toBeInTheDocument();
  });
});

describe("Answer model (DmF-Model-1…3)", () => {
  it("lists the models with their key state and saves a pick, with Undo", async () => {
    const calls = routes();
    renderAsk();
    await screen.findByText("Ask Support docs anything");
    const chip = screen.getByRole("button", { name: "Answer model: Account default" });
    fireEvent.click(chip);
    const list = screen.getByRole("listbox", { name: "Answer model" });
    await within(list).findByText("No groq key");
    const def = within(list).getByRole("option", { name: /Account default/ });
    expect(def).toHaveAttribute("aria-selected", "true");
    expect(def).toHaveAttribute("title", "Now OpenAI gpt-4o-mini");
    expect(within(def).getByText("key saved")).toBeInTheDocument();
    expect(within(list).getByText("Billed through OpenRouter")).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("option", { name: /^OpenAI gpt-4o-mini/ }));
    expect(
      await screen.findByText("Answer model set to OpenAI gpt-4o-mini for this domain"),
    ).toBeInTheDocument();
    const patches = () => calls.filter((c) => c.method === "PATCH");
    expect(patches()[0].body).toMatchObject({
      config: { generation: { model: "openai/gpt-4o-mini" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1].body).toMatchObject({ config: { generation: { model: null } } });
  });

  it("Custom… takes any provider/model name", async () => {
    const calls = routes();
    renderAsk();
    await screen.findByText("Ask Support docs anything");
    fireEvent.click(screen.getByRole("button", { name: "Answer model: Account default" }));
    fireEvent.click(screen.getByRole("option", { name: /Custom…/ }));
    const field = screen.getByRole("textbox", { name: "Custom answer model" });
    fireEvent.change(field, { target: { value: "anthropic/claude-haiku" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
        config: { generation: { model: "anthropic/claude-haiku" } },
      }),
    );
    expect(screen.queryByRole("listbox", { name: "Answer model" })).toBeNull();
  });

  it("Escape closes the list without saving", async () => {
    const calls = routes();
    renderAsk();
    await screen.findByText("Ask Support docs anything");
    fireEvent.click(screen.getByRole("button", { name: "Answer model: Account default" }));
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Answer model" }), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Answer model" })).toBeNull();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

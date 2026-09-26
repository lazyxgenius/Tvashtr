import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { useNav } from "../../lib/nav";
import { __resetWorkspaceStatusForTests } from "../../lib/workspaceStatus";
import { DomainDetailPage } from "./DomainDetailPage";
import { detailView, filesList, mockApi, sampleDomains } from "./domainsTestUtils";
import { __resetSettingsDraftsForTests } from "./useDomainSettingsDraft";

const CONFIG = {
  chunking: { strategy: "fixed", size: 600, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: {
    top_k: 8,
    mode: "dense",
    rerank: { enabled: false, model: null, top_n: 20 },
    graph: { enabled: false },
  },
  generation: { model: null },
};
const SUPPORT = detailView({ ...sampleDomains()[0], config: CONFIG });
const TEMPLATES = [
  ["support", "Support", 600, 100],
  ["legal", "Legal", 500, 80],
  ["financial", "Financial", 700, 100],
  ["scientific", "Scientific", 1000, 150],
  ["blank", "Blank", 800, 100],
].map(([template, name, piece_size, overlap]) => ({
  template,
  name,
  description: "",
  piece_size,
  overlap,
}));

function Harness() {
  const { route } = useNav();
  if (route.page !== "domains") return <p>left the domains</p>;
  if (!route.domainId) return <p>the domains list</p>;
  return <DomainDetailPage domainId={route.domainId} tab={route.tab} />;
}

function renderSettings() {
  window.location.hash = "#/domains/d-support/settings";
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

function routes(over: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/domains/d-support": SUPPORT,
    "GET /api/domain-templates": { templates: TEMPLATES },
    "GET /api/providers": { providers: [{ provider: "openai" }] },
    "PATCH /api/domains/d-support": { domain_id: "d-support" },
    "GET /api/domains/d-support/documents": filesList([]),
    "GET /api/domains/d-support/eval/cases": { cases: [] },
    "GET /api/domains/d-support/eval/runs": { runs: [] },
    ...over,
  });
}

const bar = () => screen.getByRole("region", { name: "Unsaved changes" });
const patches = (calls: ReturnType<typeof routes>) => calls.filter((c) => c.method === "PATCH");

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
  __resetSettingsDraftsForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings (Dm-Settings, DmF-Tune-1…4)", () => {
  it("shows the four cards with the stored settings and no save bar", async () => {
    routes();
    renderSettings();
    const read = await screen.findByRole("region", { name: "How files are read" });
    await waitFor(() =>
      expect(within(read).getByRole("combobox", { name: "Starting point" })).toHaveDisplayValue(
        "Support · 600-character pieces",
      ),
    );
    expect(within(read).getByRole("button", { name: "Reading model" })).toHaveTextContent(
      "OpenAI text-embedding-3-small",
    );
    expect(await within(read).findByText("openai key saved")).toBeInTheDocument();
    expect(within(read).getByLabelText<HTMLInputElement>("Piece size").value).toBe("600");
    expect(within(read).getByLabelText<HTMLInputElement>("Overlap").value).toBe("100");
    const answers = screen.getByRole("region", { name: "How answers are written" });
    expect(within(answers).getByRole("combobox", { name: "Answer model" })).toHaveDisplayValue(
      "Account default",
    );
    const search = screen.getByRole("region", { name: "How search works" });
    expect(within(search).getByRole("button", { name: "Meaning" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(search).getByLabelText<HTMLInputElement>("Passages per question").value).toBe(
      "8",
    );
    expect(
      within(search).getByText("Looks at 20 passages first, then keeps the best 8."),
    ).toBeInTheDocument();
    expect(
      within(search).getByText(
        "Adds up to 4 more passages that mention the same names. Off by default.",
      ),
    ).toBeInTheDocument();
    const danger = screen.getByRole("region", { name: "Delete this domain" });
    expect(
      within(danger).getByText(
        "Removes its 14 files, pieces, chat and test questions. Teams that use it as a step can’t run until you pick another domain.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
  });

  it("Both search: the bar says no re-read, Save and run tests goes to Quality (DmF-Tune-1…3)", async () => {
    let runs: unknown[] = [];
    const calls = routes({
      "POST /api/domains/d-support/eval/runs": () => {
        runs = [
          {
            run_id: "r2",
            number: 2,
            status: "running",
            created_at: new Date().toISOString(),
            completed_at: null,
            hit_at_k: null,
            keyword_hit: null,
            retrieval_mode: "hybrid",
            top_k: 8,
            config: {},
            progress: { done: 0, total: 12 },
            error_message: null,
          },
        ];
        return runs[0];
      },
      "GET /api/domains/d-support/eval/runs": () => ({ runs }),
      "GET /api/domains/d-support/eval/cases": {
        cases: [
          {
            case_id: "c1",
            question: "How long for a refund?",
            expected_citation_doc_ids: [],
            expected_files: [],
            expected_keywords: ["30 days"],
            ordinal: 1,
          },
        ],
      },
    });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Both" }));
    expect(within(bar()).getByText("1 unsaved change · Search by: Both")).toBeInTheDocument();
    expect(within(bar()).getByText("No re-read needed")).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Save and run tests" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support/quality"));
    const [patch] = patches(calls);
    expect(patch?.body).toEqual({
      config: { ...CONFIG, retrieval: { ...CONFIG.retrieval, mode: "hybrid" } },
    });
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/eval/runs"))).toBe(true);
    expect(await screen.findByText("Running 12 tests… about 30 seconds")).toBeInTheDocument();
  });

  it("Discard puts the settings back and the bar goes", async () => {
    routes();
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Exact words" }));
    expect(bar()).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Meaning" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps unsaved changes when you leave the tab and come back", async () => {
    routes();
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Exact words" }));
    fireEvent.click(screen.getByRole("tab", { name: /Sources/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Exact words" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(
      await screen.findByText("1 unsaved change · Search by: Exact words"),
    ).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Discard" }));
  });

  it("an answer model change just saves", async () => {
    const calls = routes();
    renderSettings();
    const select = await screen.findByRole("combobox", { name: "Answer model" });
    fireEvent.change(select, { target: { value: "openai/gpt-4o-mini" } });
    expect(within(bar()).getByText("1 unsaved change · Answer model")).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0]?.body).toEqual({
      config: { ...CONFIG, generation: { model: "openai/gpt-4o-mini" } },
    });
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Unsaved changes" })).toBeNull(),
    );
    expect(window.location.hash).toBe("#/domains/d-support/settings");
  });

  it("Custom… asks for a provider/model name", async () => {
    const calls = routes();
    renderSettings();
    fireEvent.change(await screen.findByRole("combobox", { name: "Answer model" }), {
      target: { value: "custom" },
    });
    expect(within(bar()).getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Custom answer model" }), {
      target: { value: "mistral/mistral-small" },
    });
    fireEvent.click(within(bar()).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    expect(patches(calls)[0]?.body).toMatchObject({
      config: { generation: { model: "mistral/mistral-small" } },
    });
  });

  it("a starting point fills the piece size; saving says existing files keep theirs", async () => {
    const calls = routes();
    renderSettings();
    const start = await screen.findByRole("combobox", { name: "Starting point" });
    await waitFor(() => expect(start).toHaveDisplayValue("Support · 600-character pieces"));
    fireEvent.change(start, { target: { value: "legal" } });
    expect(screen.getByLabelText<HTMLInputElement>("Piece size").value).toBe("500");
    expect(screen.getByLabelText<HTMLInputElement>("Overlap").value).toBe("80");
    expect(within(bar()).getByText("3 unsaved changes")).toBeInTheDocument();
    expect(within(bar()).getByText("Existing files keep 600")).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Save" }));
    // DM-90: asks whether to re-read the existing files; without, they keep their pieces.
    const dialog = screen.getByRole("dialog", {
      name: "Apply the new piece size to existing files?",
    });
    expect(
      within(dialog).getByText(
        "New files will use 500-character pieces. Your 14 existing files still use 600 until they’re read again.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Re-read all 14 files now (about 2 minutes)"));
    expect(within(dialog).queryByLabelText("Run tests afterwards")).toBeNull();
    expect(patches(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Saved. New files use 500-character pieces."),
    ).toBeInTheDocument();
    expect(patches(calls)[0]?.body).toEqual({
      template: "legal",
      config: { ...CONFIG, chunking: { strategy: "fixed", size: 500, overlap: 80 } },
    });
    expect(calls.some((c) => c.path.endsWith("/reread"))).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#/domains/d-support/settings");
  });

  it("a new piece size can re-read every file now and run the tests after (DmF-Piece-1…3)", async () => {
    const calls = routes({
      "POST /api/domains/d-support/reread": {
        reading: 14,
        run_tests_after: true,
        state: "started",
      },
    });
    renderSettings();
    fireEvent.change(await screen.findByLabelText("Piece size"), { target: { value: "400" } });
    expect(within(bar()).getByText("1 unsaved change · Piece size")).toBeInTheDocument();
    expect(within(bar()).getByText("Existing files keep 600")).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Save" }));
    const dialog = screen.getByRole("dialog", {
      name: "Apply the new piece size to existing files?",
    });
    expect(
      within(dialog).getByLabelText("Re-read all 14 files now (about 2 minutes)"),
    ).toBeChecked();
    expect(within(dialog).getByLabelText("Run tests afterwards")).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support"));
    expect(patches(calls)[0]?.body).toEqual({
      config: { ...CONFIG, chunking: { strategy: "fixed", size: 400, overlap: 100 } },
    });
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/reread"))?.body).toEqual({
      run_tests_after: true,
    });
    expect(
      await screen.findByText("Saved. Re-reading 14 files, then running 12 tests."),
    ).toBeInTheDocument();
  });

  it("checks the numbers before saving", async () => {
    const calls = routes();
    renderSettings();
    const size = await screen.findByLabelText<HTMLInputElement>("Piece size");
    fireEvent.change(size, { target: { value: "99" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use a number from 100 to 4,000.");
    expect(size).toHaveAttribute("aria-invalid", "true");
    expect(within(bar()).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(size, { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText("Passages per question"), { target: { value: "31" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use a number from 1 to 30.");
    fireEvent.click(within(bar()).getByRole("button", { name: "Save and run tests" }));
    expect(patches(calls)).toHaveLength(0);
  });

  it("shows the server's words when a save is refused", async () => {
    routes({
      "PATCH /api/domains/d-support": () =>
        new Response(JSON.stringify({ detail: "Overlap must be smaller than the piece size." }), {
          status: 422,
        }),
    });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Both" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Save and run tests" }));
    expect(
      await screen.findByText("Overlap must be smaller than the piece size."),
    ).toBeInTheDocument();
    expect(bar()).toBeInTheDocument();
  });

  it("another reading model warns, asks, and re-reads every file (DmF-Embed-1…3)", async () => {
    const calls = routes({
      "PATCH /api/domains/d-support": {
        domain_id: "d-support",
        reread: { needed: "required", reason: "reading_model" },
      },
    });
    renderSettings();
    await screen.findByText("openai key saved");
    const pick = (name: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: "Reading model" }));
      const list = screen.getByRole("listbox", { name: "Reading model" });
      expect(within(list).getAllByRole("option")).toHaveLength(5);
      fireEvent.click(within(list).getByRole("option", { name }));
    };
    // DM-82: the listbox names each model, its size and tagline, and the key state.
    fireEvent.click(screen.getByRole("button", { name: "Reading model" }));
    const list = screen.getByRole("listbox", { name: "Reading model" });
    expect(within(list).getByRole("option", { selected: true })).toHaveTextContent(
      "OpenAI text-embedding-3-small1536 · defaultkey saved",
    );
    expect(within(list).getByText("No huggingface token")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    // No gemini key: the warning says so and Save and re-read waits for it (DM-88).
    pick(/^Gemini embedding-001/);
    const warn = screen.getByRole("status");
    expect(warn).toHaveTextContent(
      "This re-reads all 14 files with Gemini embedding-001 (about 2 minutes). Ask and team lookups pause until it’s done. You don’t have a gemini key yet.",
    );
    expect(within(warn).getByRole("button", { name: "Add gemini key" })).toBeInTheDocument();
    expect(within(bar()).getByText("1 unsaved change · Reading model")).toBeInTheDocument();
    expect(within(bar()).getByText("Re-reads 14 files")).toBeInTheDocument();
    expect(screen.getByText("No gemini key")).toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: "Save and re-read" })).toBeDisabled();

    // The same weights through OpenRouter need no re-read (OQ-17).
    pick(/^OpenRouter text-embedding-3-small/);
    expect(within(bar()).getByText("No re-read needed")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();

    pick(/^OpenAI text-embedding-ada-002/);
    expect(screen.getByRole("status")).toHaveTextContent("Your openai key is saved.");
    fireEvent.click(within(bar()).getByRole("button", { name: "Save and re-read" }));
    const dialog = screen.getByRole("dialog", { name: "Re-read all 14 files?" });
    expect(dialog).toHaveTextContent(
      "Search compares pieces read by the same model, so every file is read again with OpenAI text-embedding-ada-002. It takes about 2 minutes. Teams that look up Support docs meanwhile wait.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(patches(calls)).toHaveLength(0);
    fireEvent.click(within(bar()).getByRole("button", { name: "Save and re-read" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save and re-read" }),
    );
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support"));
    expect(patches(calls)[0]?.body).toMatchObject({
      config: { embedding: { model: "openai/text-embedding-ada-002" } },
    });
    // The server started the re-read with the save.
    expect(calls.some((c) => c.path.endsWith("/reread"))).toBe(false);
  });

  it("Delete domain… opens the delete dialog", async () => {
    routes();
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Delete domain…" }));
    expect(screen.getByRole("dialog", { name: "Delete Support docs?" })).toBeInTheDocument();
  });
});

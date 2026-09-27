import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { useNav } from "../../lib/nav";
import {
  __resetWorkspaceStatusForTests,
  publishBadges,
  useNavBadges,
} from "../../lib/workspaceStatus";
import { DomainDetailPage } from "./DomainDetailPage";
import {
  detailView,
  domainItem,
  fakeUploads,
  fileItem,
  filesList,
  mockApi,
  sampleDomains,
} from "./domainsTestUtils";

const [support] = sampleDomains();
const SUPPORT = detailView(support, { last_question_at: null });
const FILES = [
  fileItem("refund-policy.md", { pieces: 42 }),
  fileItem("billing-faq.pdf", { byte_size: 1.2 * 1024 * 1024, pieces: 86 }),
  fileItem("troubleshooting.pdf", {
    byte_size: 3.1 * 1024 * 1024,
    created_at: "2026-09-20T10:00:00Z",
    phase: "needs_attention",
    pieces: null,
    problem: {
      kind: "no_text",
      message: "No text found. It may be a scanned image. Export it as text-based PDF.",
      fix: null,
    },
  }),
];

/** Like Workspace: the page follows the address (`?file=` opens the preview). */
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

function NavProbe() {
  const b = useNavBadges();
  return (
    <output data-testid="nav">
      {(b.domains ?? []).map((d) => `${d.name}:${d.state}`).join(",")}
    </output>
  );
}

function renderPage(hash = "#/domains/d-support") {
  window.location.hash = hash;
  return render(
    <ToastProvider>
      <Harness />
      <NavProbe />
    </ToastProvider>,
  );
}

function routes(over: Record<string, unknown> = {}) {
  return {
    "GET /api/domains/d-support": SUPPORT,
    "GET /api/domains/d-support/documents": filesList(FILES),
    ...over,
  };
}

const table = () => screen.getByRole("region", { name: "Files" });
const row = (name: string) =>
  within(table())
    .getByRole("button", { name, exact: true } as never)
    .closest("tr") as HTMLElement;

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("A domain's page (Dm-Sources)", () => {
  it("shows the header, the summary strip and the tabs", async () => {
    mockApi(routes());
    renderPage();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Support docs" });
    const head = h1.closest("header") as HTMLElement;
    expect(within(head).getByText("Ready")).toBeInTheDocument();
    expect(within(head).getByText("Support template")).toBeInTheDocument();
    expect(
      within(head).getByText(/^14 files · 1,212 pieces · read with OpenAI text-embedding-3-small/),
    ).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Domains" })).toHaveAttribute(
      "href",
      "#/domains",
    );
    const strip = screen.getByLabelText("Summary");
    expect(within(strip).getByText("Reading key saved (openai)")).toBeInTheDocument();
    expect(
      within(strip).getByText("12 test questions · 83% found the right file"),
    ).toBeInTheDocument();
    expect(within(strip).getByText("Used 3 times in 2 teams")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Set up this domain" })).toBeNull();
    const tabs = screen.getByRole("tablist", { name: "Domain sections" });
    expect(within(tabs).getByRole("tab", { name: "Sources 14" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(tabs).getByRole("tab", { name: "Use in teams 3" })).toBeInTheDocument();
  });

  it("changes tab by address without piling up history, and hides the summary off Sources", async () => {
    mockApi(routes({ "GET /api/domains/d-support/messages": { messages: [] } }));
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Support docs" });
    const before = window.history.length;
    fireEvent.click(screen.getByRole("tab", { name: "Ask" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support/ask"));
    expect(window.history.length).toBe(before);
    expect(screen.queryByLabelText("Summary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use in a team" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support/teams"));
  });

  it("offers Ask a question and Copy domain ID in the header menu", async () => {
    mockApi(routes());
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Support docs" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Support docs" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Ask a question", "Rename", "Duplicate settings", "Copy domain ID", "Delete…"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy domain ID" }));
    expect(writeText).toHaveBeenCalledWith("d-support");
    expect(await screen.findByText("Domain ID copied.")).toBeInTheDocument();
  });

  it("renames from the header and deletes back to the list (OQ-28)", async () => {
    let name = "Support docs";
    const calls = mockApi(
      routes({
        "GET /api/domains/d-support": () => ({ ...SUPPORT, name }),
        "PATCH /api/domains/d-support": (init?: RequestInit) => {
          name = (JSON.parse(init?.body as string) as { name: string }).name;
          return { domain_id: "d-support", name };
        },
        "DELETE /api/domains/d-support": { deleted: true, steps_cleared: 1, agents_cleared: 2 },
      }),
    );
    publishBadges({ domains: [{ id: "d-support", name: "Support docs", state: "ready" }] });
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Support docs" });
    const more = () => screen.getByRole("button", { name: `More actions for ${name}` });
    fireEvent.click(more());
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const rename = screen.getByRole("dialog", { name: "Rename domain" });
    fireEvent.change(within(rename).getByLabelText("Name"), { target: { value: "Help center" } });
    fireEvent.click(within(rename).getByRole("button", { name: "Save name" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Help center" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Help center");
    expect(screen.getByTestId("nav")).toHaveTextContent("Help center:ready");
    fireEvent.click(more());
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const del = screen.getByRole("dialog", { name: "Delete Help center?" });
    fireEvent.change(within(del).getByLabelText("Type the domain name to confirm"), {
      target: { value: "Help center" },
    });
    fireEvent.click(within(del).getByRole("button", { name: "Delete domain" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains"));
    expect(await screen.findByText("Help center deleted")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("says when the domain doesn't exist any more", async () => {
    mockApi({});
    renderPage("#/domains/gone");
    expect(await screen.findByText("This domain doesn’t exist any more.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Domains" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains"));
  });
});

/** A window-level file drag, as the browser sends it when a file is dropped outside a drop area. */
function windowFileDrag(type: "dragover" | "drop"): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"] } });
  window.dispatchEvent(ev);
  return ev;
}

describe("A file dropped outside a drop area (D1)", () => {
  it("never replaces the page, on any tab", async () => {
    mockApi(routes());
    renderPage("#/domains/d-support/ask");
    await screen.findByRole("heading", { name: "Support docs", level: 1 });
    expect(windowFileDrag("dragover").defaultPrevented).toBe(true);
    expect(windowFileDrag("drop").defaultPrevented).toBe(true);
  });
});

describe("The first read (DmF-First-4 → DmF-First-5)", () => {
  const reading = detailView(
    domainItem({
      name: "Support docs",
      domain_id: "d-support",
      state: "reading",
      files: { total: 3, ready: 1, reading: 1, waiting: 1, waiting_for_key: 0, needs_attention: 0 },
      pieces: 42,
    }),
    { setup: { key: true, files_read: false, tested: false, used: false } },
  );
  const done = detailView(
    domainItem({
      name: "Support docs",
      domain_id: "d-support",
      state: "ready",
      files: { total: 3, ready: 3, reading: 0, waiting: 0, waiting_for_key: 0, needs_attention: 0 },
      pieces: 179,
    }),
  );
  const firstFiles = [
    fileItem("refund-policy.md", { pieces: 42 }),
    fileItem("billing-faq.pdf", { phase: "reading", pieces: null, progress: 0.64 }),
    fileItem("getting-started.md", { phase: "waiting", pieces: null }),
  ];

  it("shows the setup strip and progress, polls every 3 s, then offers to ask", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let loads = 0;
    mockApi(
      routes({
        "GET /api/domains/d-support": () => (++loads > 1 ? done : reading),
        "GET /api/domains/d-support/documents": () =>
          filesList(loads > 1 ? firstFiles.map((f) => fileItem(f.filename)) : firstFiles),
      }),
    );
    publishBadges({ domains: [{ id: "d-support", name: "Support docs", state: "reading" }] });
    renderPage();
    const setup = await screen.findByRole("list", { name: "Set up this domain" });
    expect(within(setup).getByText("openai key saved")).toBeInTheDocument();
    expect(within(setup).getByText("Reading 3 files…")).toBeInTheDocument();
    expect(screen.getByText("Reading 3 files")).toBeInTheDocument();
    expect(screen.queryByLabelText("Summary")).toBeNull();
    await waitFor(() => expect(within(table()).getByText("Reading 64%")).toBeInTheDocument());
    expect(within(table()).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
    expect(within(table()).getByText("Waiting to read")).toBeInTheDocument();
    expect(within(table()).getByText("3 files · reading 1 of 3")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      await screen.findByText("Support docs is ready. Ask it a question."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Set up this domain" })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("nav")).toHaveTextContent("Support docs:ready"));
    await waitFor(() =>
      expect(within(table()).getByText("3 files · 126 pieces")).toBeInTheDocument(),
    );
    // Nothing is reading any more: no more polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(loads).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Ask now" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support/ask"));
  });
});

describe("The Sources table (DM-41…DM-47)", () => {
  it("lists the files with their status, and words a failed read", async () => {
    mockApi(routes());
    renderPage();
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
    const r = within(row("billing-faq.pdf"));
    expect(r.getByText("PDF")).toBeInTheDocument();
    expect(r.getByText("1.2 MB")).toBeInTheDocument();
    expect(r.getByText("86")).toBeInTheDocument();
    expect(r.getByText("Ready")).toBeInTheDocument();
    expect(r.getByText("Sep 12")).toBeInTheDocument();
    const bad = within(row("troubleshooting.pdf"));
    expect(bad.getByText("Needs attention")).toBeInTheDocument();
    expect(
      bad.getByText("No text found. It may be a scanned image. Export it as text-based PDF."),
    ).toBeInTheDocument();
    expect(bad.getByText("—")).toBeInTheDocument();
  });

  it("links a rejected key to Engines", async () => {
    mockApi(
      routes({
        "GET /api/domains/d-support/documents": filesList([
          fileItem("billing-faq.pdf", {
            phase: "needs_attention",
            pieces: null,
            problem: {
              kind: "key_rejected",
              message: "OpenAI rejected the key (401).",
              fix: "engines_key",
            },
          }),
        ]),
      }),
    );
    renderPage();
    const link = await screen.findByRole("link", { name: "Fix key in Engines" });
    expect(screen.getByText(/OpenAI rejected the key \(401\)\./)).toBeInTheDocument();
    fireEvent.click(link);
    await waitFor(() => expect(window.location.hash).toBe("#/engines/keys"));
  });

  it("searches names and text (DmF-Filter-1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi(
      routes({
        "GET /api/domains/d-support/documents": (_: unknown, url: URL) =>
          url.searchParams.get("q") === "refund"
            ? {
                ...filesList(FILES),
                documents: [
                  { ...FILES[0], matched: "name" },
                  { ...FILES[1], matched: "text" },
                ],
              }
            : filesList(FILES),
      }),
    );
    renderPage();
    const search = await screen.findByRole("textbox", { name: "Search files" });
    fireEvent.change(search, { target: { value: "refund" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() =>
      expect(within(table()).getByText("2 of 3 files match “refund”")).toBeInTheDocument(),
    );
    expect(within(table()).queryByText("troubleshooting.pdf")).toBeNull();
    expect(
      calls.some((c) => c.path === "/api/domains/d-support/documents" && c.method === "GET"),
    ).toBe(true);
  });

  it("filters with Show and its counts, then shows all again (DmF-Filter-2/3)", async () => {
    mockApi(
      routes({
        "GET /api/domains/d-support/documents": (_: unknown, url: URL) =>
          url.searchParams.get("status") === "needs_attention"
            ? { ...filesList(FILES), documents: [FILES[2]] }
            : filesList(FILES),
      }),
    );
    renderPage();
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const box = screen.getByRole("listbox", { name: "Show" });
    expect(
      within(box)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All files3", "Ready2", "Reading0", "Needs attention1"]);
    fireEvent.click(within(box).getByRole("option", { name: /Needs attention/ }));
    await waitFor(() =>
      expect(within(table()).getByText(/1 file needs attention ·/)).toBeInTheDocument(),
    );
    expect(within(table()).queryByText("refund-policy.md")).toBeNull();
    fireEvent.click(within(table()).getByRole("button", { name: "Show all files" }));
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
  });
});

describe("Re-reading every file (DmF-Embed-4, DmF-Piece-3)", () => {
  const rereadFiles = [
    fileItem("refund-policy.md", { pieces: 42 }),
    fileItem("billing-faq.pdf", { phase: "rereading", pieces: null, progress: 0.91 }),
    fileItem("getting-started.md", { phase: "waiting", pieces: null }),
  ];
  const busy = { ...support.files, ready: 1, reading: 1, waiting: 12 };

  it("a new reading model pauses Ask, says so and counts the files done", async () => {
    mockApi(
      routes({
        "GET /api/domains/d-support": {
          ...SUPPORT,
          state: "rereading",
          files: busy,
          pieces: 42,
          reading_model: { ...SUPPORT.reading_model, label: "Gemini embedding-001" },
          rereading: {
            total: 14,
            done: 1,
            eta_seconds: 117,
            reason: "reading_model",
            run_tests_after: false,
          },
        },
        "GET /api/domains/d-support/documents": filesList(rereadFiles),
      }),
    );
    renderPage();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Support docs" });
    const head = h1.closest("header") as HTMLElement;
    expect(within(head).getByText("Ask paused while re-reading")).toBeInTheDocument();
    expect(
      within(head).getByText("14 files · reading with Gemini embedding-001"),
    ).toBeInTheDocument();
    // The "14 of 14 files read" strip would be wrong now.
    expect(screen.queryByLabelText("Summary")).toBeNull();
    expect(
      await screen.findByText(
        "Re-reading with Gemini embedding-001 · about 2 minutes left. Ask is paused until it’s done.",
      ),
    ).toBeInTheDocument();
    expect(within(row("billing-faq.pdf")).getByText("Re-reading 91%")).toBeInTheDocument();
    expect(within(row("getting-started.md")).getByText("Waiting to read")).toBeInTheDocument();
    expect(await screen.findByText("Re-reading 14 files · 1 done")).toBeInTheDocument();
  });

  it("a new piece size re-reads with Ask on and the tests queued", async () => {
    mockApi(
      routes({
        "GET /api/domains/d-support": {
          ...SUPPORT,
          state: "rereading",
          files: { ...busy, ready: 0, waiting: 13 },
          config: { chunking: { strategy: "fixed", size: 400, overlap: 100 } },
          rereading: {
            total: 14,
            done: 0,
            eta_seconds: 121,
            reason: "files",
            run_tests_after: true,
          },
        },
        "GET /api/domains/d-support/documents": filesList(rereadFiles),
      }),
    );
    renderPage();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Support docs" });
    const head = h1.closest("header") as HTMLElement;
    expect(within(head).getByText("Re-reading 14 files")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Re-reading 14 files with 400-character pieces · tests run when done",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Ask is paused/)).toBeNull();
  });
});

describe("Adding files (DmF-Drag-1…4)", () => {
  const MB = 1024 * 1024;
  const sized = (name: string, size: number) => {
    const f = new File(["x"], name);
    Object.defineProperty(f, "size", { value: size });
    return f;
  };
  const dragData = (n: number, files: File[] = []) => ({
    types: ["Files"],
    items: Array.from({ length: n }, () => ({ kind: "file" })),
    files,
  });
  const body = () => document.querySelector(".dm-src") as HTMLElement;

  it("shows the drop overlay while files are dragged over the tab (DM-40)", async () => {
    mockApi(routes());
    renderPage();
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
    fireEvent.dragOver(body(), { dataTransfer: dragData(4) });
    expect(screen.getByText("Drop to add 4 files to Support docs")).toBeInTheDocument();
    expect(
      screen.getByText("They’re read automatically. You can ask about them in about a minute."),
    ).toBeInTheDocument();
    fireEvent.dragLeave(body(), { relatedTarget: null });
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
  });

  it("uploads dropped files with progress, pins them on top and turns away big ones", async () => {
    const sent = fakeUploads();
    let uploaded = false;
    const NEW = fileItem("status-page.md", {
      document_id: "doc-status",
      phase: "reading",
      pieces: null,
      progress: 0.8,
      created_at: new Date().toISOString(),
    });
    mockApi(
      routes({
        "GET /api/domains/d-support/documents": () => filesList(uploaded ? [...FILES, NEW] : FILES),
      }),
    );
    renderPage();
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
    const big = sized("video-guide.pdf", 14.2 * MB);
    fireEvent.drop(body(), {
      dataTransfer: dragData(3, [
        sized("status-page.md", 9 * 1024),
        sized("gdpr-requests.pdf", 640 * 1024),
        big,
      ]),
    });
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    // The big one never uploads: a local Needs attention row and a toast that can remove it.
    expect(
      await screen.findByText("video-guide.pdf is 14.2 MB. The limit is 10 MB."),
    ).toBeInTheDocument();
    expect(
      within(row("video-guide.pdf")).getByText(
        "Over 10 MB. Split it or compress it, then add it again.",
      ),
    ).toBeInTheDocument();
    // Two at a time, with progress.
    await waitFor(() =>
      expect(sent.map((u) => u.file?.name)).toEqual(["status-page.md", "gdpr-requests.pdf"]),
    );
    expect(sent[0].url).toBe("/api/domains/d-support/documents");
    act(() => sent[1].progress(0.45));
    expect(within(row("gdpr-requests.pdf")).getByText("Uploading 45%")).toBeInTheDocument();
    expect(within(table()).getByText(/uploading 2/)).toBeInTheDocument();
    // status-page.md lands: the server's row replaces the local one, still on top.
    uploaded = true;
    act(() => sent[0].respond(200, { document_id: "doc-status", filename: "status-page.md" }));
    await waitFor(() =>
      expect(within(row("status-page.md")).getByText("Reading 80%")).toBeInTheDocument(),
    );
    const names = () =>
      within(table())
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.querySelector(".dm-files__open")?.textContent);
    expect(names().slice(0, 4)).toEqual([
      "status-page.md",
      "gdpr-requests.pdf",
      "video-guide.pdf",
      "refund-policy.md",
    ]);
    // A local row's ⋯ offers only Remove; the toast's Remove it does the same.
    fireEvent.click(screen.getByRole("button", { name: "More actions for video-guide.pdf" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Remove"]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Remove it" }));
    expect(within(table()).queryByText("video-guide.pdf")).toBeNull();
    // The batch ends: one toast for what was added.
    act(() => sent[1].respond(413, { detail: "File too large." }));
    expect(await screen.findByText("1 file added to Support docs")).toBeInTheDocument();
    expect(
      within(row("gdpr-requests.pdf")).getByText("Couldn’t add this file: File too large."),
    ).toBeInTheDocument();
  });
});

describe("The file preview (DmF-Preview-1/2)", () => {
  const pieces = {
    document: FILES[0],
    pieces: [
      { ordinal: 0, number: 1, chars: 598, page: null, text: "# Refund policy. Money back." },
      { ordinal: 1, number: 2, chars: 600, page: 3, text: "Refunds apply to the price only." },
    ],
    total: 2,
    query: "",
    used_in_answers: { count: 6, of: 20 },
  };

  it("opens from the file name, shows its pieces, downloads in place and re-reads", async () => {
    const calls = mockApi(
      routes({
        "GET /api/domains/d-support/documents/:doc/pieces": pieces,
        "POST /api/domains/d-support/reread": {
          reading: 1,
          run_tests_after: false,
          state: "started",
        },
      }),
    );
    renderPage();
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
    fireEvent.click(
      within(row("refund-policy.md")).getByRole("button", { name: "refund-policy.md" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "refund-policy.md" });
    expect(window.location.hash).toBe(`#/domains/d-support?file=${FILES[0].document_id}`);
    expect(
      within(sheet).getByText("Markdown · 18 KB · 42 pieces · added Sep 12"),
    ).toBeInTheDocument();
    expect(await within(sheet).findByText("Piece 1 of 42")).toBeInTheDocument();
    expect(within(sheet).getByText("598 characters")).toBeInTheDocument();
    expect(within(sheet).getByText("page 3 · 600 characters")).toBeInTheDocument();
    expect(within(sheet).getByText("…Refunds apply to the price only.")).toBeInTheDocument();
    expect(within(sheet).getByText("Used in 6 of the last 20 answers")).toBeInTheDocument();
    expect(row("refund-policy.md")).toHaveClass("dm-files__row--tint");

    // D2: the original downloads in the same window, through the session.
    const download = within(sheet).getByRole("link", { name: "Download original" });
    expect(download).toHaveAttribute(
      "href",
      `/api/domains/d-support/documents/${FILES[0].document_id}/file`,
    );
    expect(download).toHaveAttribute("download", "refund-policy.md");
    expect(download).not.toHaveAttribute("target");

    fireEvent.click(within(sheet).getByRole("button", { name: "Re-read" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        document_ids: [FILES[0].document_id],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.hash).toBe("#/domains/d-support");
  });

  it("opens at a piece past the first 200, then shows earlier and later pieces", async () => {
    const seen: string[] = [];
    const piecesAt = (offset: number, limit: number) =>
      Array.from({ length: Math.max(0, Math.min(limit, 900 - offset)) }, (_, i) => ({
        ordinal: offset + i,
        number: offset + i + 1,
        chars: 600,
        page: null,
        text: `Piece text ${offset + i + 1}.`,
      }));
    mockApi(
      routes({
        "GET /api/domains/d-support/documents/:doc/pieces": (_: unknown, url: URL) => {
          seen.push(url.search);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 50);
          return { ...pieces, pieces: piecesAt(offset, limit), total: 900 };
        },
      }),
    );
    renderPage(`#/domains/d-support?file=${FILES[0].document_id}&piece=350`);
    const sheet = await screen.findByRole("dialog", { name: "refund-policy.md" });
    const marked = await within(sheet).findByText("Piece 350 of 42");
    expect(marked.closest("li")).toHaveClass("dm-piece--marked");
    fireEvent.click(within(sheet).getByRole("button", { name: "Show more" }));
    expect(await within(sheet).findByText("Piece 399 of 42")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Show earlier pieces" }));
    expect(await within(sheet).findByText("Piece 300 of 42")).toBeInTheDocument();
    expect(seen.map((q) => new URLSearchParams(q).get("offset"))).toEqual(["349", "399", "299"]);
  });

  it("opens from the address at a piece, and finds in the file", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: string[] = [];
    mockApi(
      routes({
        "GET /api/domains/d-support/documents/:doc/pieces": (_: unknown, url: URL) => {
          seen.push(url.search);
          return url.searchParams.get("q") ? { ...pieces, pieces: [], total: 0 } : pieces;
        },
      }),
    );
    renderPage(`#/domains/d-support?file=${FILES[0].document_id}&piece=2`);
    const sheet = await screen.findByRole("dialog", { name: "refund-policy.md" });
    const marked = await within(sheet).findByText("Piece 2 of 42");
    expect(marked.closest("li")).toHaveClass("dm-piece--marked");
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Find in this file" }), {
      target: { value: "sso" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await within(sheet).findByText("No pieces mention “sso”.")).toBeInTheDocument();
    expect(seen.some((s) => s.includes("q=sso"))).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(window.location.hash).toBe("#/domains/d-support"));
  });

  it("says when a re-read file is ready again (DM-50)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reread = false;
    let loads = 0;
    const rereading = detailView(support, {
      state: "reading",
      files: { ...support.files, ready: 13, reading: 1 },
    });
    mockApi(
      routes({
        "GET /api/domains/d-support": () => (reread && ++loads < 2 ? rereading : SUPPORT),
        "GET /api/domains/d-support/documents": () =>
          filesList(
            reread && loads < 2
              ? [fileItem("refund-policy.md", { phase: "rereading", pieces: null, progress: 0.4 })]
              : [fileItem("refund-policy.md", { pieces: 44 })],
          ),
        "POST /api/domains/d-support/reread": () => {
          reread = true;
          return { reading: 1, run_tests_after: false, state: "started" };
        },
      }),
    );
    renderPage();
    await waitFor(() => expect(row("refund-policy.md")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "More actions for refund-policy.md" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Re-read this file" }));
    await waitFor(() => expect(within(table()).getByText("Re-reading 40%")).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByText("refund-policy.md is ready · 44 pieces")).toBeInTheDocument();
  });
});

describe("Deleting a file (DmF-DelFile-1…3)", () => {
  const BILLING = "doc-billing-faq-pdf";
  const deletes = (calls: { method: string; path: string }[]) =>
    calls.filter((c) => c.method === "DELETE" && c.path.endsWith(`/documents/${BILLING}`));

  function fileRoutes() {
    return routes({
      "GET /api/domains/d-support/eval/cases": {
        cases: [
          { case_id: "c1", question: "q", expected_citation_doc_ids: [BILLING] },
          { case_id: "c2", question: "q", expected_citation_doc_ids: ["doc-other"] },
        ],
      },
      "DELETE /api/domains/d-support/documents/:doc": { deleted: true },
    });
  }

  async function askToDelete() {
    await waitFor(() => expect(row("billing-faq.pdf")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "More actions for billing-faq.pdf" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual([
      "Preview pieces",
      "Re-read this file",
      "Download original",
      "Copy file ID",
      "Delete file…",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete file…" }));
    return screen.getByRole("dialog", { name: "Delete billing-faq.pdf?" });
  }

  it("says what goes, hides the row at once and deletes when Undo lapses (DM-53)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi(fileRoutes());
    renderPage();
    const dialog = await askToDelete();
    expect(
      await within(dialog).findByText(
        "Its 86 pieces leave Support docs. Answers stop citing it. 1 test question expects this file and will be flagged.",
      ),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Teams using Support docs keep working with the other 13 files.",
    );
    // The row stays tinted behind the dialog.
    expect(row("billing-faq.pdf")).toHaveClass("dm-files__row--tint");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete file" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      within(table()).queryByRole("button", { name: "billing-faq.pdf", exact: true } as never),
    ).toBeNull();
    expect(screen.getByText(/^13 files · 1,126 pieces/)).toBeInTheDocument();
    expect(await screen.findByText("billing-faq.pdf deleted")).toBeInTheDocument();
    expect(deletes(calls)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(deletes(calls)).toHaveLength(1);
  });

  it("brings the row back on Undo and never sends the delete", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi(fileRoutes());
    renderPage();
    const dialog = await askToDelete();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete file" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(row("billing-faq.pdf")).toBeTruthy();
    expect(screen.getByText(/^14 files · 1,212 pieces/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(deletes(calls)).toHaveLength(0);
  });

  it("sends the delete with keepalive when the user leaves first (OQ-12)", async () => {
    const calls = mockApi(fileRoutes());
    renderPage();
    const dialog = await askToDelete();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete file" }));
    act(() => {
      window.location.hash = "#/engines";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByText("left the domain")).toBeInTheDocument();
    expect(deletes(calls)).toHaveLength(1);
    const init = vi
      .mocked(fetch)
      .mock.calls.find(([u]) => (u as string).endsWith(`/documents/${BILLING}`))?.[1];
    expect(init).toMatchObject({ method: "DELETE", keepalive: true });
  });
});

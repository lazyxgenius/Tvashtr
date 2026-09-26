import { describe, expect, it } from "vitest";

import {
  createLabel,
  deleteDomainInUse,
  deleteDomainText,
  deleteFileCallout,
  deleteFileText,
  detailBadge,
  detailWithout,
  domainNameProblem,
  filesFooter,
  filesLine,
  filterDomains,
  footerLine,
  formatAdded,
  formatShortDate,
  formatSize,
  formatUpdated,
  kindName,
  kindOfName,
  listWithout,
  metaLine,
  pieceExcerpt,
  pieceSizeLabel,
  pickProblem,
  qualityLine,
  setupSteps,
  showOptions,
  sortDomains,
  stateBadge,
  summaryItems,
  uploadProblem,
  usageLine,
} from "./domainFormat";
import {
  NOW,
  detailView,
  domainItem,
  fileItem,
  filesList,
  hoursAgo,
  sampleDomains,
} from "./domainsTestUtils";

const [support, vendor, research, q3] = sampleDomains();

describe("card lines (DM-10…DM-12)", () => {
  it("reads the design's four sample cards", () => {
    expect([support, vendor, research, q3].map(filesLine)).toEqual([
      "14 files · 1,212 pieces",
      "6 files · reading 4 of 6",
      "9 files · 1 needs attention",
      "No files yet",
    ]);
    expect([support, vendor, research, q3].map(qualityLine)).toEqual([
      "83% found the right file",
      "No test questions yet",
      "60% found the right file",
      "—",
    ]);
    expect([support, vendor, research, q3].map(usageLine)).toEqual([
      "Used 3 times in 2 teams",
      "Not used yet",
      "Used in 1 team",
      "Not used yet",
    ]);
    expect([support, vendor, research, q3].map((d) => footerLine(d, NOW))).toEqual([
      "Updated 2 hours ago",
      "Updated just now",
      "Updated yesterday",
      "Created Sep 23",
    ]);
  });

  it("words the proposed states: waiting for a key, re-reading, not run yet, singulars", () => {
    const base = { total: 3, ready: 0, reading: 0, waiting: 0, waiting_for_key: 3 };
    const waiting = domainItem({
      name: "Q3",
      state: "waiting_for_key",
      files: { ...base, needs_attention: 0 },
    });
    expect(filesLine(waiting)).toBe("3 files · waiting for an openai key");
    expect(
      filesLine({ ...waiting, reading_model: { ...waiting.reading_model, provider: "gemini" } }),
    ).toBe("3 files · waiting for a gemini key");
    const rereading = domainItem({
      name: "R",
      state: "rereading",
      files: { total: 4, ready: 1, reading: 1, waiting: 2, waiting_for_key: 0, needs_attention: 0 },
    });
    expect(filesLine(rereading)).toBe("4 files · re-reading 1 of 4");
    const two = domainItem({
      name: "Two",
      state: "needs_attention",
      files: { total: 5, ready: 3, reading: 0, waiting: 0, waiting_for_key: 0, needs_attention: 2 },
    });
    expect(filesLine(two)).toBe("5 files · 2 need attention");
    const one = domainItem({
      name: "One",
      state: "ready",
      files: { total: 1, ready: 1, reading: 0, waiting: 0, waiting_for_key: 0, needs_attention: 0 },
      pieces: 1,
    });
    expect(filesLine(one)).toBe("1 file · 1 piece");
    expect(qualityLine({ ...one, quality: { ...one.quality, cases: 12 } })).toBe(
      "12 test questions · not run yet",
    );
    expect(
      qualityLine({
        ...one,
        quality: { ...one.quality, cases: 2, last_run_at: hoursAgo(1), keyword_hit: 0.5 },
      }),
    ).toBe("50% had the key words");
    expect(usageLine({ ...one, usage: { uses: 2, teams: 1, steps: 1, agents: 1 } })).toBe(
      "Used 2 times in 1 team",
    );
  });

  it("badges each state", () => {
    expect(stateBadge("ready")).toEqual({ variant: "success", dot: true, label: "Ready" });
    expect(stateBadge("reading").label).toBe("Reading");
    expect(stateBadge("rereading").label).toBe("Re-reading");
    expect(stateBadge("needs_attention")).toEqual({
      variant: "warning",
      dot: true,
      label: "Needs attention",
    });
    expect(stateBadge("waiting_for_key").label).toBe("Waiting for a key");
    expect(stateBadge("empty")).toEqual({ variant: "neutral", dot: false, label: "Empty" });
  });
});

describe("dates", () => {
  it("says how long ago, then the date", () => {
    expect(formatUpdated(hoursAgo(0.01), NOW)).toBe("just now");
    expect(formatUpdated(hoursAgo(0.5), NOW)).toBe("30 minutes ago");
    expect(formatUpdated(hoursAgo(1), NOW)).toBe("1 hour ago");
    expect(formatUpdated(hoursAgo(30), NOW)).toBe("yesterday");
    expect(formatUpdated(hoursAgo(72), NOW)).toBe("3 days ago");
    expect(formatUpdated("2026-09-10T10:00:00Z", NOW)).toBe("Sep 10");
    expect(formatShortDate("2025-08-30T10:00:00Z", NOW)).toBe("Aug 30, 2025");
  });

  it("labels piece sizes", () => {
    expect(pieceSizeLabel(600)).toBe("600-character pieces");
    expect(pieceSizeLabel(1000)).toBe("1,000-character pieces");
  });
});

describe("search and sort (DM-7, DM-8)", () => {
  const all = sampleDomains();
  const names = (xs: { name: string }[]) => xs.map((d) => d.name);

  it("filters by a case-insensitive part of the name", () => {
    expect(names(filterDomains(all, "contr"))).toEqual(["Vendor contracts"]);
    expect(names(filterDomains(all, "  PAPERS "))).toEqual(["Research papers"]);
    expect(filterDomains(all, "filings 2025")).toEqual([]);
    expect(filterDomains(all, "")).toHaveLength(4);
  });

  it("sorts four ways", () => {
    expect(names(sortDomains(all, "recent"))).toEqual([
      "Vendor contracts",
      "Support docs",
      "Research papers",
      "Q3 filings",
    ]);
    expect(names(sortDomains(all, "name"))).toEqual([
      "Q3 filings",
      "Research papers",
      "Support docs",
      "Vendor contracts",
    ]);
    expect(names(sortDomains(all, "used"))).toEqual([
      "Support docs",
      "Research papers",
      "Q3 filings",
      "Vendor contracts",
    ]);
    expect(names(sortDomains(all, "attention"))).toEqual([
      "Research papers",
      "Vendor contracts",
      "Support docs",
      "Q3 filings",
    ]);
  });
});

// ---- The detail page and Sources tab (G2) ----

const detail = (over: Parameters<typeof detailView>[1] = {}) => detailView(support, over);
const firstRead = detailView(
  domainItem({
    name: "Support docs",
    state: "reading",
    created_at: new Date(NOW.getTime() - 20_000).toISOString(),
    files: { total: 3, ready: 1, reading: 1, waiting: 1, waiting_for_key: 0, needs_attention: 0 },
    pieces: 42,
  }),
  { setup: { key: true, files_read: false, tested: false, used: false } },
);

describe("detail header (DM-32, DM-33)", () => {
  it("badges each state", () => {
    expect(detailBadge(detail()).label).toBe("Ready");
    expect(detailBadge(firstRead)).toEqual({
      variant: "info",
      dot: true,
      label: "Reading 3 files",
    });
    const later = detail({
      state: "reading",
      files: { ...support.files, total: 16, ready: 14, reading: 1, waiting: 1 },
    });
    // After the first read, new files or one re-read don't pause Ask: the badge stays (OQ-5).
    expect(detailBadge(later).label).toBe("Ready");
    const oneReread = detail({
      state: "rereading",
      files: { ...support.files, ready: 13, reading: 1 },
    });
    expect(detailBadge(oneReread).label).toBe("Ready");
    const laterAttention = detail({
      state: "reading",
      files: { ...support.files, total: 16, ready: 14, reading: 1, needs_attention: 1 },
    });
    expect(detailBadge(laterAttention).label).toBe("1 file needs attention");
    const allAgain = detail({
      state: "rereading",
      files: { ...support.files, ready: 0, reading: 1, waiting: 13 },
    });
    expect(detailBadge(allAgain).label).toBe("Re-reading 14 files");
    const attention = detail({
      state: "needs_attention",
      files: { ...support.files, ready: 13, needs_attention: 1 },
    });
    expect(detailBadge(attention)).toEqual({
      variant: "warning",
      dot: true,
      label: "1 file needs attention",
    });
    const full = detail({
      state: "rereading",
      pieces: 0,
      files: { ...support.files, ready: 0, reading: 1, waiting: 13 },
    });
    expect(detailBadge(full).label).toBe("Ask paused while re-reading");
    expect(detailBadge(detail({ state: "waiting_for_key" })).label).toBe(
      "Waiting for an openai key",
    );
    expect(detailBadge(detail({ state: "empty" }))).toEqual({
      variant: "neutral",
      dot: false,
      label: "Empty",
    });
  });

  it("writes the meta line", () => {
    expect(metaLine(detail(), NOW)).toBe(
      "14 files · 1,212 pieces · read with OpenAI text-embedding-3-small · updated 2 hours ago",
    );
    // During the first read the pieces wait for the read to finish; a new domain says so.
    expect(metaLine(firstRead, NOW)).toBe(
      "3 files · read with OpenAI text-embedding-3-small · created just now",
    );
    const full = detail({ state: "rereading", files: { ...support.files, ready: 0, waiting: 14 } });
    expect(metaLine(full, NOW)).toContain("reading with OpenAI text-embedding-3-small");
  });
});

describe("strips (DM-34, DM-37)", () => {
  it("summarises a read domain", () => {
    expect(summaryItems(detail()).map((i) => i.text)).toEqual([
      "Reading key saved (openai)",
      "14 of 14 files read",
      "12 test questions · 83% found the right file",
      "Used 3 times in 2 teams",
    ]);
    const bare = detailView(
      domainItem({
        name: "New",
        state: "ready",
        files: {
          total: 3,
          ready: 3,
          reading: 0,
          waiting: 0,
          waiting_for_key: 0,
          needs_attention: 0,
        },
        reading_model: { ...support.reading_model, key_saved: false },
      }),
    );
    expect(summaryItems(bare)).toEqual([
      { tone: "warn", text: "No openai key" },
      { tone: "done", text: "3 of 3 files read" },
      { tone: "todo", text: "No test questions yet" },
      { tone: "todo", text: "Not used yet" },
    ]);
  });

  it("walks the four setup steps", () => {
    expect(setupSteps(firstRead)).toEqual([
      { number: 1, title: "Reading key", icon: "done", body: "openai key saved" },
      { number: 2, title: "Add files", icon: "spin", body: "Reading 3 files…" },
      {
        number: 3,
        icon: "step",
        title: "Test it",
        body: "Ask a question when reading finishes",
      },
      {
        number: 4,
        icon: "step",
        title: "Use it in a team",
        body: "As a fixed step, or give an agent access",
      },
    ]);
    const noKey = detailView(
      domainItem({
        name: "New",
        reading_model: { ...support.reading_model, key_saved: false },
        files: {
          total: 2,
          ready: 0,
          reading: 0,
          waiting: 0,
          waiting_for_key: 2,
          needs_attention: 0,
        },
      }),
      { setup: { key: false, files_read: false, tested: false, used: false } },
    );
    const [key, files] = setupSteps(noKey);
    expect(key).toMatchObject({ icon: "warn", body: "No openai key", addKey: true });
    expect(files).toMatchObject({ icon: "step", body: "2 files waiting for the key" });
  });
});

describe("Sources table words (DM-41…DM-47)", () => {
  it("formats sizes and dates", () => {
    expect(formatSize(18 * 1024)).toBe("18 KB");
    expect(formatSize(880 * 1024)).toBe("880 KB");
    expect(formatSize(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatSize(14.2 * 1024 * 1024)).toBe("14.2 MB");
    expect(formatSize(200)).toBe("1 KB");
    expect(formatAdded(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe("Just now");
    expect(formatAdded("2026-09-12T10:00:00Z", NOW)).toBe("Sep 12");
    expect(kindName("MD")).toBe("Markdown");
    expect(kindName("TXT")).toBe("Text");
  });

  it("offers the Show filter with counts", () => {
    expect(showOptions({ all: 14, ready: 13, reading: 0, needs_attention: 1 })).toEqual([
      { value: "all", label: "All files", count: 14 },
      { value: "ready", label: "Ready", count: 13 },
      { value: "reading", label: "Reading", count: 0 },
      { value: "needs_attention", label: "Needs attention", count: 1 },
    ]);
  });

  it("writes every footer", () => {
    const list = filesList([fileItem("a.md", { pieces: 700 }), fileItem("b.md", { pieces: 512 })]);
    const base = { files: support.files, list, shown: 2, query: "", filter: "all" as const };
    expect(filesFooter({ ...base, firstRead: false })).toEqual({
      text: "2 files · 1,212 pieces",
      showAll: false,
    });
    expect(filesFooter({ ...base, query: "refund", firstRead: false }).text).toBe(
      "2 of 2 files match “refund”",
    );
    expect(filesFooter({ ...base, shown: 1, filter: "needs_attention", firstRead: false })).toEqual(
      { text: "1 file needs attention · ", showAll: true },
    );
    expect(filesFooter({ ...base, shown: 1, filter: "ready", firstRead: false }).text).toBe(
      "Showing 1 of 2 files · 1,212 pieces",
    );
    const reading = { ...support.files, total: 3, ready: 1, reading: 1, waiting: 1 };
    const three = filesList([fileItem("a.md"), fileItem("b.md"), fileItem("c.md")]);
    expect(
      filesFooter({ ...base, files: reading, list: three, shown: 3, firstRead: true }).text,
    ).toBe("3 files · reading 1 of 3");
    expect(
      filesFooter({ ...base, files: reading, list: three, shown: 3, firstRead: false }).text,
    ).toBe("3 files · reading 1, waiting 1");
    const attention = { ...support.files, total: 3, ready: 2, needs_attention: 1 };
    expect(
      filesFooter({ ...base, files: attention, list: three, shown: 3, firstRead: false }).text,
    ).toBe("3 files · 1 needs attention");
    // This browser's rows (DmF-Drag-2/3): uploading and rejected files count too.
    const drag = { ...support.files, total: 16, ready: 14, reading: 1, waiting: 1 };
    const sixteen = filesList(Array.from({ length: 16 }, (_, i) => fileItem(`f${i}.md`)));
    expect(
      filesFooter({
        ...base,
        files: drag,
        list: sixteen,
        shown: 16,
        firstRead: false,
        local: { uploading: 1, rejected: 1 },
      }).text,
    ).toBe("18 files · reading 1, uploading 1, waiting 1");
    expect(
      filesFooter({
        ...base,
        files: { ...support.files, total: 17, ready: 17 },
        list: filesList(Array.from({ length: 17 }, (_, i) => fileItem(`f${i}.md`))),
        shown: 17,
        firstRead: false,
        local: { uploading: 0, rejected: 1 },
      }).text,
    ).toBe("18 files · 1 needs attention");
  });

  it("cuts piece excerpts where the design puts its ellipses", () => {
    const text = `Refunds apply to the subscription price only. ${"x".repeat(300)}`;
    expect(pieceExcerpt(text, 2)).toBe("…Refunds apply to the subscription price only.…");
    expect(pieceExcerpt("# Short piece.", 1)).toBe("# Short piece.");
    const long = `${"word ".repeat(20)}needle ${"tail ".repeat(40)}`;
    expect(pieceExcerpt(long, 1, "needle").startsWith("…")).toBe(true);
    expect(pieceExcerpt(long, 1, "needle")).toContain("needle");
  });

  it("checks files before uploading (DM-48)", () => {
    expect(uploadProblem({ name: "notes.md", size: 1000 })).toBeNull();
    expect(uploadProblem({ name: "video-guide.pdf", size: 14.2 * 1024 * 1024 })).toBe(
      "video-guide.pdf is 14.2 MB. The limit is 10 MB.",
    );
    expect(uploadProblem({ name: "deck.pptx", size: 10 })).toBe(
      "deck.pptx wasn’t added. Only PDF, Markdown, text or HTML files can be read.",
    );
  });
});

describe("the New domain dialog's words (DM-22…DM-29)", () => {
  it("checks the name: trimmed, 1–120 characters, unique ignoring case", () => {
    expect(domainNameProblem("   ", [])).toBe("Give this domain a name.");
    expect(domainNameProblem("x".repeat(121), [])).toBe("Use 120 characters or fewer.");
    expect(domainNameProblem("x".repeat(120), [])).toBeNull();
    expect(domainNameProblem(" support DOCS ", ["Support docs"])).toBe(
      "You already have a domain named “support DOCS”.",
    );
    expect(domainNameProblem("Support docs 2", ["Support docs"])).toBeNull();
  });

  it("gives a picked file its kind tile and says why it won't be added", () => {
    expect(["a.pdf", "b.MD", "c.html", "d.txt", "e"].map(kindOfName)).toEqual([
      "PDF",
      "MD",
      "HTML",
      "TXT",
      "TXT",
    ]);
    expect(pickProblem({ name: "a.md", size: 10 * 1024 * 1024 })).toBeNull();
    expect(pickProblem({ name: "a.md", size: 10 * 1024 * 1024 + 1 })).toBe("Over 10 MB.");
    expect(pickProblem({ name: "deck.pptx", size: 10 })).toBe("Only PDF, Markdown, text or HTML.");
  });

  it("says read with a key and add without one", () => {
    expect(createLabel(3, true)).toBe("Create and read 3 files");
    expect(createLabel(1, true)).toBe("Create and read 1 file");
    expect(createLabel(0, true)).toBe("Create and read 0 files");
    expect(createLabel(2, false)).toBe("Create and add 2 files");
  });
});

describe("the delete dialogs (DM-15, DM-53, OQ-14)", () => {
  it("words a domain delete, with the in-use line only for a team step", () => {
    const [support, , , q3] = sampleDomains();
    expect(deleteDomainText(support)).toBe(
      "This removes its 14 files, their pieces, the chat history and test questions. It can’t be undone.",
    );
    expect(deleteDomainText(q3)).toBe(
      "This removes its settings, the chat history and test questions. It can’t be undone.",
    );
    expect(deleteDomainInUse(support)).toBe(
      "Teams that use it as a step can’t run until you pick another domain.",
    );
    expect(deleteDomainInUse(q3)).toBeNull();
  });

  it("words a file delete from the row and the test questions", () => {
    const f = fileItem("pricing-2026.pdf", { pieces: 64 });
    expect(deleteFileText(f, "Support docs", 1)).toBe(
      "Its 64 pieces leave Support docs. Answers stop citing it. 1 test question expects this file and will be flagged.",
    );
    expect(deleteFileText(f, "Support docs", 3)).toMatch(/3 test questions expect this file/);
    expect(deleteFileText(f, "Support docs", 0)).toBe(
      "Its 64 pieces leave Support docs. Answers stop citing it.",
    );
    expect(deleteFileText(fileItem("a.pdf", { pieces: null }), "X", null)).toBe(
      "It leaves X. No answer cites it yet.",
    );
    expect(deleteFileCallout("Support docs", 13)).toBe(
      "Teams using Support docs keep working with the other 13 files.",
    );
    expect(deleteFileCallout("Support docs", 0)).toBe(
      "Support docs will have no files, so teams using it can’t get answers until you add one.",
    );
  });

  it("counts without the files waiting to be deleted (OQ-12)", () => {
    const [support] = sampleDomains();
    const gone = [
      fileItem("pricing-2026.pdf", { pieces: 64 }),
      fileItem("bad.pdf", { phase: "needs_attention", pieces: null }),
    ];
    const d = detailWithout(detailView(support), gone, NOW);
    expect(d.files.total).toBe(12);
    expect(d.pieces).toBe(1148);
    expect(d.last_activity_at).toBe(NOW.toISOString());
    const list = listWithout(filesList([...gone, fileItem("keep.md", { pieces: 5 })]), gone);
    expect(list.documents.map((f) => f.filename)).toEqual(["keep.md"]);
    expect(list.counts).toEqual({ all: 1, ready: 1, reading: 0, needs_attention: 0 });
    expect(list.total_pieces).toBe(5);
    expect(detailWithout(detailView(support), [])).toEqual(detailView(support));
  });
});

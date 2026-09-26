// Adding files by dragging, and a file that couldn't be read (group G5), website and Desktop:
//   drag-1 → DmF-Drag-1 (4 files dragged over Support docs' Sources: the drop overlay)
//   drag-2 → DmF-Drag-2 (dropped: reading 80%, uploading 45%, waiting, video-guide.pdf too big)
//   drag-3 → DmF-Drag-3 (two ready, gdpr reading 70%, the too-big row's ⋯ focused, its toast)
//   drag-4 → DmF-Drag-4 (Remove it: the row gone, "3 files added to Support docs")
//   fail-1 → DmF-Fail-1 (billing-faq.pdf: OpenAI rejected the key, Fix key in Engines)
//   fail-2 → DmF-Fail-2 (key fixed: the row's ⋯ open, Re-read this file hovered)
//   fail-3 → DmF-Fail-3 (Re-reading 40%, the badge stays Ready)
//   fail-4 → DmF-Fail-4 (ready again: "billing-faq.pdf is ready · 86 pieces")
// Counts are live (OQ-5): the strip, tab and meta line count the uploaded files where the frames
// still say 14.
import {
  D,
  DOMAINS,
  SUPPORT_FILES,
  ago,
  detailOf,
  detailRoutes,
  file,
  filesRoute,
  pair,
} from "./domains-fixtures.mjs";

const path = `/#/domains/${D.support}`;
const KB = 1024;
const MB = 1024 * 1024;
const SUPPORT = DOMAINS[0];

const counts = (total, part = {}) => ({
  total,
  ready: 0,
  reading: 0,
  waiting: 0,
  waiting_for_key: 0,
  needs_attention: 0,
  ...part,
});
const detail = (files, pieces, over = {}) =>
  detailOf({ ...SUPPORT, files, pieces, doc_count: files.total, ...over });

// ---- Dragging files in ----

// The four files the frames drop, and the uploaded rows the server then lists (created just now).
const DROPPED = [
  ["status-page.md", 9 * KB],
  ["gdpr-requests.pdf", 640 * KB],
  ["mobile-app-faq.md", 15 * KB],
  ["video-guide.pdf", 14.2 * MB],
];
const uploaded = (name, over) =>
  file(name, {
    byte_size: DROPPED.find(([n]) => n === name)[1],
    created_at: ago(0.1),
    ...over,
  });

/** The upload answers with the listed row's id (by the multipart file name). */
function uploadRoute(files) {
  return (req) => {
    const name = /filename="([^"]+)"/.exec(
      req.postDataBuffer()?.toString("latin1") ?? "",
    )?.[1];
    const row = files.find((f) => f.filename === name);
    return row
      ? { json: { ...row, ingest_status: "pending", reading: "started" } }
      : { status: 400, json: { detail: "no fixture" } };
  };
}

function dragRoutes(detailView, newRows) {
  const files = [...SUPPORT_FILES, ...newRows];
  return detailRoutes({
    detail: { ...detailView, last_activity_at: ago(0.1) },
    files,
    extra: { [`POST /api/domains/${D.support}/documents`]: uploadRoute(files) },
  });
}

/** Desktop's disclosure flag (pair's own init is replaced by a spec's) + gdpr's upload held at 45%. */
function holdGdprAt45() {
  window.sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    const f = body instanceof FormData ? body.get("file") : null;
    if (f && f.name === "gdpr-requests.pdf") {
      setTimeout(
        () =>
          this.upload.dispatchEvent(
            new ProgressEvent("progress", {
              lengthComputable: true,
              loaded: 45,
              total: 100,
            }),
          ),
        50,
      );
      return; // still uploading
    }
    return send.call(this, body);
  };
}

/** Fire a drag event carrying the four files at the Sources tab body. */
async function dragFiles(page, type) {
  await page.locator("table tbody tr").first().waitFor();
  await page.evaluate(
    ({ type, dropped }) => {
      const dt = new DataTransfer();
      for (const [name, size] of dropped)
        dt.items.add(new File([new Uint8Array(size)], name));
      const target = document.querySelector(".dm-src");
      for (const t of type === "drop"
        ? ["dragenter", "dragover", "drop"]
        : ["dragenter", "dragover"]) {
        target.dispatchEvent(
          new DragEvent(t, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          }),
        );
      }
    },
    { type, dropped: DROPPED },
  );
}

const toast = (page, text) =>
  page.getByRole("status").filter({ hasText: text });

// Drag-2: status-page.md read 80%, gdpr still uploading, mobile-app-faq.md waiting.
const DRAG2_ROWS = [
  uploaded("status-page.md", { phase: "reading", pieces: 11, progress: 0.8 }),
  uploaded("mobile-app-faq.md", { phase: "waiting", pieces: 21 }),
];
const drag2 = detail(counts(16, { ready: 14, reading: 1, waiting: 1 }), 1212, {
  state: "reading",
});

// Drag-3: two ready, gdpr reading 70%.
const DRAG3_ROWS = [
  uploaded("status-page.md", { pieces: 11 }),
  uploaded("gdpr-requests.pdf", {
    phase: "reading",
    pieces: 38,
    progress: 0.7,
  }),
  uploaded("mobile-app-faq.md", { pieces: 21 }),
];
const drag3 = detail(counts(17, { ready: 16, reading: 1 }), 1244, {
  state: "reading",
});

// Drag-4: all three ready.
const DRAG4_ROWS = [
  uploaded("status-page.md", { pieces: 11 }),
  uploaded("gdpr-requests.pdf", { pieces: 38 }),
  uploaded("mobile-app-faq.md", { pieces: 21 }),
];
const drag4 = detail(counts(17, { ready: 17 }), 1282, { state: "ready" });

// ---- A file that couldn't be read ----

const BILLING = SUPPORT_FILES.find((f) => f.filename === "billing-faq.pdf");
const rejected = (fix) =>
  file("billing-faq.pdf", {
    document_id: BILLING.document_id,
    byte_size: 1.2 * MB,
    created_at: BILLING.created_at,
    phase: "needs_attention",
    problem: {
      kind: "key_rejected",
      message: "OpenAI rejected the key (401).",
      fix,
    },
  });
const withBilling = (row) =>
  SUPPORT_FILES.map((f) => (f.document_id === BILLING.document_id ? row : f));
const attention = detail(counts(14, { ready: 13, needs_attention: 1 }), 1126, {
  state: "needs_attention",
});

/** Re-read this file flips the list to `after` (Fail-3 re-reading, Fail-4 ready again). */
function rereadRoutes(after, afterDetail) {
  let reread = false;
  return detailRoutes({
    detail: attention,
    files: [],
    extra: {
      [`GET /api/domains/${D.support}`]: () => ({
        json: reread ? afterDetail : attention,
      }),
      [`GET /api/domains/${D.support}/documents`]: (req) =>
        filesRoute(withBilling(reread ? after : rejected(null)))(req),
      [`POST /api/domains/${D.support}/reread`]: () => {
        reread = true;
        return {
          json: { reading: 1, run_tests_after: false, state: "started" },
        };
      },
    },
  });
}

async function billingMenu(page) {
  await page.locator("table tbody tr").first().waitFor();
  await page
    .getByRole("button", { name: "More actions for billing-faq.pdf" })
    .click();
  await page.getByRole("menu").waitFor();
}

async function rereadBilling(page) {
  await billingMenu(page);
  await page.getByRole("menuitem", { name: "Re-read this file" }).click();
}

/** Every render builds its own stateful routes (pair shares one spec). */
const perSurface = (name, spec) =>
  ["web", "desktop"].map((surface) => ({
    ...pair(name, spec()).find((s) => s.name.endsWith(surface)),
  }));

export default [
  ...pair("drag-1", {
    path,
    routes: detailRoutes({ detail: detailOf(SUPPORT), files: SUPPORT_FILES }),
    steps: async (page) => {
      await dragFiles(page, "over");
      await page.getByText("Drop to add 4 files to Support docs").waitFor();
    },
  }),
  ...pair("drag-2", {
    path,
    init: holdGdprAt45,
    routes: dragRoutes(drag2, DRAG2_ROWS),
    settle: 600,
    steps: async (page) => {
      await dragFiles(page, "drop");
      await page.getByText("Uploading 45%").waitFor();
      await page.getByText("Reading 80%").waitFor();
      // The frame is drawn after the too-big file's toast has gone.
      await toast(page, "The limit is 10 MB.").waitFor({
        state: "detached",
        timeout: 12_000,
      });
    },
  }),
  ...pair("drag-3", {
    path,
    routes: dragRoutes(drag3, DRAG3_ROWS),
    steps: async (page) => {
      await dragFiles(page, "drop");
      await page.getByText("Reading 70%").waitFor();
      // The frame shows only the too-big file's toast (8 s); "3 files added" (5 s) has gone.
      await toast(page, "3 files added").waitFor({
        state: "detached",
        timeout: 10_000,
      });
      await page
        .getByRole("button", { name: "More actions for mobile-app-faq.md" })
        .focus();
      await page.keyboard.press("Tab");
    },
  }),
  ...pair("drag-4", {
    path,
    routes: dragRoutes(drag4, DRAG4_ROWS),
    steps: async (page) => {
      await dragFiles(page, "drop");
      await toast(page, "3 files added to Support docs").waitFor();
      await page.getByRole("button", { name: "Remove it" }).click();
      await page
        .getByRole("button", { name: "video-guide.pdf", exact: true })
        .waitFor({ state: "detached" });
    },
  }),
  ...pair("fail-1", {
    path,
    routes: detailRoutes({
      detail: attention,
      files: withBilling(rejected("engines_key")),
    }),
  }),
  ...pair("fail-2", {
    path,
    routes: detailRoutes({
      detail: attention,
      files: withBilling(rejected(null)),
    }),
    steps: async (page) => {
      await billingMenu(page);
      await page.getByRole("menuitem", { name: "Re-read this file" }).hover();
    },
  }),
  ...perSurface("fail-3", () => ({
    path,
    routes: rereadRoutes(
      file("billing-faq.pdf", {
        document_id: BILLING.document_id,
        byte_size: 1.2 * MB,
        created_at: BILLING.created_at,
        phase: "rereading",
        pieces: 86,
        progress: 0.4,
      }),
      detail(counts(14, { ready: 13, reading: 1 }), 1126, {
        state: "rereading",
      }),
    ),
    steps: async (page) => {
      await rereadBilling(page);
      await page.getByText("Re-reading 40%").waitFor();
    },
  })),
  ...perSurface("fail-4", () => ({
    path,
    routes: rereadRoutes(BILLING, detailOf(SUPPORT)),
    steps: async (page) => {
      await rereadBilling(page);
      await toast(page, "billing-faq.pdf is ready · 86 pieces").waitFor();
    },
  })),
];

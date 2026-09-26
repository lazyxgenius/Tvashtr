// Changing how a domain's files are read (group G10), website and Desktop:
//   embed-1 → DmF-Embed-1 (Settings, the Reading model listbox open: five models, key tags)
//   embed-2 → DmF-Embed-2 (Gemini picked: the warn banner, "Re-reads 14 files", Save and re-read ringed)
//   embed-3 → DmF-Embed-3 (the "Re-read all 14 files?" confirm, Save and re-read ringed)
//   embed-4 → DmF-Embed-4 (Sources re-reading with Gemini: Ask paused, the info banner, 1 done)
//   piece-1 → DmF-Piece-1 (Piece size 400, ringed: "Existing files keep 600", Save)
//   piece-2 → DmF-Piece-2 (the "Apply the new piece size…" confirm, both boxes ticked, Save ringed)
//   piece-3 → DmF-Piece-3 (saved by the flow: Sources re-reading with 400-character pieces, the toast)
import {
  D,
  DOMAINS,
  SUPPORT_FILES,
  detailOf,
  detailRoutes,
  file,
  filesRoute,
  pair,
} from "./domains-fixtures.mjs";

const id = D.support;
const settings = `/#/domains/${id}/settings`;
const sources = `/#/domains/${id}`;
const CONFIG = {
  chunking: { strategy: "fixed", size: 600, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: {
    mode: "dense",
    top_k: 8,
    rerank: { enabled: false, model: null, top_n: 20 },
    graph: { enabled: false },
  },
  generation: { model: null },
};
const DETAIL = detailOf({ ...DOMAINS[0], config: CONFIG });
// The account holds openai, openrouter and gemini keys (the listbox tags them "key saved").
const PROVIDERS = {
  providers: [
    { provider: "openai" },
    { provider: "openrouter" },
    { provider: "gemini" },
  ],
};

const counts = (part) => ({
  total: 14,
  ready: 0,
  reading: 0,
  waiting: 0,
  waiting_for_key: 0,
  needs_attention: 0,
  ...part,
});

/** Support docs' files mid re-read: `phases` maps a file name to [phase, progress]. */
const rereadFiles = (phases) =>
  SUPPORT_FILES.map((f) => {
    const [phase, progress] = phases[f.filename] ?? ["waiting", null];
    return phase === "ready"
      ? f
      : file(f.filename, {
          document_id: f.document_id,
          byte_size: f.byte_size,
          created_at: f.created_at,
          phase,
          progress,
          pieces: f.pieces_total,
        });
  });

// Embed-4: refund-policy.md read with Gemini, three files part-way (the frame draws three at once;
// the backend reads one at a time, OQ-24), the rest waiting.
const EMBED4 = detailOf(DOMAINS[0], {
  config: { ...CONFIG, embedding: { model: "gemini/gemini-embedding-001" } },
  state: "rereading",
  files: counts({ ready: 1, reading: 3, waiting: 10 }),
  pieces: 42,
  reading_model: {
    slug: "gemini/gemini-embedding-001",
    label: "Gemini embedding-001",
    provider: "gemini",
    dim: 768,
    key_saved: true,
  },
  rereading: {
    total: 14,
    done: 1,
    eta_seconds: 117,
    reason: "reading_model",
    run_tests_after: false,
  },
});
const EMBED4_FILES = rereadFiles({
  "refund-policy.md": ["ready"],
  "billing-faq.pdf": ["rereading", 0.91],
  "getting-started.md": ["rereading", 0.82],
  "api-limits.html": ["rereading", 0.73],
});

// Piece-3, just after saving: every file waits for its 400-character pieces (none ready yet, so the
// meta line has no piece count and was updated just now), the tests run when it's done.
const PIECE3 = detailOf(DOMAINS[0], {
  config: {
    ...CONFIG,
    chunking: { strategy: "fixed", size: 400, overlap: 100 },
  },
  state: "rereading",
  files: counts({ reading: 3, waiting: 11 }),
  pieces: 0,
  last_activity_at: new Date().toISOString(),
  rereading: {
    total: 14,
    done: 0,
    eta_seconds: 121,
    reason: "files",
    run_tests_after: true,
  },
});
const PIECE3_FILES = rereadFiles({
  "refund-policy.md": ["rereading", 0.2],
  "billing-faq.pdf": ["rereading", 0.2],
  "getting-started.md": ["rereading", 0.2],
});

function settingsRoutes(extra = {}) {
  return detailRoutes({
    detail: DETAIL,
    files: SUPPORT_FILES,
    extra: {
      "GET /api/providers": PROVIDERS,
      [`GET /api/domains/${id}/eval/cases`]: { cases: [] },
      [`GET /api/domains/${id}/eval/runs`]: { runs: [] },
      ...extra,
    },
  });
}

const ready = (page) => page.getByText("openai key saved").waitFor();

const openReading = async (page) => {
  await ready(page);
  await page.getByRole("button", { name: "Reading model" }).click();
  await page.getByRole("listbox", { name: "Reading model" }).waitFor();
  await page.mouse.move(0, 0);
};

const pickGemini = async (page) => {
  await openReading(page);
  await page.getByRole("option", { name: /^Gemini embedding-001/ }).click();
  await page.getByText("Re-reads 14 files").waitFor();
};

/** The frames ring the next click: keyboard focus from the button before it. */
const ring = async (page, before) => {
  await before.focus();
  await page.keyboard.press("Tab");
  await page.mouse.move(0, 0);
};

const pieceSize400 = async (page) => {
  await ready(page);
  await page.getByLabel("Piece size").fill("400");
  await page.getByText("Existing files keep 600").waitFor();
};

/** Every render builds its own stateful routes (pair shares one spec). */
const perSurface = (name, spec) =>
  ["web", "desktop"].map((surface) => ({
    ...pair(name, spec()).find((s) => s.name.endsWith(surface)),
  }));

export default [
  ...pair("embed-1", {
    path: settings,
    routes: settingsRoutes(),
    steps: openReading,
  }),
  ...pair("embed-2", {
    path: settings,
    routes: settingsRoutes(),
    steps: async (page) => {
      await pickGemini(page);
      await ring(page, page.getByRole("button", { name: "Discard" }));
    },
  }),
  ...pair("embed-3", {
    path: settings,
    routes: settingsRoutes(),
    steps: async (page) => {
      await pickGemini(page);
      await page.getByRole("button", { name: "Save and re-read" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Re-read all 14 files?",
      });
      await dialog.waitFor();
      await ring(page, dialog.getByRole("button", { name: "Cancel" }));
    },
  }),
  ...pair("embed-4", {
    path: sources,
    routes: detailRoutes({
      detail: EMBED4,
      files: EMBED4_FILES,
      extra: { "GET /api/providers": PROVIDERS },
    }),
    steps: async (page) => {
      await page.getByText("Re-reading 14 files · 1 done").waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("piece-1", {
    path: settings,
    routes: settingsRoutes(),
    steps: pieceSize400,
  }),
  ...pair("piece-2", {
    path: settings,
    routes: settingsRoutes(),
    steps: async (page) => {
      await pieceSize400(page);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Apply the new piece size to existing files?",
      });
      await dialog.waitFor();
      await ring(page, dialog.getByRole("button", { name: "Cancel" }));
    },
  }),
  ...perSurface("piece-3", () => {
    let reread = false;
    return {
      path: settings,
      routes: settingsRoutes({
        [`GET /api/domains/${id}`]: () => ({ json: reread ? PIECE3 : DETAIL }),
        [`GET /api/domains/${id}/documents`]: (req) =>
          filesRoute(reread ? PIECE3_FILES : SUPPORT_FILES)(req),
        [`PATCH /api/domains/${id}`]: {
          domain_id: id,
          reread: { needed: "optional", reason: "pieces" },
        },
        [`POST /api/domains/${id}/reread`]: () => {
          reread = true;
          return {
            json: { reading: 14, run_tests_after: true, state: "started" },
          };
        },
      }),
      steps: async (page) => {
        await pieceSize400(page);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page
          .getByRole("dialog", {
            name: "Apply the new piece size to existing files?",
          })
          .getByRole("button", { name: "Save", exact: true })
          .click();
        await page
          .getByText("Saved. Re-reading 14 files, then running 12 tests.")
          .waitFor();
        await page
          .getByText(
            "Re-reading 14 files with 400-character pieces · tests run when done",
          )
          .waitFor();
        await page.mouse.move(0, 0);
      },
    };
  }),
];

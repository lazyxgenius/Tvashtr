// A domain's Settings tab (group G9), website and Desktop:
//   settings → Dm-Settings (Support docs: Meaning search, 8 passages, nothing changed)
//   tune-1   → DmF-Tune-1 (Both picked with the keyboard: ringed, the save bar up)
//   tune-2   → DmF-Tune-2 (the bar: "Search by: Both", No re-read needed, Save and run tests ringed)
//   tune-3   → DmF-Tune-3 (saved: Quality running 12 tests with Both search, the old scores still up)
//   tune-4   → DmF-Tune-4 (the run finished: 92% / 83%, two "fixed" marks, compared with 2 hours ago)
import { D, DOMAINS, ago, detailOf, pair } from "./domains-fixtures.mjs";
import { CASES, CONFIG, earlier, routes, run } from "./domains-quality.mjs";

const path = `/#/domains/${D.support}/settings`;
const DETAIL = detailOf({
  ...DOMAINS[0],
  config: {
    ...CONFIG,
    retrieval: {
      mode: "dense",
      top_k: 8,
      rerank: { enabled: false, model: null, top_n: 20 },
      graph: { enabled: false },
    },
  },
});

// The run with Both search: the webhook question now finds its file, the rate-limit one its key words.
const BOTH = { ...CONFIG, retrieval: { mode: "hybrid", top_k: 8 } };
const FIXED = CASES.map((c) =>
  c.question === "How do I verify webhook signatures?"
    ? { ...c, hit: true }
    : c.question === "What is the API rate limit per minute?"
      ? { ...c, kw: true }
      : c,
);
const before = [run(5, CASES, ago(120)), ...earlier(CASES)];
const running = {
  ...run(6, CASES, ago(0.1), { retrieval_mode: "hybrid", config: BOTH }),
  status: "running",
  completed_at: null,
  hit_at_k: null,
  keyword_hit: null,
  progress: { done: 7, total: 12 },
  scores: { cases_total: 12, per_case: [] },
};
const done = run(6, FIXED, ago(0.1), {
  retrieval_mode: "hybrid",
  config: BOTH,
});

const id = D.support;
/** The page's routes; `runs` answers GET …/eval/runs (a function for a run that finishes). */
function settingsRoutes(runs) {
  return {
    ...routes(CASES, before, DETAIL),
    "GET /api/providers": { providers: [{ provider: "openai" }] },
    [`PATCH /api/domains/${id}`]: { domain_id: id },
    [`POST /api/domains/${id}/eval/runs`]: running,
    [`GET /api/domains/${id}/eval/runs`]: runs,
    [`GET /api/domains/${id}/eval/runs/${done.run_id}`]: done,
  };
}

const bothByKeyboard = async (page) => {
  await page.getByRole("button", { name: "Both" }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("1 unsaved change · Search by: Both").waitFor();
};

const saveAndRunTests = async (page) => {
  await page.getByRole("button", { name: "Both" }).click();
  await page.getByRole("button", { name: "Save and run tests" }).click();
};

// Fresh routes per render: the finished run shows from the Quality tab's second read of the runs.
const perSurface = (name, spec) =>
  ["web", "desktop"].map((surface) => ({
    ...pair(name, spec()).find((s) => s.name.endsWith(surface)),
  }));

export default [
  ...pair("settings", {
    path,
    routes: settingsRoutes({ runs: before.map(({ scores, ...r }) => r) }),
    steps: async (page) => {
      await page.getByText("openai key saved").waitFor();
    },
  }),
  ...pair("tune-1", {
    path,
    routes: settingsRoutes({ runs: before.map(({ scores, ...r }) => r) }),
    steps: async (page) => {
      await page.getByText("openai key saved").waitFor();
      await bothByKeyboard(page);
    },
  }),
  ...pair("tune-2", {
    path,
    routes: settingsRoutes({ runs: before.map(({ scores, ...r }) => r) }),
    steps: async (page) => {
      await page.getByText("openai key saved").waitFor();
      await page.getByRole("button", { name: "Both" }).click();
      await page.getByRole("button", { name: "Discard" }).focus();
      await page.keyboard.press("Tab");
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("tune-3", {
    path,
    routes: settingsRoutes({
      runs: [running, ...before].map(({ scores, ...r }) => r),
    }),
    steps: async (page) => {
      await page.getByText("openai key saved").waitFor();
      await saveAndRunTests(page);
      await page.getByText("Running 12 tests with Both search…").waitFor();
      await page.getByText("How do I export all my data?").waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  ...perSurface("tune-4", () => {
    let reads = 0;
    return {
      path,
      routes: settingsRoutes(() => {
        reads += 1;
        const runs = reads === 1 ? [running, ...before] : [done, ...before];
        return { json: { runs: runs.map(({ scores, ...r }) => r) } };
      }),
      steps: async (page) => {
        await page.getByText("openai key saved").waitFor();
        await saveAndRunTests(page);
        await page
          .getByText("Ran just now · Both search · 8 passages")
          .waitFor();
        await page.getByText("fixed").first().waitFor();
        await page.mouse.move(0, 0);
      },
    };
  }),
];

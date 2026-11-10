import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { registerFresh } from "./_home";
import { seedProviderKeys } from "./_keys";

// M2 live gate (brief prompts/m2-examples.md, driven by scripts/example_builder_e2e.sh): a fresh
// account puts three claims files in a Domain, makes "Claims triage" with two tests, drafts 4 tests
// and 6 training examples with the Example builder (every seat on TVASHTR_E2E_MODEL, real agents in
// the sandbox), checks every quote against the fixture files themselves, flips, edits, meets the
// lock, accepts, downloads the training set, sees Hand in on the canvas and runs the tests. A
// screenshot per step; the real numbers are echoed at the end.

const SHOTS = process.env.TVASHTR_EXAMPLE_BUILDER_SHOTS_DIR ?? "/tmp/tvashtr_example_builder_shots";
const MODEL = process.env.TVASHTR_E2E_MODEL ?? "vertex_ai/gemini-3-flash-preview";
const FIXTURES = process.env.TVASHTR_E2E_FIXTURES ?? "";
const CHOICES = ["Motor", "Property", "Health", "Travel", "Fraud review", "Other"];
const JOB = "Reads a new insurance claim and picks the team that should handle it.";
const HAND = [
  [
    "Rear-ended at a red light. Bumper and tail lamp damaged; the other driver admits fault.",
    "Motor",
  ],
  [
    "Water from the flat above came through the ceiling during the storm and ruined a sofa.",
    "Property",
  ],
];
const SYSTEM = `${JOB}\n\nReply with exactly one of these choices and nothing else:\n${CHOICES.map((c) => `- ${c}`).join("\n")}`;

interface Draft {
  draft_id: string;
  number: number;
  kind: "test" | "training";
  input: string;
  answer: string;
  source: { file: string; quote: string };
  review: string;
  reviewed_by: string | null;
  blocked: string | null;
}
interface Batch {
  state: string;
  handed_in: number;
  cost_usd: number | null;
  estimate_usd: number | null;
  review_rounds: number;
  sent_back: number;
  drafts: Draft[];
}

let step = 0;
async function shot(page: Page, name: string) {
  step += 1;
  await page.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${name}.png`) });
}

/** The source check's own normalising: curly quotes and dashes straightened, spaces collapsed. */
const key = (t: string) =>
  t
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

async function drafts(api: APIRequestContext, modelId: string) {
  const res = await api.get(`/api/models/${modelId}/drafts`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { batches: Batch[]; test_version: number; training_version: number };
}

test("example builder: Domain → Draft with a team → review → accept → lock → JSONL → Run tests", async ({
  page,
}) => {
  test.setTimeout(40 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const api = page.request;
  const started = Date.now();

  // 1. A fresh account and its keys (Google Cloud for the team, OpenAI to read the files).
  await registerFresh(page, "m2-live");
  await seedProviderKeys(page, ["vertex_ai", "openai"]);

  // 2. A Domain with the three files, read.
  const domain = (await (
    await api.post("/api/domains", { data: { template: "blank", name: "Claims handbook" } })
  ).json()) as { id?: string; domain_id?: string };
  const domainId = (domain.id ?? domain.domain_id) as string;
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".md"));
  const text: Record<string, string> = {};
  for (const f of files) {
    text[f] = fs.readFileSync(path.join(FIXTURES, f), "utf8");
    const up = await api.post(`/api/domains/${domainId}/documents`, {
      multipart: { file: { name: f, mimeType: "text/markdown", buffer: Buffer.from(text[f]) } },
    });
    expect(up.ok(), `upload ${f} -> ${up.status()}`).toBeTruthy();
  }
  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/domains/${domainId}/documents`);
        const body = (await res.json()) as unknown;
        const rows = (
          Array.isArray(body) ? body : ((body as { documents?: unknown[] }).documents ?? [])
        ) as {
          ingest_status: string;
        }[];
        return rows.filter((r) => r.ingest_status === "ready").length;
      },
      { timeout: 5 * 60 * 1000, intervals: [2000] },
    )
    .toBe(files.length);
  await page.goto(`/#/domains/${domainId}`);
  await shot(page, "domain-ready");

  // 3. The model, with two tests by hand.
  const created = await api.post("/api/models", {
    data: { name: "Claims triage", job: JOB, answer_kind: "choice", choices: CHOICES },
  });
  expect(created.status()).toBe(201);
  const modelId = ((await created.json()) as { model_id: string }).model_id;
  for (const [input, expected] of HAND) {
    expect(
      (await api.post(`/api/models/${modelId}/tests`, { data: { input, expected } })).status(),
    ).toBe(201);
  }

  // 4. The Example builder, made the first time; every seat on the e2e model.
  const options = (await (await api.get(`/api/models/${modelId}/drafting`)).json()) as {
    teams: { team_id: string; name: string }[];
  };
  const teamId = options.teams[0].team_id;
  expect(options.teams[0].name).toBe("Example builder");
  const graph = (await (await api.get(`/api/teams/${teamId}/graph`)).json()) as {
    nodes: { id: string; kind: string; prompt: string | null }[];
  };
  for (const n of graph.nodes.filter((x) => x.kind === "agent" || x.kind === "completion")) {
    const res = await api.patch(`/api/teams/${teamId}/nodes/${n.id}`, {
      data: { prompt: n.prompt, model: MODEL },
    });
    expect(res.ok(), `seat ${n.id} -> ${res.status()}`).toBeTruthy();
  }

  // 5. Draft with a team: 4 tests + 6 training, the estimate and the pause amount show.
  await page.goto(`/#/models/${modelId}`);
  await page.getByRole("button", { name: "Draft with a team" }).click();
  const dialog = page.getByRole("dialog", { name: "Draft with a team" });
  await dialog.getByLabel("Tests").fill("4");
  await dialog.getByLabel("Training examples").fill("6");
  await expect(dialog.getByText(/^about \$/)).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(/The run pauses and asks you if it reaches/)).toBeVisible();
  const estimateText = (await dialog.getByText(/^about \$/).textContent()) ?? "";
  await shot(page, "draft-dialog");
  await dialog.getByRole("button", { name: "Start drafting" }).click();
  await expect(page).toHaveURL(/\/drafts$/, { timeout: 30_000 });
  await expect(page.getByText(/Drafting…/)).toBeVisible({ timeout: 60_000 });
  await shot(page, "drafting");

  // 6. The Drafts tab fills, then the batch is ready (allow 20 minutes).
  let batch: Batch | null = null;
  await expect
    .poll(
      async () => {
        const d = await drafts(api, modelId);
        batch = d.batches[0] ?? null;
        return batch?.state ?? "none";
      },
      { timeout: 20 * 60 * 1000, intervals: [5000] },
    )
    .not.toBe("drafting");
  const ready = batch as unknown as Batch;
  expect(ready.state, "the team handed in (not stopped)").toBe("ready");
  await page.reload();
  await expect(page.getByText(/drafts from/)).toBeVisible({ timeout: 30_000 });
  await shot(page, "drafts-ready");

  // 7. On the API: enough drafts, every quote really in its fixture file, every answer a choice,
  //    the Reviewer checked at least a third.
  const all = ready.drafts;
  expect(all.length, "at least 8 drafts").toBeGreaterThanOrEqual(8);
  for (const d of all) {
    const file = text[d.source.file];
    expect(file, `draft ${d.number} names a fixture file`).toBeTruthy();
    expect(
      key(file).includes(key(d.source.quote)),
      `draft ${d.number}'s quote is in ${d.source.file}`,
    ).toBeTruthy();
    expect(CHOICES, `draft ${d.number}'s answer`).toContain(d.answer);
  }
  const reviewed = all.filter((d) => d.reviewed_by).length;
  expect(reviewed, "the Reviewer checked at least a third").toBeGreaterThanOrEqual(
    Math.ceil(all.length / 3),
  );

  // 8. Flip one, edit one, and make a training draft equal to a hand-written test.
  const flipped = all.find((d) => d.kind === "test" && !d.blocked) as Draft;
  await page
    .getByRole("group", { name: `Draft ${flipped.number} is a` })
    .getByRole("button", { name: "Training" })
    .click();
  await expect
    .poll(
      async () =>
        (await drafts(api, modelId)).batches[0].drafts.find((d) => d.draft_id === flipped.draft_id)
          ?.kind,
    )
    .toBe("training");
  await page.reload();
  const training = (await drafts(api, modelId)).batches[0].drafts.filter(
    (d) => d.kind === "training",
  );
  const edited = training.find((d) => d.draft_id !== flipped.draft_id) as Draft;
  const copy = training.find(
    (d) => d.draft_id !== flipped.draft_id && d.draft_id !== edited.draft_id,
  ) as Draft;
  for (const [target, input] of [
    [edited, `${edited.input} The customer also attached photos.`],
    [copy, HAND[0][0]],
  ] as const) {
    const card = page.locator("article.md-dcard").filter({ hasText: target.input.slice(0, 40) });
    await page
      .getByRole("button", { name: "Show all" })
      .click()
      .catch(() => undefined);
    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Input").fill(input);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { name: /^Draft \d+$/ })).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  await page
    .getByRole("button", { name: "Show all" })
    .click()
    .catch(() => undefined);
  await expect(
    page.getByText(
      "This matches test 1, so it can't be trained on. Edit it into a different case, or reject it.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Edited by you").first()).toBeVisible();
  await shot(page, "flip-edit-lock");

  // 9. Try to accept the copy: refused with the sentence; then Accept what is selected.
  const tryCopy = await api.post(`/api/models/${modelId}/drafts/accept`, {
    data: { draft_ids: [copy.draft_id] },
  });
  const refused = (await tryCopy.json()) as {
    refused: { reason: string }[];
    accepted_training: number;
  };
  expect(refused.accepted_training).toBe(0);
  expect(refused.refused[0].reason).toContain("This matches test 1, so it can't be trained on.");
  const accept = page.getByRole("button", { name: /^Accept \d+$/ });
  const acceptN = Number(((await accept.textContent()) ?? "0").replace(/\D/g, ""));
  expect(acceptN).toBeGreaterThan(0);
  await accept.click();
  await expect(page.getByText(/^Added /)).toBeVisible({ timeout: 30_000 });
  await shot(page, "accepted");

  // 10. Tests shows the lock, the sources and a new version; Training examples shows v1.
  await page.goto(`/#/models/${modelId}`);
  await expect(page.getByText("Never used for training")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/added from Example builder/)).toBeVisible();
  const lockedRows = page.getByRole("img", { name: "Locked: never used for training" });
  expect(await lockedRows.count()).toBeGreaterThan(2);
  await expect(page.locator(".md-srcfile").first()).toBeVisible();
  await shot(page, "tests-locked");
  await page.goto(`/#/models/${modelId}/training`);
  await expect(page.getByText("Training set v1")).toBeVisible({ timeout: 30_000 });
  await shot(page, "training");

  // 11. Download JSONL: one line per example, the test instruction as its system text.
  const set = (await (await api.get(`/api/models/${modelId}/training`)).json()) as {
    examples: unknown[];
  };
  const jsonl = await (
    await api.get(`/api/models/${modelId}/training/download?format=jsonl`)
  ).text();
  const lines = jsonl
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { messages: { role: string; content: string }[] });
  expect(lines.length).toBe(set.examples.length);
  for (const l of lines) {
    expect(l.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(l.messages[0].content).toBe(SYSTEM);
    expect(CHOICES).toContain(l.messages[2].content);
  }

  // 12. The canvas of the Example builder: Hand in, the pill, Run disabled with its hint.
  await page.goto(`/#/teams/${teamId}`);
  await expect(page.getByText("Ends in Hand in · start it from a model")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".rf-node--hand-in")).toBeVisible();
  const run = page.getByRole("button", { name: /Run this team/ });
  await expect(run).toBeDisabled();
  await expect(run).toHaveAttribute(
    "title",
    "This team hands in examples. Start it from a model: Models, your model, Draft with a team.",
  );
  await shot(page, "canvas-hand-in");

  // 13. Run tests on the e2e model (top up to five tests so the estimate can learn), a card finishes.
  let tests = (
    (await (await api.get(`/api/models/${modelId}/tests`)).json()) as { tests: unknown[] }
  ).tests.length;
  for (let i = 0; tests < 5; i += 1, tests += 1) {
    await api.post(`/api/models/${modelId}/tests`, {
      data: {
        input: `Top-up claim ${i + 1}: a bus scraped my parked car's door.`,
        expected: "Motor",
      },
    });
  }
  const est = async () =>
    (
      (await (
        await api.post(`/api/models/${modelId}/estimate`, { data: { models: [MODEL] } })
      ).json()) as {
        models: { estimate_usd: number }[];
      }
    ).models[0].estimate_usd;
  const firstEstimate = await est();
  await page.goto(`/#/models/${modelId}`);
  await page.getByRole("button", { name: "Run tests" }).click();
  const runDialog = page.getByRole("dialog", { name: "Run tests" });
  await expect(runDialog.getByText(/^about \$/).first()).toBeVisible({ timeout: 30_000 });
  const startRun = await api.post(`/api/models/${modelId}/runs`, { data: { models: [MODEL] } });
  expect(startRun.status()).toBe(202);
  await runDialog.getByRole("button", { name: "Cancel" }).click();
  let real = 0;
  await expect
    .poll(
      async () => {
        const runs = (
          (await (await api.get(`/api/models/${modelId}/runs`)).json()) as {
            runs: { status: string; total_usd: number }[];
          }
        ).runs;
        real = runs[0]?.total_usd ?? 0;
        return runs[0]?.status;
      },
      { timeout: 10 * 60 * 1000, intervals: [3000] },
    )
    .toBe("completed");
  await page.goto(`/#/models/${modelId}/results`);
  await expect(page.getByText(/ passed$/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "results");
  const secondEstimate = await est();
  const final = (await drafts(api, modelId)).batches;
  console.log(
    `EXAMPLE-BUILDER LIVE: drafts=${all.length} rounds=${ready.review_rounds} sent_back=${ready.sent_back} ` +
      `cost=$${(ready.cost_usd ?? 0).toFixed(6)} estimate=${estimateText} (stored $${(ready.estimate_usd ?? 0).toFixed(6)}) ` +
      `accepted=${acceptN} minutes=${((Date.now() - started) / 60000).toFixed(1)} open_after=${final.length}`,
  );
  console.log(
    `ESTIMATE-LEARNED: first estimate $${firstEstimate.toFixed(6)} real $${real.toFixed(6)} second estimate $${secondEstimate.toFixed(6)}`,
  );
  expect(
    secondEstimate,
    "the second estimate is within 2× of the real cost",
  ).toBeGreaterThanOrEqual(real / 2);
  expect(secondEstimate).toBeLessThanOrEqual(real * 2);
});

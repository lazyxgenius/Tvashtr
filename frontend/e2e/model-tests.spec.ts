import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { seedProviderKeys } from "./_keys";

// Models 1 live gate (brief prompts/models-1.md, driven by scripts/model_tests_e2e.sh): a fresh
// account writes versioned tests by hand and by CSV, sees the cost first, runs them on two real
// models, compares them, edits one test (only its chips clear), runs an AI-judge test, finds Models
// through Cmd-K, renames and deletes. A screenshot per step; the real scores, costs and the two
// estimates are echoed at the end.

const SHOTS_DIR = process.env.TVASHTR_MODEL_TESTS_SHOTS_DIR ?? "/tmp/tvashtr_model_tests_shots";
const A = process.env.TVASHTR_E2E_MODEL_A ?? "vertex_ai/gemini-3-flash-preview";
const B = process.env.TVASHTR_E2E_MODEL_B ?? "deepseek/deepseek-chat";
const nameOf = (slug: string) => slug.split("/").pop() ?? slug;
const providerOf = (slug: string) => slug.split("/")[0];

const GOOD_CSV = [
  "input,expected",
  "A delivery van hit our parked car and broke the rear window.,Motor",
  "Hail damaged the roof of our house and water came into the attic.,Property",
  "I was admitted for appendix surgery and the hospital sent me a bill.,Health",
  "My suitcase was lost on the flight to Dubai.,Travel",
  "Two days of a burst pipe flooded the ground floor of our home.,Property",
].join("\n");

interface RunView {
  run_id: string;
  model_slug: string;
  status: string;
  passed: number;
  failed: number;
  errors: number;
  cases_total: number;
  total_usd: number;
  judge_cost_usd: number;
  estimate_usd: number | null;
  error_message: string | null;
  first_error: string | null;
}

async function untilFinished(api: APIRequestContext, modelId: string): Promise<RunView[]> {
  let runs: RunView[] = [];
  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/models/${modelId}/runs`);
        runs = ((await res.json()) as { runs: RunView[] }).runs;
        return runs.length > 0 && runs.every((r) => r.status !== "running");
      },
      { timeout: 5 * 60 * 1000, intervals: [3000] },
    )
    .toBe(true);
  return runs;
}

function csv(page: Page, name: string, text: string) {
  return page
    .getByTestId("model-csv-file")
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
}

/** Tick exactly these models in the Run tests dialog. */
async function tick(dialog: Locator, slugs: string[]) {
  const rows = dialog.locator(".md-mrow:not(.md-mrow--off)");
  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i);
    const label = (await row.locator(".ds-check__title").textContent()) ?? "";
    const want = slugs.some((s) => label.endsWith(` ${nameOf(s)}`));
    const on = await row.evaluate((el) => el.classList.contains("md-mrow--on"));
    if (want !== on) await row.locator(".ds-check__title").click();
  }
}

test("model tests: write → estimate → run on two models → compare → edit → judge", async ({
  page,
}) => {
  test.setTimeout(14 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  let step = 0;
  const shot = async (name: string) => {
    step += 1;
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOTS_DIR, `${String(step).padStart(2, "0")}-${name}.png`),
    });
  };
  const nav = page.getByRole("navigation", { name: "Dashboard" });

  // A fresh account: the first-time Models page, with no keys yet.
  const reg = await api.post("/api/auth/register", {
    data: { email: `models+${Date.now()}@tvashtr.local`, password: "model-tests-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  await page.goto("/#/models");
  await expect(
    page.getByRole("heading", { name: "Every model starts with its tests" }),
  ).toBeVisible();
  await shot("first-time");

  await seedProviderKeys(page, [...new Set([providerOf(A), providerOf(B)])]);

  // New model, then one test by hand: v1.
  await page.getByRole("button", { name: "New model" }).click();
  const create = page.getByRole("dialog", { name: "New model" });
  await create.getByRole("textbox", { name: "Name" }).fill("Claims triage");
  await create
    .getByRole("textbox", { name: "The job, in one sentence" })
    .fill("Read a new insurance claim and pick the team that should handle it.");
  const addChoice = create.getByRole("textbox", { name: "Add a choice" });
  for (const choice of ["Motor", "Property", "Health", "Travel"]) {
    await addChoice.fill(choice);
    await addChoice.press("Enter");
  }
  await shot("new-model");
  await create.getByRole("button", { name: "Create model" }).click();
  await expect(page.getByRole("heading", { name: "No tests yet" })).toBeVisible();
  const claimsId = /#\/models\/([^/]+)/.exec(page.url())?.[1] ?? "";
  expect(claimsId).not.toBe("");

  await page.getByRole("button", { name: "Add test" }).first().click();
  await page
    .getByRole("textbox", { name: "Input" })
    .fill(
      "Rear-ended at a red light. Bumper and tail lamp damaged; the other driver admits fault.",
    );
  await page.getByRole("combobox", { name: "Expected answer" }).selectOption("Motor");
  await shot("add-test");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByText("Test set v1")).toBeVisible();

  // A CSV with a bad row: its line named, nothing imported.
  await page.getByRole("button", { name: "Import CSV" }).click();
  const importer = page.getByRole("dialog", { name: "Import tests from a CSV" });
  await csv(page, "bad.csv", "input,expected\nA claim,Motor\nAnother claim,Moto\n");
  await expect(importer.getByText("Line 3: “Moto” isn't one of the choices.")).toBeVisible();
  await expect(
    importer.getByText("Fix the file and choose it again. Nothing was imported."),
  ).toBeVisible();
  await shot("csv-bad-row");
  const afterBad = (await (await api.get(`/api/models/${claimsId}`)).json()) as {
    current_version: number;
  };
  expect(afterBad.current_version).toBe(1);

  // A good CSV of 5: v2, 6 tests.
  await csv(page, "claims.csv", GOOD_CSV);
  await expect(
    importer.getByText("5 tests ready to import. They become test set v2."),
  ).toBeVisible();
  await importer.getByRole("button", { name: "Import 5 tests" }).click();
  await expect(page.getByText("Test set v2")).toBeVisible();
  const table = page.getByRole("region", { name: "Tests" });
  await expect(table.getByRole("row")).toHaveCount(7);
  await shot("tests-v2");

  // Run tests: the cost first.
  await page.getByRole("button", { name: "Run tests" }).click();
  const dialog = page.getByRole("dialog", { name: "Run tests" });
  await expect(dialog.getByText("All 6 tests from test set v2 of Claims triage")).toBeVisible();
  await expect(dialog.getByText("paid on your own keys", { exact: false })).toBeVisible();
  await tick(dialog, [A, B]);
  const rowOf = (slug: string) =>
    dialog.locator(".md-mrow").filter({ hasText: ` ${nameOf(slug)}` });
  await expect(rowOf(A).locator(".md-mrow__cost")).toHaveText(/^about /);
  await expect(rowOf(B).locator(".md-mrow__cost")).toHaveText(/^about /);
  await expect(dialog.locator(".md-estimate__sum")).toHaveText(/^about /);
  await expect(
    dialog.getByText("These tests use exact match, so no judge model is needed.", { exact: false }),
  ).toBeVisible();
  const estimateTotal = await dialog.locator(".md-estimate__sum").textContent();
  await shot("run-dialog");
  await dialog.getByRole("button", { name: "Run 6 tests on 2 models" }).click();

  // Both cards finish with real scores and costs.
  await expect(page.getByRole("tab", { name: /Results/ })).toHaveAttribute("aria-selected", "true");
  await shot("results-running");
  const runs = await untilFinished(api, claimsId);
  for (const r of runs) {
    expect(r.status, `${r.model_slug}: ${r.error_message}`).toBe("completed");
    expect(r.total_usd, `${r.model_slug} real cost`).toBeGreaterThan(0);
  }
  await expect(page.locator(".md-rcard")).toHaveCount(2);
  await expect(page.locator(".md-rcard__meta").first()).toContainText("for all 6");
  await shot("results-finished");

  // Compare: the sentence, and All 6 shows 6 rows.
  const compare = page.getByRole("region", { name: "Compare two models" });
  await expect(
    compare.getByText(/They agree on \d+ of 6 tests \(\d+ both right, \d+ both wrong\)\./),
  ).toBeVisible();
  await compare.getByRole("button", { name: "All 6" }).click();
  await expect(compare.getByRole("row")).toHaveCount(7);
  await shot("compare-all");

  // Edit test 1 (v3): only row 1's chips clear; Results says there are no runs on v3 yet.
  await page.getByRole("tab", { name: /Tests/ }).click();
  await expect(table.getByRole("row").nth(1).locator(".md-mk")).toHaveCount(2);
  await table.getByRole("row").nth(1).getByText("Rear-ended").click();
  await page
    .getByRole("textbox", { name: "Input" })
    .fill("Rear-ended at a red light on the ring road. The other driver admits fault.");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByText("Test set v3")).toBeVisible();
  await expect(table.getByRole("row").nth(1).locator(".md-mk")).toHaveCount(0);
  await expect(table.getByRole("row").nth(2).locator(".md-mk")).toHaveCount(2);
  await shot("edited-test-1");
  await page.getByRole("tab", { name: /Results/ }).click();
  await expect(page.getByRole("heading", { name: "No runs on test set v3 yet." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Runs on earlier versions (2)" })).toBeVisible();
  await shot("no-runs-on-v3");

  // A second model that writes text: one Must-contain test, one AI-judge test, run on A.
  await nav.getByRole("button", { name: "Models" }).click();
  await page.getByRole("button", { name: "New model" }).click();
  const second = page.getByRole("dialog", { name: "New model" });
  await second.getByRole("textbox", { name: "Name" }).fill("Support email router");
  await second
    .getByRole("textbox", { name: "The job, in one sentence" })
    .fill("Read a support email and say which product it is about and how urgent it is.");
  await second.getByText("Write text", { exact: true }).click();
  await second.getByRole("button", { name: "Create model" }).click();
  await expect(page.getByRole("heading", { name: "No tests yet" })).toBeVisible();
  const supportId = /#\/models\/([^/]+)/.exec(page.url())?.[1] ?? "";

  await page.getByRole("button", { name: "Add test" }).first().click();
  await page.getByRole("textbox", { name: "Input" }).fill("How do I export my invoices as a CSV?");
  await page
    .getByRole("textbox", { name: "Expected answer" })
    .fill("Product: Web dashboard. Urgency: Low.");
  const phrase = page.getByRole("textbox", { name: "Add a word or phrase" });
  await phrase.fill("dashboard");
  await phrase.press("Enter");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByText("Test set v1")).toBeVisible();

  await page.getByRole("button", { name: "Add test" }).first().click();
  await page
    .getByRole("textbox", { name: "Input" })
    .fill(
      "Since last night's update the app logs me out every time I open it. I have deliveries at 9 am and can't see the order list.",
    );
  await page
    .getByRole("textbox", { name: "Expected answer" })
    .fill("Product: Mobile app. Urgency: High, because it blocks work tomorrow morning.");
  await page.getByRole("button", { name: "AI judge" }).click();
  await page
    .getByRole("textbox", { name: "What a right answer must do" })
    .fill("Names the mobile app as the product and marks it high urgency.");
  const judgeSelect = page.getByRole("combobox", { name: "Judge model" });
  await expect(judgeSelect.locator(`option[value="${A}"]`)).toHaveCount(1);
  await judgeSelect.selectOption(A);
  await shot("judge-test");
  await page.getByRole("button", { name: "Save test" }).click();
  await expect(page.getByText("Test set v2")).toBeVisible();

  await page.getByRole("button", { name: "Run tests" }).click();
  const run2 = page.getByRole("dialog", { name: "Run tests" });
  await expect(run2.getByText("judged by", { exact: false })).toBeVisible();
  await tick(run2, [A]);
  await expect(run2.locator(".md-estimate__sum")).toHaveText(/^about /);
  const judgeEstimate = await run2.locator(".md-estimate__sum").textContent();
  await run2.getByRole("button", { name: "Run 2 tests on 1 model" }).click();
  const judged = await untilFinished(api, supportId);
  expect(judged[0].status, `${judged[0].error_message}`).toBe("completed");
  await expect(page.getByText(/Includes .* for the AI judge\./)).toBeVisible();
  await shot("judge-run");

  await page.getByRole("tab", { name: /Tests/ }).click();
  await page.getByRole("region", { name: "Tests" }).getByText("Since last night").click();
  await expect(page.getByText(/^Judge: ".+"$/)).toBeVisible();
  await shot("judge-verdict");
  await page.getByRole("button", { name: "Close" }).click();

  // Cmd-K finds Models.
  await page.getByRole("button", { name: "Search teams, runs and actions" }).click();
  await page.getByRole("combobox", { name: "Search teams, runs and actions" }).fill("open models");
  await page.getByRole("option", { name: "Open Models" }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(page.getByRole("link", { name: "Support email router" })).toBeVisible();
  await shot("cmdk-models");

  // Settings: rename, then delete the second model.
  await page.getByRole("link", { name: "Support email router" }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Support router");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Support router", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Delete this model" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete Support router?" });
  await shot("delete-confirm");
  await confirm.getByRole("button", { name: "Delete model" }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(page.getByRole("link", { name: "Claims triage" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Support router" })).toHaveCount(0);
  await shot("deleted");

  // The real numbers.
  const line = (r: RunView) =>
    `${r.model_slug}: ${r.passed}/${r.cases_total} passed, ${r.failed} failed, ${r.errors} errors; ` +
    `real $${r.total_usd.toFixed(6)} (judge $${r.judge_cost_usd.toFixed(6)}) vs estimate $${(r.estimate_usd ?? 0).toFixed(6)}`;
  console.log(`[model-tests] estimate shown for both: ${estimateTotal}`);
  for (const r of runs) console.log(`[model-tests] Claims triage ${line(r)}`);
  console.log(`[model-tests] estimate shown for the judge run: ${judgeEstimate}`);
  console.log(`[model-tests] Support router ${line(judged[0])}`);
});

import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for M-accounts Slice C: the provider-gated per-node model picker + the recommendation
// hint. NO agent run, NO real LLM. .env-INDEPENDENT: it registers a FRESH account (zero providers, no
// .env contamination) and SEEDS ITS OWN dummy encrypted provider creds via the authenticated
// /api/providers endpoint (the same encrypt-at-rest table the dashboard uses) — so it passes
// identically whether the operator's .env provider keys are present or deleted. Targeted selectors +
// a screenshot per check (NOT a full a11y snapshot — that wedges on the React Flow canvas, §4).

const SHOTS_DIR = process.env.TVASHTR_MODEL_PICKER_SHOTS_DIR ?? "/tmp/tvashtr_model_picker_shots";
const SEEDED = ["openrouter", "nvidia_nim", "openai"];

test("model picker: provider-gated picker + inline add + the same-model reviewer hint", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // Register a fresh account → the dashboard (a seeded starter team, zero providers).
  await page.goto("/");
  await page.getByRole("button", { name: "Create your own team" }).click();
  const email = `picker+${Date.now()}@tvashtr.local`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("model-picker-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Add your provider API keys")).toBeVisible({ timeout: 30_000 });

  // Seed THIS account's own dummy encrypted creds via the authenticated API (no .env, no real key).
  for (const provider of SEEDED) {
    const resp = await page.request.post("/api/providers", {
      data: { provider, api_key: `dummy-${provider}-key-0000` },
    });
    expect(resp.ok()).toBeTruthy();
  }

  // Open the seeded team → the canvas (authoring view).
  await page.reload();
  await page.getByRole("button", { name: /My team/ }).click();
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  console.log("[model-picker-e2e] CHECK 1 PASS — registered, seeded providers, opened the canvas");

  // CHECK 2 — click the Engineer node → the panel: the Provider select lists the seeded providers AND
  // the Model field shows the node's model.
  await page.locator(".react-flow__node", { hasText: "Engineer" }).first().click();
  const panel = page.getByLabel("Engineer editor");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const provider = panel.getByLabel("Provider", { exact: true });
  await expect(provider.getByRole("option", { name: "openrouter" })).toHaveCount(1);
  await expect(provider.getByRole("option", { name: "nvidia_nim" })).toHaveCount(1);
  const engineerModel = await panel.getByLabel("Model").inputValue();
  expect(engineerModel.length).toBeGreaterThan(0);
  expect(engineerModel).toContain("/"); // a full provider/model slug
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-engineer-picker.png") });
  console.log(`[model-picker-e2e] CHECK 2 PASS — picker lists providers; model=${engineerModel}`);

  // CHECK 3 — the inline "Add a provider" reaches the SAME store the dashboard reads.
  await provider.selectOption("__add_provider__");
  await panel.getByLabel("New provider", { exact: true }).fill("groq"); // exact: not "…API key"
  await panel.getByLabel("New provider API key").fill("dummy-groq-key-9999");
  await panel.getByRole("button", { name: "Add" }).click();
  await expect(provider.getByRole("option", { name: "groq" })).toHaveCount(1, { timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-inline-add.png") });
  // Persisted: back on the dashboard, the providers section lists groq too.
  await page.getByRole("button", { name: "← Dashboard" }).click();
  await expect(page.getByText("groq")).toBeVisible({ timeout: 30_000 });
  console.log(
    "[model-picker-e2e] CHECK 3 PASS — inline-added groq appears in the panel + dashboard",
  );

  // CHECK 4 — the recommendation hint: the Reviewer shares the Engineer's model → hint VISIBLE; a
  // thinker (the PM) → hint ABSENT (the discriminating pair).
  await page.getByRole("button", { name: /My team/ }).click();
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  await page.locator(".react-flow__node", { hasText: "Reviewer" }).first().click();
  const reviewerPanel = page.getByLabel("Reviewer editor");
  await expect(reviewerPanel).toBeVisible({ timeout: 30_000 });
  await expect(reviewerPanel.getByText(/Reviews are stronger when the reviewer runs/i)).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, "check4-reviewer-hint.png") });
  // Absent on a thinker (the PM / Product manager node).
  await page.locator(".react-flow__node", { hasText: "Product manager" }).first().click();
  const pmPanel = page.getByLabel("Product manager editor");
  await expect(pmPanel).toBeVisible({ timeout: 30_000 });
  await expect(pmPanel.getByText(/Reviews are stronger when the reviewer runs/i)).toHaveCount(0);
  console.log(
    "[model-picker-e2e] CHECK 4 PASS — hint present on Reviewer (same model), absent on PM",
  );

  for (const f of [
    "check2-engineer-picker.png",
    "check3-inline-add.png",
    "check4-reviewer-hint.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

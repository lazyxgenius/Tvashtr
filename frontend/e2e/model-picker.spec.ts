import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";
import { openMyTeam } from "./_myTeam";

// Live FE proof for M-accounts Slice C: the provider-gated per-node model picker + the recommendation
// hint. NO agent run, NO real LLM. .env-INDEPENDENT: it registers a FRESH account (zero providers, no
// .env contamination) and SEEDS ITS OWN dummy encrypted provider creds via the authenticated
// /api/providers endpoint (the same encrypt-at-rest table the dashboard uses) — so it passes
// identically whether the operator's .env provider keys are present or deleted. Targeted selectors +
// a screenshot per check (NOT a full a11y snapshot — that wedges on the React Flow canvas, §4).
// Revamp round 1: the account registers through the API (the email sign-up form is hidden in the
// hosted posture .env sets), the team is created (new accounts start with none), and the saved keys
// are read back on Engines › API keys (the old dashboard's providers section).
// Revamp round 2 (F5 G4): the drawer's model picker groups models by provider (a listbox each) for the
// node's seat, with an inline key field for a provider with no key yet; the recommendation hint is the
// same-model advisory under the Model row.

const SHOTS_DIR = process.env.TVASHTR_MODEL_PICKER_SHOTS_DIR ?? "/tmp/tvashtr_model_picker_shots";
const SEEDED = ["openrouter", "nvidia_nim", "openai"];

test("model picker: seat-grouped picker + inline key add + the same-model advisory", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // Register a fresh account → Home (no team, zero providers).
  await registerFresh(page, "picker");
  const held = (await (await page.request.get("/api/providers")).json()) as {
    providers: unknown[];
  };
  expect(held.providers, "a fresh account holds no provider keys").toEqual([]);

  // Seed THIS account's own dummy encrypted creds via the authenticated API (no .env, no real key).
  for (const provider of SEEDED) {
    const resp = await page.request.post("/api/providers", {
      data: { provider, api_key: `dummy-${provider}-key-0000` },
    });
    expect(resp.ok()).toBeTruthy();
  }

  // Create + open the review_loop "My team" → the canvas (authoring view).
  const myTeamId = await openMyTeam(page);
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  console.log("[model-picker-e2e] CHECK 1 PASS — registered, seeded providers, opened the canvas");

  // CHECK 2 — click the Engineer node → its drawer: the Model button opens the picker, whose groups
  // are the worker seat's providers with how this account runs each. NIM serves no seat, so it is
  // never offered even though the account holds its key; the held keys read "API key".
  await page.locator(".react-flow__node", { hasText: "Engineer" }).first().click();
  const panel = page.getByRole("complementary", { name: "Engineer settings" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const modelSection = panel.getByRole("region", { name: "Model" });
  const modelButton = modelSection.locator('button[aria-haspopup="dialog"]');
  const engineerModel = ((await modelButton.textContent()) ?? "").trim();
  expect(engineerModel.length).toBeGreaterThan(0);
  await modelButton.click();
  const picker = panel.getByRole("dialog", { name: "Choose a model" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  const group = (provider: string) =>
    picker.getByRole("group", { name: new RegExp(`^${provider}\\b`) });
  await expect(group("openai").getByText("API key")).toBeVisible();
  await expect(group("openrouter").getByText("API key")).toBeVisible();
  await expect(group("nvidia_nim")).toHaveCount(0);
  await expect(picker.getByRole("option", { selected: true })).toHaveCount(1);
  await expect(group("groq").getByText("No key yet")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-engineer-picker.png") });
  console.log(
    `[model-picker-e2e] CHECK 2 PASS — picker groups by seat, no NIM; model=${engineerModel}`,
  );

  // CHECK 3 — a key pasted into the "No key yet" group reaches the SAME store the dashboard reads,
  // and the model lands on that provider's model with the "saved to Engines" toast.
  await group("groq").getByLabel("Paste your Groq API key").fill("dummy-groq-key-9999");
  await group("groq").getByRole("button", { name: "Add", exact: true }).click();
  await expect(picker).toHaveCount(0, { timeout: 30_000 });
  await expect(panel.getByText("Groq key saved to Engines")).toBeVisible({ timeout: 30_000 });
  await expect(modelSection.getByText(/Uses your Groq API key \(saved in Engines\)/)).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-inline-add.png") });
  // Persisted: back in the shell (discarding the unsaved model change), Engines › API keys lists groq.
  await page.getByRole("button", { name: "Back to teams" }).click();
  await panel
    .getByRole("alertdialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Discard" })
    .click();
  await shellNav(page)
    .getByRole("button", { name: /^Engines/ })
    .click();
  await shellNav(page)
    .getByRole("button", { name: /^API keys/ })
    .click();
  const keys = page.locator("section[aria-labelledby='tv-engines-keys']");
  await expect(keys.locator(".tv-dash__prov-name", { hasText: /^groq$/ })).toBeVisible({
    timeout: 30_000,
  });
  console.log(
    "[model-picker-e2e] CHECK 3 PASS — the inline key lands in Engines › API keys and on the model",
  );

  // CHECK 4 — the same-model advisory: the Reviewer (a verdict agent) shares the Engineer's model
  // → advisory VISIBLE; the PM (no verdict) → ABSENT (the discriminating pair).
  await page.goto(`/#/teams/${myTeamId}`);
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  await page.locator(".react-flow__node", { hasText: "Reviewer" }).first().click();
  const reviewerPanel = page.getByRole("complementary", { name: "Reviewer settings" });
  await expect(reviewerPanel).toBeVisible({ timeout: 30_000 });
  await expect(reviewerPanel.getByText(/Reviews are stronger when the reviewer runs/i)).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, "check4-reviewer-hint.png") });
  // Absent on the PM (the Product manager node).
  await page.locator(".react-flow__node", { hasText: "Product manager" }).first().click();
  const pmPanel = page.getByRole("complementary", { name: "Product manager settings" });
  await expect(pmPanel).toBeVisible({ timeout: 30_000 });
  await expect(pmPanel.getByText(/Reviews are stronger when the reviewer runs/i)).toHaveCount(0);
  console.log(
    "[model-picker-e2e] CHECK 4 PASS — advisory present on Reviewer (same model), absent on PM",
  );

  for (const f of [
    "check2-engineer-picker.png",
    "check3-inline-add.png",
    "check4-reviewer-hint.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for M-accounts Slice B: the full account journey — account-based + provider-keyed.
// Targeted selectors (NOT a whole-tree a11y snapshot — that wedges on the React Flow canvas,
// HANDOVER §4). NO agent run is driven; no NVIDIA key needed.
//
// Selector contract:
//   Landing  — CTAs "Try the canvas" | "Create your own team"; the canvas marker "the living canvas"
//              + the dashboard "+ New team" are ABSENT here.
//   Register — the LoginScreen in register mode: aria-labels "Email"/"Password", button "Create
//              account".
//   Dashboard — the empty providers prompt "Add your provider API keys"; the provider add fields
//              "Provider"/"API key" + button "Add key"; a team row button (the seeded "My team").
//   Canvas   — the App header subtitle "the living canvas"; the back control "← Dashboard".

const SHOTS_DIR = process.env.TVASHTR_ACCOUNTS_SHOTS_DIR ?? "/tmp/tvashtr_accounts_shots";

test("accounts journey: landing → register → empty dashboard → add key → open team → canvas", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // STEP 1 — a logged-out visit shows the LANDING page: CTAs present, NO canvas, NO "create team".
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create your own team" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("the living canvas")).toHaveCount(0); // not the canvas
  await expect(page.getByRole("button", { name: "+ New team" })).toHaveCount(0); // no create-team
  await expect(page.getByLabel("Email")).toHaveCount(0); // not the login form yet
  await page.screenshot({ path: path.join(SHOTS_DIR, "step1-landing.png") });
  console.log("[accounts-e2e] STEP 1 PASS — logged-out landing page (no canvas, no create-team)");

  // STEP 2 — a CTA opens register; a brand-new account lands on the EMPTY dashboard.
  const email = `e2e+${Date.now()}@tvashtr.local`;
  await page.getByRole("button", { name: "Create your own team" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("accounts-e2e-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  // The dashboard, fresh: the providers section shows its empty-state prompt; NOT the canvas.
  await expect(page.getByText("Add your provider API keys")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "step2-empty-dashboard.png") });
  console.log(`[accounts-e2e] STEP 2 PASS — registered ${email} → empty dashboard`);

  // STEP 3 — add a provider API key; it shows as `provider · •••• last4` (the secret is never shown).
  // exact:true — the input's aria-label is "Provider"; a non-exact match also hits the section's
  // aria-label "Your providers" (substring), so pin it to the field.
  await page.getByLabel("Provider", { exact: true }).fill("openrouter");
  await page.getByLabel("API key").fill("sk-or-e2e-fake-1234");
  await page.getByRole("button", { name: "Add key" }).click();
  await expect(page.getByText("openrouter")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/•••• 1234/)).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, "step3-provider-added.png") });
  console.log("[accounts-e2e] STEP 3 PASS — added a provider key (•••• 1234, secret never shown)");

  // STEP 4 — open the seeded team from the dashboard → the canvas; back-to-dashboard returns.
  await page.getByRole("button", { name: /My team/ }).click();
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "step4-canvas.png") });
  console.log("[accounts-e2e] STEP 4 PASS — opened a team → reached the canvas");

  await page.getByRole("button", { name: "← Dashboard" }).click();
  await expect(
    page.getByText("Add your provider API keys").or(page.getByText("openrouter")),
  ).toBeVisible({
    timeout: 30_000,
  });
  console.log("[accounts-e2e] STEP 4b PASS — back-to-dashboard returns to the dashboard");

  for (const f of [
    "step1-landing.png",
    "step2-empty-dashboard.png",
    "step3-provider-added.png",
    "step4-canvas.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

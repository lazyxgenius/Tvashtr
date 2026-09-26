import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for the account journey on the revamped shell: landing → register → a first-time
// Home → add a provider key on Engines › API keys → New team → the canvas → back to Home.
// Targeted selectors (NOT a whole-tree a11y snapshot — that wedges on the React Flow canvas,
// HANDOVER §4). NO agent run is driven; no NVIDIA key needed. The email/password form only exists
// in the self-hosted posture, so scripts/accounts_e2e.sh pins TVASHTR_HOSTED_MODE=false.
//
// Selector contract:
//   Landing  — the "Get started" / "Sign in" CTAs; the shell's "Dashboard" nav, the canvas marker
//              "the living canvas" and the Email field are ABSENT here.
//   Register — the AuthWizard: "Email"/"Password", "Create account", then the two scene-setting
//              steps (a role card, Continue, a "building" card, Continue) and "Enter Tvashtr".
//   Home     — first time: "Welcome to Tvashtr…" + the "Get started" checklist ("N of 4 done").
//   Keys     — Engines › API keys (#/engines/keys): "Provider"/"API key" + "Add key"; a saved key
//              shows as `provider` + "Saved · •••• last4" (the secret is never shown).
//   Canvas   — "the living canvas"; the toolbar's "Back to dashboard" arrow.

const SHOTS_DIR = process.env.TVASHTR_ACCOUNTS_SHOTS_DIR ?? "/tmp/tvashtr_accounts_shots";

test("accounts journey: landing → register → first-time Home → add key → new team → canvas → back", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const nav = page.getByRole("navigation", { name: "Dashboard" });

  // STEP 1 — a logged-out visit shows the LANDING page: CTAs present, NO shell, NO canvas.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Get started" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(nav).toHaveCount(0); // not the signed-in shell
  await expect(page.getByText("the living canvas")).toHaveCount(0); // not the canvas
  await expect(page.getByLabel("Email")).toHaveCount(0); // not the sign-up form yet
  await page.screenshot({ path: path.join(SHOTS_DIR, "step1-landing.png") });
  console.log("[accounts-e2e] STEP 1 PASS — logged-out landing page (no shell, no canvas)");

  // STEP 2 — a CTA opens register; a brand-new account lands on the first-time Home.
  const email = `e2e+${Date.now()}@tvashtr.local`;
  await page.getByRole("button", { name: "Get started" }).first().click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("accounts-e2e-pass");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: /^Engineer/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /^A fresh idea/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("button", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /^Welcome to Tvashtr/ })).toBeVisible({
    timeout: 30_000,
  });
  const checklist = page.getByRole("region", { name: "Get started" });
  await expect(checklist).toContainText("0 of 4 done", { timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "step2-first-time-home.png") });
  console.log(`[accounts-e2e] STEP 2 PASS — registered ${email} → first-time Home (0 of 4 done)`);

  // STEP 3 — add a provider API key on Engines › API keys; it shows as `provider` + `•••• last4`.
  await nav.getByRole("button", { name: /^Engines/ }).click();
  await nav.getByRole("button", { name: /^API keys/ }).click();
  await expect(page).toHaveURL(/#\/engines\/keys$/);
  const keys = page.locator("section[aria-labelledby='tv-engines-keys']");
  await expect(keys).toBeVisible({ timeout: 30_000 });
  await keys.getByLabel("Provider", { exact: true }).fill("openrouter");
  await keys.getByLabel("API key").fill("sk-or-e2e-fake-1234");
  await keys.getByRole("button", { name: "Add key" }).click();
  await expect(keys.getByTestId("engines-key-provider")).toHaveText(["openrouter"], {
    timeout: 30_000,
  });
  await expect(keys.getByText(/•••• 1234/)).toBeVisible();
  await expect(page.getByText("sk-or-e2e-fake-1234")).toHaveCount(0); // the secret is never shown
  await page.screenshot({ path: path.join(SHOTS_DIR, "step3-provider-added.png") });
  console.log("[accounts-e2e] STEP 3 PASS — added a provider key (•••• 1234, secret never shown)");

  // The checklist counts the connected engine.
  await nav.getByRole("button", { name: /^Home/ }).click();
  await expect(checklist).toContainText("1 of 4 done", { timeout: 30_000 });

  // STEP 4 — New team from Home → its canvas; the back arrow returns to Home, which lists it.
  const teamName = `Accounts e2e team ${Date.now()}`;
  await page.getByRole("button", { name: "New team", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New team" });
  await dialog.getByLabel("Name", { exact: true }).fill(teamName);
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(page).toHaveURL(/#\/teams\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "step4-canvas.png") });
  console.log("[accounts-e2e] STEP 4 PASS — created a team → reached its canvas");

  await page.getByRole("button", { name: "Back to dashboard" }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/#\/(home)?$/);
  await expect(page.getByText(teamName).first()).toBeVisible({ timeout: 30_000 });
  await expect(checklist).toContainText("2 of 4 done", { timeout: 30_000 });
  console.log("[accounts-e2e] STEP 4b PASS — back to Home, which shows the new team (2 of 4 done)");

  for (const f of [
    "step1-landing.png",
    "step2-first-time-home.png",
    "step3-provider-added.png",
    "step4-canvas.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for the auth gate on the revamped shell. The whole app sits behind sign-in; logged
// out lands on the LANDING page, signed in on Home inside the shell (the "Dashboard" nav). Four
// checks, a screenshot each, targeted selectors (NOT a whole-tree a11y snapshot — that wedges on the
// React Flow canvas, HANDOVER §4). NO agent run is driven; no NVIDIA key needed. The email/password
// form only exists in the self-hosted posture, so scripts/auth_e2e.sh pins TVASHTR_HOSTED_MODE=false.
//
// Selector contract: landing CTAs "Get started" | "Sign in"; the AuthWizard's "Email"/"Password",
// "Create account" (register) | "Sign in" (login), then "Enter Tvashtr"; the shell's
// "Dashboard" nav is the signed-in marker; the account menu ("Account") names the signed-in email
// and holds "Log out".

const SHOTS_DIR = process.env.TVASHTR_AUTH_SHOTS_DIR ?? "/tmp/tvashtr_auth_shots";
const SEED_EMAIL = process.env.TVASHTR_SEED_EMAIL ?? "operator@tvashtr.local";
const SEED_PASSWORD = process.env.TVASHTR_SEED_PASSWORD ?? "tvashtr-dev";

test("auth gate: landing when out, register→Home, logout→landing, seeded sign-in→Home", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const nav = page.getByRole("navigation", { name: "Dashboard" });
  const landing = page.getByRole("button", { name: "Get started" }).first();

  // CHECK 1 — a fresh visit shows the LANDING page (not the shell, not the sign-in form yet).
  await page.goto("/");
  await expect(landing).toBeVisible({ timeout: 30_000 });
  await expect(nav).toHaveCount(0);
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check1-landing.png") });
  console.log("[auth-e2e] CHECK 1 PASS — unauthenticated visit shows the landing page");

  // CHECK 2 — a CTA opens register; a brand-new account lands on Home inside the shell.
  const email = `e2e+${Date.now()}@tvashtr.local`;
  await landing.click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: /^Engineer/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /^A fresh idea/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("button", { name: /^Home/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menu", { name: "Account" })).toContainText(email);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-register-home.png") });
  console.log(`[auth-e2e] CHECK 2 PASS — registered ${email} and landed on Home`);

  // CHECK 3 — Log out (account menu) returns to the landing page.
  await page
    .getByRole("menu", { name: "Account" })
    .getByRole("menuitem", { name: /Log out/ })
    .click();
  await expect(landing).toBeVisible({ timeout: 30_000 });
  await expect(nav).toHaveCount(0);
  const me = await page.request.get("/api/auth/me");
  expect(me.status(), "the session is gone after Log out").toBe(401);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-logout-landing.png") });
  console.log("[auth-e2e] CHECK 3 PASS — logout returned to the landing page");

  // CHECK 4 — sign in as the SEEDED operator → Home (proves the seed + the login path).
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menu", { name: "Account" })).toContainText(SEED_EMAIL);
  await page.keyboard.press("Escape");
  // The seeded operator imported its .env provider keys, so Engines › API keys lists them.
  await nav.getByRole("button", { name: /^Engines/ }).click();
  await nav.getByRole("button", { name: /^API keys/ }).click();
  const keys = page.locator("section[aria-labelledby='tv-engines-keys']");
  await expect(keys.getByTestId("engines-key-provider").first()).toBeVisible({ timeout: 30_000 });
  const held = await keys.getByTestId("engines-key-provider").allInnerTexts();
  await page.screenshot({ path: path.join(SHOTS_DIR, "check4-seeded-home.png") });
  console.log(
    `[auth-e2e] CHECK 4 PASS — seeded sign-in (${SEED_EMAIL}) reached the shell; keys: ${held.join(", ")}`,
  );

  for (const f of [
    "check1-landing.png",
    "check2-register-home.png",
    "check3-logout-landing.png",
    "check4-seeded-home.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

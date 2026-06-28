import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for the M-accounts auth gate (updated for Slice B's landing/dashboard shell). The
// whole app sits behind login; logged out lands on the LANDING page, logged in on the DASHBOARD.
// Four checks, a screenshot each, targeted selectors (NOT a whole-tree a11y snapshot — that wedges on
// the React Flow canvas, HANDOVER §4). NO agent run is driven; no NVIDIA key needed.
//
// Selector contract: landing CTAs "Try the canvas" | "Create your own team"; LoginScreen submit
// "Sign in" (login) | "Create account" (register), inputs aria-labelled "Email"/"Password"; the
// dashboard's empty-providers prompt "Add your provider API keys" is the authed marker; "the living
// canvas" (the App subtitle) must stay ABSENT (Slice B lands on the dashboard, not the canvas).

const SHOTS_DIR = process.env.TVASHTR_AUTH_SHOTS_DIR ?? "/tmp/tvashtr_auth_shots";
const SEED_EMAIL = process.env.TVASHTR_SEED_EMAIL ?? "operator@tvashtr.local";
const SEED_PASSWORD = process.env.TVASHTR_SEED_PASSWORD ?? "tvashtr-dev";

test("auth gate: landing when out, register→dashboard, logout→landing, seeded-login→dashboard", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // CHECK 1 — a fresh visit shows the LANDING page (not the canvas, not the login form yet).
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Try the canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check1-landing.png") });
  console.log("[auth-e2e] CHECK 1 PASS — unauthenticated visit shows the landing page");

  // CHECK 2 — a CTA opens register; a brand-new account lands on the DASHBOARD (not the canvas).
  const email = `e2e+${Date.now()}@tvashtr.local`;
  await page.getByRole("button", { name: "Create your own team" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Add your provider API keys")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-register-dashboard.png") });
  console.log(`[auth-e2e] CHECK 2 PASS — registered ${email} and landed on the dashboard`);

  // CHECK 3 — logout returns to the landing page.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Try the canvas" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Add your provider API keys")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-logout-landing.png") });
  console.log("[auth-e2e] CHECK 3 PASS — logout returned to the landing page");

  // CHECK 4 — log in as the SEEDED operator → the DASHBOARD (proves the seed + the login path).
  await page.getByRole("button", { name: "Try the canvas" }).click(); // landing CTA → login
  await page.getByRole("button", { name: "Log in" }).click(); // ensure login mode
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The seeded operator imported its providers, so the dashboard shows them (NOT the empty prompt).
  await expect(page.getByText("Provider API keys")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "check4-seeded-dashboard.png") });
  console.log(`[auth-e2e] CHECK 4 PASS — seeded login (${SEED_EMAIL}) landed on the dashboard`);

  for (const f of [
    "check1-landing.png",
    "check2-register-dashboard.png",
    "check3-logout-landing.png",
    "check4-seeded-dashboard.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

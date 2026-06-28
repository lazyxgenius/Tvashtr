import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for M-accounts Slice A: the whole app sits behind a minimal email/password login.
// Four checks, a screenshot each, targeted selectors (NOT a whole-tree a11y snapshot — that wedges
// on the React Flow canvas, HANDOVER §4). NO agent run is driven; no NVIDIA key needed.
//
// Selector contract (LoginScreen): the mode toggle is "Log in" | "Register"; the submit button is
// "Sign in" (login) | "Create account" (register); inputs carry aria-labels "Email" / "Password".
// "the living canvas" is the App header subtitle — a stable, canvas-only marker that we've landed.

const SHOTS_DIR = process.env.TVASHTR_AUTH_SHOTS_DIR ?? "/tmp/tvashtr_auth_shots";
const SEED_EMAIL = process.env.TVASHTR_SEED_EMAIL ?? "operator@tvashtr.local";
const SEED_PASSWORD = process.env.TVASHTR_SEED_PASSWORD ?? "tvashtr-dev";

test("auth gate: login required, register→canvas, logout→login, seeded-login→canvas", async ({
  page,
}) => {
  test.setTimeout(2 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // CHECK 1 — a fresh visit shows the LOGIN screen, and the canvas is NOT rendered.
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check1-login-required.png") });
  console.log("[auth-e2e] CHECK 1 PASS — unauthenticated visit shows the login screen");

  // CHECK 2 — register a brand-new unique account → the canvas renders.
  const email = `e2e+${Date.now()}@tvashtr.local`;
  await page.getByRole("button", { name: "Register" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check2-register-canvas.png") });
  console.log(`[auth-e2e] CHECK 2 PASS — registered ${email} and landed on the canvas`);

  // CHECK 3 — logout returns to the login screen.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("the living canvas")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "check3-logout-login.png") });
  console.log("[auth-e2e] CHECK 3 PASS — logout returned to the login screen");

  // CHECK 4 — log in as the SEEDED operator account → the canvas renders (proves the seed + the
  // login path the Slice-B harness will rely on).
  await page.getByRole("button", { name: "Log in" }).click(); // ensure login mode
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "check4-seeded-login.png") });
  console.log(`[auth-e2e] CHECK 4 PASS — seeded login (${SEED_EMAIL}) landed on the canvas`);

  for (const f of [
    "check1-login-required.png",
    "check2-register-canvas.png",
    "check3-logout-login.png",
    "check4-seeded-login.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

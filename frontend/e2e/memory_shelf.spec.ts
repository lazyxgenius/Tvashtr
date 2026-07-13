import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE sign-off for the M-memory S5a account **Memory shelf** (the 4th Dashboard shelf). Logs in
// as the SEEDED operator (whose .env OpenAI key was imported by the seed, so POST /api/memories can
// embed), then drives the six acceptance checks — each with a screenshot. Targeted role/label
// selectors only (the Dashboard is not a React Flow canvas, but the discipline still holds). NO agent
// run is driven; the one pending fact is seeded directly by scripts/memory_shelf_e2e.sh.
//
// Selector contract: the shelf is `section[aria-label="Your agent memory"]`; the review switch is a
// role="switch" named "Review new memories…"; the add form aria-labels are "New memory content" /
// "Tier" / "Polarity" / the "Add memory" button; each fact chip's per-row buttons carry the content
// in their name ("Pin <c>" / "Unpin <c>" / "Edit <c>" / "Delete <c>" / "Confirm <c>" / "Discard <c>")
// and the edit/confirm controls are "Edit content" / "Save memory" / "Confirm delete".

const SHOTS_DIR = process.env.TVASHTR_MEMORY_SHELF_SHOTS_DIR ?? "/tmp/tvashtr_memory_shots";
const SEED_EMAIL = process.env.TVASHTR_SEED_EMAIL ?? "operator@tvashtr.local";
const SEED_PASSWORD = process.env.TVASHTR_SEED_PASSWORD ?? "tvashtr-dev";
// Must match the content scripts/memory_shelf_e2e.sh seeds as a pending_review row for the operator.
const PENDING = "e2e-seeded pending fact awaiting review";

test("memory shelf: add / pin / edit / review-toggle / confirm-pending / delete", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const suffix = String(Date.now());
  let alpha = `e2e-alpha ${suffix} use pnpm`;
  // Element screenshot of the Memory shelf itself — auto-scrolls it into view and captures its
  // current state (the 4th shelf sits below the fold, and a reload resets the scroll to the top).
  const shelf = page.locator('section[aria-label="Your agent memory"]');
  const shot = (name: string) => shelf.screenshot({ path: path.join(SHOTS_DIR, name) });

  // ---- Log in as the seeded operator → the Dashboard. The reskinned AuthGate shows a landing whose
  // nav "Sign in" CTA opens the AuthWizard in login mode (its submit is also "Sign in"); the landing
  // is replaced by the wizard, so there is never more than one "Sign in" button on screen at once. ----
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click(); // landing nav CTA → login mode
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click(); // the AuthWizard submit
  // Sign-in ends on a "success" step; onAuthed (→ the dashboard) fires only on "Enter Tvashtr".
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();

  // The Memory shelf heading is the "logged in + dashboard loaded" marker (it is always mounted).
  await expect(shelf.getByRole("heading", { name: "Memory" })).toBeVisible({ timeout: 30_000 });

  // ---- CHECK 1 — add an Account-tier fact via the form → it appears with its polarity badge. ----
  await shelf.getByLabel("New memory content").fill(alpha);
  await shelf.getByLabel("Polarity").selectOption("require");
  await shelf.getByRole("button", { name: "Add memory" }).click();
  const alphaChip = () => shelf.locator(".tv-mem-fact", { hasText: alpha });
  await expect(alphaChip()).toBeVisible({ timeout: 30_000 });
  await expect(alphaChip().getByText("MUST", { exact: true })).toBeVisible();
  await shot("check1-add-account-fact.png");
  console.log("[memory-e2e] CHECK 1 PASS — added an Account fact; MUST badge renders");

  // ---- CHECK 2 — pin it; the pin persists across a reload. ----
  await shelf.getByRole("button", { name: `Pin ${alpha}`, exact: true }).click();
  await expect(shelf.getByRole("button", { name: `Unpin ${alpha}`, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(shelf.getByRole("button", { name: `Unpin ${alpha}`, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await shot("check2-pin-persists.png");
  console.log("[memory-e2e] CHECK 2 PASS — pin persisted across a reload");

  // ---- CHECK 3 — edit the text; the edit persists across a reload. ----
  const alpha2 = `e2e-alpha ${suffix} use bun`;
  await shelf.getByRole("button", { name: `Edit ${alpha}`, exact: true }).click();
  await shelf.getByLabel("Edit content").fill(alpha2);
  await shelf.getByRole("button", { name: "Save memory", exact: true }).click();
  alpha = alpha2;
  await expect(shelf.getByText(alpha, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(shelf.getByText(alpha, { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot("check3-edit-persists.png");
  console.log("[memory-e2e] CHECK 3 PASS — edited content persisted across a reload");

  // ---- CHECK 4 — toggle review mode ON; the switch reflects ON and survives a reload. ----
  const reviewSwitch = () => shelf.getByRole("switch", { name: /Review new memories/i });
  await expect(reviewSwitch()).toHaveAttribute("aria-checked", "false");
  await reviewSwitch().click();
  await expect(reviewSwitch()).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(reviewSwitch()).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await shot("check4-review-mode-persists.png");
  console.log("[memory-e2e] CHECK 4 PASS — review mode ON persisted across a reload");

  // ---- CHECK 5 — the seeded pending fact shows in the inbox; Confirm moves it into the live facts.
  await expect(shelf.getByRole("button", { name: `Confirm ${PENDING}`, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    shelf.getByRole("button", { name: `Discard ${PENDING}`, exact: true }),
  ).toBeVisible();
  await shelf.getByRole("button", { name: `Confirm ${PENDING}`, exact: true }).click();
  // After promote it leaves the pending inbox (no Confirm button) and becomes a live manage-able fact.
  await expect(shelf.getByRole("button", { name: `Confirm ${PENDING}`, exact: true })).toHaveCount(
    0,
    { timeout: 30_000 },
  );
  await expect(shelf.getByRole("button", { name: `Pin ${PENDING}`, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await shot("check5-confirm-pending.png");
  console.log("[memory-e2e] CHECK 5 PASS — pending fact confirmed → moved into the live facts");

  // ---- CHECK 6 — delete the alpha fact → it is gone. ----
  await shelf.getByRole("button", { name: `Delete ${alpha}`, exact: true }).click();
  await shelf.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(shelf.getByText(alpha, { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await shot("check6-delete-removes.png");
  console.log("[memory-e2e] CHECK 6 PASS — the fact was deleted");

  // ---- Cleanup — turn review mode back off so a re-run starts from a clean OFF state. ----
  if ((await reviewSwitch().getAttribute("aria-checked")) === "true") {
    await reviewSwitch().click();
  }

  for (const f of [
    "check1-add-account-fact.png",
    "check2-pin-persists.png",
    "check3-edit-persists.png",
    "check4-review-mode-persists.png",
    "check5-confirm-pending.png",
    "check6-delete-removes.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

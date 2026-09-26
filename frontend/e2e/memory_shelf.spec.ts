import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { shellNav } from "./_home";

// Live FE sign-off for Toolkit › Memory (the revamp's Memory page: Inbox / Active / Archive tabs
// and the Add memory sheet). Logs in as the SEEDED operator (whose .env OpenAI key was imported by
// the seed, so POST /api/memories can embed), then drives the six acceptance checks — each with a
// screenshot. Targeted role/label selectors only. NO agent run is driven; the one pending fact is
// seeded directly by scripts/memory_shelf_e2e.sh.
//
// Selector contract: the page header is the h1 "Memory" with an "Add memory" button (`.pg-head`);
// the tabs are a tablist "Memory" (Inbox N / Active N / Archive); each tab's list is a
// `section[aria-label="Inbox" | "Active" | "Archive"]` of `li.mem-row`, whose buttons are named
// "Keep" / "Edit" / "Discard" (Inbox) and "Pin" or "Unpin" / "Edit" / "Delete" (Active). The Add
// memory sheet is a dialog "Add memory" (textbox "What should agents remember?", group "Applies to"
// with "Every repo" / "One repo", radios "MUST Always do this." …). The inline editor is a textbox
// "Memory text" + "Save"; Delete asks in an alertdialog "Delete this memory?" ("Delete memory").
// The review switch (Inbox tab only) is a role="switch" named "Review new memories before they
// apply"; its input is visually hidden, so it is clicked through its `.mem-review .ds-switch` label.

const SHOTS_DIR = process.env.TVASHTR_MEMORY_SHELF_SHOTS_DIR ?? "/tmp/tvashtr_memory_shots";
const SEED_EMAIL = process.env.TVASHTR_SEED_EMAIL ?? "operator@tvashtr.local";
const SEED_PASSWORD = process.env.TVASHTR_SEED_PASSWORD ?? "tvashtr-dev";
// Must match the content scripts/memory_shelf_e2e.sh seeds as a pending_review row for the operator.
const PENDING = "e2e-seeded pending fact awaiting review";

test("memory page: add / pin / edit / review-toggle / keep-pending / delete", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const suffix = String(Date.now());
  let alpha = `e2e-alpha ${suffix} use pnpm`;
  const shot = (name: string) => page.screenshot({ path: path.join(SHOTS_DIR, name) });
  const tabs = page.getByRole("tablist", { name: "Memory" });
  const list = (tab: "Inbox" | "Active") => page.locator(`section[aria-label="${tab}"]`);
  const row = (tab: "Inbox" | "Active", text: string) =>
    list(tab).locator("li.mem-row", { hasText: text });
  const toast = (text: string) => page.locator('[role="status"].ds-toast', { hasText: text });
  const reviewSwitch = () =>
    page.getByRole("switch", { name: "Review new memories before they apply" });

  // ---- Sign in as the seeded operator → Home, then Toolkit › Memory. The landing's nav "Sign in"
  // CTA opens the AuthWizard in login mode (its submit is also "Sign in"); the landing is replaced by
  // the wizard, so there is never more than one "Sign in" button on screen at once. The email form
  // exists only in the self-hosted posture, so scripts/memory_shelf_e2e.sh pins
  // TVASHTR_HOSTED_MODE=false. ----
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click(); // landing nav CTA → login mode
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click(); // the AuthWizard submit
  // Sign-in ends on a "success" step; onAuthed (→ Home) fires only on "Enter Tvashtr".
  await page.getByRole("button", { name: "Enter Tvashtr" }).click();
  await shellNav(page)
    .getByRole("button", { name: /^Toolkit/ })
    .click();
  await shellNav(page)
    .getByRole("button", { name: /^Memory/ })
    .click();
  // The Memory nav always opens the Inbox.
  await expect(page).toHaveURL(/#\/toolkit\/memory\/inbox/);
  await expect(page.getByRole("heading", { name: "Memory", level: 1 })).toBeVisible({
    timeout: 30_000,
  });

  // ---- CHECK 1 — add a memory for every repo through the sheet → it lands in Active, MUST. ----
  await page.locator(".pg-head").getByRole("button", { name: "Add memory" }).click();
  const sheet = page.getByRole("dialog", { name: "Add memory" });
  await sheet.getByRole("textbox", { name: "What should agents remember?" }).fill(alpha);
  await sheet.getByRole("button", { name: "Every repo", exact: true }).click();
  await expect(sheet.getByRole("radio", { name: "MUST Always do this." })).toBeChecked();
  await sheet.getByRole("button", { name: "Add memory", exact: true }).click();
  await expect(toast("Added. It applies to every repo right away.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/toolkit\/memory\/active/);
  await expect(row("Active", alpha)).toBeVisible({ timeout: 30_000 });
  await expect(row("Active", alpha).getByText("MUST", { exact: true })).toBeVisible();
  await expect(row("Active", alpha).getByText("Added by you · just now")).toBeVisible();
  await shot("check1-add-memory.png");
  console.log("[memory-e2e] CHECK 1 PASS — added a memory for every repo; MUST, in Active");

  // ---- CHECK 2 — pin it; the pin persists across a reload. ----
  await row("Active", alpha).getByRole("button", { name: "Pin", exact: true }).click();
  await expect(toast("Pinned. Pinned notes go to the agent first.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    row("Active", alpha).getByRole("button", { name: "Unpin", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    row("Active", alpha).getByRole("button", { name: "Unpin", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await shot("check2-pin-persists.png");
  console.log("[memory-e2e] CHECK 2 PASS — pin persisted across a reload");

  // ---- CHECK 3 — edit the text in place; the edit persists across a reload. ----
  const alpha2 = `e2e-alpha ${suffix} use bun`;
  await row("Active", alpha).getByRole("button", { name: "Edit", exact: true }).click();
  await list("Active").getByRole("textbox", { name: "Memory text" }).fill(alpha2);
  await list("Active").getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast("Saved. Agents see the new text on their next run.")).toBeVisible({
    timeout: 30_000,
  });
  alpha = alpha2;
  await expect(row("Active", alpha).getByText("Edited by you · pinned")).toBeVisible();
  await page.reload();
  await expect(row("Active", alpha)).toBeVisible({ timeout: 30_000 });
  await shot("check3-edit-persists.png");
  console.log("[memory-e2e] CHECK 3 PASS — edited text persisted across a reload");

  // ---- CHECK 4 — on the Inbox tab, turn review ON; the switch stays ON across a reload. ----
  await tabs.getByRole("tab", { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/memory\/inbox/);
  await expect(reviewSwitch()).toBeEnabled({ timeout: 30_000 });
  await expect(reviewSwitch()).not.toBeChecked();
  await page.locator(".mem-review .ds-switch").click();
  await expect(reviewSwitch()).toBeChecked();
  await expect(toast("New memories now wait in the Inbox.")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(reviewSwitch()).toBeChecked({ timeout: 30_000 });
  await expect(
    page.getByText("On: every new memory waits in the Inbox until you keep it."),
  ).toBeVisible();
  await shot("check4-review-mode-persists.png");
  console.log("[memory-e2e] CHECK 4 PASS — review mode ON persisted across a reload");

  // ---- CHECK 5 — the seeded pending fact waits in the Inbox; Keep moves it into Active. ----
  await expect(row("Inbox", PENDING)).toBeVisible({ timeout: 30_000 });
  await expect(
    row("Inbox", PENDING).getByRole("button", { name: "Discard", exact: true }),
  ).toBeVisible();
  await row("Inbox", PENDING).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(toast("Kept. Agents use it from the next run.")).toBeVisible({ timeout: 30_000 });
  await expect(row("Inbox", PENDING)).toHaveCount(0, { timeout: 30_000 });
  await tabs.getByRole("tab", { name: /^Active/ }).click();
  await expect(
    row("Active", PENDING).getByRole("button", { name: "Pin", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await shot("check5-keep-pending.png");
  console.log("[memory-e2e] CHECK 5 PASS — the pending fact was kept → it is in Active");

  // ---- CHECK 6 — delete the alpha memory → it is gone. ----
  await row("Active", alpha).getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this memory?" });
  await confirm.getByRole("button", { name: "Delete memory", exact: true }).click();
  await expect(row("Active", alpha)).toHaveCount(0, { timeout: 30_000 });
  await shot("check6-delete-removes.png");
  console.log("[memory-e2e] CHECK 6 PASS — the memory was deleted");

  // ---- Cleanup — turn review mode back off so a re-run starts from a clean OFF state. ----
  await tabs.getByRole("tab", { name: /^Inbox/ }).click();
  await expect(reviewSwitch()).toBeEnabled({ timeout: 30_000 });
  if (await reviewSwitch().isChecked()) {
    await page.locator(".mem-review .ds-switch").click();
    await expect(reviewSwitch()).not.toBeChecked();
  }

  for (const f of [
    "check1-add-memory.png",
    "check2-pin-persists.png",
    "check3-edit-persists.png",
    "check4-review-mode-persists.png",
    "check5-keep-pending.png",
    "check6-delete-removes.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

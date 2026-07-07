import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// M-tools C7.C frontend self-sign-off. Drives the REAL app (register -> dashboard shelves -> new team
// -> a WORKER node drawer) and screenshots:
//   (a) the account Tool + Skill LIBRARY shelves, each holding a defined item;
//   (b) the Tools section "Add from library" pick -> a Library-badged reference row;
//   (c) the same in the Skills section;
//   (d) the "overridden" tag when an inline server shares a name with a library reference.
// Targeted selectors only (no whole-tree a11y snapshot — it wedges on the React Flow canvas).

const SHOTS = process.env.TVASHTR_C7C_SHOTS_DIR ?? "/tmp/tvashtr_c7c_shots";

test("M-tools C7.C: library shelves + Add-from-library pickers + overridden tag", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });

  // Register a fresh account through the AuthWizard (mirrors tools-c7a.spec.ts).
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "Get started" }).first().click();
  await page.getByLabel("Email").fill(`c7c+${Date.now()}@tvashtr.local`);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  for (let i = 0; i < 4; i++) {
    if (await page.getByRole("button", { name: /New team/ }).count()) break;
    const opt = page
      .getByRole("button")
      .filter({ hasNotText: /Continue|Back|Sign in|Enter Tvashtr|New team|Log/i })
      .first();
    if (await opt.count()) await opt.click().catch(() => {});
    const go = page.getByRole("button", { name: /Continue|Enter Tvashtr|Finish|Done/i }).first();
    if (await go.count()) await go.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await expect(page.getByRole("button", { name: /New team/ })).toBeVisible({ timeout: 30_000 });

  // (a) Add a tool to the Tool library shelf + a skill to the Skill library shelf, then screenshot.
  await page.getByRole("heading", { name: "Tool library" }).scrollIntoViewIfNeeded();
  await page.getByLabel("Tool name").fill("fetch");
  await page.getByLabel("Server config JSON").fill('{"command":"uvx","args":["mcp-server-fetch"]}');
  await page.getByRole("button", { name: "Add tool" }).click();
  await expect(
    page.locator(".tv-dash__prov-name", { hasText: "fetch" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Skill name").fill("house-style");
  await page.getByLabel("Skill content").fill("Prefer small, well-tested diffs.");
  await page.getByRole("button", { name: "Add skill" }).click();
  await expect(
    page.locator(".tv-dash__prov-name", { hasText: "house-style" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("heading", { name: "Tool library" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "a-library-shelves.png") });
  console.log("[c7c-e2e] (a) captured the Tool + Skill library shelves");

  // New team (PM thinker + Engineer worker), open the Engineer worker node.
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: /New team/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^PM → Engineer A PM writes/ }).click();
  await page.getByLabel("Team name").fill(`C7C ${Date.now()}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await createResp;

  const eng = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(eng).toBeVisible({ timeout: 30_000 });
  await eng.click();

  // The Tools section (worker) — scope to the <details> holding the Tools JSON textarea.
  const toolsJson = page.getByLabel("Tools JSON");
  await expect(toolsJson).toBeVisible({ timeout: 30_000 });
  const toolsSection = page.locator("details", { has: page.getByLabel("Tools JSON") });

  // (b) Tools "Add from library" -> pick "fetch" -> a Library-badged row.
  await toolsSection.getByRole("button", { name: "Add from library" }).click();
  await toolsSection.getByRole("button", { name: "Add fetch from library" }).click();
  const libRow = toolsSection.locator(".tv-mcp-row", { hasText: "Library" });
  await expect(libRow.getByText("fetch")).toBeVisible({ timeout: 15_000 });
  await libRow.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "b-tools-library-row.png") });
  console.log("[c7c-e2e] (b) captured the Tools Library-badged row");

  // (d) Add an INLINE server of the SAME name via the guided form -> the "overridden" tag (inline
  //     wins over a same-name library ref at run time).
  await page.getByLabel("New server name").fill("fetch");
  await page.getByLabel("Command").fill("inline-cmd");
  await toolsSection.getByRole("button", { name: "Add server" }).click();
  await expect(toolsSection.getByText("overridden")).toBeVisible({ timeout: 15_000 });
  await toolsSection.getByText("overridden").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "d-overridden-tag.png") });
  console.log("[c7c-e2e] (d) captured the overridden tag");

  // (c) The Skills section "Add from library" -> pick "house-style" -> a Library-badged row.
  const skillsSection = page.locator("details", {
    has: page.getByLabel("Skill content (SKILL.md)"),
  });
  await skillsSection.getByRole("button", { name: "Add from library" }).click();
  await skillsSection.getByRole("button", { name: "Add house-style from library" }).click();
  const skillLibRow = skillsSection.locator(".tv-skills__row", { hasText: "Library" });
  await expect(skillLibRow.getByText("house-style")).toBeVisible({ timeout: 15_000 });
  await skillLibRow.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "c-skills-library-row.png") });
  console.log("[c7c-e2e] (c) captured the Skills Library-badged row");

  for (const f of [
    "a-library-shelves.png",
    "b-tools-library-row.png",
    "c-skills-library-row.png",
    "d-overridden-tag.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS, f)), `screenshot ${f} written`).toBe(true);
  }
});

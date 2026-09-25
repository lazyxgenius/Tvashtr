import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";

// M-tools C7.C frontend self-sign-off. Drives the REAL app (register -> Toolkit › Tools + Skills ->
// Home's New team -> a WORKER node drawer) and screenshots:
//   (a) the account Tool + Skill LIBRARY shelves (Toolkit › Tools / Skills), each holding a defined
//       item;
//   (b) the Tools section "Add from library" pick -> a Library-badged reference row;
//   (c) the same in the Skills section;
//   (d) the "overridden" tag when an inline server shares a name with a library reference.
// Targeted selectors only (no whole-tree a11y snapshot — it wedges on the React Flow canvas).
// Revamp round 1: the account registers through the API (the sign-up wizard is not under test and
// hides its email form in the hosted posture) and the shelves live on Toolkit's pages.

const SHOTS = process.env.TVASHTR_C7C_SHOTS_DIR ?? "/tmp/tvashtr_c7c_shots";

test("M-tools C7.C: library shelves + Add-from-library pickers + overridden tag", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });

  // Register a fresh account (the page shares the cookie) → the signed-in shell.
  await registerFresh(page, "c7c");
  const nav = shellNav(page);

  // (a) Add a tool on Toolkit › Tools (its raw-JSON form sits under "Advanced (raw JSON)") and a
  //     skill on Toolkit › Skills, then screenshot each shelf. Each name is matched EXACTLY so a
  //     built-in catalog/preset entry can't satisfy the check.
  await nav.getByRole("button", { name: /^Toolkit/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/tools$/);
  const toolShelf = page.locator("section[aria-label='Your tool library']");
  await expect(toolShelf.getByRole("heading", { name: "Tool library" })).toBeVisible({
    timeout: 30_000,
  });
  await toolShelf.getByLabel("Tool name").fill("fetch");
  await toolShelf.getByText("Advanced (raw JSON)").click();
  await toolShelf
    .getByLabel("Server config JSON")
    .fill('{"command":"uvx","args":["mcp-server-fetch"]}');
  await toolShelf.getByRole("button", { name: "Add tool" }).click();
  await expect(toolShelf.locator(".tv-dash__prov-name", { hasText: /^fetch$/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: path.join(SHOTS, "a-tool-library.png") });

  await nav.getByRole("button", { name: /^Skills/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/skills$/);
  const skillShelf = page.locator("section[aria-label='Your skill library']");
  await skillShelf.getByLabel("Skill name").fill("house-style");
  await skillShelf.getByLabel("Skill content").fill("Prefer small, well-tested diffs.");
  await skillShelf.getByRole("button", { name: "Add skill" }).click();
  await expect(skillShelf.locator(".tv-dash__prov-name", { hasText: /^house-style$/ })).toBeVisible(
    { timeout: 15_000 },
  );
  await page.screenshot({ path: path.join(SHOTS, "a-library-shelves.png") });
  console.log("[c7c-e2e] (a) captured the Tool + Skill library shelves");

  // New team from Home's dialog (PM thinker + Engineer worker), open the Engineer worker node.
  await nav.getByRole("button", { name: /^Home/ }).click();
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New team", exact: true }).first().click();
  const picker = page.getByRole("dialog", { name: "New team" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker
    .locator("button.hm-tplcard", {
      has: page.locator(".hm-tplcard__name", { hasText: /^PM → Engineer$/ }),
    })
    .click();
  await picker.getByLabel("Name", { exact: true }).fill(`C7C ${Date.now()}`);
  await picker.getByRole("button", { name: "Create team" }).click();
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
    "a-tool-library.png",
    "a-library-shelves.png",
    "b-tools-library-row.png",
    "c-skills-library-row.png",
    "d-overridden-tag.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS, f)), `screenshot ${f} written`).toBe(true);
  }
});

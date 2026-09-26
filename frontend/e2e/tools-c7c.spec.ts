import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";

// M-tools C7.C frontend self-sign-off. Drives the REAL app (register -> Toolkit › Tools + Skills ->
// Home's New team -> a WORKER node drawer) and screenshots:
//   (a) the account Tool + Skill LIBRARY shelves (Toolkit › Tools / Skills), each holding a defined
//       item;
//   (b) the drawer's Add tool › From your library pick -> a Library-badged reference row;
//   (c) the same in the Skills section;
//   (d) the Add a server form refusing a name the library tool already has.
// Targeted selectors only (no whole-tree a11y snapshot — it wedges on the React Flow canvas).
// Revamp round 1: the account registers through the API (the sign-up wizard is not under test and
// hides its email form in the hosted posture) and the shelves live on Toolkit's pages.

const SHOTS = process.env.TVASHTR_C7C_SHOTS_DIR ?? "/tmp/tvashtr_c7c_shots";

test("M-tools C7.C: library shelves + Add-from-library pickers + taken tool name", async ({
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

  // The drawer's Skills & tools tab.
  const drawer = page.getByRole("complementary", { name: "Engineer settings" });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await drawer.getByRole("tab", { name: /^Skills & tools/ }).click();

  // (c) Skills › Add skill › From your library -> pick "house-style" -> a Library-badged row.
  const skillsSection = drawer.getByRole("region", { name: /^Skills/ });
  await skillsSection.getByRole("button", { name: "Add skill" }).click();
  await page.getByRole("menuitem", { name: "From your library" }).click();
  const librarySheet = drawer.getByRole("region", { name: "Add from your library" });
  await librarySheet.getByRole("checkbox", { name: /^house-style/ }).check();
  await librarySheet.getByRole("button", { name: "Add 1 skill" }).click();
  const skillLibRow = skillsSection.getByRole("listitem").filter({ hasText: "house-style" });
  await expect(skillLibRow.getByText("Library")).toBeVisible({ timeout: 15_000 });
  await skillLibRow.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "c-skills-library-row.png") });
  console.log("[c7c-e2e] (c) captured the Skills Library-badged row");

  // (b) Tools › Add tool › From your library -> pick "fetch" -> a Library-badged row.
  const toolsSection = drawer.getByRole("region", { name: /^Tools/ });
  await toolsSection.getByRole("button", { name: "Add tool" }).click();
  await page.getByRole("menuitem", { name: "From your library" }).click();
  const toolSheet = drawer.getByRole("region", { name: "Add a tool" });
  await toolSheet.getByRole("checkbox", { name: /^fetch/ }).check();
  await toolSheet.getByRole("button", { name: "Add 1 tool" }).click();
  const libRow = toolsSection.getByRole("listitem").filter({ hasText: "fetch" });
  await expect(libRow.getByText("Library")).toBeVisible({ timeout: 15_000 });
  await libRow.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "b-tools-library-row.png") });
  console.log("[c7c-e2e] (b) captured the Tools Library-badged row");

  // (d) An INLINE server can't take the library tool's name: the Add a server form says so and
  //     keeps Add server off (a run would let the inline one win silently).
  await toolsSection.getByRole("button", { name: "Add tool" }).click();
  await page.getByRole("menuitem", { name: /^Add a server/ }).click();
  await toolSheet.getByLabel("Server name").fill("fetch");
  await toolSheet.getByRole("button", { name: "Local" }).click();
  await toolSheet.getByLabel("Command").fill("inline-cmd");
  await expect(toolSheet.getByText("This agent already has a tool called fetch.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(toolSheet.getByRole("button", { name: "Add server" })).toBeDisabled();
  await page.screenshot({ path: path.join(SHOTS, "d-name-taken.png") });
  console.log("[c7c-e2e] (d) captured the taken-name check");

  for (const f of [
    "a-tool-library.png",
    "a-library-shelves.png",
    "b-tools-library-row.png",
    "c-skills-library-row.png",
    "d-name-taken.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS, f)), `screenshot ${f} written`).toBe(true);
  }
});

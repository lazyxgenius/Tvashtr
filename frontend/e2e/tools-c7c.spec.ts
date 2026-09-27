import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";

// M-tools C7.C frontend self-sign-off. Drives the REAL app (register -> Toolkit › Tools + Skills ->
// Home's New team -> a WORKER node drawer) and screenshots:
//   (a) the account Tool + Skill libraries (Toolkit › Tools / Skills), each holding a defined item
//       (Tools: added through the Add tool wizard; Skills: a skill written in the New skill editor);
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

  // (a) Add a tool on Toolkit › Tools (the Add tool wizard: Basics → a Local command → Add tool)
  //     and a skill on Toolkit › Skills, then screenshot each page. Each name is matched EXACTLY
  //     so a built-in catalog/preset entry can't satisfy the check.
  await nav.getByRole("button", { name: /^Toolkit/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/tools$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Add tool", exact: true }).first().click();
  const wizard = page.getByRole("dialog", { name: "Add a tool" });
  await wizard.getByLabel("Name", { exact: true }).fill("fetch");
  await wizard.getByRole("button", { name: "Next: Connection" }).click();
  await wizard.getByRole("button", { name: "Local command" }).click();
  await wizard.getByLabel("Command", { exact: true }).fill("uvx");
  await wizard.getByLabel(/^Arguments/).fill("mcp-server-fetch");
  await wizard.getByRole("button", { name: "Next: Secrets" }).click();
  await wizard.getByRole("button", { name: "Add tool", exact: true }).click();
  await expect(wizard).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "fetch", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: path.join(SHOTS, "a-tool-library.png") });

  // Toolkit › Skills → New skill (the editor): a name and its SKILL.md → Save skill → back on Your
  // skills with the new row.
  await nav.getByRole("button", { name: /^Skills/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/skills$/);
  await page.getByRole("button", { name: "New skill", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/toolkit\/skills\/new$/);
  await page.getByRole("textbox", { name: "Skill name" }).fill("house-style");
  await page.getByRole("textbox", { name: "SKILL.md" }).fill("Prefer small, well-tested diffs.");
  await page.getByRole("button", { name: "Save skill" }).click();
  await expect(page).toHaveURL(/#\/toolkit\/skills$/);
  await expect(
    page
      .getByRole("region", { name: "Your skills" })
      .getByRole("button", { name: "house-style", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
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

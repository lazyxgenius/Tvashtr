import fs from "node:fs";
import path from "node:path";

import { type Browser, type Page, expect, test } from "@playwright/test";

// M4 FE proof (brief §4 M4): account A's team is exported from the canvas header's Team file panel
// (YAML, Copy, Download); account B imports the downloaded file from Home › New team › "Import a
// team file": the check runs before anything changes, "Import as a new team" makes a NEW team
// "<name> (copy)", and its canvas shows the "things to fix" card (B holds no model keys) and the
// toast. A file that can't be read names its line, and nothing is created. Drives no agent run.

const SHOTS_DIR = process.env.TVASHTR_TEAM_FILE_SHOTS_DIR ?? "/tmp/tvashtr_team_file_shots";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });

async function signedIn(browser: Browser, who: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  const reg = await page.request.post("/api/auth/register", {
    data: { email: `teamfile-${who}+${Date.now()}@tvashtr.local`, password: "team-file-pass" },
  });
  expect(reg.ok(), `register account ${who}: ${reg.status()} ${await reg.text()}`).toBeTruthy();
  return page;
}

async function teamNames(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/teams");
  const body = (await res.json()) as { teams: { name: string }[] };
  return body.teams.map((t) => t.name);
}

test("team-file: export from the canvas, import from Home with its check, the fix card", async ({
  browser,
}) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // ---- Account A: the team, exported from its canvas ----
  const a = await signedIn(browser, "a");
  const made = await a.request.post("/api/teams", {
    data: { template: "review_loop", name: "Indicator sprint team" },
  });
  expect(made.ok(), "account A's team").toBeTruthy();
  const { team_graph_id: teamA } = (await made.json()) as { team_graph_id: string };
  await a.goto(`/#/teams/${teamA}`);
  await expect(a.locator(".react-flow__node", { hasText: "Engineer" }).first()).toBeVisible({
    timeout: 30_000,
  });

  await a.getByRole("button", { name: "Team file" }).click();
  const panel = a.getByRole("complementary", { name: "Team file" });
  await expect(panel.getByText("indicator-sprint-team.yaml")).toBeVisible();
  await expect(panel.getByText("No secrets or sign-ins inside")).toBeVisible();
  const code = panel.getByLabel("indicator-sprint-team.yaml, read-only");
  await expect(code).toContainText("tvashtr_team: 1");
  await expect(code).toContainText("model: ");
  await shot(a, "1-panel-yaml");

  await a.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByRole("button", { name: "Copy" }).click();
  await expect(a.getByText("Copied indicator-sprint-team.yaml")).toBeVisible();
  const copied = await a.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("name: Indicator sprint team");

  const [download] = await Promise.all([
    a.waitForEvent("download"),
    panel.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("indicator-sprint-team.yaml");
  const saved = path.join(SHOTS_DIR, "indicator-sprint-team.yaml");
  await download.saveAs(saved);
  const exported = fs.readFileSync(saved, "utf8");
  expect(exported).toBe(copied);

  // JSON renders the same team.
  await panel.getByRole("button", { name: "JSON" }).click();
  await expect(panel.getByText("indicator-sprint-team.json")).toBeVisible();
  await shot(a, "2-panel-json");

  // ---- Account B: Home › New team › Import a team file ----
  const b = await signedIn(browser, "b");
  await b.goto("/#/home");
  await b.getByRole("button", { name: "New team", exact: true }).first().click();
  const newTeam = b.getByRole("dialog", { name: "New team" });
  await expect(newTeam).toBeVisible();
  const [chooser] = await Promise.all([
    b.waitForEvent("filechooser"),
    newTeam.getByRole("button", { name: /Import a team file/ }).click(),
  ]);
  await chooser.setFiles(saved);

  const dialog = b.getByRole("dialog", { name: "Import a team file" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("What we checked")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/^\d+ agents?, \d+ gates? and \d+ routes?$/)).toBeVisible();
  await expect(dialog.getByText(/isn’t set up here$/).first()).toBeVisible();
  await expect(dialog.getByText("The team needs a change before it can run")).toHaveCount(0);
  await expect(dialog.getByLabel("Team name")).toHaveValue("Indicator sprint team (copy)");
  expect(await teamNames(b), "the check changes nothing").toEqual([]);
  await shot(b, "3-import-check");

  await dialog.getByRole("button", { name: "Import as a new team" }).click();
  await expect(b).toHaveURL(/#\/teams\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(b.getByText("Imported as a new team")).toBeVisible();
  const fixes = b.getByRole("region", { name: "Things to fix" });
  await expect(fixes).toBeVisible();
  await expect(fixes).toContainText(/Add a key for \w+, or pick another model/);
  await expect(fixes.getByRole("button", { name: "Open Engines" }).first()).toBeVisible();
  await expect(fixes).toContainText(
    "The team can’t run until each model has a key here, or you pick another model.",
  );
  await expect(
    b.locator(".react-flow__node", { hasText: "Engineer" }).getByText("Needs a model key"),
  ).toBeVisible();
  await shot(b, "4-imported-fix-card");
  expect(await teamNames(b)).toEqual(["Indicator sprint team (copy)"]);

  // Hide puts the card away; the chip stays.
  await fixes.getByRole("button", { name: "Hide" }).click();
  await expect(fixes).toBeHidden();
  await expect(
    b.locator(".react-flow__node", { hasText: "Engineer" }).getByText("Needs a model key"),
  ).toBeVisible();

  // The new team's file is A's, bar its name.
  const copyId = b.url().match(/teams\/([0-9a-f-]{36})/)![1];
  const again = await b.request.get(`/api/teams/${copyId}/file?format=yaml`);
  const strip = (s: string) =>
    s
      .split("\n")
      .filter((l) => !l.startsWith("#") && !l.startsWith("name: "))
      .join("\n");
  expect(strip(((await again.json()) as { content: string }).content)).toBe(strip(exported));

  // ---- An unreadable file names its line; nothing is created ----
  await b.goto("/#/home");
  await b.getByRole("button", { name: "New team", exact: true }).first().click();
  const [bad] = await Promise.all([
    b.waitForEvent("filechooser"),
    b
      .getByRole("dialog", { name: "New team" })
      .getByRole("button", { name: /Import a team file/ })
      .click(),
  ]);
  await bad.setFiles({
    name: "broken.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from("tvashtr_team: 1\nname: Broken\nagents: oops\n"),
  });
  const refused = b.getByRole("dialog", { name: "Import a team file" });
  await expect(refused.getByText("This file can’t be imported")).toBeVisible({ timeout: 15_000 });
  await expect(refused.getByText(/^Line 3: /)).toBeVisible();
  await expect(refused.getByRole("button", { name: "Import as a new team" })).toBeDisabled();
  await shot(b, "5-unreadable-file");
  expect(await teamNames(b)).toEqual(["Indicator sprint team (copy)"]);
});

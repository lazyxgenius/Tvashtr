import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";

// Toolkit › Connectors, end to end in a real browser against a real backend and a fake OAuth MCP
// server (backend/tests/fake_connector_server.py). No model and no provider key. Booted by
// scripts/connectors_e2e.sh, which explains the three settings this depends on.
//
//   a fresh account → Toolkit lands on Connectors › Browse → Custom connector → the fake server →
//   Allow in its window → Tvashtr's own confirm page (that window holds no Tvashtr session) →
//   Connected, read only → its page shows create_thing "Off · write" → Give an agent access →
//   that agent's drawer shows it ticked → Disconnect names the agent.
//
// Targeted selectors only (a whole-tree a11y snapshot wedges on the React Flow canvas).

const FAKE = process.env.TVASHTR_CONNECTORS_FAKE_URL ?? "http://127.0.0.1:9911";
// Full-page screenshots of the key screens, when a directory is named.
const SHOTS = process.env.TVASHTR_CONNECTORS_SHOTS_DIR ?? "";

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // `animations`: a sheet or a dialog is shot open, not sliding in.
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// The shell scrolls inside itself, so a "full page" is the window: a tall one shows each screen
// whole.
test.use({ viewport: { width: 1440, height: 1000 } });

test("Connectors: connect a custom server, give an agent access, disconnect", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);

  const email = await registerFresh(page, "connectors");
  const nav = shellNav(page);

  // A team first, so there is an agent to give access to (PM → Engineer; made through the API, as
  // the account is: neither is under test here).
  const teamName = `Connectors ${Date.now()}`;
  const team = await page.request.post("/api/teams", {
    data: { template: "two_node", name: teamName },
  });
  expect(team.ok(), `create the team -> ${team.status()}`).toBeTruthy();

  // Toolkit opens on Connectors, and an account with nothing connected lands on Browse.
  await nav.getByRole("button", { name: /^Toolkit/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/connectors\/browse$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Connectors" })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Connectors/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "Connect the apps your agents should read." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Featured" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("article", { name: "Supabase", exact: true })).toBeVisible();
  await shot(page, "01-browse-first-visit");

  // Custom connector: a name and the fake server's address, then "Check the server".
  await page.getByRole("button", { name: "Custom connector", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Custom connector" });
  await sheet.getByLabel("Name", { exact: true }).fill("Fake");
  await sheet.getByLabel("Server address").fill(`${FAKE}/mcp`);
  await shot(page, "02-custom-connector-sheet");
  await sheet.getByRole("button", { name: "Check the server" }).click();
  // The sign-in site is named by its host alone (no port).
  const host = new URL(FAKE).hostname;
  await expect(sheet.getByText(`You’ll sign in at ${host}.`)).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText("The sign-in page that opens should be Fake’s own.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Read only", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await shot(page, "03-custom-connector-checked");

  // Continue → the provider's window. Allow there, and the fake sends it to Tvashtr's callback.
  const opened = page.waitForEvent("popup");
  await sheet.getByRole("button", { name: `Continue to ${host}` }).click();
  const popup = await opened;
  await expect(sheet.getByText("Waiting for you to finish in the Fake window")).toBeVisible();
  await popup.getByRole("button", { name: "Allow" }).click();

  // That window has no Tvashtr session (the app is on 127.0.0.1, the callback on localhost), so
  // Tvashtr asks before it connects anything, naming the account in full.
  await expect(popup).toHaveURL(/\/api\/connectors\/oauth\/callback\?/);
  await expect(popup.getByText(`Connect Fake to the Tvashtr account ${email}?`)).toBeVisible();
  await shot(popup, "04-confirm-page");
  const closed = popup.waitForEvent("close");
  await popup.getByRole("button", { name: "Connect", exact: true }).click();
  await closed; // "Fake is connected. You can close this window." closes itself

  // The sheet moves on by itself: the Connected tab, with the new row read only and Ready.
  await expect(page).toHaveURL(/#\/toolkit\/connectors$/, { timeout: 30_000 });
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("Fake is connected. No agent can use it until you turn it on."),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Connected/ })).toContainText("1");
  const link = page.getByRole("link", { name: "Fake", exact: true });
  const row = page.getByRole("row").filter({ has: link });
  await expect(row).toContainText("Not reviewed");
  await expect(row).toContainText("Read only");
  await expect(row).toContainText("Ready");
  await expect(row).toContainText("Not used yet");
  await shot(page, "05-connected-tab");

  // Its page: the reads are on, and the tool the server doesn't mark read-only is off.
  await link.click();
  await expect(page).toHaveURL(/#\/toolkit\/connectors\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Fake" })).toBeVisible({
    timeout: 30_000,
  });
  const tools = page.getByRole("region", { name: "What agents can call" });
  const badge = (tool: string) =>
    tools.getByRole("listitem").filter({ hasText: tool }).locator(".cn-tool__badge");
  await expect(badge("list_things")).toHaveText("Read");
  await expect(badge("get_thing")).toHaveText("Read");
  await expect(badge("create_thing")).toHaveText("Off · write");
  await shot(page, "06-connector-page");

  // Give an agent access: the team's Engineer, read only.
  const usedBy = page.getByRole("region", { name: /^Used by/ });
  await usedBy.getByRole("button", { name: "Give an agent access" }).click();
  const give = page.getByRole("dialog", { name: "Give agents access to Fake" });
  await expect(give.getByLabel("Team")).toContainText(teamName);
  // The design system's checkbox keeps its input out of sight: a person clicks the label.
  await give.getByText("Engineer", { exact: true }).click();
  await expect(give.getByRole("checkbox", { name: "Engineer", exact: true })).toBeChecked();
  await give.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Engineer can now use Fake (read only).")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 2, name: "Used by · 1 agent" })).toBeVisible();
  await expect(usedBy.getByRole("listitem")).toContainText(teamName);

  // The agent's drawer, reached from that row: Skills & tools shows the connector ticked.
  await usedBy.getByRole("link", { name: "Engineer", exact: true }).click();
  await expect(page).toHaveURL(/#\/teams\/[0-9a-f-]{36}/);
  const drawer = page.getByRole("complementary", { name: "Engineer settings" });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect(drawer.getByRole("tab", { name: /^Skills & tools/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(drawer.getByRole("checkbox", { name: /^Fake/ })).toBeChecked({ timeout: 15_000 });
  await drawer.getByText("Connectors this agent can use").scrollIntoViewIfNeeded();
  await shot(page, "07-agent-drawer-connectors");

  // Back to Connectors (now on Connected): Disconnect says who loses it.
  await page.getByRole("button", { name: "Back to teams" }).click();
  await nav.getByRole("button", { name: /^Toolkit/ }).click();
  await expect(page).toHaveURL(/#\/toolkit\/connectors$/);
  await expect(row).toContainText("1 agent", { timeout: 30_000 });
  await page.getByRole("button", { name: "More actions for Fake" }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Disconnect Fake?" });
  await expect(confirm).toContainText(
    `Engineer in ${teamName} uses it. It loses access now, and a run that’s going finishes without it.`,
  );
  await expect(confirm).toContainText("Tvashtr deletes its copy of your sign-in.");
  await shot(page, "08-disconnect-dialog");
  await confirm.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByText("Fake is disconnected. It’s back in Browse if you need it."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Nothing connected yet")).toBeVisible();
  const left = (await (await page.request.get("/api/connectors")).json()) as {
    connections: unknown[];
  };
  expect(left.connections).toEqual([]);
});

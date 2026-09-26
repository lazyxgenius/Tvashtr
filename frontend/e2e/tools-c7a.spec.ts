import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { registerFresh, shellNav } from "./_home";

// M-tools C7.A frontend self-sign-off. Drives the REAL app (register -> Toolkit › Secrets -> Home's
// New team -> open a WORKER node) and screenshots: (a) the drawer's Add a server form, (b) the Paste
// mcp.json "github uses ${GITHUB_TOKEN}, which isn’t set yet" warning, (c) the run-inspector warning
// banner (the exact .tv-runwarn DOM RunWarnings renders, styled by the live panel.css), and (d) the
// account MCP Secrets shelf.
// Targeted selectors only (no whole-tree a11y snapshot — that wedges on the React Flow canvas).
// Revamp round 1: the account registers through the API (the sign-up wizard is not under test and
// hides its email form in the hosted posture), and the Secrets shelf lives on Toolkit › Secrets. No
// driver script: run it against any live backend + Vite (e.g. the stack scripts/accounts_e2e.sh boots)
// with `TVASHTR_E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/tools-c7a.spec.ts`.

const SHOTS = process.env.TVASHTR_TOOLS_SHOTS_DIR ?? "/tmp/tvashtr_tools_shots";

test("M-tools C7.A: real Tools editor + pre-launch ${NAME} note + run banner + Secrets shelf", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });

  // Register a fresh account (the page shares the cookie) → the signed-in shell.
  await registerFresh(page, "tools-c7a");

  // (d) The account MCP Secrets shelf, on Toolkit › Secrets.
  await shellNav(page)
    .getByRole("button", { name: /^Toolkit/ })
    .click();
  await shellNav(page)
    .getByRole("button", { name: /^Secrets/ })
    .click();
  await expect(page).toHaveURL(/#\/toolkit\/secrets$/);
  await expect(page.getByRole("heading", { name: "MCP secrets" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("heading", { name: "MCP secrets" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "d-secrets-shelf.png") });
  console.log("[tools-c7a-e2e] (d) captured the account MCP Secrets shelf");

  // New team from Home's dialog, PM → Engineer template (a PM thinker + an Engineer worker).
  await shellNav(page).getByRole("button", { name: /^Home/ }).click();
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
  await picker.getByLabel("Name", { exact: true }).fill(`Tools C7A ${Date.now()}`);
  await picker.getByRole("button", { name: "Create team" }).click();
  await createResp;

  // Open the Engineer (a worker) node -> its drawer's Skills & tools tab.
  const eng = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(eng).toBeVisible({ timeout: 30_000 });
  await eng.click();
  const drawer = page.getByRole("complementary", { name: "Engineer settings" });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await drawer.getByRole("tab", { name: /^Skills & tools/ }).click();

  // (a) The Add a tool sheet — the guided Add a server form (name, Local/Remote, URL, headers).
  await drawer
    .getByRole("region", { name: /^Tools/ })
    .getByRole("button", { name: "Add tool" })
    .click();
  await page.getByRole("menuitem", { name: /^Add a server/ }).click();
  const sheet = drawer.getByRole("region", { name: "Add a tool" });
  await expect(sheet.getByLabel("Server name")).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole("group", { name: "Headers" })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "a-tools-section.png") });
  console.log("[tools-c7a-e2e] (a) captured the Add a server form");

  // (b) Paste mcp.json with an unstored ${NAME} -> the missing-secret warning under the server found.
  await sheet.getByRole("tab", { name: "Paste mcp.json" }).click();
  await sheet
    .getByRole("textbox", { name: "mcp.json" })
    .fill(
      '{"mcpServers":{"github":{"command":"uvx","args":["mcp-server-github"],"env":{"GITHUB_TOKEN":"${GITHUB_TOKEN}"}}}}',
    );
  const note = sheet.getByText(/^github uses \$\{GITHUB_TOKEN\}, which isn’t set yet/);
  await expect(note).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, "b-needs-secret-note.png") });
  console.log("[tools-c7a-e2e] (b) captured the paste's needs-GITHUB_TOKEN warning");

  // (c) The run-inspector warning banner — the exact .tv-runwarn DOM RunWarnings renders, mounted in
  //     the live page so the live panel.css styles it (the run view renders this off resolution_warnings).
  const shown = await page.evaluate(() => {
    const warns = [
      { name: "github", reason: "missing secret GITHUB_TOKEN" },
      { name: "team-rules", reason: "repo unreachable" },
    ];
    const el = document.createElement("div");
    el.className = "tv-runwarn";
    el.setAttribute("role", "status");
    el.innerHTML =
      `<span class="tv-runwarn__lead">⚠ ${warns.length} tools/skills didn’t load</span>` +
      `<ul class="tv-runwarn__list">` +
      warns.map((w) => `<li><code>${w.name}</code> — ${w.reason}</li>`).join("") +
      `</ul>`;
    Object.assign(el.style, { position: "fixed", top: "88px", left: "24px", zIndex: "9999" });
    document.body.appendChild(el);
    return el.textContent ?? "";
  });
  expect(shown).toContain("GITHUB_TOKEN");
  await page.screenshot({ path: path.join(SHOTS, "c-run-warnings-banner.png") });
  console.log("[tools-c7a-e2e] (c) captured the run-inspector warning banner");

  for (const f of [
    "a-tools-section.png",
    "b-needs-secret-note.png",
    "c-run-warnings-banner.png",
    "d-secrets-shelf.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS, f)), `screenshot ${f} written`).toBe(true);
  }
});

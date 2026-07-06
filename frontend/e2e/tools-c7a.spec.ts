import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// M-tools C7.A frontend self-sign-off. Drives the REAL app (register -> AuthWizard -> new team ->
// open a WORKER node) and screenshots: (a) the real Tools (MCP) editor, (b) the pre-launch
// "Needs ${GITHUB_TOKEN}" note, (c) the run-inspector warning banner (the exact .tv-runwarn DOM
// RunWarnings renders, styled by the live panel.css), and (d) the account MCP Secrets shelf.
// Targeted selectors only (no whole-tree a11y snapshot — that wedges on the React Flow canvas).

const SHOTS = process.env.TVASHTR_TOOLS_SHOTS_DIR ?? "/tmp/tvashtr_tools_shots";

test("M-tools C7.A: real Tools editor + pre-launch ${NAME} note + run banner + Secrets shelf", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });

  // Register a fresh account through the AuthWizard.
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "Get started" }).first().click();
  await page.getByLabel("Email").fill(`tools-c7a+${Date.now()}@tvashtr.local`);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  // Advance through the role/building questions to the dashboard (pick an option + Continue).
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

  // (d) The account MCP Secrets shelf, live on the dashboard beside Provider keys.
  await expect(page.getByRole("heading", { name: "MCP secrets" })).toBeVisible();
  await page.getByRole("heading", { name: "MCP secrets" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "d-secrets-shelf.png") });
  console.log("[tools-c7a-e2e] (d) captured the account MCP Secrets shelf");

  // New team from the PM → Engineer template (a PM thinker + an Engineer worker).
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /New team/ }).first().click();
  await page.getByRole("button", { name: /^PM → Engineer A PM writes/ }).click();
  await page.getByLabel("Team name").fill(`Tools C7A ${Date.now()}`);
  await page.getByRole("button", { name: "Create team" }).click();
  await createResp;

  // Open the Engineer (a worker) node -> the panel with the real Tools section.
  const eng = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(eng).toBeVisible({ timeout: 30_000 });
  await eng.click();

  // (a) The real Tools section — the paste textarea + the guided Add-server form.
  const toolsJson = page.getByLabel("Tools JSON");
  await expect(toolsJson).toBeVisible({ timeout: 30_000 });
  await toolsJson.scrollIntoViewIfNeeded();
  await expect(page.getByLabel("New server name")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "a-tools-section.png") });
  console.log("[tools-c7a-e2e] (a) captured the real Tools section");

  // (b) A config with an unstored ${NAME} -> the pre-launch note + a per-server row.
  await toolsJson.fill(
    '{"mcpServers":{"github":{"command":"uvx","args":["mcp-server-github"],"env":{"GITHUB_TOKEN":"${GITHUB_TOKEN}"}}}}',
  );
  const note = page.getByText(/Needs .*GITHUB_TOKEN/);
  await expect(note).toBeVisible({ timeout: 30_000 });
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "b-needs-secret-note.png") });
  console.log("[tools-c7a-e2e] (b) captured the pre-launch needs-GITHUB_TOKEN note");

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

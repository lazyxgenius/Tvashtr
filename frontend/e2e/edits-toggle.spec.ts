import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { openMyTeam } from "./_myTeam";

// Live FE proof for M-unify U3 (the edits surface). NO agent run, NO real LLM, .env-INDEPENDENT: it
// REGISTERS a fresh account, creates the review_loop "My team" (new accounts start with no team) and
// drives the authoring canvas + node drawer. Three checks, each with a screenshot (targeted selectors — NOT a
// full a11y snapshot, which wedges on the React Flow canvas, §4). Authenticated API reads go through
// `page.request` (it shares the page's session cookie).
//
//   A) flip a NON-start node (Engineer) Edits allowed → Not allowed + author an action-verb prompt,
//      Save → PERSISTS (edits_allowed=false via the team-graph API) and the card RE-LABELS "Edits off";
//   B) the START node (PM) Edits toggle is LOCKED off;
//   C) the Tools editor is present on an EDITS-OFF node (the Reviewer) — no worker-only note;
// (The old Check D — the launch panel's edits-off action-verb advisory — is gone: the composer
// dropped that note on purpose to match the design, bc8d69e, and the architect ruled the check out.)
//
// Piece 4 (the Reviewer template ships edits-off) is asserted up front via the team graph.

const SHOTS_DIR = process.env.TVASHTR_EDITS_TOGGLE_SHOTS_DIR ?? "/tmp/tvashtr_edits_toggle_shots";

interface GNode {
  id: string;
  role_name: string;
  kind: string;
  edits_allowed?: boolean;
  prompt: string | null;
}

test("M-unify U3: edits toggle persists + re-labels, tools on every node, start locked", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // Register a fresh account via the API — this sets the session cookie on the page's context, so we
  // sidestep the marketing landing + auth-wizard UI (whose CTAs the F3/F4 reskin changed) and load the
  // app already AUTHENTICATED. `page.request` shares the page's cookie jar, so the team reads below are
  // authenticated too. (This proves the U3 surface, not the auth flow — auth has its own e2e.)
  const email = `edits+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "edits-toggle-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  // Create + open the review_loop "My team" (the template the old seed used) → its canvas; keep its
  // id for the authenticated team-graph persistence assertions.
  const teamId = await openMyTeam(page);
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  const graphNodes = async (): Promise<GNode[]> =>
    ((await (await page.request.get(`/api/teams/${teamId}/graph`)).json()) as { nodes: GNode[] })
      .nodes;
  const byRole = (nodes: GNode[], role: string) => nodes.find((n) => n.role_name === role);

  // Piece 4: the review_loop template ships the Reviewer EDITS-OFF; the Engineer stays edits-on.
  const seeded = await graphNodes();
  expect(byRole(seeded, "reviewer")?.edits_allowed, "review_loop Reviewer is edits-off").toBe(
    false,
  );
  expect(byRole(seeded, "engineer")?.edits_allowed, "the Engineer stays edits-on").toBe(true);
  console.log("[edits-toggle-e2e] piece 4 OK — seeded Reviewer edits-off, Engineer edits-on");

  // ── CHECK A — flip the Engineer (a non-start worker) Edits allowed → Not allowed + author an
  //    action-verb prompt, Save; assert it PERSISTED + the canvas RE-LABELS the card "Edits off".
  await page.locator(".react-flow__node", { hasText: "Engineer" }).first().click();
  const eng = page.getByLabel("Engineer editor");
  await expect(eng).toBeVisible({ timeout: 30_000 });
  await expect(eng.getByRole("button", { name: "Edits allowed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await eng
    .getByRole("textbox", { name: /prompt/i })
    .fill("Implement the subtract(a, b) function and a unit test.");
  await eng.getByRole("button", { name: "Not allowed" }).click();
  await expect(eng.getByRole("button", { name: "Not allowed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await eng.getByRole("button", { name: "Save" }).click();
  await expect(eng.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => byRole(await graphNodes(), "engineer")?.edits_allowed, { timeout: 30_000 })
    .toBe(false);
  await expect(page.locator(".react-flow__node", { hasText: "Engineer" }).first()).toContainText(
    "Edits off",
    { timeout: 30_000 },
  );
  await page.screenshot({ path: path.join(SHOTS_DIR, "checkA-engineer-edits-off.png") });
  console.log("[edits-toggle-e2e] CHECK A PASS — Engineer edits-off persisted + card re-labelled");

  // ── CHECK B — the START node (PM) Edits toggle is LOCKED off.
  await page.locator(".react-flow__node", { hasText: "Product manager" }).first().click();
  const pm = page.getByLabel("Product manager editor");
  await expect(pm).toBeVisible({ timeout: 30_000 });
  await expect(pm.getByRole("button", { name: "Not allowed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(pm.getByRole("button", { name: "Not allowed" })).toBeDisabled();
  await expect(pm.getByRole("button", { name: "Edits allowed" })).toBeDisabled();
  await page.screenshot({ path: path.join(SHOTS_DIR, "checkB-start-locked.png") });
  console.log("[edits-toggle-e2e] CHECK B PASS — the PM (start) Edits toggle is locked off");

  // ── CHECK C — the Tools editor is present on an EDITS-OFF node (the Reviewer), no worker-only note.
  await page.locator(".react-flow__node", { hasText: "Reviewer" }).first().click();
  const rev = page.getByLabel("Reviewer editor");
  await expect(rev).toBeVisible({ timeout: 30_000 });
  await expect(rev.getByRole("button", { name: "Not allowed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  ); // the Reviewer is edits-off
  await expect(rev.getByLabel("Tools JSON")).toBeVisible({ timeout: 30_000 });
  await expect(rev.getByText(/switch this node to Worker/i)).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS_DIR, "checkC-tools-on-edits-off.png") });
  console.log("[edits-toggle-e2e] CHECK C PASS — Tools editor present on the edits-off Reviewer");

  for (const f of [
    "checkA-engineer-edits-off.png",
    "checkB-start-locked.png",
    "checkC-tools-on-edits-off.png",
  ]) {
    expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
  }
});

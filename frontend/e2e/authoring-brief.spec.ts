import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";

import { runFromCanvas } from "./_composer";
import { registerFresh } from "./_home";
import { seedProviderKeys } from "./_keys";

// Live FE proof for the authoring-view "last run" brief (Option A / M2): run a real review_loop, then
// return to the AUTHORING view, click the PM (thinker) node, and assert its TeamNodePanel surfaces
// the per-node "Last run" brief ("Drafted the spec from the idea.") + a relative-time provenance tag
// — i.e. the cloned_from_node_id linkage + the authoring read + the view-switch re-fetch all work.
// Targeted selectors + an element screenshot (NOT a whole-tree snapshot — the React Flow a11y tree
// wedges the MCP snapshot). Revamp round 1: the team comes from Home's New team dialog and the run
// is launched through Home's composer (the canvas's "Run this team" opens it), then "Open run".

const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
const SHOTS_DIR = process.env.TVASHTR_AUTHORING_SHOTS_DIR ?? "/tmp/tvashtr_authoring_brief_shots";

async function runStatus(request: APIRequestContext, runId: string): Promise<string> {
  const res = await request.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

test("authoring-brief: a run's PM brief surfaces in the authoring node panel after returning to authoring", async ({
  page,
}) => {
  test.setTimeout(24 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // Sign in as a fresh account (the page's request context carries its cookie) with a deepseek key,
  // so the team's nodes default to deepseek models the launch pre-flight can resolve.
  await registerFresh(page, "authoring-brief");
  await seedProviderKeys(page, ["deepseek"]);
  const request = page.request;

  // 1. Create a fresh review_loop team from Home's New team dialog and capture its id + the PM
  //    authored node id.
  const TEAM_NAME = `Authoring-brief E2E ${Date.now()}`;
  const createResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New team", exact: true }).first().click();
  const picker = page.getByRole("dialog", { name: "New team" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker
    .locator("button.hm-tplcard", {
      has: page.locator(".hm-tplcard__name", { hasText: /^PM → Engineer ⇄ Reviewer$/ }),
    })
    .click();
  await picker.getByLabel("Name", { exact: true }).fill(TEAM_NAME);
  await picker.getByRole("button", { name: "Create team" }).click();
  const teamId = ((await (await createResp).json()) as { team_graph_id: string }).team_graph_id;
  console.log(`[authoring-brief-e2e] created review_loop team ${teamId}`);

  const teamGraph = (await (await request.get(`/api/teams/${teamId}/graph`)).json()) as {
    nodes: { id: string; role_name: string }[];
  };
  const pmId = teamGraph.nodes.find((n) => n.role_name === "pm")!.id;
  expect(pmId, "pm authored node id").toBeTruthy();

  // 2. "Run this team" -> Home's composer -> Launch (greenfield, the backend's skeleton idea) ->
  //    run_id; "Open run" -> the run view. The run goes hands-off (auto-approve gates, Reviewer
  //    approves) to ship.
  const { runId } = await runFromCanvas(page, { teamName: TEAM_NAME });
  console.log(`[authoring-brief-e2e] run_id = ${runId}`);

  const deadline = Date.now() + 20 * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(request, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    await page.waitForTimeout(3000);
  }
  expect(status, "the run should ship (completed)").toBe("completed");
  console.log("[authoring-brief-e2e] run shipped (completed)");

  // 3. Return to the AUTHORING view — this re-fetches the team graph, so `last_run` is now populated.
  await page.getByRole("button", { name: "Edit this team" }).click();

  // 4. Click the PM (thinker) authored node -> its authoring node panel opens.
  await expect(page.locator(`[data-id="${pmId}"]`).first()).toBeVisible({ timeout: 30_000 });
  await page.locator(`[data-id="${pmId}"]`).first().click();
  const panel = page.getByLabel("Product manager editor");
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // 5. The "Last run" section shows the PM's first-thinker brief + a relative-time provenance tag.
  await expect(panel.getByText("Drafted the spec from the idea.")).toBeVisible({ timeout: 30_000 });
  const whenTag = panel.locator(".tv-lastrun__when");
  await expect(whenTag).toBeVisible();
  await expect(whenTag).toContainText("ran"); // "ran just now" / "ran 2m ago" / …
  console.log("[authoring-brief-e2e] authoring PM panel shows the last-run brief + provenance");

  // 6. Screenshot the authoring panel as the self-sign-off artifact.
  const shot = path.join(SHOTS_DIR, "authoring-pm-last-run.png");
  await panel.screenshot({ path: shot });
  console.log(`[authoring-brief-e2e] screenshot -> ${shot}`);
  expect(fs.existsSync(shot), "screenshot saved").toBe(true);
});

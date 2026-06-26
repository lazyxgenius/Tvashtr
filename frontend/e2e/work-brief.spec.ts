import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";

// Live FE proof for the per-node work-brief (Option A, §6.2): drive a real review_loop run through
// the UI, then click the THINKER (PM) node and the WORKER (Engineer) node in the RUN view and assert
// each node's panel surfaces its own "Last run" brief — screenshotting both as operator artifacts.
// Uses targeted locators (data-id) + element screenshots, NOT a whole-tree snapshot (the React Flow
// a11y tree wedges the MCP snapshot — gotcha).

const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
const SHOTS_DIR = process.env.TVASHTR_WB_SHOTS_DIR ?? "/tmp/tvashtr_work_brief_shots";
// A well-formed non-emitting worker brief (files-changed, the expected real-build case, or no-files).
const WORKER_BRIEF = /Built the feature — changed \d+ file\(s\):|Ran but changed no files\./;

async function runStatus(request: APIRequestContext, runId: string): Promise<string> {
  const res = await request.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

test("work-brief: the run-view panel surfaces each node's 'Last run' brief (thinker + worker)", async ({
  page,
  request,
}) => {
  // A real PM (completion) + a real Engineer agent x2 (forced loop-back) on the live NIM model.
  test.setTimeout(24 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  await page.goto("/");

  // 1. Create a fresh review_loop team (deterministic regardless of prior DB state) and run it.
  const TEAM_NAME = `Work-brief E2E ${Date.now()}`;
  await page.getByRole("button", { name: /New team/ }).click();
  const picker = page.getByLabel("New team from a template");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByText("PM → Engineer ↔ Reviewer").click();
  await picker.getByRole("textbox").fill(TEAM_NAME);
  await picker.getByRole("button", { name: "Create team" }).click();
  console.log(`[work-brief-e2e] created review_loop team "${TEAM_NAME}"`);

  // (No model edit needed: the review_loop template already seeds the Engineer with the proven NIM
  // agent model — the §6.1 API checker proved this template runs to completion on NIM. Editing the
  // model to that same value would leave the dirty-aware Save button DISABLED and hang the click.)
  const engineerNode = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(engineerNode).toBeVisible({ timeout: 30_000 });

  // 2. "Run this team" -> capture run_id; the app switches to the run view.
  const startResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run this team" }).click();
  const runId = ((await (await startResp).json()) as { run_id: string }).run_id;
  expect(runId, "Run-this-team returns a run_id").toBeTruthy();
  console.log(`[work-brief-e2e] run_id = ${runId}`);

  // 3. Run hands-off (auto-approve gates + forced revision -> Engineer x2) to ship.
  const deadline = Date.now() + 20 * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(request, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    await page.waitForTimeout(3000);
  }
  expect(status, "the run should ship (completed)").toBe("completed");
  console.log("[work-brief-e2e] run shipped (completed)");

  // 4. Find the PM (thinker) + Engineer (worker) node ids from the run graph, then click each on the
  //    canvas and assert its panel shows the node's own "Last run" brief.
  const graph = (await (await request.get(`/api/runs/${runId}/graph`)).json()) as {
    nodes: { id: string; role_name: string }[];
  };
  const pmId = graph.nodes.find((n) => n.role_name === "pm")!.id;
  const engId = graph.nodes.find((n) => n.role_name === "engineer")!.id;
  expect(pmId, "pm node id").toBeTruthy();
  expect(engId, "engineer node id").toBeTruthy();

  // THINKER (PM): click -> the panel shows the first-thinker brief + the PRD body.
  await page.locator(`[data-id="${pmId}"]`).first().click();
  await expect(page.getByText("Drafted the spec from the idea.")).toBeVisible({ timeout: 30_000 });
  const thinkerShot = path.join(SHOTS_DIR, "thinker-last-run.png");
  await page.locator(".tv-panel").screenshot({ path: thinkerShot });
  console.log(`[work-brief-e2e] THINKER panel brief visible; screenshot -> ${thinkerShot}`);

  // WORKER (Engineer): click -> the panel shows the files-changed brief + the step feed.
  await page.locator(`[data-id="${engId}"]`).first().click();
  await expect(page.getByText(WORKER_BRIEF).first()).toBeVisible({ timeout: 30_000 });
  const workerShot = path.join(SHOTS_DIR, "worker-last-run.png");
  await page.locator(".tv-panel").screenshot({ path: workerShot });
  console.log(`[work-brief-e2e] WORKER panel brief visible; screenshot -> ${workerShot}`);

  expect(fs.existsSync(thinkerShot) && fs.existsSync(workerShot), "both screenshots saved").toBe(
    true,
  );
});

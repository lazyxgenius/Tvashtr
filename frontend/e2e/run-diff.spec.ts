import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { runFromCanvas } from "./_composer";
import { openMyTeam } from "./_myTeam";

// Live FE proof for the run-view "Changes" tab (M-changes): register a fresh account, seed its
// deepseek key (seed.py omits deepseek + the launch pre-flight 422s a keyless launch), create a
// review_loop team from the template and drive a REAL run to completion (LOCAL sandbox, forced
// reviewer-approve — no docker agent containers), then open the Engineer node's drawer, click
// "Changes", and assert the run's produced file(s) render with a per-file, expandable diff. A
// screenshot per check. Node-driving via data-id + element screenshots — never a whole-tree snapshot
// (the React Flow a11y tree wedges it).

const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
const SHOTS_DIR = process.env.TVASHTR_RUN_DIFF_SHOTS_DIR ?? "/tmp/tvashtr_run_diff_shots";

async function runStatus(api: APIRequestContext, runId: string): Promise<string> {
  const res = await api.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

// NB: authenticated reads go through `page.request` (it shares the page's session cookie set by the
// mid-test register) — the standalone `request` fixture is a SEPARATE, unauthenticated context.
test("run-diff: the Changes tab renders the run's changed file(s)", async ({ page }) => {
  test.setTimeout(24 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // 1. Register a fresh account (sets the page cookie) + seed its deepseek key.
  const email = `rundiff+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "run-diff-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env.DEEPSEEK_API_KEY;
  expect(Boolean(key), "DEEPSEEK_API_KEY present in the spec env").toBeTruthy();
  const seed = await page.request.post("/api/providers", {
    data: { provider: "deepseek", api_key: key },
  });
  expect(seed.ok(), "seed the deepseek provider key (pre-flight needs it)").toBeTruthy();

  // 2. Open the fresh account's seeded review_loop "My team" -> canvas (the proven fresh-account
  //    flow; every model-bearing node is deepseek since the backend seeded it under the deepseek env).
  await openMyTeam(page);
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  const engineerNode = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(engineerNode).toBeVisible({ timeout: 30_000 });
  console.log("[run-diff-e2e] opened the seeded review_loop 'My team'");

  // 3. Run this team -> Home's composer -> Launch (greenfield, the backend's skeleton idea) ->
  //    capture run_id; "Open run" -> the run view (revamp round 1: the one launch surface).
  const { runId } = await runFromCanvas(page, { teamName: "My team" });
  expect(runId, "Run-this-team returns a run_id").toBeTruthy();
  console.log(`[run-diff-e2e] run_id = ${runId}`);

  // 4. Hands-off to completion (auto-approve gates + forced reviewer-approve; PM + Engineer on deepseek).
  const deadline = Date.now() + 20 * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(page.request, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    await page.waitForTimeout(3000);
  }
  expect(status, "the run should ship (completed)").toBe("completed");
  console.log("[run-diff-e2e] run shipped (completed)");

  // 5. Cross-check the NEW diff API directly (owner-scoped read) — the run changed >= 1 file.
  const diff = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as {
    files: { path: string; status: string; additions: number; deletions: number }[];
    total: number;
  };
  expect(diff.total, "the run changed at least one file").toBeGreaterThan(0);
  const firstPath = diff.files[0].path;
  console.log(
    `[run-diff-e2e] /diff -> ${diff.total} file(s): ` +
      diff.files.map((f) => `${f.path} (${f.status} +${f.additions}/-${f.deletions})`).join(", "),
  );

  // 6. Open the Engineer (worker) node's drawer, click "Changes", assert the produced file renders.
  const graph = (await (await page.request.get(`/api/runs/${runId}/graph`)).json()) as {
    nodes: { id: string; role_name: string }[];
  };
  const engId = graph.nodes.find((n) => n.role_name === "engineer")!.id;
  expect(engId, "engineer node id").toBeTruthy();
  await page.locator(`[data-id="${engId}"]`).first().click();
  await page.getByRole("button", { name: "Changes", exact: true }).click();

  await expect(page.getByText(firstPath, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const filesShot = path.join(SHOTS_DIR, "changes-tab-files.png");
  await page.locator(".tv-panel").screenshot({ path: filesShot });
  console.log(`[run-diff-e2e] Changes tab shows "${firstPath}"; screenshot -> ${filesShot}`);

  // 7. Expand the first file to its per-file patch.
  await page.locator(".tv-diff__row").first().click();
  await expect(page.locator(".tv-diff__patch").first()).toBeVisible({ timeout: 10_000 });
  const patchShot = path.join(SHOTS_DIR, "changes-tab-patch.png");
  await page.locator(".tv-panel").screenshot({ path: patchShot });
  console.log(`[run-diff-e2e] per-file patch expands; screenshot -> ${patchShot}`);

  expect(fs.existsSync(filesShot) && fs.existsSync(patchShot), "both screenshots saved").toBe(true);
});

import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { runFromCanvas } from "./_composer";
import { openMyTeam } from "./_myTeam";

// Live FE proof for Mode A ("Ask the node"): register a fresh account, seed its deepseek key, create
// a review_loop team from the template and drive a REAL run to completion (LOCAL sandbox, forced
// reviewer-approve — no docker agent containers), then open the Engineer node's drawer, click "Ask",
// ask a question about what it did, and assert a NON-EMPTY answer renders. A screenshot per check.
// Node-driving via data-id + element screenshots — never a whole-tree snapshot (the React Flow a11y
// tree wedges it).

const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
const SHOTS_DIR = process.env.TVASHTR_NODE_ASK_SHOTS_DIR ?? "/tmp/tvashtr_node_ask_shots";

async function runStatus(api: APIRequestContext, runId: string): Promise<string> {
  const res = await api.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

// NB: authenticated reads go through `page.request` (it shares the page's session cookie set by the
// mid-test register) — the standalone `request` fixture is a SEPARATE, unauthenticated context.
test("node-ask: the Ask tab answers a question about what a node did", async ({ page }) => {
  test.setTimeout(24 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // 1. Register a fresh account (sets the page cookie) + seed its deepseek key.
  const email = `nodeask+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "node-ask-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env.DEEPSEEK_API_KEY;
  expect(Boolean(key), "DEEPSEEK_API_KEY present in the spec env").toBeTruthy();
  const seed = await page.request.post("/api/providers", {
    data: { provider: "deepseek", api_key: key },
  });
  expect(seed.ok(), "seed the deepseek provider key (pre-flight needs it)").toBeTruthy();

  // 2. Open the fresh account's seeded review_loop "My team" -> canvas (every model-bearing node is
  //    deepseek since the backend seeded it under the deepseek env).
  await openMyTeam(page);
  await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });
  const engineerNode = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(engineerNode).toBeVisible({ timeout: 30_000 });
  console.log("[node-ask-e2e] opened the seeded review_loop 'My team'");

  // 3. Run this team -> Home's composer -> Launch (greenfield, the backend's skeleton idea) ->
  //    capture run_id; "Open run" -> the run view (revamp round 1: the one launch surface).
  const { runId } = await runFromCanvas(page, { teamName: "My team" });
  expect(runId, "Run-this-team returns a run_id").toBeTruthy();
  console.log(`[node-ask-e2e] run_id = ${runId}`);

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
  console.log("[node-ask-e2e] run shipped (completed)");

  // 5. Open the Engineer (worker) node's drawer and switch to the Ask tab (present once it has run).
  const graph = (await (await page.request.get(`/api/runs/${runId}/graph`)).json()) as {
    nodes: { id: string; role_name: string }[];
  };
  const engId = graph.nodes.find((n) => n.role_name === "engineer")!.id;
  expect(engId, "engineer node id").toBeTruthy();
  await page.locator(`[data-id="${engId}"]`).first().click();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByLabel("Ask this node")).toBeVisible({ timeout: 30_000 });
  const askShot = path.join(SHOTS_DIR, "ask-tab-open.png");
  await page.locator(".tv-panel").screenshot({ path: askShot });
  console.log(`[node-ask-e2e] Ask tab open; screenshot -> ${askShot}`);

  // 6. Ask what the node did and assert a NON-EMPTY answer renders (a REAL deepseek completion, keyed
  //    to the run-owner's seeded BYOK key, answered from the node's recorded trail).
  await page.getByLabel("Ask this node").fill("In one sentence, what did you do in this run?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const answer = page.locator(".tv-chat__msg--assistant").first();
  await expect(answer).toBeVisible({ timeout: 90_000 });
  const answerText = (await answer.textContent()) ?? "";
  expect(answerText.trim().length, "the node's answer is non-empty").toBeGreaterThan(0);
  console.log(`[node-ask-e2e] answer: ${answerText.slice(0, 160)}`);

  const answerShot = path.join(SHOTS_DIR, "ask-tab-answer.png");
  await page.locator(".tv-panel").screenshot({ path: answerShot });
  console.log(`[node-ask-e2e] answer rendered; screenshot -> ${answerShot}`);

  expect(fs.existsSync(askShot) && fs.existsSync(answerShot), "both screenshots saved").toBe(true);
});

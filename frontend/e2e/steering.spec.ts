import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type APIRequestContext, expect, test } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
// DEFAULT_IDEA's deliverable line (backend/tvashtr/routers.py) — the line the shipped file must
// NOT be, proving the human's mid-run edit (not the PM's original spec) drove what shipped.
const DEFAULT_LINE = "Shipped by the Tvashtr PM->Engineer team";

const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];

async function runStatus(request: APIRequestContext, runId: string): Promise<string> {
  const res = await request.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

test("J3 live steering: a human rewrites the PRD at the gate through the real TipTap editor and the agent ships it", async ({
  page,
  request,
}) => {
  // A real PM + Engineer + Reviewer chain on the live NIM agent — give it room.
  test.setTimeout(22 * 60 * 1000);

  // Unique so the assertion can't pass on a stale workspace from a prior run.
  const SENTINEL = `Steered by a human mid-run via Tvashtr ${Date.now()}`;

  await page.goto("/");

  // 1. Launch the persistent team via the UI control (P1.8b: the canvas opens to the editable team
  //    and "Run this team" clones+launches it — a review_loop, so it still pauses at the PRD gate).
  //    Wait for the team to load so the control is enabled; capture run_id from the POST response.
  const startResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  const runControl = page.getByRole("button", { name: "Run this team" });
  await expect(runControl).toBeEnabled({ timeout: 30_000 });
  await runControl.click();
  const runId = ((await (await startResp).json()) as { run_id: string }).run_id;
  expect(runId, "the Start control returns a run_id").toBeTruthy();
  console.log(`[steering-e2e] run_id = ${runId}`);

  // 2. Wait until it pauses at the PRD gate (awaiting_human). The gate blocks indefinitely, so
  //    there is no timing race — we can take as long as the PM step needs.
  await expect
    .poll(() => runStatus(request, runId), { timeout: 6 * 60 * 1000, intervals: [2000] })
    .toBe("awaiting_human");
  console.log("[steering-e2e] paused at the PRD gate (awaiting_human)");

  // 3. Open the PM panel; assert the TipTap editor renders the PM's PRD.
  await page.locator(".react-flow__node", { hasText: "Product manager" }).first().click();
  const prose = page.locator(".tv-prd__editor .ProseMirror");
  await expect(prose).toBeVisible({ timeout: 30_000 });
  await expect(prose).not.toBeEmpty();
  console.log("[steering-e2e] TipTap editor rendered the PM PRD");

  // 4. Clear the editor and type a known minimal PRD specifying greeting.txt = SENTINEL. Save ->
  //    a new `human` version appears.
  await prose.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(
    "Create a file named greeting.txt at the repository root. It must contain exactly this single line and nothing else:",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type(SENTINEL);

  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.locator(".tv-prd__saved")).toContainText("Saved v", { timeout: 30_000 });
  await expect(page.locator(".tv-prd__version", { hasText: "human" })).toBeVisible();
  console.log("[steering-e2e] saved a new human version of the PRD");

  // 5 + 6. Approve the PRD gate (and, if the real Reviewer cycles to the cap, the escalation
  //    gate too — both ship the last build, which is deterministically the SENTINEL greeting)
  //    until the run completes.
  const deadline = Date.now() + 18 * 60 * 1000;
  let status = "awaiting_human";
  while (Date.now() < deadline) {
    status = await runStatus(request, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    // `exact` matters: the blocker CARD is itself a button whose accessible name contains the
    // description ("…Approve to let the Engineer build…"); only the action button is exactly
    // "Approve". Matching loosely would click the card (which just frames the node) and never
    // resolve the gate.
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    if ((await approve.count()) > 0) {
      await approve
        .first()
        .click()
        .catch(() => {});
      console.log(`[steering-e2e] approved a gate (run was '${status}')`);
    }
    await page.waitForTimeout(3000);
  }
  expect(status, "the steered run should ship (completed)").toBe("completed");
  console.log("[steering-e2e] run shipped (completed)");

  // 7. The proof: the shipped greeting.txt is the human's SENTINEL, NOT DEFAULT_IDEA's line.
  const ws = path.join(REPO_ROOT, "backend", ".tvashtr_workspaces", runId);
  const tag = `ship-${runId}`;
  const shipped = execFileSync("git", ["-C", ws, "show", `${tag}:greeting.txt`], {
    encoding: "utf8",
  });
  console.log(`[steering-e2e] shipped greeting.txt (tag ${tag}):\n---\n${shipped}\n---`);
  expect(shipped, "shipped greeting.txt reflects the human's mid-run edit").toContain(SENTINEL);
  expect(shipped, "the PM's original DEFAULT_IDEA line did NOT ship").not.toContain(DEFAULT_LINE);
});

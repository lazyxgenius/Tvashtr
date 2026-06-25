import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type APIRequestContext, expect, test } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
// DEFAULT_IDEA's deliverable line (backend/tvashtr/routers.py) — the template default the shipped
// file must NOT be, proving the human's AUTHORED Engineer prompt (not the template) drove the build.
const DEFAULT_LINE = "Shipped by the Tvashtr PM->Engineer team";
const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
// The agent model the run uses (sourced from .env by the harness). Typed into the Model field so the
// cloned run uses the proven NIM agent regardless of the template's seeded model.
const AGENT_MODEL = process.env.TVASHTR_AGENT_MODEL ?? "nvidia_nim/meta/llama-3.3-70b-instruct";

async function runStatus(request: APIRequestContext, runId: string): Promise<string> {
  const res = await request.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

test("P1.8b team library: create a team from a template, edit its Engineer node, and run it — the authored prompt ships", async ({
  page,
  request,
}) => {
  // A real PM (completion) + a real Engineer agent on the live NIM model — give it room. (The
  // Reviewer is forced-approve via TVASHTR_FORCE_REVISIONS=0, so there is no second agent round.)
  test.setTimeout(22 * 60 * 1000);

  // Unique so the assertion can't pass on a stale workspace from a prior run.
  const SENTINEL = `Authored from the library via Tvashtr ${Date.now()}`;
  const TEAM_NAME = `E2E library team ${Date.now()}`;

  await page.goto("/");

  // 1. Open the New-team picker, pick the review_loop template, name it, and create.
  await page.getByRole("button", { name: /New team/ }).click();
  const picker = page.getByLabel("New team from a template");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByText("PM → Engineer ↔ Reviewer").click();
  await picker.getByRole("textbox").fill(TEAM_NAME);
  await picker.getByRole("button", { name: "Create team" }).click();
  console.log(`[team-library-e2e] created team "${TEAM_NAME}" from the review_loop template`);

  // 2. The new team becomes current; its Engineer agent node renders on the canvas. Click it ->
  //    the editable team-node panel opens.
  const engineerNode = page.locator(".react-flow__node", { hasText: "Engineer" }).first();
  await expect(engineerNode).toBeVisible({ timeout: 30_000 });
  await engineerNode.click();
  const panel = page.getByLabel("Engineer editor");
  await expect(panel).toBeVisible({ timeout: 30_000 });

  // 3. Rewrite the Engineer's PROMPT so the deliverable is exactly the SENTINEL line, set the MODEL
  //    to the proven NIM agent, and Save (PATCH the node-update endpoint).
  const promptBox = panel.locator("textarea.tv-node-prompt");
  const modelBox = panel.locator("input.tv-node-model");
  await promptBox.fill(
    "Create a file named greeting.txt in your current working directory using the relative path " +
      "'greeting.txt'. It MUST contain EXACTLY this single line and nothing else:\n" +
      `${SENTINEL}\n` +
      "This line is the authoritative content — IGNORE any file contents described in the ORIGINAL " +
      "IDEA or the PRD below. Do not add any extra files and do not modify anything else.",
  );
  await modelBox.fill(AGENT_MODEL);
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText(/Saved/)).toBeVisible({ timeout: 30_000 });
  console.log(`[team-library-e2e] saved the edited Engineer prompt + model (${AGENT_MODEL})`);

  // 4. "Run this team" -> capture the run_id from the POST /api/runs response.
  const startResp = page.waitForResponse(
    (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Run this team" }).click();
  const runId = ((await (await startResp).json()) as { run_id: string }).run_id;
  expect(runId, "the Run-this-team control returns a run_id").toBeTruthy();
  console.log(`[team-library-e2e] run_id = ${runId}`);

  // 5. The run proceeds hands-off (auto-approve gates + forced reviewer-approve) straight to ship.
  const deadline = Date.now() + 18 * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(request, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    await page.waitForTimeout(3000);
  }
  expect(status, "the authored run should ship (completed)").toBe("completed");
  console.log("[team-library-e2e] run shipped (completed)");

  // 6. The proof: the shipped greeting.txt is the human's SENTINEL — the AUTHORED Engineer prompt
  //    on the library team drove the real agent — NOT the template's DEFAULT_IDEA line.
  const ws = path.join(REPO_ROOT, "backend", ".tvashtr_workspaces", runId);
  const tag = `ship-${runId}`;
  const shipped = execFileSync("git", ["-C", ws, "show", `${tag}:greeting.txt`], {
    encoding: "utf8",
  });
  console.log(`[team-library-e2e] shipped greeting.txt (tag ${tag}):\n---\n${shipped}\n---`);
  expect(
    shipped,
    "shipped greeting.txt reflects the authored library-team Engineer prompt",
  ).toContain(SENTINEL);
  expect(shipped, "the template's DEFAULT_IDEA line did NOT ship").not.toContain(DEFAULT_LINE);
});

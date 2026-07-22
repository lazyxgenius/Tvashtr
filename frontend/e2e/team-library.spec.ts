import { type APIRequestContext, expect, test } from "@playwright/test";

import { shippedFile } from "./_shipReadback";

// DEFAULT_IDEA's deliverable line (backend/tvashtr/routers.py) — the template default the shipped
// file must NOT be, proving the human's AUTHORED Engineer prompt (not the template) drove the build.
const DEFAULT_LINE = "Shipped by the Tvashtr PM->Engineer team";
const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
// The agent model the run uses (sourced from .env by the harness). Typed into the Model field so the
// cloned run uses the proven agent regardless of the template's seeded model.
const AGENT_MODEL = process.env.TVASHTR_AGENT_MODEL ?? "deepseek/deepseek-chat";

async function runStatus(request: APIRequestContext, runId: string): Promise<string> {
  const res = await request.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

/**
 * Post M-accounts: register (cookie on page.request), seed deepseek BYOK, land on the dashboard.
 * The standalone `request` fixture is unauthenticated — always use page.request for owner reads.
 */
async function registerAndSeed(page: import("@playwright/test").Page): Promise<void> {
  const email = `teamlibrary+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "team-library-e2e-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env.DEEPSEEK_API_KEY;
  expect(Boolean(key), "DEEPSEEK_API_KEY present in the spec env").toBeTruthy();
  const seed = await page.request.post("/api/providers", {
    data: { provider: "deepseek", api_key: key },
  });
  expect(seed.ok(), "seed the deepseek provider key (pre-flight needs it)").toBeTruthy();
  await page.goto("/");
  // Dashboard after cookie register: New team is available (landing is skipped).
  await expect(page.getByRole("button", { name: "New team", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  console.log(`[team-library-e2e] registered ${email} and landed on the dashboard`);
}

test("P1.8b team library: create a team from a template, edit its Engineer node, and run it — the authored prompt ships", async ({
  page,
}) => {
  // A real PM (completion) + a real Engineer agent — give it room. (The Reviewer is forced-approve
  // via TVASHTR_FORCE_REVISIONS=0, so there is no second agent round.)
  test.setTimeout(22 * 60 * 1000);

  // Unique so the assertion can't pass on a stale workspace from a prior run.
  const SENTINEL = `Authored from the library via Tvashtr ${Date.now()}`;
  const TEAM_NAME = `E2E library team ${Date.now()}`;

  await registerAndSeed(page);
  const api = page.request;

  // 1. Open the New-team picker (F2c dialog aria-label "New team"), pick review_loop, name it, create.
  await page.getByRole("button", { name: "New team", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "New team" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByText("PM → Engineer ↔ Reviewer").click();
  await picker.getByLabel("Team name").fill(TEAM_NAME);
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
  //    to the proven agent, and Save (PATCH the node-update endpoint).
  // Multiple textareas share .tv-node-prompt (reads-from, skills, tools); pin the System prompt.
  const promptBox = panel.getByRole("textbox", { name: /System prompt/i });
  const modelBox = panel.locator("input.tv-node-model").first();
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
  // Slice 2: "Run this team" opens the launch panel; its Run fires the (greenfield) launch.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const runId = ((await (await startResp).json()) as { run_id: string }).run_id;
  expect(runId, "the Run-this-team control returns a run_id").toBeTruthy();
  console.log(`[team-library-e2e] run_id = ${runId}`);

  // 5. The run proceeds hands-off (auto-approve gates + forced reviewer-approve) straight to ship.
  const deadline = Date.now() + 18 * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(api, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    await page.waitForTimeout(3000);
  }
  expect(status, "the authored run should ship (completed)").toBe("completed");
  console.log("[team-library-e2e] run shipped (completed)");

  // 6. The proof: the shipped greeting.txt is the human's SENTINEL — the AUTHORED Engineer prompt
  //    on the library team drove the real agent — NOT the template's DEFAULT_IDEA line.
  //    Read via /diff (the Changes-tab product surface) — the workspace is reaped after ship.
  const shipped = await shippedFile(api, runId, "greeting.txt");
  console.log(`[team-library-e2e] shipped greeting.txt (via /diff):\n---\n${shipped}\n---`);
  // Non-null + non-empty first so a missing artifact fails LOUDLY (not.toContain would pass on "").
  expect(shipped, "durable /diff must carry greeting.txt as an added file").toBeTruthy();
  expect(
    shipped as string,
    "shipped greeting.txt reflects the authored library-team Engineer prompt",
  ).toContain(SENTINEL);
  expect(shipped as string, "the template's DEFAULT_IDEA line did NOT ship").not.toContain(
    DEFAULT_LINE,
  );
});

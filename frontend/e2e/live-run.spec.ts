import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { runFromCanvas } from "./_composer";
import { openMyTeam } from "./_myTeam";

// M2 live FE proof (brief §4 M2): a REAL local run (LOCAL sandbox, auto-approved gates, forced
// reviewer-approve) shows the live run view — the Now bar, the Activity feed growing while it runs,
// the filter by agent, and the Done summary at the end. The provider is chosen by the launcher
// (TVASHTR_E2E_PROVIDER + its key env var), so a provider outage doesn't block the proof.
// Element screenshots only (the React Flow a11y tree wedges whole-tree snapshots).

const TERMINAL_BAD = ["failed", "rejected", "cancelled", "over_budget"];
const SHOTS_DIR = process.env.TVASHTR_LIVE_RUN_SHOTS_DIR ?? "/tmp/tvashtr_live_run_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia_nim: "NVIDIA_BUILD_API_KEY",
};

async function runStatus(api: APIRequestContext, runId: string): Promise<string> {
  const res = await api.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

function stepsOf(text: string | null): number {
  const m = /(\d+) steps?/.exec(text ?? "");
  return m ? Number(m[1]) : 0;
}

test("live-run: the Now bar, a growing Activity feed, its filter and Done", async ({ page }) => {
  test.setTimeout(24 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const email = `liverun+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "live-run-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  const seed = await page.request.post("/api/providers", {
    data: { provider: PROVIDER, api_key: key },
  });
  expect(seed.ok(), `seed the ${PROVIDER} key (the pre-flight needs it)`).toBeTruthy();

  await openMyTeam(page);
  await expect(page.locator(".react-flow__node", { hasText: "Engineer" }).first()).toBeVisible({
    timeout: 30_000,
  });
  const { runId } = await runFromCanvas(page, { teamName: "My team" });
  expect(runId, "a run started").toBeTruthy();
  console.log(`[live-run-e2e] run_id = ${runId}`);

  // The run view: the Now bar under the toolbar, one chip per agent.
  const now = page.getByRole("region", { name: "Now" });
  await expect(now).toBeVisible({ timeout: 60_000 });
  await expect(now.getByRole("button", { name: /^Engineer/ })).toBeVisible();
  await now.screenshot({ path: path.join(SHOTS_DIR, "now-bar.png") });

  // The Activity feed grows while the run works.
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity).toBeVisible();
  const count = activity.locator(".lv-act__count");
  const first = stepsOf(await count.textContent());
  await expect
    .poll(async () => stepsOf(await count.textContent()), {
      timeout: 10 * 60 * 1000,
      intervals: [2000],
    })
    .toBeGreaterThan(first);
  console.log(
    `[live-run-e2e] the feed grew: ${first} → ${stepsOf(await count.textContent())} steps`,
  );
  await activity.screenshot({ path: path.join(SHOTS_DIR, "activity-growing.png") });

  // Hands-off to completion.
  const deadline = Date.now() + 20 * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(page.request, runId);
    if (status === "completed") break;
    if (TERMINAL_BAD.includes(status)) throw new Error(`run ended '${status}' before shipping`);
    await page.waitForTimeout(3000);
  }
  expect(status, "the run should finish (completed)").toBe("completed");

  // Done: the summary takes the Now bar's row.
  await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("region", { name: "Run summary" }).screenshot({
    path: path.join(SHOTS_DIR, "done-summary.png"),
  });

  // The filter: only the Engineer's steps, then all of them again.
  await activity
    .getByRole("button", { name: "Show", exact: false })
    .first()
    .click()
    .catch(() => undefined);
  await activity.getByRole("button", { name: "Engineer", exact: true }).click();
  const who = activity.locator(".lv-line__who");
  await expect.poll(async () => (await who.allTextContents()).length).toBeGreaterThan(0);
  expect(new Set(await who.allTextContents())).toEqual(new Set(["Engineer"]));
  await activity.getByRole("button", { name: "All", exact: true }).click();
  await expect.poll(async () => new Set(await who.allTextContents()).size).toBeGreaterThan(1);
  await activity.screenshot({ path: path.join(SHOTS_DIR, "activity-done.png") });
  console.log("[live-run-e2e] Now bar, growing feed, filter and Done summary: all seen");
});

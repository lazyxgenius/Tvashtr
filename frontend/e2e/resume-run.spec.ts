import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { runFromCanvas } from "./_composer";
import { openMyTeam } from "./_myTeam";

// M3 live FE proof (brief §4 M3, ruling R8): a REAL local run whose Engineer round 1 is forced to
// fail (TVASHTR_FORCE_FAIL_ROLE=engineer, TVASHTR_FORCE_FAIL_ROUND=1 — no LLM call, never in a
// resumed run) is resumed from the run view: the Failed callout's "Resume from Engineer, round 1"
// → the confirm dialog → "Resume run". The resumed run opens, says "Resumed from #n", carries the
// PM's spec and the approval (Carried over, never run again), runs the Engineer for real and
// reaches Done. Element screenshots only (the React Flow a11y tree wedges whole-tree snapshots).

const SHOTS_DIR = process.env.TVASHTR_RESUME_RUN_SHOTS_DIR ?? "/tmp/tvashtr_resume_run_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia_nim: "NVIDIA_BUILD_API_KEY",
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const uuids = (url: string): string[] => url.match(UUID) ?? [];

async function runStatus(api: APIRequestContext, runId: string): Promise<string> {
  const res = await api.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

async function waitFor(
  api: APIRequestContext,
  runId: string,
  wanted: string,
  minutes: number,
): Promise<string> {
  const deadline = Date.now() + minutes * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(api, runId);
    if (status === wanted || ["completed", "failed", "rejected", "cancelled"].includes(status))
      return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return status;
}

test("resume-run: a failed run picks up from Engineer, round 1 and ships", async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const email = `resume+${Date.now()}@tvashtr.local`;
  const reg = await page.request.post("/api/auth/register", {
    data: { email, password: "resume-run-pass" },
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
  console.log(`[resume-run-e2e] run_id = ${runId}`);

  // The forced failure: the PM writes the spec (a real model call), the gate is approved, the
  // Engineer's round 1 fails at once.
  expect(await waitFor(page.request, runId, "failed", 15), "the first run fails").toBe("failed");

  // The Failed callout offers Resume from the step that failed.
  const activity = page.getByRole("region", { name: "Activity" });
  const resume = activity.getByRole("button", { name: "Resume from Engineer, round 1" });
  await expect(resume).toBeVisible({ timeout: 60_000 });
  await activity.screenshot({ path: path.join(SHOTS_DIR, "failed-callout.png") });
  await resume.click();

  // The confirm dialog: what is kept, what runs again, then "Resume run".
  const confirm = page.getByRole("dialog", { name: "Resume from Engineer, round 1?" });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await expect(confirm.getByText("Runs again")).toBeVisible();
  await confirm.screenshot({ path: path.join(SHOTS_DIR, "confirm.png") });
  await confirm.getByRole("button", { name: "Resume run" }).click();

  // The resumed run opens: "Resumed from #n", the carried steps, the PM Carried over.
  await expect(page.getByText(/^Resumed from #\d+$/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => uuids(page.url()).includes(runId)).toBe(false);
  const ids = uuids(page.url());
  const newRunId = ids[ids.length - 1];
  expect(newRunId && newRunId !== runId, "the view moved to the new run").toBeTruthy();
  console.log(`[resume-run-e2e] resumed run_id = ${newRunId}`);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByText("Carried over").first()).toBeVisible({ timeout: 60_000 });
  await expect(activity.getByText(/from run #\d+/).first()).toBeVisible();
  await now.screenshot({ path: path.join(SHOTS_DIR, "resumed-now-bar.png") });

  // It ships: the Engineer runs for real (round 1 again), the reviewer approves, Done.
  expect(await waitFor(page.request, newRunId, "completed", 20), "the resumed run ships").toBe(
    "completed",
  );
  await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("region", { name: "Run summary" })
    .screenshot({ path: path.join(SHOTS_DIR, "resumed-done.png") });

  // The carried PM never ran again in the new run: no step of its own, a carried card instead.
  const graph = (await (await page.request.get(`/api/runs/${newRunId}/graph`)).json()) as {
    nodes: { role_name: string; invocations: unknown[]; carried: { text: string } | null }[];
  };
  const pm = graph.nodes.find((n) => n.role_name === "pm");
  expect(pm?.invocations ?? ["missing"]).toEqual([]);
  expect(pm?.carried?.text).toMatch(/^From run #\d+$/);
  const engineer = graph.nodes.find((n) => n.role_name === "engineer");
  expect((engineer?.invocations ?? []).length).toBeGreaterThan(0);
  console.log("[resume-run-e2e] failed → Resume → carried PM + approval → Engineer ran → Done");
});

import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { runFromCanvas } from "./_composer";
import { openMyTeam } from "./_myTeam";

// MA ruling R19 live FE proof: a REAL local run whose Engineer waits like a model that never
// answers (TVASHTR_FORCE_HANG_ROLE=engineer — never in a resumed run) is stopped from Home ›
// Running now (the Stop dialog now says "You can resume it later from the step it stopped at.").
// The stopped run's view pins "You stopped this run at …" with "Resume from <step>", which opens
// the "Resume run #n" pick panel; Resume from here → the confirm → Resume run. The resumed run says
// "Resumed from #n", runs the Engineer for real and reaches Done. The stopped run never joins Needs
// you. Element screenshots only (the React Flow a11y tree wedges whole-tree snapshots).

const SHOTS_DIR =
  process.env.TVASHTR_RESUME_STOPPED_SHOTS_DIR ?? "/tmp/tvashtr_resume_stopped_shots";
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

async function waitFor(api: APIRequestContext, runId: string, wanted: string, minutes: number) {
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

/** Wait until the Engineer's step is open (the forced hang has begun). */
async function engineerWorking(api: APIRequestContext, runId: string, minutes: number) {
  const deadline = Date.now() + minutes * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await api.get(`/api/runs/${runId}/activity`);
    if (res.ok()) {
      const act = (await res.json()) as { agents: { label: string; live_state: string }[] };
      const eng = act.agents.find((a) => a.label === "Engineer");
      if (eng && ["working", "quiet", "stalled"].includes(eng.live_state)) return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

test("resume-stopped: a stopped run picks up from the step it stopped at and ships", async ({
  page,
}) => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;

  const reg = await api.post("/api/auth/register", {
    data: { email: `stopped+${Date.now()}@tvashtr.local`, password: "resume-stopped-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  const seeded = await api.post("/api/providers", { data: { provider: PROVIDER, api_key: key } });
  expect(seeded.ok(), `seed the ${PROVIDER} key (the pre-flight needs it)`).toBeTruthy();

  const team = await openMyTeam(page);
  await expect(page.locator(".react-flow__node", { hasText: "Engineer" }).first()).toBeVisible({
    timeout: 30_000,
  });
  const { runId } = await runFromCanvas(page, { teamName: "My team", openRun: false });
  console.log(`[resume-stopped-e2e] run_id = ${runId}`);
  expect(await engineerWorking(api, runId, 15), "the Engineer's step opened").toBe(true);

  // Stop it from Home › Running now: the dialog's last line is R19's.
  await page.goto("/#/");
  const running = page.getByRole("region", { name: "Running now" });
  const card = running.getByRole("article", { name: /^My team:/ }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Stop", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Stop this run?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("You can resume it later from the step it stopped at.");
  await expect(dialog).not.toContainText("You can’t resume a stopped run.");
  await dialog.screenshot({ path: path.join(SHOTS_DIR, "stop-dialog.png") });
  await dialog.getByRole("button", { name: "Stop run" }).click();
  expect(await waitFor(api, runId, "cancelled", 2), "the run is stopped").toBe("cancelled");

  // Stopped runs don't join Needs you.
  const inbox = (await (await api.get("/api/inbox")).json()) as { items: unknown[] };
  expect(inbox.items.filter((i) => JSON.stringify(i).includes(runId))).toEqual([]);

  // The stopped run's view pins Resume from the step it stopped at.
  await page.goto(`/#/teams/${team}/runs/${runId}`);
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity.getByText(/^You stopped this run at Engineer/)).toBeVisible({
    timeout: 60_000,
  });
  const resume = activity.getByRole("button", { name: /^Resume from Engineer/ });
  await expect(resume).toBeVisible();
  await activity.screenshot({ path: path.join(SHOTS_DIR, "stopped-callout.png") });
  await resume.click();

  // The pick panel (same as a failed run's), then the confirm.
  const pick = page.getByRole("complementary", { name: /^Resume run #\d+$/ });
  await expect(pick).toBeVisible({ timeout: 30_000 });
  await pick.screenshot({ path: path.join(SHOTS_DIR, "pick.png") });
  await pick
    .getByRole("button", { name: /Resume from here/ })
    .first()
    .click();
  const confirm = page.getByRole("dialog", { name: /^Resume from Engineer/ });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.screenshot({ path: path.join(SHOTS_DIR, "confirm.png") });
  await confirm.getByRole("button", { name: "Resume run" }).click();

  // The resumed run opens and ships: the Engineer runs for real this time.
  await expect(page.getByText(/^Resumed from #\d+$/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => uuids(page.url()).includes(runId)).toBe(false);
  const ids = uuids(page.url());
  const newRunId = ids[ids.length - 1];
  expect(newRunId && newRunId !== runId, "the view moved to the new run").toBeTruthy();
  console.log(`[resume-stopped-e2e] resumed run_id = ${newRunId}`);
  expect(await waitFor(api, newRunId, "completed", 20), "the resumed run ships").toBe("completed");
  await expect(page.getByRole("region", { name: "Run summary" })).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("region", { name: "Run summary" })
    .screenshot({ path: path.join(SHOTS_DIR, "resumed-done.png") });
  console.log("[resume-stopped-e2e] stopped → Resume from its step → pick → confirm → Done");
});

import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { runFromCanvas } from "./_composer";
import { openMyTeam } from "./_myTeam";

// M7 FE proof (brief §4 M7): a REAL local run of a review_loop team (forced reviewer-approve on
// round 1, no LLM call for it) gives the Reviewer a round; the team drawer's Reviewer › Runs ›
// round ⋯ › Make this a test opens the New test dialog, where the prefilled check is removed and a
// Must not say "banana-split-xyz" (always met) added; a second test is made through the API with
// Must say "banana-split-xyz" (never met). Run all 2 replays only the Reviewer (real LLM calls on the
// owner's key) and the tab shows one Passed and one Failed whose detail reads
// "Must say: banana-split-xyz · not met". Element screenshots only (React Flow's a11y tree wedges
// whole-tree snapshots).

const SHOTS_DIR = process.env.TVASHTR_AGENT_TESTS_SHOTS_DIR ?? "/tmp/tvashtr_agent_tests_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia_nim: "NVIDIA_BUILD_API_KEY",
};
const NEVER = "banana-split-xyz";

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function runStatus(api: APIRequestContext, runId: string): Promise<string> {
  const res = await api.get(`/api/runs/${runId}`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { run?: { status?: string } | null };
  return body?.run?.status ?? "";
}

/** Poll until the run is terminal (or the minutes run out); returns its last status. */
async function terminal(api: APIRequestContext, runId: string, minutes: number): Promise<string> {
  const deadline = Date.now() + minutes * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    status = await runStatus(api, runId);
    if (["completed", "failed", "rejected", "cancelled"].includes(status)) return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return status;
}

/** Poll the Tests tab's data until its newest run has ended. */
async function testsEnded(api: APIRequestContext, base: string, minutes: number): Promise<string> {
  const deadline = Date.now() + minutes * 60 * 1000;
  let status = "";
  while (Date.now() < deadline) {
    const body = (await (await api.get(base)).json()) as { run?: { status?: string } | null };
    status = body.run?.status ?? "";
    if (status && status !== "running") return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return status;
}

async function drawerOn(page: Page, team: string, node: string, tab: string): Promise<Locator> {
  await page.goto(`/#/teams/${team}?node=${node}&tab=${tab}`);
  const drawer = page.getByRole("complementary", { name: "Reviewer settings" });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  return drawer;
}

test("agent tests: make a test from a round, run both, see pass and fail", async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  const shot = (loc: Locator, name: string) =>
    loc.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });

  const reg = await api.post("/api/auth/register", {
    data: { email: `tests+${Date.now()}@tvashtr.local`, password: "agent-tests-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  await json(await api.post("/api/providers", { data: { provider: PROVIDER, api_key: key } }));

  // A real run gives the Reviewer a round to test.
  const team = await openMyTeam(page);
  await expect(page.locator(".react-flow__node", { hasText: "Reviewer" }).first()).toBeVisible({
    timeout: 30_000,
  });
  const { runId } = await runFromCanvas(page, {
    teamName: "My team",
    idea: "Create hello.py that prints hello",
    openRun: false,
  });
  console.log(`[agent-tests-e2e] run_id = ${runId}`);
  expect(await terminal(api, runId, 15), "the run ships").toBe("completed");

  const graph = await json<{ nodes: { id: string; role_name: string }[] }>(
    await api.get(`/api/teams/${team}/graph`),
  );
  const rev = graph.nodes.find((n) => n.role_name === "reviewer")!.id;
  const base = `/api/teams/${team}/nodes/${rev}/tests`;
  const runs = await json<{ run: { rounds: { invocation_id: number; iteration: number }[] } }>(
    await api.get(`/api/teams/${team}/nodes/${rev}/runs`),
  );
  const round1 = runs.run.rounds.find((r) => r.iteration === 1)!;
  expect(round1, "the Reviewer has a round 1").toBeTruthy();

  // Team drawer › Reviewer › Runs › round ⋯ › Make this a test.
  let drawer = await drawerOn(page, team, rev, "runs");
  const more = drawer.getByRole("button", { name: "More for round 1" });
  await expect(more).toBeVisible({ timeout: 30_000 });
  await more.click();
  const menu = drawer.getByRole("menu", { name: "More for round 1" });
  await shot(drawer, "round-menu");
  await menu.getByRole("menuitem", { name: /Make this a test/ }).click();
  const dialog = page.getByRole("dialog", { name: "New test from round 1" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Test name").fill("Never says banana");
  // The prefilled verdict check depends on the real answer: drop it for a check that always holds.
  const prefilled = dialog.getByRole("button", { name: "Remove Must say" });
  if (await prefilled.count()) await prefilled.first().click();
  await dialog.getByRole("button", { name: "Add a check" }).click();
  await page.getByRole("menuitem", { name: /Must not say/ }).click();
  await dialog.getByLabel("Must not say").fill(NEVER);
  await shot(dialog, "new-test");
  await dialog.getByRole("button", { name: "Save test" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // A second test, through the API, that can't pass.
  await json(
    await api.post(base, {
      data: {
        invocation_id: round1.invocation_id,
        name: "Says banana",
        checks: [{ kind: "must_say", value: NEVER }],
      },
    }),
  );

  // Run all 2, and wait for the replays (real model calls on the owner's key).
  drawer = await drawerOn(page, team, rev, "tests");
  await expect(drawer.getByText("2 tests")).toBeVisible({ timeout: 30_000 });
  await shot(drawer, "tests-list");
  await drawer.getByRole("button", { name: "Run all 2" }).click();
  // Running (or waiting for a slot) right away; shot when it shows.
  await drawer
    .getByText(/^Running \d of 2|^Waiting to start/)
    .waitFor({ timeout: 30_000 })
    .then(() => shot(drawer, "tests-running"))
    .catch(() => undefined);
  expect(await testsEnded(api, base, 10), "the test run ends").toBe("done");

  // One passed, one failed, and why.
  await expect(drawer.getByText(/1 of 2 passed/)).toBeVisible({ timeout: 30_000 });
  const rows = drawer.getByRole("list", { name: "Tests" }).getByRole("listitem");
  const passed = rows.filter({ hasText: "Never says banana" });
  const failed = rows.filter({ hasText: "Says banana" }).filter({ hasNotText: "Never" });
  await expect(passed.getByText("Passed")).toBeVisible();
  await expect(failed.getByText("Failed")).toBeVisible();
  await expect(failed).toContainText(`Must say: ${NEVER} · not met`);
  await shot(drawer, "tests-results");
  console.log(
    "[agent-tests-e2e] a test from a round + one from the API → Run all 2 → 1 passed, 1 failed",
  );
});

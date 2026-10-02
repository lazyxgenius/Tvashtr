import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { openMyTeam } from "./_myTeam";

// M8 live FE proof (brief §4 M8, ruling R5): a review_loop team saved as v1 and v2 (v2 changes the
// Reviewer's instructions) is compared from the canvas header's Compare: v1 vs v2 on one task in the
// LOCAL sandbox, both lanes run at once, gates approved by the compare itself (no global
// auto-approve), the results table reads back, and neither side ships (no pull request). Element
// screenshots only (the React Flow a11y tree wedges whole-tree snapshots).

const SHOTS_DIR = process.env.TVASHTR_COMPARE_SHOTS_DIR ?? "/tmp/tvashtr_compare_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia_nim: "NVIDIA_BUILD_API_KEY",
};
const TASK = "Create hello.py that prints hello";

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

interface Side {
  label: string;
  version: number;
  run_id: string | null;
  status: string;
}

test("compare: v1 vs v2 on one task — both lanes, results, nothing ships", async ({ page }) => {
  test.setTimeout(40 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  const shot = (name: string) => path.join(SHOTS_DIR, `${name}.png`);

  const reg = await api.post("/api/auth/register", {
    data: { email: `compare+${Date.now()}@tvashtr.local`, password: "compare-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  await json(await api.post("/api/providers", { data: { provider: PROVIDER, api_key: key } }));

  // Two versions: v1 as the template made it, v2 with the Reviewer's instructions changed.
  const team = await openMyTeam(page);
  await json(await api.get(`/api/teams/${team}/versions`)); // v1 (lazy)
  const graph = await json<{
    nodes: { id: string; role_name: string; prompt: string; model: string }[];
  }>(await api.get(`/api/teams/${team}/graph`));
  const reviewer = graph.nodes.find((n) => n.role_name === "reviewer")!;
  await json(
    await api.patch(`/api/teams/${team}/nodes/${reviewer.id}`, {
      data: {
        prompt: `${reviewer.prompt}\nBe strict: every change needs a test.`,
        model: reviewer.model,
      },
    }),
  );
  const saved = await json<{ number: number }>(
    await api.post(`/api/teams/${team}/versions`, { data: {} }),
  );
  expect(saved.number, "v2 saved").toBe(2);

  // Canvas header › Compare opens "Compare versions" on previous (v1) vs current (v2).
  await page.goto(`/#/teams/${team}`);
  const toolbar = page.getByRole("toolbar", { name: "Team" });
  await toolbar.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "Run the same task on two versions" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Version A" })).toHaveValue("1");
  await expect(page.getByRole("combobox", { name: "Version B" })).toHaveValue("2");
  await page.getByRole("textbox", { name: "Task" }).fill(TASK);
  await expect(page.getByRole("checkbox", { name: /Approve gates automatically/ })).toBeChecked();
  await page.locator("main").screenshot({ path: shot("start") });
  await page.getByRole("button", { name: "Start compare" }).click();

  // Running: both lanes at once.
  await expect(page.getByRole("heading", { name: /^v1 and v2 on/ })).toBeVisible({
    timeout: 60_000,
  });
  const id = page.url().match(/\/compare\/([0-9a-f-]{36})/)?.[1];
  expect(id, "the page moved to the compare").toBeTruthy();
  await expect(page.getByRole("region", { name: "Version A" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Version B" })).toBeVisible();
  await page.locator("main").screenshot({ path: shot("running") });

  const deadline = Date.now() + 30 * 60 * 1000;
  let body = await json<{ status: string; sides: Side[] }>(await api.get(`/api/compares/${id}`));
  while (Date.now() < deadline && ["waiting", "running"].includes(body.status)) {
    await new Promise((r) => setTimeout(r, 4000));
    body = await json(await api.get(`/api/compares/${id}`));
  }
  expect(body.status, "the compare finished").toBe("finished");

  // Results.
  const results = page.getByRole("table", { name: "Results" });
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(results.getByRole("row", { name: /^Result/ })).toBeVisible();
  await page.locator("main").screenshot({ path: shot("results") });

  // Each side ran on its own version, finished, and opened no pull request.
  const runs = await Promise.all(
    body.sides.map(async (s) => {
      const r = await json<{
        run: { status: string; pr_url: string | null; team_version_number: number | null };
      }>(await api.get(`/api/runs/${s.run_id}`));
      return [s.version, r.run] as const;
    }),
  );
  expect(runs.map(([v, r]) => [v, r.team_version_number, r.status, r.pr_url])).toEqual([
    [1, 1, "completed", null],
    [2, 2, "completed", null],
  ]);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("toolbar", { name: "Team" })).toBeVisible({ timeout: 30_000 });
  console.log("[compare-e2e] v1 vs v2 → both lanes → results → no PR on either side");
});

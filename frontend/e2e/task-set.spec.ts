import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { openMyTeam } from "./_myTeam";

// M9 live FE proof (brief §4 M9, rulings R11, R12): a review_loop team saved as v1 and v2, a task set
// of two tasks made in the Task sets tab (each with a hidden check), then a compare of v1 vs v2 on the
// set in the LOCAL sandbox: four runs, each followed by its hidden check (the first always passes,
// the second always fails with "signal line missing"), the set table and the summary cards read
// back, and nothing ships. The checks' commands carry a marker the driver then looks for in every
// table an agent can read (R11).

const SHOTS_DIR = process.env.TVASHTR_COMPARE_SHOTS_DIR ?? "/tmp/tvashtr_task_set_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia_nim: "NVIDIA_BUILD_API_KEY",
};
const MARKER = process.env.TVASHTR_HIDDEN_MARKER ?? "TVHIDDEN_M9";
const TASKS = [
  { task: "Create hello.py that prints hello", check: `test -d . # ${MARKER}` },
  {
    task: "Create bye.py that prints bye",
    check: `echo ${MARKER}; echo "signal line missing"; exit 1`,
  },
];

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

interface Cell {
  run_id: string | null;
  status: string;
  check: "passed" | "failed" | null;
  note: string | null;
}
interface SetCompare {
  status: string;
  started: number;
  items: { task: string; a: Cell; b: Cell }[];
  results: { cards?: { key: string; a: string; b: string }[] } | null;
}

test("task set: v1 vs v2 on a set of two — hidden checks, the set table, the cards", async ({
  page,
}) => {
  test.setTimeout(45 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  const shot = (name: string) => path.join(SHOTS_DIR, `${name}.png`);

  const reg = await api.post("/api/auth/register", {
    data: { email: `taskset+${Date.now()}@tvashtr.local`, password: "taskset-pass" },
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
  await json(await api.post(`/api/teams/${team}/versions`, { data: {} }));

  // Compare › Task sets › New task set: two tasks, each with its hidden check.
  await page.goto(`/#/teams/${team}`);
  const toolbar = page.getByRole("toolbar", { name: "Team" });
  await toolbar.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compare versions" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("tab", { name: /Task sets/ }).click();
  await page.getByRole("button", { name: "New task set" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Greetings");
  for (const [i, t] of TASKS.entries()) {
    await dialog.getByRole("button", { name: "Add a task" }).click();
    await dialog.getByRole("textbox", { name: "Task", exact: true }).nth(i).fill(t.task);
    await dialog.getByRole("textbox", { name: "Hidden check" }).nth(i).fill(t.check);
  }
  await dialog.screenshot({ path: shot("set-edit") });
  await dialog.getByRole("button", { name: "Save set" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("Greetings").first()).toBeVisible();
  await page.locator("main").screenshot({ path: shot("set-list") });

  // Compare tab: Run them on › A task set, then Start compare.
  await page.getByRole("tab", { name: /^Compare/ }).click();
  await page.getByRole("radio", { name: "A task set" }).click();
  await expect(page.getByRole("list", { name: "Tasks in Greetings" })).toBeVisible();
  await page.locator("main").screenshot({ path: shot("start-set") });
  await page.getByRole("button", { name: "Start compare" }).click();

  await expect(page.getByRole("heading", { name: /^v1 and v2 on Greetings/ })).toBeVisible({
    timeout: 60_000,
  });
  const id = page.url().match(/\/compare\/([0-9a-f-]{36})/)?.[1];
  expect(id, "the page moved to the compare").toBeTruthy();
  await expect(page.getByRole("table", { name: "Tasks" })).toBeVisible();
  await page.locator("main").screenshot({ path: shot("running") });

  const deadline = Date.now() + 35 * 60 * 1000;
  let body = await json<SetCompare>(await api.get(`/api/compares/${id}`));
  while (Date.now() < deadline && ["waiting", "running"].includes(body.status)) {
    await new Promise((r) => setTimeout(r, 4000));
    body = await json(await api.get(`/api/compares/${id}`));
  }
  expect(body.status, "the compare finished").toBe("finished");
  expect(body.started, "all four runs started").toBe(4);

  // The hidden checks: task 1 passes on both sides, task 2 fails on both with its last line.
  expect(body.items.map((it) => [it.task, it.a.check, it.b.check])).toEqual([
    [TASKS[0].task, "passed", "passed"],
    [TASKS[1].task, "failed", "failed"],
  ]);
  expect([body.items[1].a.note, body.items[1].b.note]).toEqual([
    "signal line missing",
    "signal line missing",
  ]);
  const checks = body.results?.cards?.find((c) => c.key === "checks");
  expect([checks?.a, checks?.b]).toEqual(["1 of 2", "1 of 2"]);

  // Results: the four cards and the table, on the page.
  const results = page.getByRole("table", { name: "Results" });
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("group", { name: "Hidden checks passed" })).toBeVisible();
  await expect(results.getByRole("row", { name: new RegExp(`^${TASKS[1].task}`) })).toContainText(
    "signal line missing",
  );
  await page.locator("main").screenshot({ path: shot("results") });

  // Every run ran its own version, finished, and opened no pull request.
  const runIds = body.items.flatMap((it) => [it.a.run_id, it.b.run_id]);
  const runs = await Promise.all(
    runIds.map(async (r) => {
      const x = await json<{
        run: { status: string; pr_url: string | null; team_version_number: number | null };
      }>(await api.get(`/api/runs/${r}`));
      return [x.run.team_version_number, x.run.status, x.run.pr_url];
    }),
  );
  expect(runs).toEqual([
    [1, "completed", null],
    [2, "completed", null],
    [1, "completed", null],
    [2, "completed", null],
  ]);
  fs.writeFileSync(path.join(SHOTS_DIR, "run_ids.txt"), runIds.join("\n"));
  console.log("[task-set-e2e] v1 vs v2 on a set of two → hidden checks → set table → cards");
});

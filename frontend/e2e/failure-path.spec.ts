import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";
import { openMyTeam } from "./_myTeam";

// M11 live FE proof (brief §4 M11, ruling R13): a review_loop team gains a gate "Ask me what to do"
// and a Stop, wired as the Engineer's failure path ("If it fails or times out"). The canvas draws it
// and its edge menu shows the choice; a run whose Engineer fails at once (the forced-failure harness,
// no LLM call) does NOT fail: the walk takes the failure path, the run waits at the gate (Needs you)
// with the Activity line saying so; approving the gate ends the run at Stop, never Failed. LOCAL
// sandbox. Element screenshots only (the React Flow a11y tree wedges whole-tree snapshots).

const SHOTS_DIR = process.env.TVASHTR_COMPARE_SHOTS_DIR ?? "/tmp/tvashtr_failure_path_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "deepseek";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia_nim: "NVIDIA_BUILD_API_KEY",
};
const GATE = "Ask me what to do";

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test("failure path: the Engineer fails, the run takes its failure path to a gate instead of failing", async ({
  page,
}) => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  const shot = (name: string) => path.join(SHOTS_DIR, `${name}.png`);

  const reg = await api.post("/api/auth/register", {
    data: { email: `failpath+${Date.now()}@tvashtr.local`, password: "failpath-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  await json(await api.post("/api/providers", { data: { provider: PROVIDER, api_key: key } }));

  // The team: the Engineer's failure path → "Ask me what to do" → Stop.
  const team = await openMyTeam(page);
  const graph = await json<{ nodes: { id: string; role_name: string }[] }>(
    await api.get(`/api/teams/${team}/graph`),
  );
  const engineer = graph.nodes.find((n) => n.role_name === "engineer")!;
  const gate = await json<{ id?: string; node?: { id: string } }>(
    await api.post(`/api/teams/${team}/nodes`, {
      data: { node_kind: "gate", title: GATE, position: { x: 620, y: 360 } },
    }),
  );
  const gateId = gate.id ?? gate.node?.id ?? "";
  const stop = await json<{ id?: string; node?: { id: string } }>(
    await api.post(`/api/teams/${team}/nodes`, {
      data: { node_kind: "terminal", terminal_kind: "stop", position: { x: 860, y: 360 } },
    }),
  );
  const stopId = stop.id ?? stop.node?.id ?? "";
  await json(
    await api.post(`/api/teams/${team}/edges`, {
      data: { source_node_id: engineer.id, target_node_id: gateId, role: "failure" },
    }),
  );
  await json(
    await api.post(`/api/teams/${team}/edges`, {
      data: { source_node_id: gateId, target_node_id: stopId, role: "forward" },
    }),
  );
  const valid = await json<{ runnable: boolean; errors: unknown[] }>(
    await api.get(`/api/teams/${team}/validate`),
  );
  expect(valid.errors, "the team with a failure path is runnable").toEqual([]);

  // The canvas draws the path and its menu shows the choice (Cnv-FailPath).
  await page.goto(`/#/teams/${team}`);
  const label = page.getByText("If it fails or times out").first();
  await expect(label).toBeVisible({ timeout: 30_000 });
  // The label lets clicks through to its path (pointer-events: none): click the path under it.
  const box = (await label.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Use this path…");
  await expect(menu).toContainText("Time limit");
  await page.locator("main").screenshot({ path: shot("canvas-menu") });
  await page.keyboard.press("Escape");

  // A run whose Engineer fails in round 1 (forced, no LLM): the spec gate is approved by a person.
  const run = await json<{ run_id: string }>(
    await api.post("/api/runs", {
      data: { idea: "Create hello.py that prints hello", team_graph_id: team },
    }),
  );
  const runId = run.run_id;
  const status = async () =>
    (await json<{ run: { status: string } }>(await api.get(`/api/runs/${runId}`))).run.status;
  const pending = async () =>
    (
      await json<{ tasks: { id: number; status: string; title: string }[] }>(
        await api.get(`/api/runs/${runId}/tasks`),
      )
    ).tasks.filter((t) => t.status === "pending");
  await expect.poll(status, { timeout: 12 * 60 * 1000, intervals: [3000] }).toBe("awaiting_human");
  const spec = (await pending())[0];
  await json(
    await api.post(`/api/runs/${runId}/tasks/${spec.id}/resolve`, {
      data: { decision: "approve", note: null },
    }),
  );

  // The Engineer fails; the run waits at "Ask me what to do" instead of failing.
  await expect
    .poll(
      async () => {
        const s = await status();
        if (s === "failed") throw new Error("the run failed instead of taking its failure path");
        const tasks = s === "awaiting_human" ? await pending() : [];
        return tasks.some((t) => t.id !== spec.id);
      },
      { timeout: 10 * 60 * 1000, intervals: [3000] },
    )
    .toBe(true);
  const activity = await json<{ lines: { text: string }[] }>(
    await api.get(`/api/runs/${runId}/activity`),
  );
  expect(activity.lines.map((l) => l.text)).toContain(
    `The Engineer failed, so the run takes its failure path to ${GATE}`,
  );
  await page.goto(`/#/teams/${team}/runs/${runId}`);
  await expect(
    page.getByText(`The Engineer failed, so the run takes its failure path to ${GATE}`),
  ).toBeVisible({ timeout: 60_000 });
  await page.locator("main").screenshot({ path: shot("run-failure-path") });

  // Approving the gate ends the run at Stop — never Failed.
  const ask = (await pending()).find((t) => t.id !== spec.id)!;
  await json(
    await api.post(`/api/runs/${runId}/tasks/${ask.id}/resolve`, {
      data: { decision: "approve", note: null },
    }),
  );
  await expect
    .poll(status, { timeout: 5 * 60 * 1000, intervals: [3000] })
    .not.toMatch(/^(running|awaiting_human|pending)$/);
  expect(await status(), "the run ends at its path's Stop, not Failed").not.toBe("failed");
  console.log(
    `[failure-path-e2e] run ${runId}: Engineer failed → ${GATE} → Stop (${await status()})`,
  );
});

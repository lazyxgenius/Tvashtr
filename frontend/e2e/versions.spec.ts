import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { saveAgentPromptAndModel } from "./_canvas";

// M5 FE proof (brief §4 M5, ruling R3): a team at v7; the Engineer's instructions and model are edited
// in the drawer → the header chip says "2 changes since v7" → Save as v8 → History shows v8 → What
// changed shows the instructions diff → Restore v7 makes v9 = v7 → a run started now runs on v9 and
// its run bar says so. The run is stopped right after it starts (the proof is its version).

const SHOTS_DIR = process.env.TVASHTR_VERSIONS_SHOTS_DIR ?? "/tmp/tvashtr_versions_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};
const MODEL = process.env.TVASHTR_E2E_MODEL ?? "openai/gpt-4.1";
const LINE = "Always run the linter before you finish.";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
type Node = { id: string; role_name: string; prompt: string };
type Graph = { nodes: Node[] };

async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test("versions: 2 changes since v7 → Save as v8 → What changed → Restore v7 as v9 → a run on v9", async ({
  page,
}) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;

  const reg = await api.post("/api/auth/register", {
    data: { email: `versions+${Date.now()}@tvashtr.local`, password: "versions-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  await json(await api.post("/api/providers", { data: { provider: PROVIDER, api_key: key } }));

  // A team at v7: v1, then six saved edits (the Engineer's description).
  const { team_graph_id: team } = await json<{ team_graph_id: string }>(
    await api.post("/api/teams", {
      data: { template: "review_loop", name: "Indicator sprint team" },
    }),
  );
  await json(await api.get(`/api/teams/${team}/versions`));
  const graph = await json<Graph>(await api.get(`/api/teams/${team}/graph`));
  const engineer = graph.nodes.find((n) => n.role_name === "engineer")!;
  const original = engineer.prompt;
  for (let i = 2; i <= 7; i++) {
    await json(
      await api.patch(`/api/teams/${team}/nodes/${engineer.id}`, {
        data: { description: `Writes & ships it (${i})` },
      }),
    );
    await json(await api.post(`/api/teams/${team}/versions`, { data: {} }));
  }

  await page.goto(`/#/teams/${team}`);
  const chip = page.getByRole("button", { name: "Version history" });
  await expect(chip).toContainText("v7", { timeout: 30_000 });
  await expect(chip).toContainText("saved");

  // Edit the Engineer's instructions and model in the drawer → 2 changes since v7.
  await page.locator(".react-flow__node", { hasText: "Engineer" }).first().click();
  await saveAgentPromptAndModel(page, "Engineer", `${original}\n${LINE}`, MODEL);
  await expect(chip).toContainText("2 changes since v7", { timeout: 15_000 });
  await shot(page, "1-two-changes-since-v7");

  await page.getByRole("button", { name: "Save as v8" }).click();
  await expect(chip).toContainText("v8", { timeout: 15_000 });
  await expect(chip).toContainText("saved");

  // History shows v8; What changed shows the diff.
  await chip.click();
  const history = page.getByRole("complementary", { name: "History" });
  await expect(history).toBeVisible();
  const v8 = history.getByRole("listitem").filter({ hasText: "v8" }).first();
  await expect(v8).toContainText("Engineer: instructions and model changed");
  await shot(page, "2-history-v8");
  await v8.getByRole("button", { name: "What changed in v8" }).click();
  const changes = page.getByRole("dialog", { name: "What changed in v8" });
  await expect(changes).toBeVisible();
  await expect(changes).toContainText("Instructions");
  await expect(changes).toContainText(LINE);
  await expect(changes).toContainText("v8 is your current version");
  await shot(page, "3-what-changed-v8");
  await changes.getByRole("button", { name: "Close" }).last().click();

  // Restore v7 → v9 = v7.
  const v7 = history.getByRole("listitem").filter({ hasText: "v7" }).first();
  await v7.getByRole("button", { name: "Restore v7" }).click();
  const restore = page.getByRole("dialog", { name: "Restore v7?" });
  await expect(restore).toContainText("Restoring makes a new version, v9, that matches v7.");
  await shot(page, "4-restore-v7");
  await restore.getByRole("button", { name: "Restore as v9" }).click();
  await expect(chip).toContainText("v9", { timeout: 15_000 });
  const v9 = await json<{ summary: string }>(await api.get(`/api/teams/${team}/versions/9`));
  expect(v9.summary).toBe("Restored v7");
  const back = await json<Graph>(await api.get(`/api/teams/${team}/graph`));
  const eng9 = back.nodes.find((n) => n.id === engineer.id);
  expect(eng9?.prompt, "v9's Engineer has v7's instructions").toBe(original);

  // A run started now runs on v9, and its run bar says so.
  const launched = await json<{
    run_id: string;
    team_version_number: number;
    version_saved: boolean;
  }>(await api.post("/api/runs", { data: { idea: "Add an RSI indicator", team_graph_id: team } }));
  expect(launched.team_version_number).toBe(9);
  expect(launched.version_saved).toBe(false);
  await page.goto(`/#/teams/${team}/runs/${launched.run_id}`);
  const bar = page.getByRole("toolbar", { name: "Team" });
  await expect(bar.getByText("v9", { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, "5-run-on-v9");
  await api.post(`/api/runs/${launched.run_id}/cancel`);
});

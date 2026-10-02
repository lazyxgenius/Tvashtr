import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { composer, ideaBox } from "./_composer";

// M6 FE proof (brief §4 M6, ruling R4): the Reviewer of one team is saved as "Strict reviewer"
// (drawer › More actions › Save as my agent); another team's Reviewer uses it from Instructions ›
// Templates › My agents at once, with Undo; used again, then Detach; the first team saves it again
// (v2) and Toolkit › My agents shows the other team on v1 with "Update Bugfix squad". Home's
// composer shows Recent tasks as you type; picking one fills the task and its team.

const SHOTS_DIR = process.env.TVASHTR_MY_AGENTS_SHOTS_DIR ?? "/tmp/tvashtr_my_agents_shots";
const PROVIDER = process.env.TVASHTR_E2E_PROVIDER ?? "openai";
const KEY_ENV: Record<string, string> = { openai: "OPENAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const STRICT = "You are a strict Reviewer. Fail the round if any new indicator isn't registered.";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
type Node = {
  id: string;
  role_name: string;
  prompt: string;
  config: Record<string, unknown> | null;
};

async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function reviewer(api: APIRequestContext, team: string): Promise<Node> {
  const graph = await json<{ nodes: Node[] }>(await api.get(`/api/teams/${team}/graph`));
  return graph.nodes.find((n) => n.role_name === "reviewer")!;
}

async function openReviewer(page: Page, team: string) {
  await page.goto(`/#/teams/${team}`);
  await page.locator(".react-flow__node", { hasText: "Reviewer" }).first().click();
  const drawer = page.getByRole("complementary", { name: "Reviewer settings" });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  return drawer;
}

test("my agents: save → use with Undo → Detach → v2 → Update; Recent tasks fill the composer", async ({
  page,
}) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  const reg = await api.post("/api/auth/register", {
    data: { email: `agents+${Date.now()}@tvashtr.local`, password: "my-agents-pass" },
  });
  expect(reg.ok(), "register a fresh account").toBeTruthy();
  const key = process.env[KEY_ENV[PROVIDER] ?? ""];
  expect(Boolean(key), `${KEY_ENV[PROVIDER]} present in the spec env`).toBeTruthy();
  await json(await api.post("/api/providers", { data: { provider: PROVIDER, api_key: key } }));

  const made = async (name: string) =>
    (
      await json<{ team_graph_id: string }>(
        await api.post("/api/teams", { data: { template: "review_loop", name } }),
      )
    ).team_graph_id;
  const teamA = await made("Indicator sprint team");
  const teamB = await made("Bugfix squad");
  const revA = await reviewer(api, teamA);
  await json(await api.patch(`/api/teams/${teamA}/nodes/${revA.id}`, { data: { prompt: STRICT } }));
  const revB = await reviewer(api, teamB);

  // 1. Save team A's Reviewer as "Strict reviewer" (v1).
  let drawer = await openReviewer(page, teamA);
  await drawer.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Save as my agent/ }).click();
  const save = page.getByRole("dialog", { name: "Save Reviewer as my agent" });
  await expect(save).toBeVisible();
  await save.getByLabel("Name").fill("Strict reviewer");
  await expect(save).toContainText("Saved as version 1");
  await shot(page, "1-save-dialog");
  await save.getByRole("button", { name: "Save to My agents" }).click();
  await expect(drawer).toContainText("Saved as Strict reviewer v1", { timeout: 15_000 });

  // 2. Team B's Reviewer uses it from Templates › My agents — at once, with Undo.
  drawer = await openReviewer(page, teamB);
  await drawer.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("menuitem", { name: /Strict reviewer/ }).click();
  await expect(drawer).toContainText("Reviewer now uses Strict reviewer v1", { timeout: 15_000 });
  await shot(page, "2-used-with-undo");
  expect((await reviewer(api, teamB)).prompt).toBe(STRICT);
  await drawer.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await reviewer(api, teamB)).prompt).toBe(revB.prompt);

  // 3. Use it again, then Detach: the parts stay, the link goes.
  await drawer.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("menuitem", { name: /Strict reviewer/ }).click();
  await expect(drawer).toContainText("Based on Strict reviewer v1", { timeout: 15_000 });
  await expect(drawer).toContainText("Its memory and routes stay with this team");
  await shot(page, "3-based-on");
  await drawer.getByRole("button", { name: "Detach" }).click();
  await expect(drawer).not.toContainText("Based on Strict reviewer v1", { timeout: 15_000 });
  const detached = await reviewer(api, teamB);
  expect(detached.prompt).toBe(STRICT);
  expect(detached.config?.based_on).toBeUndefined();

  // 4. Team B uses v1 again; team A saves v2; Toolkit › My agents brings team B up.
  const agents = await json<{ agents: { id: string; name: string }[] }>(
    await api.get("/api/my-agents"),
  );
  const strict = agents.agents.find((a) => a.name === "Strict reviewer")!;
  await json(
    await api.post(`/api/teams/${teamB}/nodes/${revB.id}/use-agent`, {
      data: { agent_id: strict.id },
    }),
  );
  await json(
    await api.patch(`/api/teams/${teamA}/nodes/${revA.id}`, {
      data: { prompt: `${STRICT}\nName the file and line for each problem.` },
    }),
  );
  await json(
    await api.post("/api/my-agents", {
      data: {
        team_id: teamA,
        node_id: revA.id,
        name: "Strict reviewer",
        include: ["instructions", "model", "skills_tools", "file_access"],
      },
    }),
  );
  await page.goto("/#/toolkit/agents");
  const card = page.getByRole("article").filter({ hasText: "Strict reviewer" });
  await expect(card).toContainText("1 team is on v1", { timeout: 30_000 });
  await shot(page, "4-library-behind");
  await card.getByRole("button", { name: "Update Bugfix squad" }).click();
  await expect
    .poll(
      async () => ((await reviewer(api, teamB)).config?.based_on as { version?: number })?.version,
    )
    .toBe(2);
  await expect(card).not.toContainText("1 team is on v1", { timeout: 15_000 });

  // 5. Home › Recent tasks: a task run on team A fills the composer with it and its team.
  const run = await json<{ run_id: string }>(
    await api.post("/api/runs", {
      data: { idea: "Add an RSI indicator", team_graph_id: teamA },
    }),
  );
  await api.post(`/api/runs/${run.run_id}/cancel`);
  await page.goto("/#/home");
  await ideaBox(page).click();
  await ideaBox(page).pressSequentially("Add an");
  const list = page.getByRole("listbox", { name: "Recent tasks" });
  await expect(list.getByRole("option", { name: /Add an RSI indicator/ })).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, "5-recent-tasks");
  await ideaBox(page).press("ArrowDown");
  await ideaBox(page).press("Enter");
  await expect(ideaBox(page)).toHaveValue("Add an RSI indicator");
  await expect(composer(page).locator(".hm-picker--team")).toContainText("Indicator sprint team");
  await expect(list).toBeHidden();
});

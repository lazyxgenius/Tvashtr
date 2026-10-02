import fs from "node:fs";
import path from "node:path";

import { type APIRequestContext, expect, test } from "@playwright/test";

// M10 live FE proof (brief §4 M10, ruling R9): the seeded operator runs a review_loop team on a
// real GitHub repo in the LOCAL sandbox (the Reviewer forced to approve round 1; the spec gate
// approved by a person, through the API, so the run has a decision) until it opens a pull request.
// Then, on that Done run: "Start the next run from this" → the dialog (what comes along, start
// from the pull request) → Start run → the new run shows "From run #N", its first Activity line
// and "See what came along"; its first agent's compiled context holds the carried parts (the
// manifest via /trajectory); its base is the pull request's branch. The new run is stopped (no
// second pull request). Last, the first run's ⋯ › Download the run log, both formats: no key or
// token in either. Element screenshots only (the React Flow a11y tree wedges whole-tree snapshots).

const SHOTS_DIR = process.env.TVASHTR_COMPARE_SHOTS_DIR ?? "/tmp/tvashtr_start_from_shots";
const EMAIL = process.env.TVASHTR_PROOF_EMAIL ?? "operator@tvashtr.local";
const PASSWORD = process.env.TVASHTR_PROOF_PASSWORD ?? "tvashtr-dev";
const REPO = process.env.TVASHTR_PROOF_REPO ?? "lazyxgenius/trade_mcp";
const SECRETS = [
  process.env.OPENAI_API_KEY,
  process.env.DEEPSEEK_API_KEY,
  process.env.GITHUB_TOKEN,
].filter((s): s is string => Boolean(s && s.length > 8));
const IDEA =
  "Add a file named NEXT_E2E.md at the repository root containing exactly one line: first run";
const NEXT = "Change NEXT_E2E.md so its one line reads exactly: second run, built on the first";

type Res = Awaited<ReturnType<APIRequestContext["get"]>>;
async function json<T>(res: Res): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

interface RunView {
  run: {
    id: string;
    status: string;
    number: number | null;
    pr_url: string | null;
    base_ref: string | null;
    ship_branch?: string | null;
    started_from?: { run_id: string; number: number; summary: string } | null;
  };
}

test("start from a run: Done → Start the next run from this → carried context → the run log", async ({
  page,
}) => {
  test.setTimeout(50 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const api = page.request;
  const shot = (name: string) => path.join(SHOTS_DIR, `${name}.png`);

  const login = await api.post("/api/auth/login", { data: { email: EMAIL, password: PASSWORD } });
  expect(login.status(), `POST /api/auth/login as ${EMAIL}`).toBe(200);
  const made = await json<{ team_graph_id: string }>(
    await api.post("/api/teams", {
      data: { template: "review_loop", name: `Next run ${Date.now()}` },
    }),
  );
  const team = made.team_graph_id;

  // The first run, on the repo, to a pull request; a person approves its gates (decisions).
  const first = await json<{ run_id: string }>(
    await api.post("/api/runs", { data: { idea: IDEA, team_graph_id: team, github_repo: REPO } }),
  );
  const id1 = first.run_id;
  const deadline = Date.now() + 30 * 60 * 1000;
  let view = await json<RunView>(await api.get(`/api/runs/${id1}`));
  while (Date.now() < deadline && !["completed", "failed", "cancelled"].includes(view.run.status)) {
    const tasks = await json<{ tasks: { id: number; status: string; kind: string }[] }>(
      await api.get(`/api/runs/${id1}/tasks`),
    );
    for (const t of tasks.tasks.filter((x) => x.status === "pending"))
      await api.post(`/api/runs/${id1}/tasks/${t.id}/resolve`, {
        data: { decision: "approve", note: null },
      });
    await new Promise((r) => setTimeout(r, 4000));
    view = await json(await api.get(`/api/runs/${id1}`));
  }
  expect(view.run.status, "the first run finished").toBe("completed");
  expect(view.run.pr_url, "the first run opened a pull request").toBeTruthy();
  const n1 = view.run.number;

  // Its Done summary offers the next run.
  await page.goto(`/#/teams/${team}/runs/${id1}`);
  const summary = page.getByRole("region", { name: "Run summary" });
  await expect(summary).toBeVisible({ timeout: 60_000 });
  await expect(summary.getByRole("link", { name: /^Open pull request/ })).toBeVisible();
  await summary.getByRole("button", { name: "Start the next run from this" }).click();
  const dialog = page.getByRole("dialog", { name: `Start a new run from run #${n1}` });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Left behind: the agents’ full conversations");
  await expect(dialog.getByRole("checkbox", { name: /^The final spec/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /^Your decisions/ })).toBeChecked();
  await dialog.getByLabel("What should the team do next?").fill(NEXT);
  await dialog.screenshot({ path: shot("carry") });
  await dialog.getByRole("button", { name: "Start run" }).click();

  // The new run: From run #N, the first Activity line, what came along.
  await expect
    .poll(() => page.url().match(/\/runs\/([0-9a-f-]{36})/)?.[1] ?? id1, { timeout: 60_000 })
    .not.toBe(id1);
  const id2 = page.url().match(/\/runs\/([0-9a-f-]{36})/)?.[1] ?? "";
  expect(id2 && id2 !== id1, "the page moved to the new run").toBeTruthy();
  await expect(page.getByRole("link", { name: `From run #${n1}` })).toBeVisible({
    timeout: 60_000,
  });
  // The Activity shows the last six lines: the first one may already be among the earlier steps.
  const earlier = page.getByRole("button", { name: /^Show \d+ earlier steps?$/ });
  if (await earlier.isVisible().catch(() => false)) await earlier.click();
  const startLine = page.getByText(new RegExp(`^Started from run #${n1} · brought `));
  await expect(startLine).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "See what came along" }).click();
  const along = page.getByRole("dialog", { name: `What came along from run #${n1}` });
  await expect(along).toBeVisible();
  await expect(along).toContainText("Spec approved");
  await along.screenshot({ path: shot("came-along") });
  await along.getByRole("button", { name: "Close" }).click();

  const next = await json<RunView>(await api.get(`/api/runs/${id2}`));
  expect(next.run.started_from?.number).toBe(n1);
  const firstRun = await json<RunView>(await api.get(`/api/runs/${id1}`));
  expect(next.run.base_ref, "the new run starts from the pull request's branch").toBe(
    firstRun.run.ship_branch,
  );

  // The first agent's compiled context names the carried parts (and only them from run #N).
  let parts: string[] = [];
  const ctxDeadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < ctxDeadline && !parts.includes("carried_spec")) {
    const traj = await json<{ rows?: { context_manifest?: { parts?: { name: string }[] } }[] }>(
      await api.get(`/api/runs/${id2}/trajectory`),
    );
    parts = (traj.rows ?? []).flatMap((i) => i.context_manifest?.parts?.map((p) => p.name) ?? []);
    if (!parts.includes("carried_spec")) await new Promise((r) => setTimeout(r, 5000));
  }
  expect(parts, "the carried parts are in the compiled context").toEqual(
    expect.arrayContaining(["carried_spec", "carried_decisions"]),
  );
  await page.locator("main").screenshot({ path: shot("next-run") });
  await api.post(`/api/runs/${id2}/cancel`); // no second pull request

  // The first run's ⋯ › Download the run log, both formats: no key or token in either.
  await page.goto(`/#/teams/${team}/runs/${id1}`);
  await page.getByRole("button", { name: "More for this run" }).click({ timeout: 60_000 });
  await page.getByRole("menuitem", { name: "Download the run log" }).click();
  const logDialog = page.getByRole("dialog", { name: "Download the run log" });
  await expect(logDialog).toBeVisible();
  await logDialog.screenshot({ path: shot("run-log") });
  for (const format of ["Readable text", "JSON lines"]) {
    await logDialog.getByRole("button", { name: format, exact: true }).click();
    await expect(logDialog.getByRole("button", { name: "Download", exact: true })).toBeEnabled({
      timeout: 30_000,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      logDialog.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    const file = path.join(SHOTS_DIR, download.suggestedFilename());
    await download.saveAs(file);
    const text = fs.readFileSync(file, "utf8");
    expect(text.length, `${format}: not empty`).toBeGreaterThan(200);
    for (const secret of SECRETS)
      expect(text.includes(secret), `${format}: a secret leaked`).toBe(false);
    if (format === "Readable text") expect(text).toContain(`run #${n1}`);
    else
      for (const line of text.trim().split("\n"))
        expect(() => JSON.parse(line) as unknown, "each JSON line parses").not.toThrow();
  }
  fs.writeFileSync(path.join(SHOTS_DIR, "runs.txt"), `${id1}\n${id2}\n`);
  console.log(
    `[start-from-e2e] run #${n1} → the next run ${id2} with carried context → the run log`,
  );
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { ideaBox, launchFromComposer, openComposerFromCanvas } from "./_composer";
import { registerFresh } from "./_home";

// Live FE proof for the ONE launch surface (was the M-brownfield Slice 2 launch panel; revamp round 1
// replaced it with Home's "Start a run" composer): clicking the canvas's "Run this team" OPENS the
// composer with the team picked (it does not fire the run); typing a REAL fixture repo path into the
// repo picker validates it through a live POST /api/repo/inspect and fills Options › Base branch;
// and the greenfield path ("No repo") still launches a run. Targeted selectors + element screenshots
// (NOT a whole-tree a11y snapshot — that wedges on the React Flow canvas, HANDOVER §4). The free-text
// repo path is the self-hosted posture, so scripts/launch_panel_e2e.sh pins TVASHTR_HOSTED_MODE=false.
// The greenfield run is cancelled straight away. The account holds a DUMMY deepseek key only so the
// composer's readiness check and the backend pre-flight let it start (deepseek serves both seats) —
// no real key or LLM is needed.

const SHOTS_DIR = process.env.TVASHTR_LAUNCH_SHOTS_DIR ?? "/tmp/tvashtr_launch_panel_shots";

// A tiny REAL git repo on a known branch — the backend's repo_inspect runs git against this path.
function makeFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tvashtr-launch-fixture-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "trunk");
  git("config", "user.email", "fixture@tvashtr.local");
  git("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  fs.writeFileSync(path.join(dir, "main.py"), "print('hi')\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

test("launch-panel: Run opens the composer, validates a real repo via inspect, fills the base branch, and greenfield still launches", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const fixture = makeFixtureRepo();

  try {
    await registerFresh(page, "launch-panel");
    const key = await page.request.post("/api/providers", {
      data: { provider: "deepseek", api_key: "dummy-deepseek-key-0000" },
    });
    expect(key.ok(), "store a dummy deepseek key").toBeTruthy();

    // Create a fresh team from Home's New team dialog (the review_loop template), so it opens on the
    // canvas runnable and "Run this team" enables.
    const teamName = `Launch-panel E2E ${Date.now()}`;
    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "New team", exact: true }).first().click();
    const picker = page.getByRole("dialog", { name: "New team" });
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await picker
      .locator("button.hm-tplcard", {
        has: page.locator(".hm-tplcard__name", { hasText: /^PM → Engineer ⇄ Reviewer$/ }),
      })
      .click();
    await picker.getByLabel("Name", { exact: true }).fill(teamName);
    await picker.getByRole("button", { name: "Create team" }).click();
    const teamId = ((await (await createResp).json()) as { team_graph_id: string }).team_graph_id;

    // "Run this team" is enabled (a runnable current team).
    const runBtn = page.getByRole("button", { name: "Run this team" });
    await expect(runBtn).toBeEnabled({ timeout: 30_000 });

    // CHECK 1 — clicking "Run this team" OPENS Home's composer with the team picked (no run fired).
    let launched = false;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/runs") && r.method() === "POST") launched = true;
    });
    const card = await openComposerFromCanvas(page, teamName);
    await expect(ideaBox(page)).toBeVisible();
    await card.screenshot({ path: path.join(SHOTS_DIR, "check1-panel-open.png") });
    expect(launched, "opening the composer does not launch a run").toBe(false);
    console.log("[launch-panel-e2e] CHECK 1 PASS — Run opened the composer with the team picked");

    // CHECK 2 — type the REAL fixture repo path into the repo picker, and assert the LIVE
    // POST /api/repo/inspect round-trip fills Options › Base branch with the repo's branch.
    const inspectResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/repo/inspect") && r.request().method() === "POST",
    );
    await card.locator(".hm-picker--repo").click();
    const repoPop = page.getByRole("dialog", { name: "Pick a repo" });
    await expect(repoPop).toBeVisible();
    const repoInput = repoPop.getByRole("textbox", { name: "Repository path" });
    await repoInput.fill(fixture);
    await repoInput.press("Enter");
    await expect(repoPop).toHaveCount(0);
    await expect(card.locator(".hm-picker--repo")).toContainText(fixture);

    const inspectJson = (await (await inspectResp).json()) as {
      is_git: boolean;
      current_branch?: string;
    };
    expect(inspectJson.is_git, "the fixture inspects as a git repo").toBe(true);
    expect(inspectJson.current_branch, "the fixture's current branch").toBe("trunk");

    await card.getByRole("button", { name: "Options", exact: true }).click();
    const options = page.getByRole("dialog", { name: "Run options" });
    const baseBranch = options.getByLabel("Base branch");
    await expect(baseBranch).toBeVisible({ timeout: 10_000 });
    await expect(baseBranch).toHaveValue("trunk"); // defaulted to the repo's current_branch
    await card.screenshot({ path: path.join(SHOTS_DIR, "check2-repo-validated.png") });
    await card.getByRole("button", { name: "Options", exact: true }).click();
    console.log(
      "[launch-panel-e2e] CHECK 2 PASS — inspect round-trip filled the base branch (trunk)",
    );

    // CHECK 3 — switch the target back to "No repo" and confirm the greenfield path still launches:
    // the POST body carries this team and the idea and NO repo target (the composer always sends an
    // idea — the old panel's "{ team_graph_id } only" body is gone with it), and "Open run" takes
    // the canvas over with the run view.
    await card.locator(".hm-picker--repo").click();
    await page
      .getByRole("dialog", { name: "Pick a repo" })
      .getByRole("option", { name: /No repo/ })
      .click();
    await expect(card.locator(".hm-picker--repo")).toContainText("No repo");
    const { runId, body: postBody } = await launchFromComposer(page);
    expect(postBody.team_graph_id, "the launch is for this team").toBe(teamId);
    expect(typeof postBody.idea, "the launch carries the idea").toBe("string");
    expect((postBody.idea as string).length, "the idea is non-empty").toBeGreaterThan(0);
    for (const k of ["github_repo", "repo_path", "local_repo", "base_ref", "subpath"]) {
      expect(postBody, `greenfield POST body carries no ${k}`).not.toHaveProperty(k);
    }
    expect(runId, "the greenfield launch returns a run_id").toBeTruthy();

    // The greenfield launch TOOK OVER: on the run's canvas the authoring "Run this team" control is
    // gone (replaced by the run view — "Running…" while in flight, "Edit this team" once terminal).
    await expect(page.getByRole("button", { name: "Run this team" })).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.screenshot({ path: path.join(SHOTS_DIR, "check3-greenfield-launched.png") });
    console.log(`[launch-panel-e2e] CHECK 3 PASS — greenfield launch run_id=${runId} (no target)`);

    // Clean citizen: cancel the run we started so no PENDING workflow lingers (best-effort).
    await page.request.post(`/api/runs/${runId}/cancel`).catch(() => {});

    expect(fs.existsSync(path.join(SHOTS_DIR, "check1-panel-open.png"))).toBe(true);
    expect(fs.existsSync(path.join(SHOTS_DIR, "check2-repo-validated.png"))).toBe(true);
    expect(fs.existsSync(path.join(SHOTS_DIR, "check3-greenfield-launched.png"))).toBe(true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

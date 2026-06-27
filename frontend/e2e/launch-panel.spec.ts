import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for the M-brownfield Slice 2 launch panel: clicking "Run this team" OPENS the panel
// (it does not fire the run); flipping "work on a local repo" + typing a REAL fixture repo path
// validates it through a live POST /api/repo/inspect and populates the base-branch dropdown; and the
// greenfield path (toggle Off) still launches a run. Targeted selectors + element screenshots (NOT a
// whole-tree a11y snapshot — that wedges on the React Flow canvas, HANDOVER §4). NO full agent run is
// driven from the browser — the backend brownfield-check + the greenfield smokes prove runs; this
// gate is the panel + the inspect wiring. No NVIDIA key needed.

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

test("launch-panel: opens, validates a real repo via inspect, populates the branch dropdown, and greenfield still launches", async ({
  page,
  request,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const fixture = makeFixtureRepo();

  try {
    await page.goto("/");

    // Create a fresh team (deterministic regardless of prior DB state — same template as the seeded
    // "My team"), so it becomes current + runnable and "Run this team" enables.
    const createResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /New team/ }).click();
    const picker = page.getByLabel("New team from a template");
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await picker.getByText("PM → Engineer ↔ Reviewer").click();
    await picker.getByRole("textbox").fill(`Launch-panel E2E ${Date.now()}`);
    await picker.getByRole("button", { name: "Create team" }).click();
    await createResp;

    // "Run this team" is enabled (a runnable current team).
    const runBtn = page.getByRole("button", { name: "Run this team" });
    await expect(runBtn).toBeEnabled({ timeout: 30_000 });

    // CHECK 1 — clicking "Run this team" OPENS the launch panel (it does NOT fire the run).
    await runBtn.click();
    const panel = page.getByRole("dialog", { name: "Launch run" });
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByLabel("Feature request")).toBeVisible();
    await panel.screenshot({ path: path.join(SHOTS_DIR, "check1-panel-open.png") });
    console.log("[launch-panel-e2e] CHECK 1 PASS — the launch panel opened");

    // CHECK 2 — flip "work on a local repo" On, type the REAL fixture repo path, and assert the
    // base-branch dropdown populates from the LIVE POST /api/repo/inspect round-trip.
    const inspectResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/repo/inspect") && r.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "On" }).click();
    const repoInput = panel.getByLabel("Repo path");
    await repoInput.fill(fixture);
    await repoInput.blur();

    const inspectJson = (await (await inspectResp).json()) as {
      is_git: boolean;
      current_branch?: string;
    };
    expect(inspectJson.is_git, "the fixture inspects as a git repo").toBe(true);
    expect(inspectJson.current_branch, "the fixture's current branch").toBe("trunk");

    const baseSelect = panel.getByLabel("Base branch");
    await expect(baseSelect).toBeVisible({ timeout: 10_000 });
    await expect(baseSelect).toHaveValue("trunk"); // defaulted to the repo's current_branch
    await panel.screenshot({ path: path.join(SHOTS_DIR, "check2-repo-validated.png") });
    console.log(
      "[launch-panel-e2e] CHECK 2 PASS — inspect round-trip populated the branch dropdown (trunk)",
    );

    // CHECK 3 — toggle the repo OFF and confirm the greenfield path still launches: the POST body is
    // exactly { team_graph_id } (the byte-for-byte contract) and the UI takes over with the run view.
    const startResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "Off" }).click();
    await panel.getByRole("button", { name: "Run", exact: true }).click();

    const startReq = (await startResp).request();
    const postBody = JSON.parse(startReq.postData() ?? "{}") as Record<string, unknown>;
    expect(Object.keys(postBody).sort(), "greenfield POST body is { team_graph_id } only").toEqual([
      "team_graph_id",
    ]);
    const startBody = (await (await startResp).json()) as { run_id: string };
    expect(startBody.run_id, "the greenfield launch returns a run_id").toBeTruthy();

    // The greenfield launch TOOK OVER: the authoring "Run this team" control is gone (replaced by
    // the run view — "Running…" while in flight, "Edit this team" once terminal). Asserting its
    // disappearance is deterministic regardless of how fast the run reaches a terminal state.
    await expect(page.getByRole("button", { name: "Run this team" })).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.screenshot({ path: path.join(SHOTS_DIR, "check3-greenfield-launched.png") });
    console.log(
      `[launch-panel-e2e] CHECK 3 PASS — greenfield launch run_id=${startBody.run_id} (no extra fields)`,
    );

    // Clean citizen: cancel the run we started so no PENDING workflow lingers (best-effort).
    await request.post(`/api/runs/${startBody.run_id}/cancel`).catch(() => {});

    expect(fs.existsSync(path.join(SHOTS_DIR, "check1-panel-open.png"))).toBe(true);
    expect(fs.existsSync(path.join(SHOTS_DIR, "check2-repo-validated.png"))).toBe(true);
    expect(fs.existsSync(path.join(SHOTS_DIR, "check3-greenfield-launched.png"))).toBe(true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

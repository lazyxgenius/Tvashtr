import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { ideaBox, openComposerFromCanvas, SKELETON_IDEA } from "./_composer";
import { registerFresh } from "./_home";
import { openMyTeam } from "./_myTeam";

// Live FE proof for the M-brownfield scoped-mount Slice 2 SCOPE PICKER, on the one launch surface
// revamp round 1 left: Home's "Start a run" composer. NO agent run, NO real LLM, .env-INDEPENDENT: it
// REGISTERS a fresh account, creates the review_loop "My team", opens the composer from the canvas,
// and drives the repo-inspect round-trip for a REAL multi-package fixture repo. Three checks, each
// with a screenshot (targeted selectors — NOT a full a11y snapshot, which wedges on the React Flow
// canvas, HANDOVER §4). The free-text repo path is the self-hosted posture, so
// scripts/scope_picker_e2e.sh pins TVASHTR_HOSTED_MODE=false.
//
//   1) "Run this team" OPENS the composer (it does not fire the run);
//   2) type the fixture path in the repo picker → the LIVE POST /api/repo/inspect fills Options ›
//      Base branch AND the Scope select (from the returned `subpaths`);
//   3) pick a package + Launch → the launch POST /api/runs body carries `subpath` (+ repo_path/
//      base_ref). The composer refuses a keyless launch before it sends anything, so the account
//      holds a DUMMY deepseek key and the harness answers the POST itself (a 422, like the old
//      keyless pre-flight) — NO run/agent starts, but the OUTGOING request proves the picker threaded
//      the scope (the whole point of this slice).

const SHOTS_DIR = process.env.TVASHTR_SCOPE_SHOTS_DIR ?? "/tmp/tvashtr_scope_picker_shots";

// A REAL git repo with two top-level packages (`api`, `core`) + a root file — the shape the Scope
// picker offers. The backend's repo_inspect / repo_subpaths run git against this path.
function makeMultiPackageRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tvashtr-scope-fixture-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "trunk");
  git("config", "user.email", "fixture@tvashtr.local");
  git("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(dir, "README.md"), "# fixture\n"); // a root file — never a subpath
  fs.mkdirSync(path.join(dir, "core"));
  fs.writeFileSync(path.join(dir, "core", "indicators.py"), "x = 1\n");
  fs.writeFileSync(path.join(dir, "core", "ema.py"), "y = 2\n");
  fs.mkdirSync(path.join(dir, "api"));
  fs.writeFileSync(path.join(dir, "api", "server.py"), "z = 3\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

test("scope-picker: inspect populates base-branch + Scope dropdowns; picking a package threads subpath", async ({
  page,
}) => {
  test.setTimeout(3 * 60 * 1000);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const fixture = makeMultiPackageRepo();

  try {
    // Register a fresh account via the API (its cookie carries to the page), give it a DUMMY
    // deepseek key (the composer's readiness check wants a key for the team's models; no request
    // ever reaches deepseek), then create + open the review_loop "My team" → the canvas.
    await registerFresh(page, "scope");
    const key = await page.request.post("/api/providers", {
      data: { provider: "deepseek", api_key: "dummy-deepseek-key-0000" },
    });
    expect(key.ok(), "store a dummy deepseek key").toBeTruthy();
    await openMyTeam(page);
    await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });

    // CHECK 1 — clicking "Run this team" OPENS the composer with the team picked (no run fired).
    const card = await openComposerFromCanvas(page, "My team");
    await card.screenshot({ path: path.join(SHOTS_DIR, "check1-panel-open.png") });
    console.log("[scope-picker-e2e] CHECK 1 PASS — Run opened the composer");

    // CHECK 2 — type the REAL fixture path into the repo picker, and assert the LIVE POST
    // /api/repo/inspect round-trip fills BOTH Options › Base branch AND the Scope select (from the
    // returned `subpaths`).
    const inspectResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/repo/inspect") && r.request().method() === "POST",
    );
    await card.locator(".hm-picker--repo").click();
    const repoInput = page
      .getByRole("dialog", { name: "Pick a repo" })
      .getByRole("textbox", { name: "Repository path" });
    await repoInput.fill(fixture);
    await repoInput.press("Enter");

    const inspectJson = (await (await inspectResp).json()) as {
      is_git: boolean;
      subpaths?: { path: string; file_count: number }[];
    };
    expect(inspectJson.is_git, "the fixture inspects as a git repo").toBe(true);
    expect(inspectJson.subpaths, "inspect returns the repo's top-level packages + counts").toEqual([
      { path: "api", file_count: 1 },
      { path: "core", file_count: 2 },
    ]);

    await card.getByRole("button", { name: "Options", exact: true }).click();
    const options = page.getByRole("dialog", { name: "Run options" });
    const baseBranch = options.getByLabel("Base branch");
    await expect(baseBranch).toBeVisible({ timeout: 10_000 });
    await expect(baseBranch).toHaveValue("trunk"); // defaulted to the repo's current branch

    const scopeSelect = options.getByLabel("Scope");
    await expect(scopeSelect).toBeVisible({ timeout: 10_000 });
    await expect(scopeSelect).toHaveValue(""); // Whole repo by default
    // The Scope options came from the LIVE inspect round-trip — "Whole repo" + one per package (the
    // composer lists each package by its path; the old panel's "(N files)" suffix is not drawn).
    await expect(scopeSelect.locator("option")).toHaveText(["Whole repo", "api", "core"], {
      timeout: 10_000,
    });
    await card.screenshot({ path: path.join(SHOTS_DIR, "check2-scope-populated.png") });
    console.log(
      "[scope-picker-e2e] CHECK 2 PASS — base branch + Scope filled from the live inspect",
    );

    // CHECK 3 — pick a package + Launch; the launch POST /api/runs body carries `subpath` (+
    // repo_path + base_ref). The harness answers the POST itself, so NO run/agent starts — but the
    // OUTGOING request proves the picker threaded the scope.
    await page.route("**/api/runs", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "scope-picker e2e: launch intercepted (no run)" }),
      });
    });
    await scopeSelect.selectOption("core");
    await ideaBox(page).fill(SKELETON_IDEA);
    const runReq = page.waitForRequest(
      (r) => r.url().endsWith("/api/runs") && r.method() === "POST",
    );
    await card.getByRole("button", { name: "Launch", exact: true }).click();

    const postBody = (await runReq).postDataJSON() as Record<string, unknown>;
    expect(postBody.subpath, "the launch options carry the picked package").toBe("core");
    expect(postBody.repo_path, "the brownfield repo_path is carried").toBe(fixture);
    expect(postBody.base_ref, "the base_ref is carried").toBe("trunk");
    await page.screenshot({ path: path.join(SHOTS_DIR, "check3-subpath-threaded.png") });
    console.log(
      `[scope-picker-e2e] CHECK 3 PASS — launch body carried subpath=${String(postBody.subpath)}`,
    );

    for (const f of [
      "check1-panel-open.png",
      "check2-scope-populated.png",
      "check3-subpath-threaded.png",
    ]) {
      expect(fs.existsSync(path.join(SHOTS_DIR, f)), `screenshot ${f} written`).toBe(true);
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

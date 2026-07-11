import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

// Live FE proof for the M-brownfield scoped-mount Slice 2 SCOPE PICKER. NO agent run, NO real LLM,
// .env-INDEPENDENT: it REGISTERS a fresh account (whose seeded starter team is the review_loop "My
// team"), opens the launch panel, and drives the repo-inspect round-trip for a REAL multi-package
// fixture repo. Three checks, each with a screenshot (targeted selectors — NOT a full a11y snapshot,
// which wedges on the React Flow canvas, HANDOVER §4).
//
//   1) "Run this team" OPENS the launch panel;
//   2) flip "work on a local repo" On + type the fixture path → the LIVE POST /api/repo/inspect
//      populates the base-branch dropdown AND the new Scope dropdown (from the returned `subpaths`);
//   3) pick a package + Run → the launch POST /api/runs body carries `subpath` (+ repo_path/base_ref).
//      The keyless fresh account 422s the create pre-flight, so NO run/agent starts — but the OUTGOING
//      request proves the picker threaded the scope (the whole point of this slice).

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
    // Register a fresh account via the API — this sets the session cookie on the page's context, so
    // we load the app already AUTHENTICATED (the F3/F4 reskin changed the marketing CTAs; auth has
    // its own e2e). A fresh account is seeded a starter review_loop team ("My team").
    const email = `scope+${Date.now()}@tvashtr.local`;
    const reg = await page.request.post("/api/auth/register", {
      data: { email, password: "scope-picker-pass" },
    });
    expect(reg.ok(), "register a fresh account").toBeTruthy();

    // Load authenticated → the dashboard → open the seeded team → the canvas.
    await page.goto("/");
    await page.getByRole("button", { name: "Open My team" }).click();
    await expect(page.getByText("the living canvas")).toBeVisible({ timeout: 30_000 });

    // CHECK 1 — clicking "Run this team" OPENS the launch panel (it does NOT fire the run).
    await page.getByRole("button", { name: "Run this team" }).click();
    const panel = page.getByRole("dialog", { name: "Launch run" });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.screenshot({ path: path.join(SHOTS_DIR, "check1-panel-open.png") });
    console.log("[scope-picker-e2e] CHECK 1 PASS — the launch panel opened");

    // CHECK 2 — flip "work on a local repo" On, type the REAL fixture path, and assert the LIVE POST
    // /api/repo/inspect round-trip populates BOTH the base-branch dropdown AND the new Scope dropdown
    // (from the returned `subpaths`).
    const inspectResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/repo/inspect") && r.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "On" }).click();
    const repoInput = panel.getByLabel("Repo path");
    await repoInput.fill(fixture);
    await repoInput.blur();

    const inspectJson = (await (await inspectResp).json()) as {
      is_git: boolean;
      subpaths?: { path: string; file_count: number }[];
    };
    expect(inspectJson.is_git, "the fixture inspects as a git repo").toBe(true);
    expect(inspectJson.subpaths, "inspect returns the repo's top-level packages + counts").toEqual([
      { path: "api", file_count: 1 },
      { path: "core", file_count: 2 },
    ]);

    const baseSelect = panel.getByLabel("Base branch");
    await expect(baseSelect).toBeVisible({ timeout: 10_000 });
    await expect(baseSelect).toHaveValue("trunk"); // defaulted to the repo's current branch

    const scopeSelect = panel.getByLabel("Scope");
    await expect(scopeSelect).toBeVisible({ timeout: 10_000 });
    await expect(scopeSelect).toHaveValue(""); // Whole repo by default
    // The Scope options came from the LIVE inspect round-trip — "Whole repo" + one per package.
    const optionTexts = (await scopeSelect.locator("option").allTextContents()).map((t) =>
      t.trim(),
    );
    expect(optionTexts, "Scope options render each package with its file count").toEqual([
      "Whole repo",
      "api (1 files)",
      "core (2 files)",
    ]);
    await panel.screenshot({ path: path.join(SHOTS_DIR, "check2-scope-populated.png") });
    console.log(
      "[scope-picker-e2e] CHECK 2 PASS — base-branch + Scope dropdowns populated from the live inspect",
    );

    // CHECK 3 — pick a package + Run; the launch POST /api/runs body carries `subpath` (+ repo_path +
    // base_ref). The keyless fresh account 422s the create pre-flight, so NO run/agent starts — but the
    // OUTGOING request proves the picker threaded the scope.
    const runResp = page.waitForResponse(
      (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
    );
    await scopeSelect.selectOption("core");
    await panel.getByRole("button", { name: "Run", exact: true }).click();

    const runReq = (await runResp).request();
    const postBody = JSON.parse(runReq.postData() ?? "{}") as Record<string, unknown>;
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

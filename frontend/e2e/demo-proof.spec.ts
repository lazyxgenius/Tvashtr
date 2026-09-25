/**
 * M-proof — the demo path proves itself end to end, in a real browser (checks C1–C12).
 *
 * ONE harness, three legs, selected by `TVASHTR_PROOF_LEG`:
 *   local  — the local stack (Vite + backend in hosted mode), signed in by posting the seeded
 *            operator's credentials from the browser context (`POST /api/auth/login` is NOT
 *            hosted-gated), so the `tv_session` cookie is the genuine signed one.
 *   prod   — the deployed app, signed in from a saved Playwright `storageState`. The prod account
 *            was created through the OAuth callback and carries `auth.UNUSABLE_PASSWORD_HASH`, so
 *            `POST /api/auth/login` can NEVER succeed for it — there is nothing to "try harder" at.
 *   login  — the one-off headed capture that writes that `storageState` file.
 *
 * What it proves: M-thrift's four shipped behaviours (the NIM-first provider order, the
 * account-derived `fallback_model` on every model-bearing node, caveman on workers only, and the
 * output ceiling that keeps the run alive) are true THROUGH THE PRODUCT'S OWN UI, and the team the
 * UI creates ships a real pull request against a real repository.
 *
 * Revamp round 1: the old dashboard and the canvas's LaunchPanel are gone. C1 lands on Home inside
 * the new shell, C2 reads the keys on Engines › API keys, C3/C4 use Home's "New team" dialog, C9
 * launches through Home's "Start a run" composer (the canvas's "Run this team" opens it with the
 * team picked), C10 approves every gate by clicking through Home's "Needs you" → Review →
 * "Approve and continue" (the run view's task drawer when Home shows its first-time layout, which
 * has no Needs you), and C12 deletes the team from Home's Teams section.
 *
 * React Flow gotcha: Playwright's full-tree accessibility snapshot chokes on the canvas. Every
 * canvas assertion below is a targeted locator query plus a screenshot — never a whole-tree snapshot.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const LEG = (process.env.TVASHTR_PROOF_LEG ?? "local").toLowerCase();
const STATE_PATH = process.env.TVASHTR_PROOF_STORAGE_STATE ?? "";
const SHOTS = process.env.TVASHTR_PROOF_SHOTS_DIR ?? "";
const REPO = process.env.TVASHTR_PROOF_REPO ?? "lazyxgenius/trade_mcp";
const EMAIL = process.env.TVASHTR_PROOF_EMAIL ?? "operator@tvashtr.local";
const PASSWORD = process.env.TVASHTR_PROOF_PASSWORD ?? "tvashtr-dev";
const RUN_TIMEOUT_MS = Number(process.env.TVASHTR_PROOF_TIMEOUT_S ?? "2100") * 1000;
const LOGIN_TIMEOUT_MS = Number(process.env.TVASHTR_PROOF_LOGIN_TIMEOUT_S ?? "300") * 1000;

/**
 * The feature request. Small, additive, single-file and behaviour-preserving, so the Engineer
 * finishes in a round or two, every existing test in the target repo still passes, and the Reviewer
 * has a fair chance to genuinely approve rather than being forced. The path is fixed so the harness
 * can name it.
 */
const DEFAULT_IDEA =
  "Add ONE new file at docs/DEMO_PROOF.md — a short Markdown document titled 'Demo Proof' with a " +
  "one-line purpose sentence and a bulleted list naming each top-level directory of this " +
  "repository and what it holds. Create only that single new file. Do not modify, move, rename or " +
  "delete any existing file, and keep every existing test passing.";
const IDEA = process.env.TVASHTR_PROOF_IDEA ?? DEFAULT_IDEA;

/** M-thrift's `_PROVIDER_DEFAULT_ORDER` (backend/tvashtr/control_plane/teams.py). */
const PROVIDER_ORDER = ["nvidia_nim", "openai", "gemini", "groq", "deepseek", "openrouter"];
/** M-live: this used to be a hardcoded copy of the backend's `PROVIDER_CATALOGUE`, and it went
 * stale the moment NVIDIA retired `meta/llama-3.3-70b-instruct` and the catalogue moved on — C5
 * then failed comparing a CORRECT chip against a dead expectation. A harness that duplicates a
 * declaration eventually contradicts it, so the expectation is now DERIVED from
 * `GET /api/config`, which serves `teams.public_provider_catalogue()` — the single place a slug
 * is declared. This is the same move M-runnable made for the FE's own model presets, and it means
 * the NEXT retirement cannot desync the harness.
 *
 * M-seat: the catalogue is now split by SEAT, so the expectation is too. A provider that cannot
 * serve a worker declares `worker_default: null` and YIELDS that seat to the next held provider —
 * which means the PM chip and the Engineer/Reviewer chips may legitimately differ, and asserting
 * they match would pin the very bug this milestone removed. */
type Capability = "thinker" | "worker";
interface CatalogueRow {
  provider: string;
  thinker_default: string | null;
  worker_default: string | null;
}
interface ConfigPayload {
  provider_catalogue?: CatalogueRow[];
}

async function providerCatalogue(api: APIRequestContext): Promise<CatalogueRow[]> {
  const cfg = await jsonOf<ConfigPayload>(api, "/api/config");
  const rows = cfg.provider_catalogue ?? [];
  if (rows.length === 0) {
    throw new Error(
      "GET /api/config returned no provider_catalogue — the harness derives every model " +
        "expectation from it, so an empty catalogue is a real backend finding, not a skip.",
    );
  }
  return rows;
}

/** The backend walk, replayed against the served catalogue: the first HELD provider (in
 * `_PROVIDER_DEFAULT_ORDER`) that declares a default for this seat, then the second — i.e. exactly
 * what `account_default_model` / `account_fallback_model` resolve for this account. */
function seatWalk(rows: CatalogueRow[], held: string[], capability: Capability): string[] {
  const defaultOf = (p: string) => {
    const row = rows.find((r) => r.provider === p);
    return (capability === "worker" ? row?.worker_default : row?.thinker_default) ?? null;
  };
  return PROVIDER_ORDER.filter((p) => held.includes(p))
    .map(defaultOf)
    .filter((m): m is string => Boolean(m));
}
/** Terminal DBOS *workflow* statuses. Poll to these, never to `run.status` — a fast run flips
 * `runs.status` to 'completed' while the same `run_team` workflow is still pushing and opening the
 * PR, so `pr_url` is not yet written. */
const TERMINAL_WF = new Set(["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);

// The prod leg is authenticated purely by the saved session; the shell guards its absence first.
if (LEG === "prod" && STATE_PATH && fs.existsSync(STATE_PATH)) {
  test.use({ storageState: STATE_PATH });
}

/** A stop condition: printed with the marker the shell wrapper greps for, then thrown. */
function needsHuman(reason: string): never {
  console.log(`NEEDS_HUMAN: ${reason}`);
  throw new Error(`NEEDS_HUMAN: ${reason}`);
}

async function shot(page: Page, n: number, slug: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${String(n).padStart(2, "0")}-${slug}.png`);
  await page.screenshot({ path: file });
  console.log(`[demo-proof] shot ${file}`);
}

/** The canvas card carrying `roleTitle` in its `.rf-node__role`. */
function nodeCard(page: Page, roleTitle: string): Locator {
  return page
    .locator(".react-flow__node")
    .filter({ has: page.locator(".rf-node__role", { hasText: new RegExp(`^${roleTitle}$`) }) })
    .first();
}

/** Open a node's config drawer the way a user does: click its model strip. */
async function openNodeDrawer(page: Page, roleTitle: string): Promise<void> {
  await nodeCard(page, roleTitle).locator(".rf-node__model").click();
  await expect(page.locator("input[aria-label='Fallback model']")).toBeVisible({ timeout: 15_000 });
}

/** The slices of the API payloads this harness reads. Typed so `String(...)` never stringifies an
 * object by accident (the eslint `no-base-to-string` rule earns its keep here). */
interface RunSnapshot {
  workflow_status?: string;
  run?: { status?: string; pr_url?: string };
}
interface TrajectoryRow {
  role_name?: string;
  outcome?: string;
  outcome_label?: string;
}

/** Expand a `<details>` if it is closed.
 *
 * `getAttribute("open")` answers `""` for `<details open>` — falsy in JS — so a naive
 * `if (!open) click()` guard toggles an already-open block SHUT, and the rows inside then report
 * `innerText === ""` because innerText is layout-dependent. Compare against `null`. */
async function openDetails(details: Locator): Promise<void> {
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

async function jsonOf<T>(api: APIRequestContext, url: string): Promise<T> {
  const res = await api.get(url);
  if (!res.ok()) throw new Error(`GET ${url} -> ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

test.describe("M-proof", () => {
  test("demo-proof-login: capture the prod session (headed, operator completes OAuth)", async ({
    page,
    context,
  }) => {
    test.skip(LEG !== "login", "login leg only");
    test.setTimeout(LOGIN_TIMEOUT_MS + 60_000);

    await page.goto("/");
    console.log(
      "\n============================================================\n" +
        "  ACTION NEEDED — a browser window is open.\n" +
        "  1. Click 'Continue with GitHub' and finish the GitHub sign-in.\n" +
        "  2. Wait until Tvashtr's Home appears. Then leave it alone.\n" +
        "  This harness is watching and will save the session by itself.\n" +
        "============================================================\n",
    );
    await expect(page.getByRole("navigation", { name: "Dashboard" })).toBeVisible({
      timeout: LOGIN_TIMEOUT_MS,
    });

    const me = await context.request.get("/api/auth/me");
    expect(me.status(), "/api/auth/me after sign-in").toBe(200);

    if (!STATE_PATH) throw new Error("TVASHTR_PROOF_STORAGE_STATE is not set");
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    await context.storageState({ path: STATE_PATH });
    // The session cookie's SESSION_MAX_AGE_SECONDS is 14 days.
    const expiry = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    console.log(`[demo-proof-login] session saved to ${STATE_PATH} (gitignored)`);
    console.log(`[demo-proof-login] usable until about ${expiry}; re-run this target after that.`);
  });

  test("demo-proof C1-C12: the demo path, end to end, in a real browser", async ({
    page,
    context,
  }) => {
    test.skip(LEG === "login", "proof legs only");
    test.setTimeout(RUN_TIMEOUT_MS + 300_000);

    const api = context.request;
    const teamName = `demo-proof-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    let teamId = "";
    // M-seat rider: C12 deletes the team, and that cascade takes `agent_invocations` with it — the
    // forensic trail of whatever just went wrong. It destroyed the evidence of the M-live Engineer
    // failure three separate times. So the delete is now conditional: a run that did NOT reach a
    // real PR keeps its team, and the transcript says where to look. Residue from a FAILED run is
    // the cheapest thing in this system; a lost failure trail costs a whole re-run to recover.
    let runSucceeded = false;
    let runIdForReport = "";

    try {
      // ---- C1: establish the session and land on the dashboard -------------------------------
      if (LEG === "prod") {
        if (!STATE_PATH || !fs.existsSync(STATE_PATH)) {
          needsHuman(
            `no prod session file at ${STATE_PATH || "(unset)"} — run \`make demo-proof-login\`, ` +
              "complete the GitHub sign-in, and re-run `make demo-proof-prod`.",
          );
        }
        const me = await api.get("/api/auth/me");
        if (me.status() !== 200) {
          needsHuman(
            `the saved prod session is stale (GET /api/auth/me -> ${me.status()}) — run ` +
              "`make demo-proof-login`, complete the GitHub sign-in, and re-run " +
              "`make demo-proof-prod`. Do not substitute a password: the prod account was created " +
              "through the OAuth callback and holds auth.UNUSABLE_PASSWORD_HASH.",
          );
        }
      } else {
        const login = await api.post("/api/auth/login", {
          data: { email: EMAIL, password: PASSWORD },
        });
        expect(login.status(), `POST /api/auth/login as ${EMAIL}`).toBe(200);
      }

      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "Dashboard" });
      await expect(nav).toBeVisible({ timeout: 30_000 });
      await expect(nav.getByRole("button", { name: /^Home/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
      const hello = page.locator("h1.hm-head__title, h1.hm-ft-head__title");
      await expect(hello).toHaveText(/^(Good (morning|afternoon|evening)|Welcome to Tvashtr)/, {
        timeout: 30_000,
      });
      console.log(`[C1] PASS — Home for ${(await hello.innerText()).trim()} (leg=${LEG})`);
      await shot(page, 1, "home");

      // ---- C2: provider keys (Engines › API keys) --------------------------------------------
      await nav.getByRole("button", { name: /^Engines/ }).click();
      await nav.getByRole("button", { name: /^API keys/ }).click();
      await expect(page).toHaveURL(/#\/engines\/keys$/);
      const keysPanel = page.locator("section[aria-labelledby='tv-engines-keys']");
      await expect(keysPanel).toBeVisible({ timeout: 30_000 });
      await expect(keysPanel).toContainText("API keys");
      await expect
        .poll(async () => keysPanel.locator(".tv-dash__prov-name").count(), { timeout: 20_000 })
        .toBeGreaterThan(0)
        .catch(() => undefined);
      const held = (await keysPanel.locator(".tv-dash__prov-name").allInnerTexts())
        .map((s) => s.trim())
        .filter(Boolean);
      console.log(`[C2] held providers (${held.length}): ${held.join(", ") || "(none)"}`);
      if (held.length < 2 || !held.includes("nvidia_nim")) {
        const why =
          held.length < 2
            ? `only ${held.length} provider key(s) held`
            : "nvidia_nim is not among the held providers";
        needsHuman(
          `${LEG} account fails the C2 provider bar: ${why}. Held: ` +
            `[${held.join(", ") || "none"}]. M-proof needs >=2 keys including nvidia_nim. ` +
            "Add the missing key through the product's own Engines › API keys page — the harness " +
            "must never handle raw credentials.",
        );
      }
      const rows = await providerCatalogue(api);
      const thinkerWalk = seatWalk(rows, held, "thinker");
      const workerWalk = seatWalk(rows, held, "worker");
      if (thinkerWalk.length === 0 || workerWalk.length === 0) {
        needsHuman(
          `the served catalogue offers this account no ${thinkerWalk.length === 0 ? "thinker" : "worker"} ` +
            `model at all (held: [${held.join(", ")}]). Every provider it holds declares null for ` +
            "that seat, so no team it is given can run. Add a key for a provider that serves it, " +
            "or re-run `scripts/seat_probe.py` and fill the catalogue in.",
        );
      }
      const expected: Record<Capability, { primary: string; fallback: string }> = {
        thinker: { primary: thinkerWalk[0], fallback: thinkerWalk[1] ?? "" },
        worker: { primary: workerWalk[0], fallback: workerWalk[1] ?? "" },
      };
      console.log(
        `[C2] thinker seat: primary ${expected.thinker.primary}; fallback ` +
          `${expected.thinker.fallback || "(none)"}`,
      );
      console.log(
        `[C2] worker  seat: primary ${expected.worker.primary}; fallback ` +
          `${expected.worker.fallback || "(none)"}`,
      );
      console.log("[C2] PASS — seat expectations derived from GET /api/config");
      await shot(page, 2, "providers");

      // ---- C3: Home's New team dialog ----------------------------------------------------------
      await nav.getByRole("button", { name: /^Home/ }).click();
      await expect(page).toHaveURL(/#\/(home)?$/);
      await page.getByRole("button", { name: "New team", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "New team" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("group", { name: "Starting point" }).locator(".hm-tplcard"),
      ).toHaveCount(5, { timeout: 30_000 });
      await expect(dialog).not.toContainText("Couldn’t load the starter templates");
      const templates = (await dialog.locator(".hm-tplcard__name").allInnerTexts()).map((s) =>
        s.trim(),
      );
      console.log(`[C3] templates: ${templates.join(" | ")}`);
      for (const want of [
        "Blank",
        "PM → Engineer",
        "PM → Engineer ⇄ Reviewer",
        "PM → Architect → Engineer ⇄ Reviewer",
        "Full feature squad",
      ]) {
        expect(templates, `template card '${want}'`).toContain(want);
      }
      console.log("[C3] PASS — the dialog renders Blank and all four starter templates");
      await shot(page, 3, "new-team-dialog");

      // ---- C4: create the team ----------------------------------------------------------------
      await dialog.getByLabel("Name", { exact: true }).fill(teamName);
      const reviewLoop = dialog.locator("button.hm-tplcard", {
        has: page.locator(".hm-tplcard__name", { hasText: /^PM → Engineer ⇄ Reviewer$/ }),
      });
      await reviewLoop.click();
      await expect(reviewLoop).toHaveAttribute("aria-pressed", "true");
      const created = page.waitForResponse(
        (r) => r.url().endsWith("/api/teams") && r.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Create team", exact: true }).click();
      const createdRes = await created;
      expect(createdRes.ok(), `POST /api/teams -> ${createdRes.status()}`).toBeTruthy();
      const createdTeam = (await createdRes.json()) as { team_graph_id: string; name: string };
      expect(createdTeam.name, "the created team's name").toBe(teamName);
      teamId = String(createdTeam.team_graph_id);
      await expect(dialog).toHaveCount(0, { timeout: 30_000 });
      await expect(page).toHaveURL(new RegExp(`#/teams/${teamId}$`), { timeout: 30_000 });
      await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
      console.log(`[C4] PASS — created '${teamName}' (${teamId}) from review_loop; canvas open`);
      await shot(page, 4, "canvas-created");

      // ---- C5: canvas model chips (per SEAT) --------------------------------------------------
      // M-seat: the PM is a thinker and the Engineer/Reviewer are workers, so each chip is checked
      // against ITS OWN seat's walk. Asserting all three match would re-pin the defect this
      // milestone removed — a worker wearing whatever slug the first held provider declared.
      const roles: [string, Capability][] = [
        ["Product manager", "thinker"],
        ["Engineer", "worker"],
        ["Reviewer", "worker"],
      ];
      for (const [role, capability] of roles) {
        const chip = nodeCard(page, role).locator(".rf-node__model-text");
        await expect(chip, `${role} model chip`).toBeVisible({ timeout: 20_000 });
        const slug = (await chip.innerText()).trim();
        console.log(`[C5] ${role} (${capability}) model chip = ${slug}`);
        if (slug.startsWith("openrouter/")) {
          throw new Error(
            `[C5] FAIL — ${role} is stamped ${slug}: the M-thrift provider reorder did not take ` +
              "for this account (openrouter must be LAST, nvidia_nim FIRST).",
          );
        }
        expect(slug, `${role} model chip (${capability} seat)`).toBe(expected[capability].primary);
      }
      console.log(
        `[C5] PASS — thinker chip ${expected.thinker.primary}; worker chips ` +
          `${expected.worker.primary}`,
      );
      await shot(page, 5, "model-chips");

      // ---- C6: the account-derived fallback model, on EVERY model-bearing node -----------------
      // Also per seat: a worker whose failover target only serves thinkers is a safety net tied to
      // nothing, so the fallback walks the same capability as the primary.
      for (const [role, capability] of roles) {
        await openNodeDrawer(page, role);
        const value = await page.locator("input[aria-label='Fallback model']").inputValue();
        console.log(`[C6] ${role} (${capability}) fallback model value = ${JSON.stringify(value)}`);
        expect(value, `${role} fallback model (${capability} seat; value, not placeholder)`).toBe(
          expected[capability].fallback,
        );
      }
      console.log(
        `[C6] PASS — thinker fallback ${expected.thinker.fallback || "(none)"}; worker fallback ` +
          `${expected.worker.fallback || "(none)"}`,
      );
      await shot(page, 6, "fallback-model");

      // ---- C7: caveman on the workers ---------------------------------------------------------
      for (const role of ["Engineer", "Reviewer"]) {
        await openNodeDrawer(page, role);
        const skills = page.locator("details.tv-skills");
        await expect(skills.locator("summary"), `${role} skills summary`).toHaveText("Skills · 1");
        await openDetails(skills);
        await expect(skills.locator(".tv-skills__rows")).toBeVisible();
        const labels = (await skills.locator(".tv-skills__label").allInnerTexts()).map((s) =>
          s.trim(),
        );
        console.log(`[C7] ${role} skills = ${JSON.stringify(labels)}`);
        expect(labels, `${role} skill rows`).toEqual(["caveman"]);
        // The badge renders capitalised ("Inline"); the brief wrote the underlying `type` value.
        // Assert the rendered DOM, case-insensitively, on the ROW rather than the whole block.
        await expect(skills.locator(".tv-skills__row").first()).toContainText(/inline/i);
      }
      console.log(
        "[C7] PASS — Engineer and Reviewer each carry exactly one inline 'caveman' skill",
      );
      await shot(page, 7, "caveman-worker");

      // ---- C8: caveman NOT on the thinker -----------------------------------------------------
      await openNodeDrawer(page, "Product manager");
      const pmSkills = page.locator("details.tv-skills");
      await expect(pmSkills.locator("summary"), "PM skills summary").toHaveText("Skills");
      await openDetails(pmSkills);
      const pmLabels = await pmSkills.locator(".tv-skills__label").allInnerTexts();
      console.log(`[C8] PM skills = ${JSON.stringify(pmLabels)}`);
      expect(pmLabels, "the thinker must carry NO stamped skill").toEqual([]);
      console.log("[C8] PASS — the caveman stamp did not leak onto the thinker");
      await shot(page, 8, "caveman-not-thinker");

      // ---- C9: launch at a real repo, through Home's composer ----------------------------------
      // The canvas's Run opens Home's "Start a run" composer with this team picked.
      await page.getByRole("button", { name: "Run this team", exact: true }).click();
      const composer = page.locator("section[aria-label='Start a run']");
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/#\/(home)?$/);
      await expect(composer.locator(".hm-picker--team")).toContainText(teamName, {
        timeout: 30_000,
      });
      await composer.getByRole("textbox", { name: "What should the team build?" }).fill(IDEA);
      await composer.locator(".hm-picker--repo").click();
      const repoPop = page.getByRole("dialog", { name: "Pick a repo" });
      await expect(repoPop).toBeVisible();
      if ((await repoPop.getByRole("textbox", { name: "Search repos" }).count()) === 0) {
        needsHuman(
          "the composer's target picker offers no GitHub repo search — this leg is not running in " +
            "hosted mode, so no pull request can be opened. Local leg: set " +
            "TVASHTR_HOSTED_MODE=true on the backend.",
        );
      }
      await expect(repoPop).not.toContainText("Loading repositories…", { timeout: 60_000 });
      const repoList = repoPop.getByRole("listbox", { name: "Repos" });
      const offered = (
        await repoList.locator("button[role='option'] .hm-picker__code").allInnerTexts()
      )
        .map((s) => s.trim())
        .filter(Boolean);
      console.log(`[C9] repos offered (${offered.length}): ${offered.join(", ")}`);
      if (!offered.includes(REPO)) {
        const manage = await repoPop.locator("a").allInnerTexts();
        needsHuman(
          `TVASHTR_PROOF_REPO='${REPO}' is not among the repos this GitHub App installation ` +
            `grants. Offered: [${offered.join(", ")}]. Grant it (the picker's install/manage door: ` +
            `${manage.join(" / ") || "'Add repositories on GitHub'"}) or set TVASHTR_PROOF_REPO to ` +
            "one above.",
        );
      }
      await repoList
        .locator("button[role='option']", {
          has: page.locator(".hm-picker__code", { hasText: new RegExp(`^${REPO}$`) }),
        })
        .click();
      await expect(repoPop).toHaveCount(0);
      await expect(composer.locator(".hm-picker--repo")).toContainText(REPO);
      await composer.getByRole("button", { name: "Options", exact: true }).click();
      const options = page.getByRole("dialog", { name: "Run options" });
      const base = options.getByLabel("Base branch");
      await expect(base, "the base branch").toBeVisible();
      const baseBranch = await base.inputValue();
      expect(baseBranch.length, "base branch must render non-empty").toBeGreaterThan(0);
      console.log(`[C9] target ${REPO} @ base branch '${baseBranch}'`);
      await shot(page, 9, "composer");
      await composer.getByRole("button", { name: "Options", exact: true }).click();
      await expect(options).toHaveCount(0);

      const launched = page.waitForResponse(
        (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
        { timeout: 120_000 },
      );
      await composer.getByRole("button", { name: "Launch", exact: true }).click();
      const launchRes = await launched;
      expect(
        launchRes.ok(),
        `POST /api/runs -> ${launchRes.status()} ${await launchRes.text()}`,
      ).toBeTruthy();
      const sent = (launchRes.request().postDataJSON() ?? {}) as Record<string, unknown>;
      expect(sent.team_graph_id, "the composer launched THIS team").toBe(teamId);
      expect(sent.github_repo, "the composer launched at the picked repo").toBe(REPO);
      expect(sent.base_ref, "the composer sent the base branch").toBe(baseBranch);
      const runId = ((await launchRes.json()) as { run_id: string }).run_id;
      expect(runId, "the launch returns a run_id").toBeTruthy();
      await expect(
        page.getByRole("status").filter({ hasText: `Run started on ${teamName}.` }),
      ).toBeVisible({ timeout: 30_000 });
      runIdForReport = runId;
      console.log(`[C9] PASS — run ${runId} launched against ${REPO} from Home's composer`);

      // ---- C10 + C11: approve the real gates through the UI, then a terminal run + a real PR ---
      // Home's Needs you lists each gate; Review opens the approve sheet. An account still on the
      // first-time Home has no Needs you, so there the gate is approved in the run view instead.
      let gatesSeen = 0;
      let gatesApproved = 0;
      let escalationsApproved = 0;
      const gateTitles: string[] = [];
      let snapshot: RunSnapshot = {};
      const deadline = Date.now() + RUN_TIMEOUT_MS;
      const needsYou = page.locator("section[aria-label='Needs you']");
      const firstTime = (await needsYou.count()) === 0;
      if (firstTime) {
        console.log("[C10] Home shows its first-time layout (no Needs you) — using the run view");
        await page.goto(`/#/teams/${teamId}/runs/${runId}`);
      }

      const noteGate = async (title: string) => {
        gatesSeen += 1;
        gateTitles.push(title);
        console.log(`[C10] gate ${gatesSeen} awaiting approval: '${title}' — clicking Approve`);
        await shot(
          page,
          10,
          `gate-${gatesSeen}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        );
      };

      while (Date.now() < deadline) {
        snapshot = await jsonOf<RunSnapshot>(api, `/api/runs/${runId}`);
        const wf = snapshot.workflow_status ?? "";
        if (TERMINAL_WF.has(wf)) break;

        if (!firstTime) {
          const row = needsYou
            .locator("li.hm-inbox__item")
            .filter({ hasText: teamName })
            .filter({ has: page.getByRole("button", { name: "Review", exact: true }) })
            .first();
          if ((await row.count()) > 0) {
            const title = (await row.locator(".hm-inbox__title").innerText()).trim();
            await row.getByRole("button", { name: "Review", exact: true }).click();
            const sheet = page.getByRole("dialog", { name: title });
            await expect(sheet).toBeVisible({ timeout: 15_000 });
            await expect(sheet).toContainText(teamName);
            await noteGate(title);
            await sheet.getByRole("button", { name: "Approve and continue", exact: true }).click();
            gatesApproved += 1;
            if (/escalat/i.test(title)) escalationsApproved += 1;
            await expect(sheet).toHaveCount(0, { timeout: 60_000 });
            await expect(row).toHaveCount(0, { timeout: 60_000 });
          }
        } else {
          const card = page
            .locator("article.tv-task")
            .filter({ hasText: "Awaiting your approval" })
            .first();
          if ((await card.count()) > 0) {
            const title = (await card.locator(".tv-task__title").first().innerText()).trim();
            await noteGate(title);
            await card.getByRole("button", { name: "Approve", exact: true }).click();
            gatesApproved += 1;
            if (/escalat/i.test(title)) escalationsApproved += 1;
            await expect(card).toHaveCount(0, { timeout: 60_000 });
          }
        }
        await page.waitForTimeout(4000);
      }

      const wf = snapshot.workflow_status ?? "";
      const run = snapshot.run ?? {};
      const status = run.status ?? "";
      const prUrl = run.pr_url ?? "";
      console.log(`[C11] workflow_status=${wf} run.status=${status}`);
      if (!TERMINAL_WF.has(wf)) {
        throw new Error(
          `[C11] FAIL — the run never reached a terminal workflow status within ` +
            `${RUN_TIMEOUT_MS / 1000}s (last workflow_status=${wf}, run.status=${status}, ` +
            `gates approved=${gatesApproved}).`,
        );
      }
      expect(status, "run.status").toBe("completed");
      expect(prUrl, "run.pr_url must be a real non-empty PR URL").toMatch(
        /^https:\/\/github\.com\/.+\/pull\/\d+$/,
      );

      // How was the ship reached? A reviewer that genuinely approved is a stronger proof than an
      // escalation gate a human waved through, so the transcript must say which.
      let reviewerRounds = 0;
      let reviewerFinal = "(none)";
      try {
        const traj = await jsonOf<{ rows?: TrajectoryRow[]; trajectory?: TrajectoryRow[] }>(
          api,
          `/api/runs/${runId}/trajectory`,
        );
        const rows = traj.rows ?? traj.trajectory ?? [];
        for (const r of rows) {
          if (/review/i.test(r.role_name ?? "")) {
            reviewerRounds += 1;
            reviewerFinal = r.outcome ?? r.outcome_label ?? reviewerFinal;
          }
        }
      } catch (e) {
        console.log(`[C11] trajectory read failed (non-fatal): ${String(e)}`);
      }
      const shipVia =
        reviewerFinal === "approved"
          ? "REVIEWER-APPROVED (the Reviewer genuinely approved)"
          : escalationsApproved > 0
            ? "ESCALATION-GATE (a human waved it through; weaker proof)"
            : `UNDETERMINED (reviewer final outcome '${reviewerFinal}')`;

      runSucceeded = true;
      console.log("[C11] PASS — terminal run with a real pull request");
      console.log(`PR_URL(${LEG}): ${prUrl}`);
      console.log(`SHIP_VIA(${LEG}): ${shipVia}`);
      console.log(
        `GATE_COUNTS(${LEG}): gates_seen=${gatesSeen} approved_via_ui=${gatesApproved} ` +
          `escalation_gates_approved=${escalationsApproved} reviewer_rounds=${reviewerRounds}`,
      );
      console.log(`GATE_TITLES(${LEG}): ${gateTitles.join(" | ") || "(none)"}`);
      await page.goto(`/#/teams/${teamId}/runs/${runId}`);
      await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 30_000 });
      await shot(page, 11, "terminal-run-pr");
    } finally {
      // ---- C12: cleanup — delete the team, never the PR (the PR is the artifact) --------------
      try {
        await page.goto("/");
        const teamsSection = page.locator("section[aria-label='Teams']");
        await expect(teamsSection).toBeVisible({ timeout: 30_000 });
        // Sweep every demo-proof-* team, not just this run's: a crashed earlier run leaves one
        // behind and this harness is permanent, so residue would accumulate forever. The ONE
        // exception is THIS run when it failed (see `runSucceeded` above) — deleting it would
        // cascade away the agent_invocations that say why.
        if (!runSucceeded) {
          console.log(
            `[C12] PRESERVED '${teamName}' (team ${teamId || "unknown"}, run ` +
              `${runIdForReport || "not launched"}) — the run did not reach a real PR, so its ` +
              "invocations are kept for diagnosis. Delete it from Home's Teams when done.",
          );
        }
        await teamsSection.getByRole("textbox", { name: "Search teams" }).fill("demo-proof-");
        const stale = teamsSection
          .getByRole("button", { name: /^More actions for demo-proof-/ })
          .and(
            page.locator(
              runSucceeded ? "button" : `button:not([aria-label="More actions for ${teamName}"])`,
            ),
          );
        await expect
          .poll(async () => (await stale.count()) > 0, { timeout: 20_000, intervals: [500] })
          .toBe(true)
          .catch(() => undefined);
        let removed = 0;
        while ((await stale.count()) > 0) {
          const name = (await stale.first().getAttribute("aria-label"))!.replace(
            /^More actions for /,
            "",
          );
          await stale.first().click();
          await page
            .getByRole("menu", { name: `More actions for ${name}` })
            .getByRole("menuitem", { name: "Delete team" })
            .click();
          const confirm = page.getByRole("alertdialog", { name: `Delete ${name}?` });
          await expect(confirm).toBeVisible({ timeout: 15_000 });
          if (removed === 0) await shot(page, 12, "delete-confirm");
          await confirm.getByRole("button", { name: "Delete team", exact: true }).click();
          await expect(confirm).toHaveCount(0, { timeout: 30_000 });
          await expect(
            teamsSection.getByRole("button", { name: `More actions for ${name}`, exact: true }),
          ).toHaveCount(0, { timeout: 30_000 });
          removed += 1;
          console.log(`[C12] deleted '${name}' through Home's Teams section`);
        }
        console.log(
          `[C12] PASS — ${removed} demo-proof team(s) cleaned up; the PR is kept` +
            (runSucceeded ? "" : `; '${teamName}' deliberately kept for diagnosis`),
        );
      } catch (e) {
        console.log(`[C12] cleanup did not complete: ${String(e)}`);
      }
    }
  });
});

# M-h1b — HOSTED: pick a repo → clone → run → push branch → open PR

> Architect brief for Tvashtr-68. The `/goal` points here. This brief SUPERSEDES `CLI-RULES.md` §7
> for this run. Read it fully before writing any code.

---

## 1. Objective (one sentence)

A **hosted** user picks one of their own GitHub repos from a **dropdown**, types a feature request,
runs their team, and gets a **real Pull Request** on that repo — with the free-text local-path door
**fenced off** in hosted mode.

Branch: **`feat/m-h1b-clone-run-pr`**

---

## 2. Ground truth (architect-verified on disk — trust THIS over CLI-RULES §2/§4.6/§7, which are STALE)

- `main` @ `1f75995`. **No `[remote]` in `.git/config`** — pushing Tvashtr's own repo is
  structurally impossible. (The push you are ADDING is product code pushing the USER's repo to
  GitHub. That is a different thing and is the point of this milestone.)
- Alembic head **`0029_github_identity`**. The freeze hook blocks `0001`–`0029`. **`0030` is yours.**
- Floors: **710 backend / 372 vitest**. Both go UP. Never down.
- Agent model is **DeepSeek** (`.env` `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`).
  CLI-RULES §4.6 ("proven agent model = `nvidia_nim/…70b`") and §2 ("head `0014`", "239+ tests")
  are STALE — ignore them.
- `.env` currently has `TVASHTR_HOSTED_MODE=true` plus the five `GITHUB_APP_*` values.
- GitHub ground truth: installation_id `147133756`, repo `lazyxgenius/trade_mcp`, permissions
  Contents R/W + Metadata R + **Pull requests R/W** (so the PR call is authorised).

---

## 3. WHY this shape — read this, it constrains everything below

Today the launch panel's free-text **Repo path** box is a window into the server's basement: an
attacker with an account can *look* (`POST /api/repo/inspect` on `/Users/...` leaks branch names and
file counts) but cannot carry anything out — the agent's work lands on a local branch they can
never reach.

**This milestone installs a delivery chute to GitHub.** The moment `push` exists, an attacker signs
up (hosted = public sign-up, so "you need an account" is not a defence), sets `repo_path` to `/`,
points the run at **their own** GitHub repo, and the ship commit couriers the server's private files
— `.env`, every other tenant's clone — straight into their account.

So the fencing is **not a rider**. It is a prerequisite that this milestone itself creates the need
for. And it forces the frontend into scope: **you cannot brick up the old door without building the
new one**, or a hosted user has no way to launch a brownfield run at all.

---

## 4. Tasks

Self-decompose the implementation. The shape below is the contract, not a step list.

### Task 1 — the three sign-in riders. **COMMIT THESE FIRST, ALONE, before anything else.**

All three are in the sign-in path and all three are the **architect's** brief errors from M-h1a —
not defects you introduced. Rider 1 blocks *all repeat sign-in*, so without it the operator cannot
sign in to eyeball your dropdown at the end. Committing them first also means that if the rest of
this milestone stalls, they are trivially cherry-pickable.

1. **`build_install_url()` picks the wrong front door.** It prefers
   `github.com/apps/<slug>/installations/new` when a slug is set. That URL **only works for a
   first-time user**: once installed, GitHub says "already installed" and redirects to its own
   settings page — **no `code` is issued, the callback never fires, the user is never signed in.**
   Proven live: the operator landed on `github.com/settings/installations/147133756`.
   **The existing fallback was the correct primary.** Make
   `github.com/login/oauth/authorize?client_id=…` the **primary** (it handles both cases: it
   authorises an existing install and prompts to install when absent).
2. **Demote slug-install to a SECONDARY "add repositories" URL.** It still has a real job (see Task
   5: a user with no installation gets an empty dropdown and needs a way out). Surface it as a
   **second, separate** public field on `GET /api/config` — e.g. `github_manage_url` — empty when no
   slug is configured. Do **not** delete it.
3. **`build_install_url()` must tolerate a pasted full URL.** The slug is interpolated raw, and
   GitHub's settings page offers the public link **with a copy button**, so the natural action
   yields `https://github.com/apps/tvashtr-dev` → `…/apps/https://github.com/apps/tvashtr-dev/…`
   → a GitHub 404. **The architect fell into this exact trap.** Strip a leading
   `https://github.com/apps/` (and any trailing `/`) before interpolating. Prefer a clear error over
   silently building nonsense.
4. **The callback redirect target is wrong.** `auth.py::github_callback` ends with
   `RedirectResponse(url="/")` → the **backend's** root (`localhost:8000` → `{"detail":"Not Found"}`).
   The session itself is fine (cookies scope by **domain, not port**), so this is a broken *first
   impression*, not a broken chain — but it is the last thing a new user sees. Redirect to a
   **configurable FE origin**: a new setting (e.g. `TVASHTR_FRONTEND_ORIGIN`, default
   `http://localhost:5173`) so local dev works out of the box and M-h4 points it at the real domain.

Tests: each rider gets a real assertion (the primary URL shape; a pasted-full-URL slug producing a
sane URL; the callback's `Location` header being the FE origin).

### Task 2 — the orphan test move (rides; zero risk)

`scripts/test_rung2_whole_repo.py` is mutation-real but lives under `scripts/`, so **`make test`
never runs it** and it will rot. Move it to `backend/tests/`, following the project's own existing
pattern — `backend/tests/test_model_bench.py` tests a `scripts/` harness by **loading it by file
path from `backend/tests/`**. Floor 710 → **714**.

### Task 3 — schema (migration `0030`, the ONLY migration in this milestone)

Two additive nullable columns on `runs`:
- **`github_repo`** — the `owner/name` full name a hosted run targets. NULL ⇒ not a hosted-GitHub
  run (every existing run, every local brownfield run, every greenfield run).
- **`pr_url`** — the opened PR's html URL. NULL until the PR exists.

Both nullable ⇒ no backfill, every existing row valid. **Bump the freeze regex to cover `0030` as
the LAST commit of the milestone**, and verify it blocks `0030` and allows `0031`.

### Task 4 — the backend chain

**4a. `create_run` — the two postures.**
- **Hosted mode + `repo_path` present ⇒ 422.** This is the fence from §3. Same for **`POST
  /api/repo/inspect` ⇒ 422 in hosted mode** (it is the reconnaissance half — it leaks branch names
  and file counts for any path on the server).
- **Hosted mode + `github_repo` present ⇒** verify the repo is in **this owner's** installation
  repos (reuse `github_app.list_installation_repositories`, which is already owner-scoped via
  `github_installations.owner_id`). Not theirs ⇒ **422**. This is an authorisation check, not a
  convenience: a user can POST any `full_name`.
- **`base_ref` for a hosted run comes free**: `list_installation_repositories` already returns
  `default_branch`. Use it. Do not invent a branch picker.
- **`github_repo` outside hosted mode ⇒ 422** ("hosted mode only"). Keeps the two postures crisp.
- Both `repo_path` and `github_repo` ⇒ 422.
- **Self-hosted posture is BYTE-UNCHANGED.** `repo_path`, `base_ref`, `subpath`, `/api/repo/inspect`
  all behave exactly as today. Every live gate and `brownfield-rung2` depend on this.

**4b. The clone is a DURABLE STEP that sets `repo_path` — this is the load-bearing design call.**

`run_team` calls `load_graph_step(run_id)` **first**, and that step **snapshots `repo_path` into the
graph dict** that `run_graph` then reads (`graph.get("repo_path")`). So the clone **must land before
`load_graph_step`**, or the run silently executes as *greenfield*.

Add a step in `run_team` **before** `load_graph_step` that, when `runs.github_repo` is set and
`repo_path` is NULL, clones the repo into a per-run directory and **sets `runs.repo_path` to it**.

The payoff: **everything downstream is untouched.** `engineer_setup_step` cuts its worktree from the
clone exactly as it does from a local repo; `build_repo_grounding`, `_resolve_pull_paths`,
`ship_step` are all byte-identical. A hosted run simply *looks like* a local brownfield run to the
rest of the system. **Do not fork the brownfield path. Do not touch `run_graph`'s walk.**

- **Idempotent + crash-safe**, mirroring `add_worktree` / `init_workspace_repo`: a clone already
  present ⇒ no-op. It is a `@DBOS.step()` so a resume replays it.
- **NOT in the endpoint.** A clone is unbounded network I/O; blocking `POST /api/runs` on it would
  hang the request on a big repo and would not survive a crash. The durable step is the architecture
  (§13 Risk 1).
- **Scrub the token off disk.** Clone with the tokenised URL
  (`https://x-access-token:<token>@github.com/<owner>/<repo>.git`), then **immediately**
  `git remote set-url origin` to the **tokenless** URL. Git writes `remote.origin.url` into
  `.git/config`, and a 1h token rotting in a file the run keeps is both a leak and useless by push
  time. (`.git` is never uploaded to the agent container — `enumerate_push_files_git` uses
  `git ls-files`, which cannot list it — but do not rely on that; scrub anyway.)

**4c. Push + PR on the Ship terminal.**

In `run_graph`'s **ship** arm only (never the stop arm), after `ship_step`, for a run with
`github_repo` set: mint a **fresh** installation token (the one from clone time may be expired on a
long run), push the run's ship branch, and open the PR.

- **Push** the worktree's branch to the tokenised URL **explicitly on the command line** — never
  persist it, never re-add a remote.
- **Open the PR idempotently by construction**, the same discipline as `idempotent_ship`'s tag
  dedup: **list open PRs for that head branch first; create only if absent.** (A duplicate create
  returns a 422 whose body `_http` deliberately drops — status alone cannot tell you "already
  exists" from a real error, so do not try to catch your way out of it.) `base` = the run's
  `base_ref`. Record `pr_url` on the run.
- **INVARIANT — a hosted Ship that could not reach GitHub must NOT report a clean `completed`.**
  For a hosted run the clone is a per-run throwaway, so a commit that never reached GitHub shipped
  **nothing** the user can see. Either the run has a `pr_url`, or its failure is visible and **names
  the reason**. Never a silent success with no PR. (This is unlike `distill_run_memory_step`, which
  is genuinely best-effort — the PR is not.) You choose the mechanism.

**4d. Secrets discipline — the existing C8 invariant extends here, unchanged.** The installation
token is never persisted, never logged, never serialised into any response, never in an error
message. `github_app.py` has **no `logging` import at all** — keep it that way. `_http` raises
status-only. New helpers follow the same rule. Assert it with a test.

### Task 5 — the frontend

**The repo dropdown (hosted posture only).**
- `LaunchPanel` in hosted mode: the **Repo path** text input is replaced by a **Repository**
  dropdown listing the account's repos (`GET /api/github/repos`), showing `full_name` and marking
  private ones. The **base branch is shown read-only** (the repo's `default_branch`), not a picker.
- **Empty list ⇒ the user is stuck** — they authorised but installed the app on no repo. Show the
  **"Add repositories on GitHub →"** link (rider 2's `github_manage_url`). This is mandatory, not
  decoration.
- **Self-hosted posture renders exactly as today** — path box, inspect, branch dropdown, Scope
  picker, large-repo hint. Assert this with a test; it is the harness every gate depends on.
- **No Scope picker in hosted mode** and **no large-repo hint** — both are fed by
  `/api/repo/inspect`, which is now fenced. This is fine and deliberate: the **whole-repo leg is
  PROVEN** (Tvashtr-67: `run.subpath = None`, all 264 files, `max_abs_diff = 0.0`, C1's condenser
  folding twice), so whole-repo is the validated default and scoping is an optimisation. Registered
  as deferred — do not build a hosted scope picker here.

**The PR link.** `RunBanner` currently shows `branch <ship_branch>`. When `pr_url` is set, show a
clickable **"Opened PR →"** instead. The PR is the deliverable — a branch in a throwaway clone on
Tvashtr's server means nothing to a hosted user.

Thread `github_repo` through `RunTeamOptions` / `runTeam` **only when set**, matching the existing
`if (opts.subpath) body.subpath = …` discipline, so a greenfield/self-hosted launch stays
byte-for-byte the prior contract. Add `pr_url` + `github_repo` to `RunRow` and `_run_to_dict`.

### Task 6 — the live gate: `make github-pr-e2e`

**This gate pushes a REAL branch and opens a REAL PR on `lazyxgenius/trade_mcp`. The operator has
consented. Every prior gate was read-only against GitHub — this one is not.**

- Mirror `docs_chain_check.py` / `github_app_e2e_check.py`: **skip cleanly** (exit 0, "not a
  failure") when `GITHUB_APP_*` or the model's provider key are absent, and use the same defensive
  `.env` loader (a plain `source` breaks on the `x-api-key=` line).
- **Never hardcode a model slug in the recipe** — `TVASHTR_PR_E2E_MODEL ?= $(TVASHTR_AGENT_MODEL)`.
  Setting `TVASHTR_HOSTED_MODE=true` inline **is** correct: the gate is testing the hosted posture.
  (That is a posture, not a model pin — the Tvashtr-39/66 anti-pattern was pinning the *model*.)
- Keep it **fast and cheap**: follow `run_diff_e2e.sh` / `node_ask_e2e.sh` — LOCAL sandbox, forced
  reviewer-approve, no docker, and a **trivial idea** (e.g. add a docstring). You are proving the
  **new seams** — clone-from-GitHub, push, PR, and that a cloned `repo_path` reaches
  `load_graph_step` — not re-proving the agent loop, which rung 2 already proved.
- It must assert, and **echo verbatim into the transcript**: `run.repo_path` is the clone dir,
  `run.github_repo == 'lazyxgenius/trade_mcp'`, `run.subpath is None`, `run.status == 'completed'`,
  the workflow status is terminal, and a **non-empty `pr_url`**. Print the PR URL so the operator
  can open and close it.
- **Poll to a TERMINAL DBOS *workflow* status before exiting `TestClient`** — and look for the
  bug's real shape: the rung-2 driver already checked `_TERMINAL_WF` but as
  `if wf in _TERMINAL_WF **or** run_status in _TERMINAL_RUN`, and the `run_status` arm won the race
  on a fast run, leaving a PENDING `run_team` that wedges the next boot's recovery. **Look for the
  `or`.**
- **Re-runnable**: a second run must not fail on a leftover branch or PR from the first.

---

## 5. Hard invariants (each must be PROVEN, not asserted)

1. **`engines/` is untouched.** Prove with the **subtree hash** of `engines/` on `main` vs your
   branch — identical (this is strictly stronger than `git diff --stat` and immune to a mis-scoped
   pathspec). Baseline on `main` @ `1f75995` is `af1ae92d3a`.
2. **The self-hosted posture is byte-unchanged.** `make brownfield-rung2` and every existing live
   gate rely on `repo_path` + `login_operator`. Prove it: `TVASHTR_HOSTED_MODE` unset ⇒ `create_run`
   with `repo_path` and `POST /api/repo/inspect` behave exactly as before (a test, plus the existing
   suite staying green).
3. **The greenfield path is byte-unchanged.** No `github_repo` + no `repo_path` ⇒ the prior
   contract exactly.
4. **`run_graph`'s walk is not forked for hosted.** The clone step sets `repo_path`; the walk cannot
   tell a hosted run from a local brownfield one. `_resolve_pull_paths` stays byte-identical (it is
   the load-bearing Slice-4 anti-clobber invariant).
5. **No secret on disk, in a row, in a log, or in an error.** Including: `.git/config` carries the
   **tokenless** remote after the clone — assert it.
6. **`team_run.py` stays openhands-free at import.** New GitHub helpers belong in
   `control_plane/github_app.py` (stdlib + PyJWT; **no `httpx`** — it is a dev-only dep — and no
   `logging`).
7. **Migrations `0001`–`0029` are never edited.** `0030` is new; the freeze bump is the LAST commit.

---

## 6. Acceptance — run every one of these YOURSELF, debug to green, and echo the decisive line

Do **not** hand the operator a list of commands to run. The only thing left for a human is looking
at your screenshots.

- [ ] `make test` — **≥ 714** backend passing (710 floor + the moved orphan test + your new tests).
      Echo the `=== N passed ===` line.
- [ ] `make lint` — clean. **Re-run the FULL lint AFTER adding gate/e2e files** (a prior session
      committed two unlinted deliverables by linting before adding them).
- [ ] `make test-frontend` — **≥ 372** vitest. Echo the count.
- [ ] `make build-frontend` — green.
- [ ] `make github-pr-e2e` — green, with the asserted values and the **PR URL** echoed.
- [ ] `alembic heads` ⇒ `0030`. Echo it.
- [ ] The invariant proofs from §5, with their actual output.
- [ ] Playwright self-sign-off with **a screenshot per check** (see §7).
- [ ] `READY_TO_MERGE: branch=feat/m-h1b-clone-run-pr, sha=<sha>, tests=<N>` in `STATE.md`.

## 7. Playwright self-sign-off (screenshot each)

Backend + Vite on **non-default ports** (e.g. 8002 / 5175) so nothing clashes.
1. **Hosted posture** (`TVASHTR_HOSTED_MODE=true`): open a team → "Run this team" → the **Repository
   dropdown** renders with `lazyxgenius/trade_mcp` in it, the base branch shows read-only, and
   **there is no free-text path box**. Screenshot.
2. **The "Add repositories on GitHub →" link** is present. Screenshot.
3. **Self-hosted posture** (`TVASHTR_HOSTED_MODE` unset): the same panel shows the **free-text path
   box** and **no** repo dropdown. Screenshot. *(This is the regression proof that the posture flag
   is a real switch, not a one-way door.)*
4. A completed hosted run's banner shows **"Opened PR →"** as a link. Screenshot.

**Gotcha:** Playwright's full-page a11y snapshot **hangs** on the large React Flow canvas — use
targeted `browser_evaluate` on specific selectors + screenshots, never a whole-tree snapshot.

## 8. Stop conditions

- Write `NEEDS_HUMAN: <exact reason>` to `STATE.md` and stop on a genuinely external blocker (a dead
  credential, a confirmed GitHub outage, an un-scriptable OAuth/MFA flow).
- **A second/unknown problem needing a broad or unproven change ⇒ STOP + `NEEDS_HUMAN`.** A
  code-proven, contained, regression-guarded fix to a SINGLE identified cause may proceed.
- Hard cap: **60 turns**.
- Emit the CLI-RULES §4.7 **FINAL REPORT** (all 8 sections) at the end, whatever the terminal.

## 9. Explicitly OUT of scope (registered as deferred — do not build)

Hosted scope picker · hosted base-branch picker · hosted large-repo hint · clone GC / disk reclaim ·
a shared per-(owner,repo) cached checkout (per-run clone is deliberate: isolation over speed) ·
per-run Fly Machine isolation (M-h2) · quotas/abuse caps (M-h3) · deployment (M-h4).

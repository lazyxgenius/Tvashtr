# M-proof — the demo path proves itself end to end, in a real browser, locally AND in production

> Brief for the `/goal` of the same name. Written by the architect (Tvashtr Sidechat-12).
> Project root: `/Users/adimac/Desktop/Tvashtr`. Branch off `main` @ `47d97e5`.

---

## 0. Why this milestone exists

M-thrift (merged, `main` @ `47d97e5`) changed what a **newly created** team looks like:

1. `Settings.agent_max_output_tokens` (default 4096) is passed to all three OpenHands adapters' `LLM(...)`, so OpenRouter's pre-flight credit reservation can no longer refuse the run with a 402.
2. `_PROVIDER_DEFAULT_ORDER` is now `(nvidia_nim, openai, gemini, groq, deepseek, openrouter)`, so a multi-provider account's fresh team is stamped **NVIDIA NIM primary**, not OpenRouter.
3. `_stamp_account_defaults()` writes `config["fallback_model"]` on every model-bearing node = the default model of the owner's **second** held provider (per the same order). Fewer than two held providers ⇒ nothing written.
4. The vendored MIT `caveman` skill (`backend/tvashtr/skills/caveman/SKILL.md`) is stamped as an `inline`/`always` skill on **worker (`kind == "agent"`) nodes only**. Thinkers are deliberately untouched.

**None of that has ever been verified through the product's own UI, and none of it has been verified on the deployed app at all.** The deployed image at `https://tvashtr.fly.dev` predates M-thrift entirely.

This milestone closes that gap **permanently**: a re-runnable browser harness that walks the exact path the operator would walk in a live demo, on both the local stack and production, and fails loudly if any part of it regresses.

It also retires a standing §15 complaint: *"sign-off harnesses deleted after use so no hosted end-to-end proof exists."* **These two targets are permanent. Do not delete them at the end of the run.**

---

## 1. Deliverable

Two Makefile targets, both committed and both documented in `make help` in the house style:

| Target | Against | Sandbox | Purpose |
|---|---|---|---|
| `make demo-proof` | the LOCAL stack (Vite + backend, hosted mode ON) | `local` | the fast, cheap, debuggable leg — must be green first |
| `make demo-proof-prod` | `$(TVASHTR_DEPLOY_URL)`, default `https://tvashtr.fly.dev` | `fly` (whatever prod is configured for) | the leg that proves the thing the operator actually demos |
| `make demo-proof-login` | prod, HEADED browser | — | one-off: the operator completes GitHub OAuth by hand; Playwright saves the session for the prod leg (§2) |

One shared harness (a `scripts/demo_proof.py`, or a `.sh` + `.py` pair matching the existing `*_e2e.sh` house pattern — follow whichever the neighbouring harnesses use, e.g. `scripts/memory_shelf_e2e.sh`, `scripts/team_library_e2e.sh`), parameterised by base URL, credentials source, and expected sandbox. **Do not fork two near-identical scripts.**

Both targets:
- Skip cleanly (exit 0 with a clear "skipped: <reason>" line) when their credentials are absent, matching the house convention — **except** where §6 says to stop with `NEEDS_HUMAN` instead.
- Write one screenshot per numbered check into `artifacts/demo-proof/<leg>/NN-<slug>.png`. Add `artifacts/` to `.gitignore` if it is not already ignored.
- Are **NOT** added to `make test` (they need live credentials and spend real money).

---

## 2. Environment per leg

### Local leg (`make demo-proof`)
- `TVASHTR_HOSTED_MODE=true` — this is what turns the launch panel's repo picker into the **GitHub App** picker rather than the local-path field. Without it there is no PR at the end and the leg is worthless.
- `TVASHTR_AGENT_SANDBOX=local` — a real GitHub clone + a real PR, but no Fly microVM, so the leg is minutes and cents.
- `GITHUB_APP_*` from `.env` (the same set `make github-pr-e2e` uses).
- Postgres up + migrated + `make seed` (the seeded operator account is the login).
- A provider key set on the seeded account such that it holds **≥2** catalogued providers, one of which is `nvidia_nim`.

**Login (local).** The hosted-mode auth wizard renders **only** a "Continue with GitHub" link — there is no email/password form on screen (`AuthWizard.tsx`, the `hosted` branch). But `POST /api/auth/login` is **not** gated by `hosted_mode`, and the seeded operator has a real bcrypt password. So the local harness authenticates by posting those credentials, which sets the genuine signed `tv_session` cookie in the browser context, and then navigates to the dashboard. `scripts/operator_session.py` is the existing shared helper — reuse it rather than writing a third login path.

**GitHub installation (local) — do not skip this.** The seeded account has `github_user_id = NULL`. `routers._backfill_github_installations` matches installations to users **by GitHub account id**, so it can never attach one to the seeded account, and `GET /api/github/repos` returns an empty list — the launch panel's repo picker would be empty and C9 would stall. The established fix is the one `scripts/github_pr_e2e_check.py::_seed_operator_installation` already uses: write the `GithubInstallation` row directly for the seeded operator. Reuse that helper (extract it to a shared module if that is cleaner than importing across scripts — say which you did and why). Installation id from `TVASHTR_PROOF_INSTALLATION_ID`, default `147133756`. This is a **local-only** fixture: never write installation rows against prod.

### Prod leg (`make demo-proof-prod`)
- Base URL `$(TVASHTR_DEPLOY_URL)`.
- Everything else is whatever prod is already configured with. **The harness must not mutate prod configuration**, must not write installation rows, and must not add provider keys.

**Login (prod) — Playwright `storageState`, and nothing else.** Prod is hosted mode, so GitHub is the identity provider. The operator's prod account was created through the OAuth callback and therefore carries `auth.UNUSABLE_PASSWORD_HASH` (`"!github-oauth-no-password"`), a sentinel `verify_password` can never match — **there is no password, and `POST /api/auth/login` will always 401 for it.** Do not try. Do not create a second prod account. Do not attempt to drive `github.com`'s own login form: it has 2FA and bot detection, and a harness that fights it will be permanently flaky.

Instead:

1. `make demo-proof-login` launches a **headed** Playwright browser at `$(TVASHTR_DEPLOY_URL)`, and prints one clear instruction telling the operator to click **Continue with GitHub** and finish the OAuth. It then waits (generously — a minute or two) for the dashboard to appear, asserts `GET /api/auth/me` returns 200, writes `context.storageState(path=...)` and exits with a line naming the file and its expiry date.
2. The state file lives at a fixed, **gitignored** path — `.playwright/prod-session.json` or similar. It is a live session credential: add it to `.gitignore` in the same commit, never print its contents, never commit it.
3. `make demo-proof-prod` loads that state into the browser context and, **as its very first action**, calls `GET /api/auth/me`. A 401 or a missing file means the session is stale or absent: fail immediately with the exact remedy — "run `make demo-proof-login` and retry" — not a confusing failure forty steps later.

The `tv_session` cookie's `SESSION_MAX_AGE_SECONDS` is **14 days**, so this is a rare one-off, not a per-run chore. The cookie captured is the *same* signed cookie `auth.github_callback` issues, so nothing about the identity path is stubbed.

### Target repository (both legs)
`TVASHTR_PROOF_REPO`, default `lazyxgenius/trade_mcp`. The harness reads the account's repos from the launch panel's own picker (which is backed by `GET /api/github/repos`). If `TVASHTR_PROOF_REPO` is not among them, stop with `NEEDS_HUMAN` and **list the repos that were offered** so the operator can pick one.

### Feature request text
A single constant in the harness, overridable via `TVASHTR_PROOF_IDEA`. It must be:
- **small, additive, single-file** — so the Engineer finishes in one or two rounds;
- **behaviour-preserving** — it must not change any existing code path, so the repo's existing tests still pass and the Reviewer has a fair chance to genuinely approve;
- **deterministic in name** — so the harness can assert on the shipped path.

A `docs/`-only or a new-module-with-its-own-test change is the right shape. Do not pick something that edits an existing module.

---

## 3. The checks, in order, with real selectors

These selectors were read off the current `main`. If any has drifted, **that is a finding** — fix the harness to the real DOM, and say so in the report.

> **React Flow gotcha (known, do not rediscover):** Playwright's full-page accessibility snapshot chokes on the canvas. Use targeted `page.evaluate` / locator queries on the specific selectors below, plus screenshots. Never snapshot the whole tree.

### C1 — Establish the session and land on the dashboard
Per §2: the local leg posts the seeded credentials to `/api/auth/login`; the prod leg loads the saved `storageState` and asserts `GET /api/auth/me` is 200 **before** anything else.

Then navigate to the dashboard and expect the greeting block (`.tv-dash__hello`, text starts "Good to see you,").
**FAIL** on an error banner (`.tv-dash__error`), or on the logged-out landing page / auth wizard rendering instead (that means the session did not take).

### C2 — Provider keys
Panel `section[aria-label="Your providers"]`, heading text `Provider keys`. Read the chips at `.tv-dash__prov-name`.
- **PASS** if the set has **≥2** entries **and** contains `nvidia_nim`.
- **FAIL** ⇒ `NEEDS_HUMAN`, naming exactly which of the two conditions failed and what was found. **Do not add keys programmatically on either leg** — the harness must never handle the operator's raw credentials.

Record the held set; C6 derives its expected value from it.

### C3 — New-team dialog
Click the button whose text is `New team`. Expect `div[role="dialog"][aria-label="New team"]`.
Expect five template cards at `.tv-dash__template-name`: `Blank`, `PM → Engineer`, `PM → Engineer ↔ Reviewer`, `PM → Architect → Engineer ↔ Reviewer`, `Full feature squad`.
**FAIL** on the text "Couldn't load the starter templates".

### C4 — Create the team
Type a unique name into `input[aria-label="Team name"]` — `demo-proof-<utc-timestamp>`, so re-runs never collide and the row is identifiable for cleanup.
Click the template card whose `.tv-dash__template-name` reads exactly `PM → Engineer ↔ Reviewer` (template key `review_loop`).
Click `Create team`. Expect the dialog to close and the canvas to open on the new team.

### C5 — Canvas model chips
On the canvas, three agent cards carry a role title at `.rf-node__role`: `Product manager`, `Engineer`, `Reviewer`. Each card's model strip is `.rf-node__model-text`.

**PASS** if all three read exactly:
```
nvidia_nim/meta/llama-3.3-70b-instruct
```
**FAIL** if any reads a slug beginning `openrouter/` — the reorder did not take for this account.

Screenshot the canvas.

### C6 — The Engineer's fallback model
Click the Engineer card's `.rf-node__model` strip. This selects the node and opens the config drawer scrolled to and flashing the Model section. Read `input[aria-label="Fallback model"]`.

**PASS** if its **value** (not its placeholder) is non-empty and equals the default model of the account's **second** held provider, walking `(nvidia_nim, openai, gemini, groq, deepseek, openrouter)`:

| second held provider | expected value |
|---|---|
| `openai` | `openai/gpt-4o-mini` |
| `gemini` | `gemini/gemini-2.0-flash` |
| `groq` | `groq/llama-3.3-70b-versatile` |
| `deepseek` | `deepseek/deepseek-chat` |
| `openrouter` | `openrouter/openai/gpt-4o-mini` |

Derive the expectation **in the harness** from the set read at C2 and the order above — do not hardcode one provider. `input[aria-label="Fallback model"]` reports `""` for the placeholder-only case, so assert on `.inputValue()`, never on visible text.

Repeat the same assertion for the **Product manager** and the **Reviewer** — `_stamp_account_defaults` stamps every model-bearing node, not just workers, and a partial stamp must not pass.

### C7 — Caveman on the workers
Still in the Engineer's drawer, the Skills block is `details.tv-skills`; its `summary` text should read `Skills · 1`. Expand it and read the row label at `.tv-skills__label`.
**PASS** if exactly one row, badge type `inline`, label `caveman`.
Repeat for the **Reviewer** (also `kind == "agent"`).

### C8 — Caveman NOT on the thinker
Open the **Product manager** drawer. Its `details.tv-skills > summary` must read exactly `Skills` with **no** ` · N` count, and the row list must be absent.
**FAIL** if caveman is present — the stamp leaked onto a thinker.

### C9 — Launch at a real repo
Click `Run this team`. Expect `div[role="dialog"][aria-label="Launch run"]`.
- Type the feature request into `textarea[aria-label="Feature request"]`.
- Turn on the toggle labelled `Work on a GitHub repo` (`aria-label="Work on a GitHub repo"`). In hosted mode this lazily fetches the account's repos.
- Select `TVASHTR_PROOF_REPO` in `select[aria-label="Repository"]`. If absent ⇒ `NEEDS_HUMAN` per §2.
- The base branch is the repo's read-only `default_branch` — assert it renders, do not try to change it.
- Click `Run`.

### C10 — Approve the human gates through the UI
The `review_loop` team parks at `prd_gate` (and may park at `escalation_gate` if the Engineer↔Reviewer cycle hits the cap). Each parked gate raises a human task rendered as `article.tv-task` with the pill text `Awaiting your approval` and an `Approve` button.

**The harness clicks that real `Approve` button.** It must **not**:
- call the resolve/approve API directly;
- set any force/auto-approve flag;
- force or stub the Reviewer's verdict.

Poll for a task card to appear, screenshot it, click `Approve`, and continue. Bound the wait sensibly and fail with the run's current status if nothing appears.

### C11 — Terminal state + a real PR
Poll the run until terminal. **PASS** requires all of:
- run `status == "completed"`;
- a **non-empty `pr_url`** — echo it;
- the workflow reached a terminal node.

Record and echo **how the ship was reached**: the Reviewer genuinely approved, or the escalation gate was approved by the human. Both are legitimate demo paths; the transcript must say which, because a run that only ever ships via escalation is a weaker proof and the operator needs to know.

### C12 — Cleanup
Delete the `demo-proof-<timestamp>` team from the dashboard (the delete confirm dialog is `aria-label="Delete <name>"`). Do **not** delete or close the PR — it is the artifact. Cleanup runs in a `finally` so a mid-way failure still tidies up.

---

## 4. Fixes in scope

### F1 — Whatever C1–C12 catch
Root cause each one. No harness-side workaround that papers over a product defect: if a chip shows the wrong slug, fix the stamping, not the assertion.

### F2 — `gateway.complete()` tries fallback candidates with the wrong credential

**The defect.** In `backend/tvashtr/gateway/gateway.py`, the candidate list is built as:

```python
candidates = [(model, request.api_key) for model in _ordered_models(request)]
```

`_ordered_models` is `[request.model, *get_settings().model_fallbacks]`. So every **static** fallback is tried with the **primary provider's** key. The shipped default `model_fallbacks` is `["openrouter/google/gemini-flash-1.5", "gpt-4o-mini"]`, so on the new NIM-primary default a thinker's hard failure sends the NVIDIA key to OpenRouter, gets a 401, and that 401 **replaces** the real error the operator needs to see. This is registered in `PROJECTPLAN.md` §15 as a live latent defect.

The per-node path is already correct — `team_run._resolve_model_and_key` / `_owner_api_key` resolve the fallback provider's own credential, and the per-node fallback is spliced in at index 1 ahead of the static list. **Do not touch that path.** This fix is about the static list only.

**The invariant to establish.** *A model candidate is never tried with a credential belonging to a different provider. A candidate for which no owner credential can be resolved is skipped, and the original primary error propagates unchanged.*

Implement it however is cleanest and most honest for the BYOK architecture. Two shapes both satisfy the invariant — choose one and justify it in the commit message:
- resolve each static candidate's own owner credential at candidate-build time, skipping candidates with none; or
- treat the static `model_fallbacks` list as inapplicable to owner-scoped requests (it is a pre-BYOK global-config concept), leaving the authored per-node `fallback_model` as the only fallback in BYOK mode.

Whichever you pick, a request with **no** owner scope (the direct/self-hosted caller) must stay byte-identical in behaviour to today.

**Reproduce first.** A test that fails on current `main`: a primary hard-failure on provider A must not result in an outbound call to provider B carrying A's key. Paste the RED output before writing the fix. Do not accept a test that would pass for the wrong reason — assert on the key actually handed to the second call, not merely on the call count.

**Do not** change the `model_fallbacks` default value as the fix. With the invariant above, a stale default becomes harmless on an account that holds none of those providers; rewriting the default would hide the structural bug rather than fix it.

### Explicitly OUT of scope
- **Backfilling existing teams.** `_stamp_account_defaults` fires at team creation only; teams already in the database keep their old primary and have no `fallback_model`. That is a separate milestone (`M-backfill`) with its own migration. Leave the §15 entry in place and do not touch it.
- Any change to `_PROVIDER_DEFAULT_ORDER`, the caveman skill content, or the adapters' `max_output_tokens` wiring. M-thrift shipped those; this milestone **proves** them.

---

## 5. Sequence — hard order, no reordering

1. Branch off `main` @ `47d97e5`.
2. Build the harness. Get **`make demo-proof` fully green locally**, including a real PR URL. Debug to green — do not hand anything to the operator.
3. Land F2 with its reproduce-first RED pasted.
4. Full gate: `make test`, `make lint`, `make build-frontend`, `make test-frontend`. All green, floors not regressed (**1153** backend / **421** vitest).
5. **Only now** `fly deploy`.
6. `make deploy-smoke` immediately after. This is the boot canary: the vendored `SKILL.md` is read at import time by `teams.py`, so a `.dockerignore` regression would crash `import teams` at prod boot and take the app down. If `deploy-smoke` is red, **roll back to the previous Fly release, then stop with `NEEDS_HUMAN`.**
7. `make demo-proof-prod` green, with a real prod PR URL.
8. Commit. `READY_TO_MERGE`.

---

## 6. Stop conditions → write `NEEDS_HUMAN` to `STATE.md` and stop

- Either account holds fewer than 2 provider keys, or does not hold `nvidia_nim`. **Name exactly what is held and what is missing.** Never add keys yourself.
- `TVASHTR_PROOF_REPO` is not among the repos the GitHub App grants. **List what was offered**, plus the install/manage link the panel renders.
- The prod session state file is missing, or `GET /api/auth/me` returns 401 with it loaded. Say exactly: run `make demo-proof-login`, complete the GitHub sign-in, and re-run. Do NOT try to work around it with a password, a new account, or by automating github.com.
- `make deploy-smoke` red after deploy — roll back **first**, then stop.
- A second, unknown problem that would need a broad or unproven change to fix. A **code-proven, contained, regression-guarded** fix may proceed without stopping.
- Turn cap: 40.

A mid-session `NEEDS_HUMAN` written while a run is still in flight has happened before on this project and was wrong. Before writing one, re-read the live state rather than a stale exit file.

---

## 7. Gotchas carried in from previous sessions

- **`.dockerignore`** carries `!backend/tvashtr/skills/**` specifically so `*.md` does not exclude the vendored `SKILL.md` from the image. Any new vendored non-code asset needs the same un-ignore. Do not "tidy" that line.
- **402 ≠ 429.** `_is_rate_limit()` deliberately suppresses failover on 429 (the retry envelope owns it); a 402 must fall through to the provider-failure path. Do not collapse the two.
- **zsh strips nothing.** Any shell block handed to the operator must be comment-free.
- **The agent never pushes.** `.git/config` has no remote and `protect-no-push.sh` is a `PreToolUse(Bash)` hook. The operator fast-forward-merges.
- **The migration set is frozen** (`protect-migrations.sh`, survives bypass). This milestone adds **no** migration; prove it by showing the versions-directory file count unchanged.
- Leave `prompts/*.md`, `PROJECTPLAN.md` and `HANDOVER.md` untracked from your side — the architect owns them. Commit only your own changed paths.

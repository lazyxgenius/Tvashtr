# HANDOVER — Tvashtr

> Written by **Tvashtr Sidechat-28**, closing out on 2026-11-01 (~21:15 IST).
> Read this, then `PROJECTPLAN.md`: the header line (line 6), the §15 block **"Sidechat-28 register"** (just above §16) and
> the §17 entry **"Tvashtr Sidechat-28"** (the last entry, just above §18). Skip the giant archived banner (line 9). Older
> context: §1's "Direction update (2026-10-31 — Sidechat-27)", the Sidechat-27/-26 registers and their §17 entries.

---

## 1. Where we are (checked on disk)

- **Production unchanged:** `origin/main` = **`8cf90334`** → Fly **v47** (image `deployment-01M69AGBH5GE81KC66970B4GM4` — the
  rollback target), alembic **0053**, Desktop **`desktop-v0.27.0`**. DBOS app versions in production: fly `c7320dd5…`.
- **Local `main` = `db8ab37f`** (both merges fast-forward, audited PASS):
  - **Google Cloud 1** (`5aa05280`…`97aadec0`, 8 commits) — a `vertex_ai` provider shown as "Google Cloud": Gemini on Vertex AI
    with a Google Cloud API key, so the operator's Google Cloud credits pay. No migration; DBOS versions unchanged.
  - **Models 1** (`64570b37`…`db8ab37f`, 11 commits) — the Models area (model tests). Migration **`0054_model_tests`** (frozen in
    the hook); a new durable workflow → app versions local **`cf35c932…`**, fly **`8e9305b7…`** (**the ship must drain**).
  - Floors on `db8ab37f`: `make test` **3746** passed / 1 xfailed; vitest **2815** (+ the known `CompareView.tsx:96` unhandled
    error); desktop **161**; `make lint` = ruff's 38-error baseline. `team_run.py` `9a22d313d5c9`; `@DBOS.` **78**.
- **Docs commit at this closeout (operator, before the ship)** — exactly these commands, from Terminal:
  ```
  cd /Users/adimac/Desktop/Tvashtr
  git checkout main
  git add HANDOVER.md PROJECTPLAN.md prompts/models-1.md prompts/models-1.launch.md prompts/models-1-design prompts/gcloud-1.md prompts/gcloud-1.launch.md prompts/ship-models-1.md prompts/ship-models-1.launch.md
  git commit -m "docs: Sidechat-28 closeout — Google Cloud 1 + Models 1 merged, the ship briefed"
  git show --stat HEAD
  ```
  It should list exactly 22 files: HANDOVER.md, PROJECTPLAN.md, the six briefs/launch files, and the design folder's 14
  (6 `.dc.html`, 7 `.png`, `README.md`).
  `STATE.md` stays untracked on purpose.
- **Push guard ON** (`remote.origin.pushurl = DISABLED-no-push-during-video-work`) — the operator unsets it only for the ship.
- `.env` now holds `GOOGLE_CLOUD_API_KEY` (shape `AQ.…`); the seed imported it into the operator's dev account. The key's project
  is `carbide-parser-435515-i6` ("My First Project") → billing account "My Billing Account 1", billing enabled (read via `gcloud`).
- Claude Pro plan; the operator's `gcloud` CLI is signed in on the Mac (sessions may use it **read-only**).

## 2. What happened this chat

1. **Models 1 briefed** from the approved "Tvashtr Models" canvas. The canvas can't be opened by a build session, so its six
   screens were copied into `prompts/models-1-design/` — the `.dc.html` sources plus PNG renders (rendered in the architect's
   container by loading each source with the design-system bundle and the app's token CSS).
2. **The operator asked for Google Cloud API keys** ("a lot of free credits"). Research: Google's Welcome/trial credits don't pay
   for AI Studio Gemini API keys (the existing `gemini` provider); they pay for **Vertex AI** (renamed "Gemini Enterprise Agent
   Platform"), which accepts a Google Cloud API key at `https://aiplatform.googleapis.com/v1/publishers/google/models/<id>:generateContent`
   with `x-goog-api-key`. LiteLLM 1.89's own `vertex_ai/` route needs a service account; its `gemini/` route + `api_base` reaches
   the same address with the key. → **Google Cloud 1** (`prompts/gcloud-1.md`): slug `vertex_ai`, one pure translation in
   `backend/tvashtr/google_cloud.py`, applied in a one-line hook in `gateway.complete()` and in `config.agent_llm_routing`.
3. Google Cloud 1 stopped once (NEEDS_HUMAN: an off-list e2e file). Rulings: approve `live-run.spec.ts` + `demo-proof.spec.ts`
   (its own copy of the provider order would have failed the next ship's gate); **fix `seat_probe.py`'s stale 400-token T2 cap**
   (the product has no such cap since M-unify — T2 now reads `default_max_tokens_per_call`) → Gemini 3 Flash passed the thinker
   seat too. Result: a Google-Cloud-only account runs PM, Engineer and Reviewer on Gemini 3 Flash; demo-proof C1–C12 passed with
   Google Cloud in every seat (trade_mcp#74).
4. **Models 1** re-pointed to `97aadec0` (live tests on Google Cloud + DeepSeek; prices for `vertex_ai/…` via `gemini/…`), built
   and merged. One `--amend` on a seconds-old revert commit (no content change) — accepted.
5. **The ship of both briefed:** `prompts/ship-models-1.md` + `.launch.md` (Sonnet 5.5 high).

## 3. Your job (Sidechat-29)

1. **Check the docs commit landed** (`git show --stat main`, `git hash-object <file>` = `git rev-parse main:<file>`): one commit on
   `db8ab37f` holding exactly the files in §1.
2. **The ship.** The operator launches `prompts/ship-models-1.launch.md` (its §0 is: docs commit, `fly auth whoami`, unset the push
   guard). When the session posts its SHIP REQUEST, the operator pastes it to you first: check every gate line, the drain (any
   parked runs named — a parked run can't resume on the new DBOS version), the PUSH_SCAN list, then tell him to paste the
   approval line. After SHIPPED: audit the report (release, alembic 0054, the smoke lines, the Neon snapshot name), give him the
   push-guard command, and walk him through the production first look one step at a time (add the Google Cloud key under
   Engines → make a model → run tests on Gemini 3 Flash).
3. **Then, in order (operator's call on timing):** (a) the small **gateway fix** — `complete()` lets a thinking model's empty
   response escape as a bare `IndexError` (no retry, no backup model); make it a provider error so retries and the backup apply
   (reproduce-first); (b) **M2 — the example builder** (agents draft tests and training examples from Domain files, citing
   sources; tests never used for training, shown with a lock) — **design its new screens in-chat first** (Artifact tool, Design
   type, Tvashtr Labs design system), then the brief; fold in the estimate fix for thinking models (learn each model's real
   output size from past runs).
4. Docs closeout at the end (§17 as-built, §15 register, header bump; HANDOVER rewrite; the next chat's first message).

## 4. Open items — context, not an agenda (say each once)

1. 🟡 **The operator's billing check:** Google Cloud Billing → Reports for "My Billing Account 1" / the project above — confirm the
   Vertex AI charges (~$0.20 so far across probes, runs and demo-proof) are paid by credits. If not, the next Google step is the
   **service-account login** (§15 Sidechat-28 (h)).
2. 🟡 Deferred from Sidechat-28 (§15 list a–m): estimates exclude thinking tokens; error verdicts shown as Fail; New-model
   subtitle wording; no per-account cap on concurrent test runs (before a wide release); token-counter network fetch (the ship
   times it); provider slugs instead of names on Engines rows/pickers (all providers); Vertex embeddings 404; 2.5 models 404 in
   `asia-southeast1`; the `test_skill_repo` fixture-id flake; Models reaches the Desktop with its next release; e2e specs' own
   provider maps; other providers' thinker verdicts were made at the stale 400 cap (re-probe `gemini` AI Studio sometime).
3. 🟡 Carried: `make test-frontend` exits non-zero on the `CompareView.tsx:96` unhandled error (every test passes); `make lint`
   stops at the 38-error ruff baseline; `make demo-proof-prod` needs `make demo-proof-login` first (stale session).
4. 🟡 Still on the table (operator's call): **M-desk-9** (carry on when a plan runs out; on hold); landing follow-ups (`/media/*.webp`
   MIME, mobile performance 71 < 85, the next Desktop release drops `dist-fe/media/`); Prune 2; S4b; the full film V4 (parked).
5. 🟢 Cleanup (when he asks): trade_mcp PRs #50–#74 (none merged); merged branches (`feat/gcloud-1`, `feat/models-1`,
   `video/demo-2min`, `feat/landing-1`, older); Code-tab worktrees (never prune from the VM); throwaway DBs; Docker image
   `tvashtr-ship`; `video/voice-venv` + the Hugging Face cache; `.taste-skill/`, `.hallmark/`; `artifacts/gcloud-1/`, `artifacts/models-1/`.

## 5. Things you most need to know

1. **Sessions run from the Claude desktop app's Code tab.** A launch package = (0) any Terminal step, (1) Code-tab setup (Local,
   the folder, branch `main`, worktree off, Auto, model + effort), (2) the full init prompt, (3) the full `/goal` (< 4,000 chars by
   Python `len`, requiring the CLI-RULES §4.7 eight-section FINAL REPORT) — always inline, every time. Briefs go in `prompts/`.
2. **Claude Pro plan:** one session at a time. **Sonnet 5.5 high** for procedural work (ships, small fixes); **Opus 5.5 high** for
   design and hard engineering; never ultracode or workflows; at most one subagent; `STATE.md` after each step. An "Opus limit"
   can be worked around with `/model sonnet`. Tell him to close finished sessions (his "keepwarm" plugin keeps them warm).
3. **A held session takes rulings as a normal message** (not a new `/goal`): after a NEEDS_HUMAN, give him a paste-in message with
   numbered rulings; the session continues the same goal.
4. **Screens are designed in this chat** (Artifact tool, Design type, the **Tvashtr Labs** design system
   https://claude.ai/artifact/Je8mftnyJPArcvNzP1Hvqj; namespace `DesignSystem_dbaa69`). A build session can't open a canvas: copy
   the `project/*.dc.html` sources into `prompts/<milestone>-design/` and render PNGs — in the architect's container, serve the
   folder with `artifact-type/dc-runtime.js` saved as `support.js`, inject the app's token CSS
   (`frontend/src/design-system/tokens/{colors,typography,spacing,extend}.css`, NOT `index.css`/`ds.css` — the bundle carries its
   own component CSS) and screenshot with Playwright at the canvas sizes.
5. **Model slugs are LiteLLM slugs; `vertex_ai/<id>` is the one exception** — it is translated in `tvashtr/google_cloud.py` to
   `gemini/<id>` + the Vertex base. Never send `vertex_ai/` to LiteLLM directly (a guard test fails). New model helpers (pricing,
   token counting) must go through `_priced_as` in `gateway.py`.
6. **Probe gates must read the product's real limits from settings** (the T2 lesson). Catalogue entries need evidence
   (`scripts/seat_probe.py`) and a listed price.
7. **DBOS hashes only workflow source;** a new workflow changes the app version → drain live runs before deploying (Models 1 did).
8. **Claims about the product must match the code** (on the web each run gets its own throwaway Fly microVM; on the Desktop each
   agent step works on its own temporary repo copy; Desktop subscription agents don't use library tools/MCP yet; never "open
   source" — "source on GitHub").
9. **Licences:** the one-file-studio skill (Reel 1 / f1–f5) is personal-use — never in the repo; TimesFM-3 weights non-commercial;
   check Unsloth Studio's licence before any bundling.

## 6. Gotchas that cost turns

- Reaching the Mac: `device_request_folder_access` for `/Users/adimac/Desktop/Tvashtr`, then `device_bash` (`$HOME/mnt/Tvashtr`).
  `PROJECTPLAN.md` is ~925 KB: read it with `sed -n` ranges and index it with `grep -nE '^#{1,3} '`. To edit it: stage it into the
  container, patch with a python script on unique anchors, check that the bytes only grew and the untouched ranges are identical,
  then commit it back with `expectedMtimeMs`. Read-only git only from the VM (`show`, `log`, `rev-parse`, `diff` with explicit
  revisions, `merge-base --is-ancestor`, ref files) — **never `git status`**.
- `.env` is fenced: check names only (`grep -o '^[A-Z_]*API_KEY'`), never values.
- The VM can't reach services on the Mac's localhost (no DB queries from here) — ask a session to read the DB.
- PUSH_SCAN known false positives: the pattern lists in `prompts/ship-*.md`; `EnginesStep.sheets.test.tsx:56`; made-up keys in
  `backend/tests/test_model_tests.py`, `backend/tests/test_google_cloud.py`, `frontend/e2e/google-cloud-key.spec.ts`; the pattern
  line in `guardrails.py`.
- e2e specs that log in by the password form need `TVASHTR_HOSTED_MODE=false`.
- A brief must not demand that a commit be "literally last" — allow formatting-only commits after it (no-amend rule).

## 7. Standing operator directives (carry these forward)

- Decide from the **product vision**, never from effort. **One design question at a time**; explanation above any picker, short
  labels. **Pair every decision with its user-facing UX.**
- **Cost efficiency** for user and operator is a design input — prefer the operator's Google Cloud credits for live calls.
- **Screens designed in-chat first** for unbuilt app screens. **Additive only** for the product.
- Two chat sequences: "Tvashtr-N" and "Tvashtr Sidechat-N". State the name on opening.
- Terse operator: "Proceed"/"Go"/"yes"/"done"/"merged"/"launch X" = ratification. "By the way" = short answer. "handover" = wrap up
  now. **When he's lost, stop and explain in two or three plain sentences what is happening and the one thing he needs to do.**
- **Procedures one step at a time.** **Complete copyable artifacts inline.** Merge commands always include `git checkout main`;
  `--ff-only` when FF-able, else `--no-ff`; say what the verify line prints. Before he pastes an approval line for a production
  step, have him paste the request to you first.
- Plain, everyday language; analogies help. **Evidence or nothing** — open screenshots yourself, read diffs, re-hash invariants.
- **Videos:** $0, the film's narrator, no new recording unless he asks.
- Security: the agent never pushes (ship sessions push only `main`, on the operator's approval); never `--force`/`reset --hard`; no
  Fly secrets changes; never print secrets; never open CLI credential files; `gcloud` read-only unless he approves a change; don't
  delete his files without asking.
- He likes to close a chat once nothing urgent is pending — say plainly what (if anything) is.

## 8. First message for the next chat

> You are Tvashtr Sidechat-29. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first — in `PROJECTPLAN.md` the header
> line, the §15 block "Sidechat-28 register" and the §17 entry "Tvashtr Sidechat-28"; skip the giant banner. Then: (1) check on
> disk that the Sidechat-28 docs commit landed; (2) help me ship Google Cloud 1 + Models 1 with `prompts/ship-models-1.launch.md`
> — I'll paste the ship session's request and report to you. I'm on the Claude Pro plan. Don't start work until you've read them.

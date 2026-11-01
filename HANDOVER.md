# HANDOVER — Tvashtr

> Written by **Tvashtr Sidechat-27**, closing out on 2026-11-01 (~09:20 IST).
> Read this, then `PROJECTPLAN.md`: the header line (line 6), §1's **"Direction update (2026-10-31 — Sidechat-27)"**
> (line ~44), the §15 block **"Sidechat-27 register"** (just above §16) and the §17 entry **"Tvashtr Sidechat-27"**
> (the last entry, just above §18). Skip the giant archived banner (line 9). Older context: the Sidechat-26/-25
> registers in §15 and their §17 entries.
> This chat wrote **no briefs**. Its design lives in the Claude Design canvas **"Tvashtr Models"**:
> https://claude.ai/artifact/Tvis4EKWWQxMzGsTB294wf (version 8, approved).

---

## 1. Where we are (checked on disk)

- **Production unchanged:** `origin/main` = **`8cf90334`** → Fly **v47** (image `deployment-01M69AGBH5GE81KC66970B4GM4`;
  rollback target v46 `deployment-01M52DHZM26THGADX25RFFSG65`), alembic head **0053**, Desktop **`desktop-v0.27.0`**.
  `team_run.py` `9a22d313d5c9`.
- **Local `main` = `ebba75ef`** — the Sidechat-26 docs commit, checked this chat: one commit on `8cf90334` holding exactly
  HANDOVER.md, PROJECTPLAN.md and six prompts; working copies byte-identical to it.
- **Docs commit at this closeout (operator):** `HANDOVER.md` + `PROJECTPLAN.md` only, on top of `ebba75ef`. Local until
  the next ship pushes `main`. `STATE.md` stays untracked on purpose.
- **Push guard ON** (`remote.origin.pushurl = DISABLED-no-push-during-video-work`, checked).
- The operator is on the **Claude Pro plan** (not Max) — see §5.

## 2. What happened this chat: a new direction

1. **The operator brought two YC W27 requests for startups.** (1) Small specialised foundation models per industry that
   work zero/few-shot at far less compute (examples: Jev — a decision model that returns a typed answer + probability;
   Google TimesFM-3, 330M params, weights non-commercial). (2) **"Own your intelligence"** — companies own and improve
   models on their own data: workflows → tests, expertise → training data, production failures → improvements, carried
   forward to each new base model.
2. **Ratified: Tvashtr = "agent teams that ship software AND build and improve your own models"** — both halves equal on
   the headline; additive (canvas, teams, gates, documents unchanged; a team's result can be a new model version as well
   as a PR). **Problem 1 as a business is out** (pretraining needs private industry data, domain depth, a GPU budget).
3. **The operator's hybrid = the Train path:** Adaption's "Invent a dataset" (describe a behaviour → a training-ready
   dataset) × **Unsloth** (fast fine-tuning). Tvashtr **plugs trainers in, never rebuilds them**; its edge is a dataset
   built by the customer's own agent team **from their Domain files**, every example citing its source, sample-checked by
   a Reviewer gate, kept as a versioned editable document; a **Score gate** publishes a version only if it beats the old
   one on the customer's own tests.
4. **Where training runs (operator):** the customer chooses per request — **their own machine** (Tvashtr first checks
   whether that machine can do *this* request) **or the cloud**. Consequence: on-machine training is a **Desktop** feature;
   the web app offers cloud only, with "use the Desktop app to train on your machine".
5. **Decision 1 (signed off) — training engines:** a new "training engine" slot like the agent engines. **Unsloth — on
   your machine** (Desktop) and **Together AI — cloud, the customer's own key** (checked: own-key training; Qwen 3.5/3.6,
   Llama, Gemma 4, gpt-oss bases; adapter + merged weights downloadable). Rejected: running Unsloth ourselves on rented
   GPUs. UX: Engines page gets a "Training" section; the Train step asks "Where to train: This machine / Cloud (Together)"
   and "This machine" runs the check at once in plain words (needs X GB, has Y GB); every version says where it trained and
   offers "Download files". **Risk carried:** Unsloth documents no way for another app to start a training job and its
   Core says Mac is "in the works" → the first on-machine milestone opens with a proof; fallback behind the same button:
   Apple's MLX trainer.
6. **Decision 2 (signed off) — first milestone = Model tests**, screens designed first (§3 has the scope).
7. **The design (approved 11-01):** canvas "Tvashtr Models", built in-chat on the **Tvashtr Labs** design system (its
   colour tokens = `frontend/src/design-system/tokens/colors.css`). Six screens: **Models list** (+ a "First time" state),
   **New model**, **Tests tab**, **Edit a test** (right drawer, AI judge), **Run tests** (cost first), **Results** (score
   cards + compare two models). **Operator change, applied:** models are **not listed one by one in the left menu**
   (unlike Domains) — only "Models"; a model's page keeps "Models" highlighted, with a breadcrumb back.
8. **Correction (architect):** Domains' Quality tab tests *search* (`DomainEvalCase`: expected files/keywords), not a
   model's answers → model tests need their own scorer.
9. **Later ideas, logged, not now:** a cheap judge trained on Tvashtr's own run data; decision models (typed verdict +
   probability) for Tvashtr's checks (today `agent_tests.ai_check` reads YES/NO from a chat model's first word).

## 3. Your job (Sidechat-28)

1. **Check the docs commit landed** (`.git/refs/heads/main`, `.git/logs/HEAD`, `git show --stat main`,
   `git hash-object <file>` = `git rev-parse main:<file>`): one commit on `ebba75ef` holding exactly HANDOVER.md and
   PROJECTPLAN.md.
2. **Write milestone 1 — Model tests:** brief `prompts/models-1.md` + `prompts/models-1.launch.md`, then the full launch
   package inline (Code tab, **Opus 5.5 high**, one session). Read the canvas as the visual spec: `Artifact` `read` of
   https://claude.ai/artifact/Tvis4EKWWQxMzGsTB294wf, files `project/{Main,NewModel,Tests,EditTest,RunTests,Results}.dc.html`
   (the brief should tell the session to rebuild from them; it can't open the canvas itself — copy what it needs into the
   brief or a `prompts/models-1-design/` folder).
   **Scope (decision 2):** a top-level **Models** area (menu item after Domains, **no per-model children**; Cmd-K "Open
   Models" beside "Open Domains" in `pages/home/paletteItems.ts`); a **model** = name + the job in one sentence + the kind
   of answer (Pick from a list with its choices → exact match / Write text → must contain or AI judge); a **test set** =
   cases (input, expected answer, scoring: exact match / must contain / AI judge with a rubric and a judge model), added by
   hand or CSV, **versioned on every save** (results stay tied to their version; compare only within one version); **run**
   on any model the customer holds a key for (reuse `resolve_owner_api_key` and the "Custom…" LiteLLM slug as Domains
   does), **estimated cost shown before running**; durable runner, one step per case (pattern:
   `control_plane/domain_eval.py`'s `run_domain_eval_workflow`); Results = score card per run (score, % passed, cost,
   speed, Best score / Lowest cost) + compare two models (only where they differ, agree/disagree counts).
   **Settle in the brief:** the tables + migration `0054` (freeze bump as the last step); how the estimate is priced
   (check LiteLLM's model price data; else show "price unknown"); a judge model's cost added to the run total.
   **Invariants:** additive only; `team_run.py` untouched; existing `@DBOS.` code untouched (a new workflow changes the
   DBOS app version → drain before the ship); Playwright self-sign-off with a screenshot per screen compared to the canvas;
   gates worded "no new finding; the exit code may stay non-zero" (§4 item 1). Live model calls in tests/e2e need a
   working provider (locally deepseek/groq worked; prod OpenAI is out of credit, Gemini 400).
   **Out of milestone 1:** agents drafting tests, the "never used for training" lock, datasets, training, versions, your
   own models in the picker.
3. **The road after it** (each new screen designed in-chat first): M2 example builder (agents draft tests + training
   examples from Domain files, citing sources; tests never used for training, shown with a lock) → M3 train in the cloud
   (Together) → M4 train on your machine (the check + Unsloth/MLX proof; a Desktop release — which also drops
   `dist-fe/media/`) → M5 Score gate, publish, your models in the model picker, serving → M6 carry forward to a new base
   model. Order may change once M1 lands.
4. **Still on the table (operator's call when):** **M-desk-9** (carry on when a plan runs out — proposed three times, on
   hold; first design question when he says go: switch plans automatically or always ask); **landing follow-ups**
   (`/media/*.webp` served as `application/octet-stream` → `mimetypes.add_type("image/webp", ".webp")`; mobile performance
   71 < 85; the next Desktop release leaves out `dist-fe/media/`); **Prune 2**; **S4b**.
5. Docs closeout at the end (§17 as-built, §15 register, header bump; HANDOVER rewrite; the next chat's first message).

## 4. Open items — context, not an agenda (say each once)

1. 🟡 `make test-frontend` exits non-zero on one unhandled error at `CompareView.tsx:96` (on `main` before; every test
   passes). `make lint` stops at the 38-error ruff baseline (identical set since `6b35addc`).
2. 🟡 `make demo-proof-prod` needs `make demo-proof-login` first (its saved session went stale).
3. 🟡 The full ~7½-min film (V4) stays parked; it could become a "Full walkthrough" link under the demo.
4. 🟡 Product notes carried from Sidechat-25: a test replay doesn't carry the Tests check's result; Claude Opus 5.5 isn't
   a model-picker preset; "$0.00 in all" beside subscription cards; Now bar / Activity name checks by kind; the run
   drawer's lower area is short; Import lists "Add a key for anthropic" twice; e2e flakes (steering@1280×720, work_brief);
   no in-app notice when a run stalls while the Desktop is in front; the "1 library tool(s)" banner on every Desktop run;
   resuming after a check doesn't re-seed its note; a Query domain step with no reading key fails mid-run; AI checks need
   server checks-model secrets; `protect-no-push.sh` not registered; the Desktop runner's env leak (`harness/spawnEnv.cjs`);
   prod providers (OpenAI out of credit, Gemini 400).
5. 🟢 Cleanup (when he asks): trade_mcp PRs #50–#73 (none merged); merged branches (`video/demo-2min`, `feat/landing-1`,
   older); Code-tab worktrees (never prune from the VM); throwaway DBs; Docker image `tvashtr-ship`; `video/voice-venv` +
   the Hugging Face cache; the reel folder's `cache/`; `.taste-skill/` and `.hallmark/`.

## 5. Things you most need to know

1. **Sessions run from the Claude desktop app's Code tab.** A launch package = (0) any Terminal step, (1) Code-tab setup
   (Local, the folder, the branch, worktree off, Auto, model + effort), (2) the full init prompt, (3) the full `/goal`
   (< 4,000 chars, requiring the CLI-RULES §4.7 eight-section FINAL REPORT) — always inline, every time. Briefs go in
   `prompts/` (architect-direct).
2. **Claude Pro plan:** run sessions **one at a time**. **Sonnet 5.5 high** for procedural work (small fixes, ships);
   **Opus 5.5 high** for design and hard engineering (milestone 1 is Opus); never ultracode or workflows; at most one
   subagent; `STATE.md` after each step (a usage-limit pause waits and continues if the session stays open and the Mac
   awake; an "Opus limit" can be worked around with `/model sonnet`). Tell him to close finished sessions (his
   "keepwarm" plugin keeps a finished session's cache warm for hours).
3. **Screens are designed in this chat** (operator, 10-31): the Artifact tool's Design type + the **Tvashtr Labs** design
   system (https://claude.ai/artifact/Je8mftnyJPArcvNzP1Hvqj; namespace `DesignSystem_dbaa69`, installed on a canvas as
   `project/ds/designsystem_dbaa69/` + a `designSystems` record; mount its real Button/Badge/Tabs/Input/Select/Checkbox;
   the app shell's sizes are in `frontend/src/pages/shell/shell.css`). No separate design brief.
4. **One stack, one Desktop on this Mac.** `/goal` loops keep going until satisfied; at a valid NEEDS_HUMAN stop the
   operator ends it with `/goal clear`. Word gates with known baseline failures as "no new finding; the exit code may stay
   non-zero" or the checker loops.
5. **Evidence or nothing:** open screenshots and frames yourself; read diffs; re-hash invariants; check product claims
   against the code before building on them (this chat's Domains correction).
6. **Claims about the product must match the code**: on the web each **run** gets its own throwaway Fly microVM; on the
   Desktop each agent step works on its own temporary repo copy; Desktop subscription agents don't use library tools / MCP
   yet; stalled runs show in Needs you; never "open source" ("source on GitHub").
7. **DBOS hashes only workflow source**; keep `@DBOS.`-decorated code untouched in unrelated work (75 decorators); a new
   workflow changes the app version → drain live runs before deploying.
8. **Licences:** the one-file-studio skill (Reel 1 / f1–f5) is personal-use — its files never enter the repo;
   taste-skill, gsap-skills and hallmark are MIT (user-level `~/.claude/skills/`). TimesFM-3's public weights are
   non-commercial. Check Unsloth Studio's licence before any bundling (not stated on its install page).

## 6. Gotchas that cost turns

- Reaching the Mac: `device_request_folder_access` for `/Users/adimac/Desktop/Tvashtr` first, then `device_bash`
  (`$HOME/mnt/Tvashtr`). The older filesystem tool couldn't upload the 900 KB `PROJECTPLAN.md` — read it with `sed -n`
  on line ranges and index it with `grep -nE '^#{1,3} '`. Read-only git only (`show`, `log`, `rev-parse`, `diff` with
  explicit revisions, `ls-files`, `config --get`, `hash-object` without `-w`, ref files) — **never `git status`**.
- Writing docs: python read-modify-write on a unique anchor, backup in the VM's `$HOME` first. Line 6 is the header.
- PUSH_SCAN flags our own briefs' pattern lists (`prompts/ship-*.md`) and one 33-char test placeholder in
  `EnginesStep.sheets.test.tsx:56` (public since before) — known false positives.
- `.env` is fenced. Never run tests next to a live stack; never `make test` on `tvashtr_film`.
- A Design canvas: write `project/canvas.json` first, then one artboard file per publish; the Design type says not to
  render-check unless the operator asks.

## 7. Standing operator directives (carry these forward)

- Decide from the **product vision**, never from effort. **One design question at a time**; explanation above any picker,
  short labels. **Pair every decision with its user-facing UX.**
- **Cost efficiency** for user and operator is a design input. **Don't shy from large scope**; on Pro, sessions one at a
  time.
- **Screens designed in-chat first** for unbuilt app screens (no separate Claude Design brief). **Additive only** for the
  product.
- Two chat sequences: "Tvashtr-N" and "Tvashtr Sidechat-N". State the name on opening.
- Terse operator: "Proceed"/"Go"/"yes"/"done"/"merged"/"Signed off" = ratification. "By the way" = short answer.
  "handover" = wrap up now. **When he's lost, stop and explain in two or three plain sentences what is happening and the
  one thing he needs to do.**
- **Procedures one step at a time.** **Complete copyable artifacts inline.** Merge commands always include
  `git checkout main`; `--ff-only` when FF-able, else `--no-ff`; say what the verify line prints. Before he pastes an
  approval line for a production step, have him paste the request to you first.
- Plain, everyday language; analogies help. **Evidence or nothing.**
- **Videos:** $0, the film's narrator, no new recording unless he asks.
- Security: the agent never pushes (ship sessions push only `main`, on the operator's approval); never `--force`/
  `reset --hard`; no Fly secrets changes; never print secrets; never open the CLI credential files; don't delete his files
  without asking.
- He likes to close a chat once nothing urgent is pending — say plainly what (if anything) is.

## 8. First message for the next chat

> You are Tvashtr Sidechat-28. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first — in `PROJECTPLAN.md`
> the header line, §1's "Direction update (2026-10-31 — Sidechat-27)", the §15 block "Sidechat-27 register" and the §17
> entry "Tvashtr Sidechat-27"; skip the giant banner. Then: (1) check on disk that the Sidechat-27 docs commit landed;
> (2) write milestone 1 (Model tests) — its build brief and the full launch package — from the approved "Tvashtr Models"
> design. I'm on the Claude Pro plan. Don't start work until you've read them.

# Brief — Models 1: Model tests (the first milestone of "build and improve your own models")

Architect: Tvashtr Sidechat-28, 2026-11-01. Path: `/Users/adimac/Desktop/Tvashtr/prompts/models-1.md`.
`prompts/` (this brief, `models-1.launch.md`, the folder `prompts/models-1-design/`), `HANDOVER.md`, `PROJECTPLAN.md` and
`design/` belong to the architect: never edit, stage or commit them. `STATE.md` is your log (git-ignored) — write to it after
every step. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins.

## Why

Tvashtr's new direction (PROJECTPLAN §1 "Direction update (2026-10-31 — Sidechat-27)"): **agent teams that ship software AND
build and improve your own models.** Every later step — datasets, training, the Score gate that publishes a new version only
if it beats the old one — needs the customer's own tests first. Tests are also useful on their own today: "which model I can
rent does my job best, and for how much?" This milestone builds that: a **Models** area where a customer describes one job,
writes real test cases with the right answers, runs them on any model they hold a key for (the cost shown before running),
and compares the results.

## What this session is — and isn't

- **One branch `feat/models-1` from `main` = `97aadec0`.** Code + tests + one new migration (`0054`). No push, no deploy, no
  Desktop release, no Fly, no Neon. The operator merges after the architect's audit; it ships later in its own ship session.
- **Additive only.** Nothing that exists today changes behaviour. The only edits to existing files are the hook-ups listed
  under "Existing files you may touch". Tests whose DOM legitimately changes because of the new menu item are re-pointed
  (listed in the report), never weakened or deleted.
- **Out of this milestone** (later milestones — don't build, don't stub in the UI): agents drafting tests, the "never used for
  training" lock, datasets, training, model versions, your own models in the model picker, Desktop-subscription models
  (Claude/Grok plans) as test targets, counting test runs in Home's spend card.
- **Claude Pro plan:** one session, Opus 5.5 at high effort. No ultracode, no dynamic workflows, at most one subagent at a time.
  If a usage limit pauses you, `STATE.md` must let you (or a fresh session) continue exactly where you stopped.

## State on disk (checked by the architect, 2026-11-01)

- `main` = `97aadec0` = **Google Cloud 1** (merged fast-forward, 8 commits) on `52986900` (docs) on `ebba75ef` (docs) on
  `8cf90334`. `origin/main` = `8cf90334` = production (Fly v47, alembic `0053`, Desktop `desktop-v0.27.0`). Push guard:
  `remote.origin.pushurl` = `DISABLED-no-push-during-video-work`.
- **Google Cloud 1 is new on `main`:** a `vertex_ai` provider shown as "Google Cloud" — Gemini on Vertex AI with a Google Cloud
  API key, so the operator's Google Cloud credits pay. The translation lives in `backend/tvashtr/google_cloud.py`
  (`call_settings(slug, key)`: `vertex_ai/<id>` → LiteLLM `gemini/<id>` + the Vertex `api_base`); `gateway.complete()` applies
  it in one hook line and `config.agent_llm_routing` for agents. Catalogue: `vertex_ai/gemini-3-flash-preview` is the default of
  both seats, `vertex_ai/gemini-3.5-flash` a preset; `vertex_ai` leads `_PROVIDER_DEFAULT_ORDER`.
- Floors on `main` (STATE.md, Google Cloud 1's final report): `make test` on `tvashtr_gate` **3591 passed / 1 xfailed**; vitest
  **271 files / 2757** plus one known unhandled error at `CompareView.tsx:96` (`frontend/src` unchanged since that run); `tsc`
  0; build ok; desktop **161**; `make lint` stops at ruff's **38-error baseline** (identical set since `6b35addc`), eslint 0,
  prettier clean. One known random failure: `test_skill_repo::test_scan_reads_a_private_repo_through_the_owners_app_installation`
  (its fixture id can collide with an old row in `tvashtr_gate`) — if it fails, re-run that file alone and say so.
- `backend/tvashtr/control_plane/team_run.py` blob `9a22d313d5c9`. `@DBOS.` decorators under `backend/tvashtr`: **75**. DBOS
  application versions on `97aadec0` (unchanged since `8cf90334`): local `3011d7ac6e4e7c30d0ad38372dfc32a3` (60 workflows) / fly
  `c7320dd5c7e4b8866eefbd9174226f71` (63) — computed "no DB, import + registry hash" as in STATE.md's SHIP LANDING-1 entry.
- Alembic head `0053_desktop_routes`; `.claude/hooks/protect-migrations.sh` freezes `0001–0053`.
- The working tree holds many **untracked files that are the operator's** (`design/`, `graphify-out/`, `STATE.md`, …). Never
  touch, stage, move or delete an untracked file you didn't create.
- `.env` holds (names only — never print a value) `GOOGLE_CLOUD_API_KEY` (Google Cloud — the operator's credits pay, so prefer
  it for live calls), `DEEPSEEK_API_KEY` and `GROQ_CLOUD_API_KEY`; all worked locally. Production's OpenAI key is out of credit
  and Gemini (AI Studio) answers 400 — don't depend on either.

## The design — what to build, screen by screen

The operator approved six screens in a Claude Design canvas you can't open. Everything is copied into
**`prompts/models-1-design/`**: read its `README.md` first. Each screen has its source (`*.dc.html`: exact words, order, sizes,
colours) and a picture (`*.png`, 1440 wide). Build each screen to match its source and picture, using the app's real shell and
design-system components (`frontend/src/design-system/components`: Button, Badge, Tabs, Input, TextArea, Select, Checkbox,
Dialog, Sheet, ConfirmDialog, Menu) and the existing `tv-seg` segmented control. The sample data in the sources is what the
pictures show; your screens show real data.

1. **Models (the list)** — `Main.dc.html`, both states. A new menu item **Models** right after Domains (lucide `Box` icon), with
   **no per-model children** (the operator's change). The menu foot note on every Models page: "**Models** start with tests:
   real cases with the right answers, so you can see how well any model does your job." First time: the centred card "Every
   model starts with its tests", three steps, **New model**. With models: one card per model — name (serif), the job, a status
   badge, chips (`50 tests` · `Pick from a list · 6 choices` or `Write text` · `Test set v4`), and "Best on your tests": up to
   three runs on the current test set version, best score first (ties: lower cost first), each `Provider model-name`,
   `46 / 50`, `$0.21 for all 50`. A model never run shows "No results yet. Run its tests to see how models do." and a **Run
   tests** button (opens the Run tests dialog for it). Clicking a card opens the model.
2. **New model** — `NewModel.dc.html`. Name; "The job, in one sentence"; "What kind of answer?" — **Pick from a list** (scored
   by exact match) or **Write text** (scored by key words or an AI judge); for Pick from a list, "The choices" as removable chips
   with "Add a choice and press Enter" and the hint "Every test's expected answer must be one of these." **Create model** opens
   the new model's page on its Tests tab.
3. **A model — Tests tab** — `Tests.dc.html`. Breadcrumb `Models / <name>` (Models links back; the menu keeps Models
   highlighted). Header: name, job, **Import CSV**, **Add test**, **Run tests**. Tabs **Tests** (count) · **Results** (count of
   runs on the current version) · **Settings**. A line with the version chip `Test set v4`, "Edited 2 h ago by you", **History**;
   for choice models "Answers are one of:" with the choices. The table: #, Input, Expected answer, Scored by, **Last run** (see
   the rules), and a ⋯ menu per row (**Edit**, **Delete**). Clicking a row opens it in the drawer. Shows the first 25 tests, then
   "Showing 25 of 50 tests" + **Show all 50**.
4. **Edit a test** — `EditTest.dc.html`. A right drawer beside the table (the row stays highlighted), with an expand control
   ("Open as a pop-up") that shows the same content as a centred pop-up and a control back ("Dock to the side") — the pattern of
   `panel/NodeHeader.tsx`'s Focus mode / Dock to the side — and Close. Title `Test 7` (or `New test`), subtitle `<model> · test set v2`. Input;
   Expected answer; **How to score** (`tv-seg`: Exact match / Must contain / AI judge) with its hint; for AI judge: "What a right
   answer must do" and **Judge model** ("The judge runs on your key too. Its cost is added to each run's total."); the **Last
   run** box (each run's verdict, and the judge's reason when there is one); footer "Saving makes test set v3. Earlier results
   stay tied to v2." with **Delete test**, **Cancel**, **Save test**.
5. **Run tests** — `RunTests.dc.html`. "All 50 tests from test set v4 of Claims triage". "Which models?": one row per model with a
   checkbox, `Provider model-name`, "Your <Provider> key", and "about $0.21" on the right; a model whose provider has no key is
   disabled with "No <Provider> key yet" and **Add a key**; **Custom model…**. The **Estimated cost** box ("about $0.23", the
   models × tests line, the judge line, "The estimate uses each model's listed price and the length of your tests. The real cost
   shows when the run ends."), "You can leave this page. Results fill in on the Results tab as each test finishes.", **Cancel**,
   **Run 50 tests on 2 models**.
6. **Results** — `Results.dc.html`. Version chip, "3 runs on this version", **Runs on earlier versions (2)**. One score card per
   run: provider + model name, the badges **Best score** / **Lowest cost**, the score `46 / 50` (serif) with "92% passed", a bar
   (sage for the best, stone for the rest), and `$0.21 for all 50` · `1.4 s per answer` · `2 h ago`. **Compare two models**:
   First / Second selects (`model-name · 46 / 50`), the `tv-seg` **Only where they differ (7)** / **All 50**, the sentence "They
   agree on 43 of 50 tests (40 both right, 3 both wrong). A is right on 6 where B is wrong; B is right on 1 where A is wrong.",
   the table (#, Input, Expected, each model's answer as a green ✓ or red ✗ chip with the answer exactly as given), and the
   foot note "Only runs on the same test set version are compared. Each answer is shown exactly as the model gave it."

**Screens the canvas doesn't draw** — build them in the same style from the same components, with these words:

- **Settings tab:** "Name" (Input + **Save name**); "The job, in one sentence" (TextArea); "The choices" (choice models only,
  chips as in New model); hint "Changing the job or the choices makes a new test set version, since models see them with every
  test."; **Save changes**; "Kind of answer: Pick from a list — set when the model was made." (read-only); **Delete this model**
  → ConfirmDialog "Delete Claims triage?" / "Its 50 tests, every test set version and every result are deleted. This can't be
  undone." / **Delete model**.
- **Import CSV dialog:** title "Import tests from a CSV". Body: "The first row names the columns. You need input and expected.
  For Write text models you can add scoring (exact, contains or judge), must_contain (phrases split by ;), rubric and
  judge_model." **Choose a CSV file**. After choosing: either "12 tests ready to import. They become test set v5." with
  **Import 12 tests**, or the errors as a list — "Line 3: “Moto” isn't one of the choices." — and "Fix the file and choose it
  again. Nothing was imported."
- **History** (a right Sheet): title "Test set history"; one row per version, newest first — `v4` · the change note · "you" ·
  "2 h ago" · "3 runs" · **View**. Viewing an older version shows its tests read-only with a banner "You're looking at test set
  v2. It can't be changed." + **Back to v4** + **Restore as v5**.
- **Delete a test:** ConfirmDialog "Delete test 7?" / "This makes test set v5 without it. Earlier results stay tied to v4." /
  **Delete test**.
- **Empty states:** Tests tab with no tests — "No tests yet" / "Add a test by hand, or import a CSV with the columns input and
  expected." + **Add test** + **Import CSV** (Run tests disabled, title "Add a test first"). Results with no runs on this version
  — "No runs on test set v4 yet." / "Run its tests to see how each model does, and for how much." + **Run tests**. Compare with
  fewer than two finished runs — "Compare needs two finished runs on this version."
- **Run card states:** running — "23 of 50 done", a coral progress bar, the score so far, and a ghost **Stop**; stopped — badge
  "Stopped", "Stopped after 23 of 50"; failed — "This run failed: <reason>" + **Run again**; any answers that couldn't be scored —
  "2 couldn't be scored" in amber, its title the first reason. A run with a judge adds the line "Includes $0.01 for the AI
  judge." A model with no listed price shows "cost not listed" instead of the dollar figure.
- **Models card badge:** "Tested 2 h ago" (success, dot) when the current version has a finished run; "Not run yet" (neutral);
  "Tests changed since last run" (warning) when runs exist only on older versions — then the card says "Its tests changed since
  the last run. Run them again to see scores." + **Run tests**.
- **Cmd-K:** "Open Models" right after "Open Domains" (`pages/home/paletteItems.ts`, icon of your choice from the existing set).

Words for errors (shown in place, from the server's 422 detail where the server checks it): "Give it a name." · "That name is
taken. Pick another." · "Describe the job in one sentence." · "Add at least two choices." · "That choice is already in the
list." · "Write the input first." · "Write the expected answer." · "The expected answer must be one of the choices." · "Add at
least one word or phrase it must contain." · "Say what a right answer must do." · "Pick a judge model." · "You can have up to
500 tests." · "Type it as provider/model, like groq/llama-3.3-70b-versatile." · "Pick at least one model." · "You have no key
for: <provider>. Add it under Engines first."

## Product rules

**A model** = name (≤ 80 chars, unique per account ignoring case) + the job in one sentence (≤ 500) + the kind of answer, set
at creation and never changed: `choice` (Pick from a list: 2–50 choices, each ≤ 80 chars, unique ignoring case) or `text`
(Write text). Owner-scoped: another account gets 404 "model not found".

**A test** = input (≤ 20,000 chars) + expected answer (≤ 5,000) + how it's scored:
- `exact` — the answer equals the expected answer after normalising both: trim; strip surrounding quotes, backticks, asterisks
  and brackets; drop one final `.`; collapse runs of whitespace; ignore case. Choice models always use `exact`, and their
  expected answer must be one of the choices (the drawer shows a Select of the choices and only "Exact match", hint
  "Pick-from-a-list tests are scored by exact match.").
- `contains` — every phrase in "Words it must contain" (1–20 phrases, each ≤ 200) appears in the answer, ignoring case and
  whitespace runs. Drawer field: "Words it must contain", helper "Each word or phrase must appear in the answer. Case doesn't
  matter.", chips + "Add a word or phrase and press Enter". Fail reason: `Missing: "high urgency"`.
- `judge` — an AI judge reads the answer against the rubric ("What a right answer must do", ≤ 2,000) on a judge model the
  customer picks (its own key). Text models default a new test to `contains`; the judge model defaults to the last judge used
  in this model, else the account's default thinking model (`control_plane/teams.py` `account_default_model`). The judge
  picker offers the same models as the Run tests dialog (held providers only) + **Custom…**.

Hints under How to score: Exact match — "The answer must match the expected answer. Case, spaces and a final full stop don't
matter." · Must contain — "The answer passes if it contains every word or phrase below." · AI judge — as designed.

**Test set versions.** Every save makes a new version: add, edit, delete, CSV import, restore, and a change of the job or the
choices (Settings — the model sees both with every test). A version never changes after it's made. Change notes: "Added test 7",
"Edited test 7", "Deleted test 7", "Imported 12 tests from claims.csv", "Changed the job", "Changed the choices", "Restored v2".
A model starts with no version; the first saved test makes v1. ≤ 500 tests per version. Renaming the model is not a version.

**Running tests.** The customer picks 1–6 models. A model is any `provider/model` slug: the dialog lists every catalogued
provider's thinker presets (`GET /api/config` → `provider_catalogue`, `thinker_presets` + `model_labels` + `label`; never
`nvidia_nim`, whose catalogued slugs are retired), the held providers' models first and enabled, then for each provider the
account holds no key for, its `thinker_default` disabled with **Add a key** (opens the existing `AddKeySheet` in place —
copy the pattern of `pages/domains/domainKeys.tsx`). **Custom model…** takes any `provider/model`. Pre-checked: the models of
this model's last run, else the account's default thinking model. Each chosen model starts **one run** = that model on the
current version, all its tests. The server refuses with 422 `missing_providers` (naming every provider without a key —
including the judge models' providers), 422 when there are no tests, or more than 6 models.

What each tested model is sent (fixed; tests check the exact messages):
- choice — system: `{job}\n\nReply with exactly one of these choices and nothing else:\n- {choice 1}\n- {choice 2}…`;
  user: `{input}`.
- text — system: `{job}`; user: `{input}`.
- `temperature=0`; `max_tokens` 1024 (choice) / 2048 (text) — room for thinking models.

An empty answer fails ("The model gave an empty answer."). A call that errors after the gateway's retries is an **error**
verdict with the error's first line. **If the gateway answered with a different model than the one tested**
(`CompletionResult.model_used != slug`, possible through the static `model_fallbacks`), the case is an error "Answered by
<model_used>, so it isn't counted." — never scored as the tested model.

The judge prompt (fixed; one user message, `temperature=0`, `max_tokens=1024`):

```
You are grading one answer for this job: {job}

The input:
{input}

The expected answer:
{expected}

What a right answer must do:
{rubric}

The answer to grade:
{answer}

Reply with JSON only: {"pass": true or false, "reason": "one short sentence"}
```

Parse the first JSON object; else a first word PASS/FAIL (YES/NO); anything else is an error "The judge's reply couldn't be
read." The reason (≤ 300 chars) is stored and shown as `Judge: "…"`.

**Score** = passed / tests in the run. Errors count as not passed and are shown apart ("2 couldn't be scored"). Cost of a run =
the tested model's calls + the judge's calls (stored separately, shown together). Speed = the mean latency of the tested
model's answers (the judge's time excluded), shown to one decimal ("1.4 s per answer").

**The cost estimate (shown before running).** For each chosen model, per test: prompt tokens = the exact messages above counted
with the model's tokenizer; expected answer tokens = choice: the longest choice + 2; text: 1.5 × the expected answer's tokens +
20. Price each with the model's listed per-token price. For a judge test, add the judge prompt (with the expected answer
standing in for the answer) + 60 output tokens at the **judge model's** price. A model whose price isn't listed shows "price not
listed" on its row and is left out of the total, with the line "No listed price for <model>: its cost shows after the run if
the provider reports it." When judge tests exist: "These tests include 4 AI-judge tests, judged by <judge> on your key. The
judge's cost is included." — when none: "These tests use exact match, so no judge model is needed." (or "…exact match and key
words, so…"). Money: two decimals, `<$0.01` below a cent, "about $0.23" for estimates. The real cost after a run is the sum of
the gateway's `cost_usd` per call; a run started with a model whose price isn't listed shows "cost not listed".

**Last run on the Tests tab.** A test keeps its identity across versions; an unchanged test is the same revision in every
version. The column shows the latest two finished runs (any version) that included at least one of the current tests: the
header names their models (`sonnet-5-5 / gpt-oss-120b`); each row shows Pass/Fail chips for the runs that ran **this exact
revision**, else "—". So editing test 7 clears only test 7's chips. The drawer's Last run box uses the same rule and adds the
judge's reason.

**Results** are per version: the version chip opens a Select of the versions that have runs ("Runs on earlier versions (2)"
switches to it). Cards: newest first. **Best score** = the highest score among finished runs (ties → lower cost); **Lowest
cost** = the lowest cost among finished runs with a listed price, shown only when two or more runs finished; both badges can sit
on one card. Stopped and failed runs get neither badge and aren't offered in Compare. **Compare** takes two finished runs of the
same version (the server refuses others with 422 "Only runs on the same test set version can be compared."); "agree" = both
right or both wrong; an error counts as wrong.

**Stop and stale.** **Stop** asks the run to stop; it ends as `stopped` before its next test (no DBOS cancel). A run still
`running` with no new result for 15 minutes reads as failed — "The test run stopped before it finished." — with **Run again**
(DBOS only recovers workflows of its own application version, so a deploy mid-run leaves such a run behind).

**CSV import.** UTF-8, a header row. Columns: `input`, `expected` (required); `scoring` (`exact|contains|judge`; ignored for
choice models), `must_contain` (phrases split by `;`), `rubric`, `judge_model` (text models only). A missing `scoring` becomes
`contains` when `must_contain` is set, `judge` when `rubric` is set, else `exact`. All or nothing: any bad row → nothing is
imported and every bad row is listed by its line number (the header is line 1). A dry run returns the preview. Imported tests
are appended after the existing ones as one new version. Up to the 500-test cap.

## Data — migration `0054_model_tests` (revises `0053_desktop_routes`)

Five new tables; no existing table changes. Shapes (SQLAlchemy models in `backend/tvashtr/models.py`, appended):

- `user_models` — `id` uuid pk; `owner_id` → users.id, not null, indexed; `name` text; `job` text; `answer_kind` text
  (`choice|text`); `choices` jsonb `[]`; `current_version` int not null default 0 (0 = no test set yet); `created_at`,
  `updated_at`. Unique index on `(owner_id, lower(name))`. (Named `user_models` so the class `UserModel` can't be confused with
  the module `tvashtr.models`.)
- `model_test_cases` — **immutable**, one row = one revision of one test: `id` uuid pk; `model_id` → user_models.id ON DELETE
  CASCADE, indexed; `case_key` uuid (the test's identity across revisions); `input`, `expected` text; `scoring` text;
  `must_contain` jsonb `[]`; `rubric` text null; `judge_model` text null; `created_at`.
- `model_test_set_versions` — **immutable**: `id` uuid pk; `model_id` → CASCADE, indexed; `version` int, unique with
  `model_id`; snapshots `job`, `answer_kind`, `choices`; `case_ids` jsonb — the ordered `model_test_cases.id`s; `change_note`
  text; `created_by` → users.id ON DELETE SET NULL; `created_at`. Saving one test = one new case row + one new version row whose
  list swaps one id; nothing is copied.
- `model_test_runs` — `id` uuid pk; `model_id` → CASCADE, indexed; `version_id` → model_test_set_versions.id CASCADE;
  `version` int; `model_slug` text; `status` text (`running|completed|failed|stopped`); `stop_requested` bool default false;
  `cases_total` int; `price_known` bool; `estimate_usd` numeric(12,6) null; filled when it ends: `passed`, `failed`, `errors`
  int, `cost_usd`, `judge_cost_usd` numeric(12,6), `avg_latency_ms` int; `error_message` text; `started_by` → users.id SET NULL;
  `created_at`, `completed_at`.
- `model_test_results` — `id` uuid pk; `run_id` → CASCADE, indexed; `case_id` → model_test_cases.id CASCADE; `case_key` uuid;
  `position` int (1-based number in the version); `answer` text (≤ 20,000 kept); `verdict` text (`pass|fail|error`); `reason`
  text; `model_used` text; `latency_ms` int; `prompt_tokens`, `completion_tokens` int; `cost_usd` numeric(12,6) default 0;
  `judge_model` text null; `judge_cost_usd` numeric(12,6) default 0; `created_at`. **Unique `(run_id, case_id)`**: a retried
  DBOS step replaces its own row.

The migration is additive, has a working `downgrade()`, and gets a round-trip test like `test_migration_0053_is_additive_…`.
**Never store a key** in any of these tables, in a DBOS workflow's or step's arguments or return value, or in a log line.

## Backend

- **Where:** logic in new `backend/tvashtr/control_plane/model_tests*.py` modules (pure scoring/normalising/estimate maths in a
  module with no DB and no network, so it's unit-testable); routes in a new `backend/tvashtr/routes/models.py` registered in
  `main.py` beside the other `routes/*` routers. Every route uses `get_current_user` and is owner-scoped.
- **API** (names may be refined; keep these shapes): `GET/POST /api/models`; `GET/PATCH/DELETE /api/models/{id}`;
  `GET /api/models/{id}/tests?version=N` (cases + the Last run columns); `POST /api/models/{id}/tests`;
  `PUT/DELETE /api/models/{id}/tests/{case_key}`; `GET /api/models/{id}/tests/{case_key}/results`;
  `POST /api/models/{id}/tests/import` (`{filename, csv, dry_run}`); `GET /api/models/{id}/versions`;
  `POST /api/models/{id}/versions/{n}/restore`; `POST /api/models/{id}/estimate` (`{models}`);
  `POST /api/models/{id}/runs` (`{models}` → 202 with the runs); `GET /api/models/{id}/runs?version=N`;
  `GET /api/models/{id}/runs/{run_id}`; `POST /api/models/{id}/runs/{run_id}/stop`;
  `GET /api/models/{id}/compare?a=&b=`. Validation errors are 422 with the exact words above.
- **The durable runner:** a new DBOS workflow, one step per test, then a finishing step — the pattern of
  `control_plane/domain_eval.py`'s `run_domain_eval_workflow` (read it; don't change it). Workflow arguments are ids and the
  ordered case ids only. Each step: checks `stop_requested`; resolves the owner's key **inside the step** with
  `credentials.resolve_owner_api_key`; calls `gateway.complete(CompletionRequest(...))` (default retries — it's a background
  run); scores; for a judge test resolves the judge's key and calls the judge; **upserts** its result row; returns only the
  verdict. The finishing step fills the run's totals. Runs for different models run in parallel (one workflow each).
- **Two new gateway helpers, additive in `backend/tvashtr/gateway/gateway.py`** (the only module allowed to import `litellm`;
  `complete()` and `embed()` stay byte-identical): `count_tokens(model, messages) -> int` (litellm's token counter; on any error,
  characters ÷ 4 rounded up — never raises) and `price_per_token(model) -> tuple[float, float] | None` (input, output USD per
  token from litellm's own price data, using litellm's lookup that understands the `provider/` prefix; `None` when the model
  isn't listed — never raises). Both helpers price and count a `vertex_ai/<id>` slug as `gemini/<id>` (take the model name from
  `tvashtr.google_cloud.call_settings`, since that is how its calls are made). Prove with tests: `deepseek/deepseek-chat` and
  `groq/openai/gpt-oss-120b` are listed (their backup-map prices are 2.8e-07/4.2e-07 and 1.5e-07/6e-07),
  `vertex_ai/gemini-3-flash-preview` is listed (5e-07/3e-06, as `gemini/gemini-3-flash-preview`), `openai/gpt-4o-mini` resolves
  through its prefix, `nvidia_nim/meta/llama-3.3-70b-instruct` and a made-up slug answer `None`.
- **Known gateway gap (logged, don't fix here):** `complete()` can raise a bare `IndexError` when a thinking model returns an
  empty response. A model-test step treats any exception from the call as an **error** verdict with its first line.
- **Owner-scope sweep:** add a row for every new route to `backend/tests/test_owner_scope_guard.py`'s `ROUTES`, and a new
  `backend/tests/test_owner_scope_models.py` proving account B gets 404 on account A's model, tests, runs and compare, sees none
  of A's models in the list, and leaves A's rows unchanged.

## Frontend

- New `frontend/src/pages/models/` (pages, dialogs, drawer, `models.css`) and `frontend/src/lib/api/models.ts`. Copy the
  structure and patterns of `pages/domains/` (list page, detail page with tabs in the address, Sheets, polling while a run is
  going, `domainFormat`-style helpers with their own tests).
- Addresses: `#/models`, `#/models/<id>` (Tests), `#/models/<id>/results`, `#/models/<id>/settings`; `sectionOf` gains
  `"models"`; refresh at any address lands back on the same screen.
- Results poll every 3 s while any run on the shown version is running, then stop.

**Existing files you may touch (each change additive):** `backend/tvashtr/models.py` (new classes appended),
`backend/tvashtr/main.py` (include the router), `backend/tvashtr/gateway/gateway.py` (the two helpers),
`backend/tests/test_owner_scope_guard.py` (rows), `frontend/src/lib/nav.ts`, `frontend/src/pages/Workspace.tsx`,
`frontend/src/pages/shell/Shell.tsx` (+ `shell.css` only if needed), `frontend/src/pages/home/paletteItems.ts` and wherever the
palette maps a target to a route, `frontend/e2e/_keys.ts` (add `groq: "GROQ_CLOUD_API_KEY"` to `ENV_OF` only if you use Groq — `vertex_ai` is already there), `Makefile` (a new
`model-tests-e2e` target and its `.PHONY` entry), existing tests that assert the exact menu (re-pointed, listed), and finally
`.claude/hooks/protect-migrations.sh` (the freeze bump to `0054`, its own last commit — precedent: `6bc7720a chore(hooks):
freeze migration 0053`). Anything else existing that you believe must change → stop and ask (NEEDS_HUMAN), don't change it.

## Tests

- **Red first** for the pure logic: write the scorer (normalising, exact, contains, judge-reply parsing), the message builder,
  the estimate maths and the CSV parser's tests before the code; run them and echo the failing summary (`SCORER-RED`), then
  green. Tests assert real values (exact strings, exact dollar figures from a fixed fake price, the line numbers of CSV errors).
- **Backend** (offline, the gateway faked by monkeypatching `gateway.complete` / the price helpers): versions (every save makes
  one; old ones never change; restore), limits and every 422 word, the workflow end to end (results rows, totals incl. the judge,
  `model_used` mismatch → error, empty answer → fail, stop → `stopped`, a step retried → still one row), the stale read, Last-run
  per revision, compare counts, the estimate incl. unknown prices and the judge, `missing_providers` incl. the judge's provider,
  and **no key in any DBOS workflow/step argument or result** (assert on what `DBOS.start_workflow` and the steps receive).
- **Vitest** for the new pages: the list (both states, all three badges), New model validation, the drawer per kind and scoring,
  Import preview/errors, Run dialog (estimate lines, missing key, price not listed, judge line, button label), Results (cards,
  badges, running/stopped/failed, compare counts and the differ filter), Settings, History view/restore, nav + Cmd-K.
- **Live e2e** `make model-tests-e2e` → `scripts/model_tests_e2e.sh` + `frontend/e2e/model-tests.spec.ts`, modelled on
  `scripts/agent_tests_e2e.sh` (`.env` sourced, never echoed; own ports **backend :8024, Vite :5197**; skips cleanly — exit 0
  with a line — when `GOOGLE_CLOUD_API_KEY` or `DEEPSEEK_API_KEY` is absent). Models A = `vertex_ai/gemini-3-flash-preview`
  (Google Cloud — the credits pay), B = `deepseek/deepseek-chat` (override with `TVASHTR_E2E_MODEL_A/_B`). The spec: register fresh → the first-time Models page → seed both keys → New model
  "Claims triage" (choices Motor, Property, Health, Travel) → one test by hand (v1) → a CSV with a bad row (its line error shown,
  nothing imported) → a good CSV of 5 (v2, 6 tests) → Run tests: both rows show "about $…" and a total → run both → both cards
  finish (allow 5 min) with real scores and costs → Compare shows the agree sentence; **All 6** shows 6 rows → edit test 1 (v3):
  only row 1's chips clear, Results says "No runs on test set v3 yet." and offers "Runs on earlier versions (2)" → a second model
  "Support email router" (Write text) with one Must-contain and one AI-judge test (judge `vertex_ai/gemini-3-flash-preview`) → run on A →
  the card shows "Includes $… for the AI judge" and the judge test's drawer shows a non-empty `Judge: "…"` → Cmd-K "Open Models"
  → Settings: rename, then delete the second model. A screenshot per step into `/tmp/tvashtr_model_tests_shots`. Echo the real
  scores, costs and the two estimates vs the real costs.

## Self-sign-off — Playwright, screen by screen against the design

Write `scripts/models_seed.py`: it fills a given local database (never `tvashtr_film`, never production) for one account with
the canvas's sample data — "Claims triage" (choice, 6 choices, test set v4, 50 tests of which the first 8 are the canvas's rows,
three finished runs on v4 matching the Results card numbers and the 7 differing tests, two runs on older versions) and "Support
email router" (text, test set v2, 18 tests of which 7 are the canvas's rows, the canvas's judge verdicts on test 7) — inserting
rows directly (no model calls). Bring up one local stack on it and screenshot at the canvas sizes (1440×960 for the list and
New model, 1440×1000 for Tests, Edit a test and Run tests, 1440×1080 for Results), plus the first-time state on a fresh account:

`S1` Models first time · `S2` Models list · `S3` New model · `S4` Tests tab · `S5` Edit a test (AI judge) · `S6` Run tests ·
`S7` Results + compare — then the undrawn ones: `S8` Settings · `S9` Import CSV with an error · `S10` History viewing v2 ·
`S11` a running card · `S12` Cmd-K "Open Models".

For **S1–S7**, open your screenshot and the matching `prompts/models-1-design/*.png` side by side and compare: the same
elements in the same order with the same words, the same sizes (within 2 px for heights, paddings and gaps), the same colours,
fonts and component variants. Fix every difference that isn't explained by the picture's rendering (its brand mark is missing)
or by data the seed can't reproduce; list what remains with the reason (`SIGNOFF S4: matches; differences: none` or the list).
Save the screenshots under `artifacts/models-1/` (git-ignored) and echo each path.

## Steps (echo each evidence line as it completes, and write it to STATE.md)

1. **PREFLIGHT:** `main` = `97aadec0`; push guard = the dummy; tracked tree clean (`git diff --quiet && git diff --cached
   --quiet`); Docker up; :8000 :5173 :8024 :5197 free; `.env` has `GOOGLE_CLOUD_API_KEY` / `DEEPSEEK_API_KEY` (say present or
   absent — never the value); `team_run.py` blob; `@DBOS.` count 75; the two DBOS app versions = the values above. Anything else
   → NEEDS_HUMAN. Create `feat/models-1`.
2. **BASELINE:** quote the floors above from STATE.md (the code on `97aadec0` is the code they were measured on). If a gate later
   fails in a file this branch didn't touch, re-run that test on `main` in a scratch worktree to prove it pre-exists.
3. **MIGRATION** `0054` + models + round-trip test (echo `alembic upgrade head` → `0054_model_tests` on a scratch DB and the
   downgrade).
4. **SCORER-RED → SCORER-GREEN**, then the gateway helpers with their tests (`PRICES`: the six slugs and what each answered).
5. **API** + versions + CSV + estimate + **OWNER-SCOPE** (the sweep test passing with the new rows).
6. **WORKFLOW:** the runner, stop, stale, compare — with the offline end-to-end test output.
7. **FRONTEND** — every screen above, then **VITEST** for it.
8. **SIGNOFF S1–S12** as above.
9. **LIVE:** `make seed` first if a script needs it, then `make model-tests-e2e` — up to 3 attempts for provider flakes; if every
   attempt fails on a provider's error (not the product's), record the decisive line and carry on (the architect decides).
10. **FREEZE:** the hook bump to `0054`, its own commit.
11. **GATES on the final head:** `make test` on `tvashtr_gate` (0 failed, ≥ 3591 + your new tests; one line proving which
    database), `cd frontend && npx vitest run` (≥ 2757 + yours; the `CompareView.tsx:96` unhandled error may still show, no new
    one), `npx tsc --noEmit`, `npm run build`, `cd desktop && npm test` (161), `make lint` — **no new finding; the exit code may
    stay non-zero** (ruff's 38-error baseline) — and the frontend part clean; e2e on one local stack with
    `TVASHTR_HOSTED_MODE=false`: `revamp-shell.spec.ts` and `domains.spec.ts` (the menu changed) pass.
12. **INVARIANTS** with proofs, **DBOS-VERSIONS**, **NET** (`git diff --shortstat main`), then **READY_TO_MERGE
    feat/models-1 <sha>** and the FINAL REPORT.

## Invariants (each with its proof in the report)

- Additive only: `git diff main --stat` shows changes to existing files only in the list above; every new file is under the new
  paths; for each existing file touched, the diff has no removed line except the re-pointed menu assertions (listed).
- `team_run.py` blob `9a22d313d5c9`. `control_plane/domain_eval.py` unchanged.
- Existing DBOS code untouched: every file that has `@DBOS.` on `main` shows an empty `git diff main -- <file>`; the count is 75 +
  the new ones, all in the new modules.
- DBOS application versions computed for the branch head (local and fly posture): they **will change** (a new workflow). Echo
  old → new. The ship of this branch must drain live runs first — say so in section 7.
- `gateway.py`: `complete()` and `embed()` byte-identical (show the diff is additions only); no other module imports `litellm`
  (`git grep -n "import litellm"`).
- Alembic: one new file `0054_model_tests.py`; `0001–0053` unchanged; the hook freezes `0001–0054` in the last commit.
- No dependency change: every `package.json`, `package-lock.json`, `backend/pyproject.toml`, `backend/uv.lock` byte-identical.
- No key anywhere it shouldn't be: the tests above, plus `git grep` over the branch diff for the PUSH_SCAN patterns
  (`sk-…`, `gsk_…`, `ghp_…`, `postgres://…:…@`, `-----BEGIN`) — known false positives listed by path:line only.
- No untracked file you didn't create was touched; `prompts/`, `design/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` not staged.

## Rules

Auto mode. Commit in small, single-purpose commits on `feat/models-1` (conventional messages). No push, deploy, tag, force,
`reset --hard`, stash, rebase or amend; never change git config. `.env` fenced: source it in scripts, never print or open it in
the chat; never open the CLI credential files. Tests never on `tvashtr_film` or next to a live stack; one stack at a time;
`caffeinate -dimsu` while working. Three-attempt rule for any one failure, then stop and report. Time box: 12 working hours
(usage-limit pauses don't count).

**Stop conditions** — write `NEEDS_HUMAN: <reason>` to STATE.md, echo the FINAL REPORT and leave a safe state (committed work on
the branch, nothing running): `main` isn't `97aadec0`; the push guard isn't the dummy; tracked changes at start; a port held; an
existing file outside the list must change; a second, unknown problem that needs a broad or unproven change (a code-proven,
contained fix with a regression test may proceed); an existing test fails for a reason this branch didn't cause and can't be
proven pre-existing; a safeguards notice. `GOOGLE_CLOUD_API_KEY` or `DEEPSEEK_API_KEY` absent → do everything else, then stop at LIVE with NEEDS_HUMAN.

**Final report:** the eight sections of `prompts/CLI-RULES.md` §4.7. In section 3 every evidence line above with its decisive
output quoted; in section 7 anything that needs a ruling (a design difference you couldn't close, a price that looked wrong, a
place where the brief's words didn't fit the screen) and the note that shipping needs a drain.

# M-rung2 — the brownfield thesis probe on the REAL `trade_mcp`, with DeepSeek

> Brief for Claude Code. The `/goal` points here. Architect: Tvashtr-66. Branch off `main` @ `998bd9f`.

## 0. Objective (ONE outcome)

**Produce a recorded VERDICT for the M-brownfield rung-2 thesis:** can a composed, human-steered
Tvashtr team land a **correct, reviewer-approved** DEMA indicator into the **real 264-file
`trade_mcp` monorepo**, judged by the harness's **INDEPENDENT numeric gate** — running the
go-forward agent model **DeepSeek** (`deepseek/deepseek-chat`)?

Two blockers stand between here and that run. Fix them (Part 1), then run the probe (Part 2).

**THE VERDICT IS THE DELIVERABLE.** A recorded **FINDING is a COMPLETE, SUCCESSFUL milestone** and
an explicit goal-met terminal state. It is *not* a failure and must *not* be retried around.
A fake PASS is far worse than no run: Mv (the project's real value gate) would be built on a lie.

## 1. Why this milestone exists (context you need)

Everything built since Tvashtr-38 to beat rung 2 — scoped mounts, the C1 condenser, the context
compiler, memory, the BYOK retry envelope, M-robust — is merged on `main` and **has never once been
run against rung 2**. This closes that loop.

History (§17 Tvashtr-38 / -39): rung 2 walked three walls — (1) context overflow (**fixed** by the
scoped mount), (2) the 70b's capability ceiling (it ships a *wrong* DEMA), (3) the NIM free-tier 429
throttle (a *capable* model — Kimi — earned a reviewer-approved **correct** DEMA after riding out 8×
429s and 93 edits, then crashed pre-ship, so **the numeric gate has never actually run**).

**DeepSeek is BYOK/paid, so wall #3 dies structurally.** This run is the first honest test of walls
#1 and #2 together. Model choice is **settled** (§17 Tvashtr-53 — DeepSeek is go-forward; it
supersedes Tvashtr-39's Kimi trigger). Kimi is the registered escalation **only** if DeepSeek fails
specifically on *capability*.

## 2. Part 1 — the two blockers (REPRODUCE FIRST, then fix)

### Blocker A — the seeded operator has NO `deepseek` credential ⇒ the run 422s at launch

Traced on disk by the architect:

- `backend/tvashtr/seed.py` → `_ENV_PROVIDER_MAP` maps only `openrouter`, `openai`, `gemini`,
  `groq`, `nvidia_nim`. **There is no `DEEPSEEK_API_KEY` → `deepseek` entry**, so `seed.main()`
  silently drops it even though `.env` sets `DEEPSEEK_API_KEY`.
- `control_plane/credentials.py` → `provider_for_model("deepseek/deepseek-chat") == "deepseek"`,
  and `resolve_owner_api_key` has **no `.env` fallback**.
- `routers.py` → `_missing_provider_credentials()` + `create_run` **refuse with 422**
  (`missing_providers: ["deepseek"]`) unless the owner holds a key for **every** node model's
  provider.
- `control_plane/teams.py` → `build_review_loop_team()` gives PM `settings.default_model`
  (`.env` `DEFAULT_MODEL=deepseek/deepseek-chat`) and Engineer/Reviewer `engineer_model()` /
  `reviewer_model()` (`.env` `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`).

**Consequence: `make brownfield-rung2` cannot launch a run *today*, even unchanged** — the PM alone
already needs a `deepseek` key the seed never imports. This is a **real product bug**, not harness
plumbing: a fresh operator who follows the documented setup (`make seed`) **cannot run the
product's own configured default model.** The seed's map is stale relative to the Tvashtr-53
DeepSeek pivot — the same stale-artifact hazard class that hid the M-reaper bug.

**Fix A (root cause):** add the DeepSeek env→provider mapping to `_ENV_PROVIDER_MAP` so `make seed`
imports `DEEPSEEK_API_KEY` into the operator's encrypted `provider_credentials` exactly as it
already does for the other five providers. Follow the existing tuple shape; change nothing else.

**Reproduce first:** a unit test that **FAILS on the current code** proving the seed drops
`DEEPSEEK_API_KEY` (i.e. asserts a `deepseek` credential exists for the operator after
`import_env_provider_keys` with that env var set). Confirm it RED before you fix, then GREEN.
Do not let a conftest fixture make it vacuous.

*(Reference pattern, already proven live: `scripts/memory_injection_check.py` works around this by
POSTing `/api/providers` for `deepseek` itself, onto a throwaway account. That is the workaround;
the seed map is the root cause. Fix the root cause.)*

### Blocker B — `make brownfield-rung2` is pinned to the abandoned model

`Makefile` (~line 136) hardcodes `TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct`
**inline in the recipe** — a recipe-level assignment that **overrides the environment**, so `.env`
cannot reach it. §17 Tvashtr-39 recorded this exact trap: it ran the driver directly rather than
the target, because the bare target would silently run the 70b and invalidate the thesis run.

**Fix B:** make the rung-2 target honor the configured model and stay overridable from the command
line — so the registered Kimi escalation is a one-command change with no edit. **Follow the file's
own existing precedent**: `TVASHTR_RUNG2_REPO ?=` / `TVASHTR_RUNG2_SUBPATH ?=` are declared as
overridable make variables near the top and threaded into the recipe as `$(VAR)`. Do the same for
the model. Default it to the configured `.env` value, **not** a hardcoded slug.

**`Makefile` edits must be surgical** — recipes are TAB-indented; never rewrite the file wholesale.

## 3. Part 2 — the probe

1. `make brownfield-rung2` (docker; the operator's `trade_mcp` is **never** touched — the harness
   clones fresh to a tempdir).
2. **Verify the models on the run graph before trusting the result**: PM, Engineer and Reviewer must
   all read `deepseek/deepseek-chat`, and `run.subpath` must be `core`. A silent fallback to any
   other slug **invalidates the run** — say so and stop.
3. Record the outcome verbatim: the independent numeric gate's result, the shipped
   `core/indicators.py` diff, the reviewer's final verdict, run id, branch, wall-clock, any 429s.

### Scope leg
Default leg = **`core`** (`TVASHTR_RUNG2_SUBPATH` default). If — and only if — the `core` leg
PASSES cleanly and you have turns left, you MAY run one **whole-repo** leg
(`TVASHTR_RUNG2_SUBPATH=` empty) as a second data point, since C1's condenser has never been
validated live and whole-repo is what a real user gets by default. **Do not** run the whole-repo leg
first, and **do not** treat its failure as the milestone's verdict — the `core` leg is the verdict.

## 4. FENCE — explicitly OUT of scope (do NOT implement)

If you believe any of these is a real hole, **SAY SO IN THE REPORT — do not implement it.**

- **Do NOT tune your way to green.** You may **not** touch the numeric gate, the DEMA spec, the
  reviewer prompt, `_IDEA`, or the fixture/target repo. §17 Tvashtr-34 already recorded this trap
  (do not prompt-tune a weak model to chase a pass).
- **Do NOT** add `deepseek` to `PROVIDER_DEFAULT_MODEL` / `_PROVIDER_DEFAULT_ORDER` in `teams.py`.
  That changes the default model of newly-dropped nodes — an authoring-UX change unrelated to this
  probe. (Architect is aware; it is registered.)
- **Do NOT** touch `brownfield-check` or `brownfield-loop-check`. They are **proven rung-1 gates**
  on the 70b; re-pointing their model invalidates a proven gate.
- **Do NOT** rename the `.env` `x-api-key=` line (registered in §15; three scripts already carry a
  defensive loader).
- **Do NOT** add a migration. Alembic head stays `0027`. Do not touch the freeze hook.
- **Do NOT** touch `control_plane/team_run.py` or anything under `backend/tvashtr/engines/`.
- **Do NOT** add a dependency (no `psutil`, no `ps` subprocess). Not about pid reuse / `started_at`.
- **Do NOT** add proactive rate pacing (registered §15 — deferred with reasons).
- **Do NOT** `git push` (there is no remote) and do not `git reset --hard`.

## 5. Acceptance / evidence (echo EACH into the chat as it completes)

You run every check yourself and debug to green. Do **not** hand the operator commands to run.

1. The reproduce-first test **RED on pre-fix code** (paste the failure), then **GREEN**.
2. `make test` — **≥ 669** backend, all passing.
3. `make lint` clean · `make build-frontend` clean · `make test-frontend` **≥ 365**.
4. `git diff` proof that the fence held: **zero** diff in `control_plane/team_run.py`,
   `backend/tvashtr/engines/`, `backend/alembic/`, `pyproject.toml`, `uv.lock`,
   and the `brownfield-check` / `brownfield-loop-check` recipes.
5. The live `make brownfield-rung2` transcript, with the run-graph model verification from §3.2.
6. The verdict block: **PASS** or **RUNG-2 FINDING**, with the numeric gate result + the shipped
   diff + which wall stood.
7. Branch name + a final `READY_TO_MERGE` line (a recorded FINDING still merges the Part-1 fixes —
   they are correct and independently valuable regardless of the probe's outcome).
8. The mandatory 8-section FINAL REPORT (CLI-RULES §4.7), written ONCE.

## 6. Stop conditions

- **A code-proven, contained, regression-guarded fix → you MAY proceed.**
- **A second/unknown problem needing a broad or unproven change → STOP**, write `NEEDS_HUMAN` to
  `STATE.md` with the diagnosis, and report. Do not improvise a broad fix.
- A provider/quota/Docker outage, or a missing `DEEPSEEK_API_KEY` → that is an external blocker:
  record it and stop. Do not silently swap models.
- Hard turn cap: **60**. A recorded FINDING is a valid, goal-met terminal — do not loop on it.

## 7. Notes

- `prompts/CLI-RULES.md` **§2 is STALE** — it claims alembic head `0014`; the real head is `0027`.
  Ignore that claim. §3.11's "hard walls" claim is also stale. The rest of the contract stands.
- `.env` contains live secrets. **Never echo a key value** into the chat, a log, or a commit.
- Commit only your own changed paths. Leave `prompts/*.md`, `PROJECTPLAN.md`, `HANDOVER.md`,
  `design/` and the untracked deep-dive `.md` files alone — the architect owns those.

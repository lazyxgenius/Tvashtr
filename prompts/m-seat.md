# M-seat — the worker seat gets its own evidence, and the flow opens a real PR (LOCAL ONLY)

> Brief written by **Tvashtr Sidechat-13**, 2026-09-08, from a disk audit of `main` @ `fc22df0`
> and of the uncommitted working tree on `feat/m-seat`.
> **Read this whole file before you plan anything.**

---

## 0. Read this first: the tree is NOT clean, and that is deliberate

`main` is at `fc22df0`. HEAD is checked out on **`feat/m-seat`**, a branch created from `fc22df0`
with **zero commits** — but the working tree carries a substantial, coherent, **uncommitted**
M-seat implementation. It was written by the previous Claude Code session, which then hit
`PAUSED_RATE_LIMIT` (see the tail of `STATE.md`) before it could finish. Nobody recorded it.

**Do not discard it. Do not `git checkout .`, `git stash drop`, `git reset --hard`, or clean the
tree.** Your first job is to take custody of it.

### The exact inventory, verified against `.git/index` and against decompressed git blobs

Modified, tracked (committed size → on-disk size):

| Path | committed | on disk |
|---|---|---|
| `backend/tvashtr/config.py` | 40,612 B | 43,903 B |
| `backend/tvashtr/control_plane/teams.py` | 76,333 B | ~80,190 B |
| `backend/tvashtr/engines/openhands_adapter.py` | 34,452 B | 34,798 B |
| `backend/tvashtr/engines/openhands_docker_adapter.py` | 31,979 B | ~32,326 B |
| `backend/tvashtr/engines/openhands_fly_adapter.py` | 33,059 B | ~33,404 B |
| `backend/tvashtr/main.py` | ~12,913 B | ~13,384 B |
| `backend/tvashtr/routers.py` | ~139,945 B | ~140,155 B |
| `frontend/src/lib/api.ts` | ~64,778 B | ~66,396 B |
| `frontend/src/panel/TeamNodePanel.tsx` | ~47,708 B | ~48,527 B |

New, untracked:

- `backend/tests/test_condenser_token_budget.py`
- `backend/tests/test_seat_defaults.py`
- `scripts/seat_probe.py`

**Verify this inventory yourself before touching anything** (`git status --porcelain`,
`git diff --stat`). If the real set differs from the table above, STOP and write `NEEDS_HUMAN` —
something changed under us and the audit this brief rests on is stale.

### What that uncommitted work actually is

1. **`config.py`** adds two settings and one routing key:
   - `agent_condenser_max_tokens` (default `96_000`) — the condenser's **token** trigger. M-ctx0
     wired `LLMSummarizingCondenser(keep_first=2, max_size=80)`, but `max_size` counts **events**
     and the SDK gates its token path on a separate `max_tokens` that defaults to `None`, so that
     branch was dead code and 80 events was the only trigger.
   - `agent_request_timeout_s` (default `120`) — a per-request HTTP timeout, so a provider that
     accepts a connection and never answers fails legibly instead of burning `num_retries × 300s`.
   - `"timeout": settings.agent_request_timeout_s` added to `agent_llm_routing`'s **BYOK branch
     only** (the proxy-ON branch is untouched).
2. **All three adapters** pass `max_tokens=settings.agent_condenser_max_tokens` to the condenser.
3. **`teams.py`** splits `PROVIDER_CATALOGUE` by **seat**: every entry becomes
   `{thinker_default, worker_default, thinker_presets, worker_presets}`; `PROVIDER_DEFAULT_MODEL`
   is deleted; `catalogue_default`, `catalogue_presets`, `capability_of` are added;
   `account_default_model` / `account_fallback_model` / `public_provider_catalogue` /
   `_node_default_model` / `_stamp_account_defaults` all take or derive a capability. `routers.py`,
   `api.ts` and `TeamNodePanel.tsx` are updated consistently — I found **no dangling references**.
4. **`scripts/seat_probe.py`** is the evidence harness: four worker gates (live gateway completion ·
   the OpenHands content-block shape · a real agent step whose file lands *inside* the workspace
   with exact contents · no crash in the loop) and two thinker gates (live completion · a real
   deliverable under the output ceiling that is not merely chain-of-thought).

### The one thing that makes it unshippable as it stands

**Five of the six providers in `PROVIDER_CATALOGUE` have the literal string `"PROBE_PENDING"` as
both defaults, and empty preset lists** — `nvidia_nim`, `openai`, `gemini`, `groq`, `deepseek`.
Only `openrouter` carries real slugs (deliberately left as M-runnable seeded it, and honestly
commented as unprobed because the operator holds no OpenRouter key).

In this state every freshly created team would be stamped with a nonsense model. **The probe was
written and never run.** Running it and filling the table in is the core of this milestone.

---

## 1. The architect's decision (already made — do not re-open it)

The handover offered three levers for the Engineer-seat failure. Here is the ruling, and the
reasoning you must not quietly re-litigate:

> **The worker seat is a first-class, separately-evidenced seat. `PROVIDER_CATALOGUE` splits by
> seat; a provider that cannot serve a worker declares `None` and yields that seat to the next held
> provider; and the transcript feeding the worker's model is bounded by TOKENS, not by event count.
> Repo scoping is NOT the answer to context overflow and is OUT of scope for this milestone.**

Why:

- **The "big repo" premise does not survive contact with the code.** `build_repo_grounding` is
  already bounded — 80 structure entries, ~6 KB of conventions, paths only, no file contents. It
  cannot produce a 131k-token prompt. The overflow came from the agent's own exploration
  accumulating in the transcript, and the only fold trigger was 80 events. Reading a handful of
  files breaches a 131,072-token window in far fewer than 80 events **on a repo of any size**. So
  scoping treats a symptom: a user scoped to one package can still overflow.
- **The seat split is not an optimisation, it is the correct model.** One `default_model` per
  provider answers "which provider?" when the question is "can this model do this job?" M-live
  proved the difference in production: the same slug drove the PM to a real PRD and a
  human-approved gate, then killed the Engineer.
- **"A bigger-context worker model" is subsumed.** Once seats are split and probed, the worker
  default is by construction a model that passed the worker gates — evidence, not a hand-pick.

The hosted inspect/scope gap stays in `PROJECTPLAN.md` §15 as what it really is: a way for a user to
point a team at part of a repo. It is a genuine product gap and it will be built. It is not a crash
workaround, and building it here would ship a fix that does not hold.

### The user-facing UX consequence

- **Today:** you create a team and every node — the PM thinker and the Engineer worker alike — gets
  the same model, from the first provider you hold. The run clears the PM, shows you a real PRD, you
  approve the gate, and then the Engineer card goes red with an unreadable provider error. Nothing
  on the canvas ever told you the Engineer had been handed a model that cannot do its job.
- **After:** a new team's PM card and Engineer card can carry **different** models, each chosen for
  that node's job and each probed. If the provider at the top of your list can talk but cannot drive
  the agent loop, your Engineer gets the next provider you hold that can, while the PM keeps the
  first. Open a node's config drawer and the model quick-picks are **scoped to that node's seat** —
  an edits-on worker is never offered a talk-only model, so you cannot hand-pick the failure either.
  A worker's `fallback_model` follows the same rule, so the failover target can actually drive the
  loop. And if you hold no provider that can serve a worker at all, you learn that at launch as a
  named 422 on the canvas (the refusal M-live already built), not thirty minutes into a run.
- **Existing authored teams are untouched** — their nodes keep their models. This changes only what
  a *new* node or team is given, and what the picker offers.

---

## 2. Deliverables

### D1 — Take custody of the tree

Work on the existing **`feat/m-seat`** branch (already checked out; created from `fc22df0`, so it
fast-forwards). Record the verified dirty/untracked inventory in `STATE.md` first. Then commit the
inherited work in coherent commits with honest messages saying it was inherited uncommitted.
Nothing in this brief authorises deleting any of it.

### D2 — Run the probe; delete every `PROBE_PENDING`

Run `scripts/seat_probe.py` live against every provider the account actually holds, for **both**
seats. Fill `PROVIDER_CATALOGUE` with the slugs that passed.

- A provider that resolves **no** worker candidate gets `worker_default: None` and
  `worker_presets: []`. That is a legal, meaningful answer — not a gap to paper over. Same for a
  thinker.
- Never invent, guess, or carry forward a slug that no gate covered. `openrouter` may stay as-is
  **only** if its honest "unprobed, no key held" comment stays with it.
- Paste the probe transcript — per provider, per candidate, per gate, pass/fail with the reason —
  into `STATE.md`.
- After the edit, **no occurrence of `PROBE_PENDING` may remain anywhere in the repo.** Show the
  grep.

### D3 — Prove the overflow premise (do not assume it)

Both halves are required.

**Offline, reproduce-first.** `backend/tests/test_condenser_token_budget.py` exists but is
uncommitted and unproven. Demonstrate it goes **RED against the pre-fix code** (the committed
adapter line `condenser=LLMSummarizingCondenser(llm=condenser_llm, keep_first=2, max_size=80)`) and
GREEN after. Quote both outputs. If it does not go red, it is not a regression test — rewrite it
until it is. Do the same for `agent_request_timeout_s`: there is currently **no test** that
`agent_llm_routing`'s BYOK branch carries `timeout`, and the proxy-ON branch must be proven to still
omit it. Write one, RED first.

**Live, on the real path.** The demo-proof run in D4 must target the **WHOLE repo — no `subpath`,
no scoping**. That is the premise test: if the flow completes end-to-end on the whole repo, repo
size was not the blocker. Then report, from `agent_invocations` / `run_events` for the Engineer
node: the per-step prompt-token series, and whether a condensation event fired and at which step.

Answer this question explicitly in your final report, in one paragraph, with the numbers:
**was the M-live Engineer failure caused by repo size, or by context management?**

### D4 — `make demo-proof` green, end to end, with a real PR

C1–C12 all pass on the local leg. C12 must assert a real `pr_url`. Screenshots land under
`artifacts/demo-proof/local/`. The gate approvals go through the real UI Approve button and the
Reviewer's verdict is not forced — the harness already unsets `TVASHTR_AUTO_APPROVE_GATES` and
`TVASHTR_FORCE_REVISIONS`; leave that alone.

The team under test must be **created fresh after your catalogue change** — `_stamp_account_defaults`
fires at team creation only, so a pre-existing team receives none of the new defaults and proves
nothing.

### D5 — Two riders, both small, both earned

- **C12 must not delete the team when the run did not succeed.** The cleanup cascade-deletes
  `agent_invocations` and destroys the forensic trail of the very failure the harness just caught.
  It cost the previous session its evidence three times. Skip the delete on a non-success and say so
  in the output.
- **`make lint` is red on `main`** for a pre-existing reason: untracked `frontend/.cursor/cli.json`
  fails prettier. Three sessions have now worked around it. Add the ignore entry and end the tax.

### D6 — Run every gate yourself, to green

`make test` (floor **1194** backend, plus your new tests) · `make lint` · the frontend build ·
vitest (floor **427**, plus any new) · `make demo-proof`. Debug to green. Do not hand the operator a
command to run. Report `READY_TO_MERGE: YES` with the branch and sha only when all of it is green.

---

## 3. Invariants — expressed as things you must be able to show on disk

- **NO migration.** `backend/alembic/versions/` stays at **31 files**, head `0031`. Show the count.
- **NO deploy.** No `fly deploy`, no `make demo-proof-prod`, no prod leg, no touching `fly.toml`.
  The operator deploys himself once this is green locally.
- **NO scoping work.** Do not thread `subpath` through the hosted launch, do not unfence
  `/api/repo/inspect`, do not add a hosted Scope picker. Ruled out above by decision, not by effort.
- **The launch pre-flight's `fallback_model` gap stays open** (§15) — do not fold it in.
- **`_PROVIDER_DEFAULT_ORDER` is unchanged** — the seat split is the fix, not a reordering.
- **Never edit `frontend/src` while `demo-proof` is driving the Vite dev server.** HMR reloads
  `App.tsx`, resets `runId` to null, drops the app into authoring mode, unmounts the tasks drawer
  and kills the poll — so a gate check can never pass. The previous session burned several turns
  hunting a "product defect" that was its own interference. Stop the harness, edit, restart.
- **Never weaken an assertion to make a run pass.** A test that passes because it stopped checking
  is not a test.
- **No `git push`** (hook-enforced, survives bypass). The operator merges.
- **Do not touch** `PROJECTPLAN.md`, `HANDOVER.md`, or `prompts/*.md` — those are the architect's.

---

## 4. Stop conditions

- **A second or unknown problem that needs a broad or unproven change** → write `NEEDS_HUMAN` to
  `STATE.md` with what you found, and stop.
- **A code-proven, contained, regression-guarded fix** → proceed, and say so in the report.
- **Do not write `NEEDS_HUMAN` off one observation of a flaky gate.** The recorded guidance for this
  gate class is retry **5–6 times**; last session attempt 6 reached a gate after five failures that
  were the fleet ceiling, not the agent.
- Hard turn cap: **60**.

---

## 5. Gotchas that will otherwise cost you turns

- **Clear stale runs before every live gate.** `make test` leaves non-terminal `runs` rows that the
  M-h3 fleet ceiling counts, so the next live gate dies with `429 global_concurrency_limit`:
  `docker exec tvashtr-postgres psql -U tvashtr -d tvashtr -c "update runs set status='cancelled' where status in ('pending','running','awaiting_human');"`
  Do **not** raise the ceiling env vars — that hides the condition the gate exists to run under.
- **A residue sweep must key on DBOS workflow liveness, not wall-clock age.** A 30-minute window
  cannot tell a live gate from fresh `make test` residue.
- **Playwright's full-tree accessibility snapshot chokes on the React Flow canvas.** Use targeted
  locator / evaluate queries plus screenshots.
- **Local auth:** `/api/auth/login` is not hosted-gated locally and the seeded operator has a real
  password — but that account has `github_user_id = NULL`, so the installation backfill can never
  reach it. The harness seeds the `GithubInstallation` row directly via `scripts/github_fixture.py`.
- **Docker:** the container is `tvashtr-postgres`; use `docker compose start postgres`, not `up`.
- **`.env` line 13 (`x-api-key=`)** is not a shell-valid identifier, so `source`-based scripts skip
  it defensively. Don't "fix" it here.
- **Target repo:** `TVASHTR_PROOF_REPO`, default `lazyxgenius/trade_mcp`. The GitHub App also grants
  `lazyxgenius/cryptoground-mcp`.
- **Bypass mode** makes `.claude/settings.json` allow/deny rules inert. Only PreToolUse hooks
  survive — `protect-no-push.sh` and `protect-migrations.sh` both hold.

---

## 6. The final report (mandatory, per CLI-RULES §4.7)

Per file: what changed and why. The probe transcript in full. The RED-then-GREEN output for every
reproduce-first test, quoted. Every command and its result. The Engineer node's prompt-token series
and the condensation evidence. The explicit answer to D3's premise question. Deviations with
justification. Anything touched outside stated scope. What you deliberately did not do. Residual
risks. Then `READY_TO_MERGE: YES|NOT YET` with branch and sha.

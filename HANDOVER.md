# HANDOVER — for Tvashtr-20

> Structured snapshot for the next architect chat. Read this **and** PROJECTPLAN.md (start with the
> Tvashtr-19 header + §13/§14/§15/§16 + the two §17 Tvashtr-19 entries — the *design* one and the
> *closeout* one) before doing anything.

---

## 1. Where we are (one breath)
- **`main` @ `3f02189`.** **§14.1 (the per-round reviewer-verdict view) is SHIPPED + merged.**
- **Phase: P1.5c item-3 = §14**, the team A/B "which config ships better" attributability instrument.
  Decomposed into **§14.1 (verdict view — DONE) → §14.2 (A/B pair + launch + migration `0010` +
  verdict-reasons) → §14.3 (the comparison view)**. §14.2 is next.
- **Execution model is now the CLI `/goal` loop + `--dangerously-skip-permissions` (bypass)** — and it's
  *guarded*: both the no-push hook and the migration-freeze hook survive bypass, and the CLI operating
  contract is now genuinely in version control.

## 2. What Tvashtr-19 did
1. **Landed the two Tvashtr-18 capstone FF-merges** (they hadn't actually run — the prior HANDOVER's
   "now FF-merged" was anticipatory; verified from refs/reflog): `86a6685` → `b8a470e`.
2. **Formalized the deferred Tvashtr-18 §17 record** (the capstone + the CLI pivot).
3. **Settled execution (operator): the CLI `/goal` loop + bypass.** Clarified the `/goal`-vs-brief
   confusion → **memory #5** (supersedes the brief-default in #2): lean `/goal` per milestone, agent
   self-decomposes, **architect audits on disk**; **scope each `/goal` LARGER** than the old per-prompt
   slices (a full bounded, transcript-verifiable milestone — not unbounded).
4. **Stood up bypass-safety:** converted the no-push guard from a (bypass-inert) `permissions.deny`
   rule into a `PreToolUse(Bash)` hook (`.claude/hooks/protect-no-push.sh`); ratified the implementer's
   matcher-hardening (the brief's `-C`-only spec was bypassable). Commit `6f0f6b9`.
5. **Versioned the CLI contract** — caught on disk that the Tvashtr-18 infra was untracked; committed
   `protect-migrations.sh` + `CLI-RULES.md` + `CLI-SETUP.md` (+ the no-push-hook prompt). Commit `82d0eab`.
6. **Scoped + decomposed §14**, then **shipped §14.1** via the first bypass `/goal` (audited
   zero-blocking, FF-merged `3f02189`).
7. **Rewrote the Claude.ai project description + instructions** (matured thesis + the `/goal` model) and
   handed them to the operator to paste — *not repo files*; do not expect them on disk.

## 3. Immediate next steps (Tvashtr-20)
**Scope + ship §14.2 — the A/B pair + launch.** But settle the open decision FIRST (see §4).

§14.2 design (from the §17 *design* entry — re-read it):
- **`POST /api/ab-runs`** — one idea + two configs → **two runs sharing a pairing key**.
- **A nullable `pair_id` (uuid) + `pair_label` ("A"/"B") on `Run`** (migration **`0010`** — a *new*
  migration, NOT a new `run_pairs` table; the freeze hook guards only `0001`–`0009`, so `0010` is fine).
- **v1 configs: A = `two_node` (no review), B = `review_loop` (the agent-Reviewer)** — the two we
  already have; the delta tests the §1 question (does the review gate change the output, or is it
  theatre?). Arbitrary-config A/B is Phase-2, not now.
- **The verdict-reasons persistence** (needed by §14.3's "what B caught" story): `AgentInvocation`
  carries only the verdict *label* today; the *reasons* (`verdict["reasons"]`) are written nowhere
  queryable. So persisting them = a new column (e.g. `agent_invocations.outcome_detail`) +
  `close_invocation_step` gains a param + the reviewer call site in `team_run.py` passes the reasons.

## 4. THE OPEN DECISION to settle before writing §14.2's `/goal`
**Do the verdict-reasons persistence as its OWN `/goal`, or fold it into the A/B pair + launch?**
- It's the one piece that touches **a migration AND the executor** (`close_invocation_step` +
  `team_run.py`) — the exact risk seam the freeze hook exists to protect. That argues for **isolating
  it** as its own clean, focused, separately-audited milestone (migration `0010` could be *just* the
  `pair_id`/`pair_label`, or *just* the reasons column, or both — part of the call).
- Counter: they're cohesive (both back §14.3), and the operator wants **larger** `/goal` scope.
- **Architect's lean:** isolate the migration+executor change (reasons-persistence) as one `/goal`, and
  the A/B pair+launch (endpoint + the pairing migration) as another — but re-decide with fresh context;
  this is a genuine fork, not settled. Whatever you choose, the migration + executor change must be its
  own auditable evidence in the transcript.

## 5. How we execute now (the loop)
1. **Architect writes ONE lean `/goal`** for the milestone: the outcome + the hard invariants/
   do-not-touch (expressed AS acceptance evidence where possible, e.g. `git diff --stat` showing X
   untouched) + the acceptance/evidence checklist the transcript must show (tests with thresholds,
   payload samples, the branch + a READY_TO_MERGE line; tell it to echo each piece of evidence) + stop
   conditions (NEEDS_HUMAN to STATE.md on an external blocker; a turn cap).
2. **Operator launches** `cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`,
   pastes the init prompt (CLI-SETUP §5), then the `/goal`. It runs turn-after-turn, commits on a branch.
3. **Operator pastes the report** (or you read STATE.md / the branch directly).
4. **Architect audits on disk** — read the changed files + `git diff --stat` + refs vs acceptance;
   confirm tests actually ran (read the output), flag gaps/risks/deviations, update the plan.
5. **Operator FF-merges.** Repeat.

The governing docs are `prompts/CLI-RULES.md` (in-session contract) + `prompts/CLI-SETUP.md`
(launch/resume). A step-by-step **brief inside the `/goal` is optional** (fold it in, or point at a
`prompts/<name>.md`). `/tvashtr-loop <brief-path>` + Playwright MCP remain available when useful.

## 6. Guardrails (config-enforced; survive bypass)
- **Agent never pushes** — operator merges. `.claude/settings.json` `deny` (non-bypass layer) **+**
  `.claude/hooks/protect-no-push.sh` (PreToolUse Bash; survives bypass; blocks `git push`/`--force`/
  `reset --hard`, allows `git stash push`).
- **Migrations `0001`–`0009` frozen** — `.claude/hooks/protect-migrations.sh` (PreToolUse Edit|Write).
  Create a NEW migration (`0010`) instead.
- **Branch-per-step; operator FF-merges (always `--ff-only`); the agent commits ONLY its own changed
  paths** — explicit `git add`, never `-A` — so it never sweeps the architect's in-flight doc edits.

## 7. Gotchas / carry-forward
- **The working tree always carries uncommitted `HANDOVER.md` + `PROJECTPLAN.md`** (the architect's
  living-doc edits) and sometimes an untracked `prompts/*.md`. **Right now, this closeout's PROJECTPLAN
  + HANDOVER edits are uncommitted on `main` and still need a commit** (operator's call — typically a
  `docs(tvashtr-19): closeout` commit of just those two paths). The CLI agent must never stage them.
- **Two stale Tvashtr-18 comments still pending** (cosmetic): the `loop-feature-docker` Makefile `##`
  help says "Gemini" (the proven model is **NIM** via `.env`); **CLI-RULES §4.6**'s Gemini-key caveat
  is factually wrong (the key authenticated — *quota* was the wall). Fix each when next editing that file.
- **NIM free-tier dependency** — the capstone is proven + recorded, but *re-running* `loop-feature-docker`
  depends on the NVIDIA NIM free tier staying usable.
- **The verdict view surfaces LABELS only** (reasons land with §14.2). To *see* the multi-round case
  visually, start the backend with `TVASHTR_FORCE_REVISIONS=1` then do a UI run (the data path is already
  proven by the ordering test).
- **`.claude/settings.local.json`** is the operator's personal local permission grants — currently
  tracked; gitignore + `git rm --cached` it later if you'd rather keep it out of VCS (not blocking).
- **Disk-audit is the control point.** Don't trust "done": read the changed files, confirm tests ran
  (the output, not the claim), verify git state from refs. The no-push run *improved* on the brief and
  the §14.1 run was zero-blocking — but only because they were audited.

## 8. Useful state
- **`main` @ `3f02189`.** Alembic head **`0009`**. **161 offline tests** + **43 vitest**, ruff clean.
- Commit chain since Tvashtr-17: `a678f9b` (T17 agent-Reviewer) → `86a6685` → `b8a470e` (T18 capstone)
  → `6f0f6b9` (no-push hook) → `82d0eab` (CLI infra versioned) → `3f02189` (§14.1 verdict view).
- Stack (locked): Python 3.12, FastAPI, DBOS Transact, SQLAlchemy 2/Alembic, Postgres 16, React Flow,
  LiteLLM proxy, OpenHands SDK, Node 24, Docker. Default LLM provider OpenRouter; agent runs on
  `nvidia_nim/qwen/qwen3-next-80b-a3b-instruct` (key in gitignored `.env`).
- Filesystem MCP is the only way to touch the repo from the architect chat. `list_allowed_directories`
  at session start; for the 280 KB+ PROJECTPLAN, copy it to Claude's side + grep/sed (read), but write
  edits back to the original via `edit_file` (always `dryRun: true` first, anchor on unique multi-line
  strings). `.git` refs/logs are plaintext — read them to verify git state.

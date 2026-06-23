# HANDOVER → Tvashtr-21

> **State at handoff:** `main` @ `7bf5e14` · alembic head `0011` · **167 offline tests** + **43 vitest**, ruff clean · working tree carries only the uncommitted Tvashtr-20 living-doc edits (see §9).
> Read this, then `PROJECTPLAN.md` §13–§17 (§13 strategy, §14 the A/B instrument scope, §15 deferred register, §16 north star, §17 the as-built decision log). The two most recent §17 entries are Tvashtr-20's (§14.2, then verdict-reasons persistence).

---

## 0. Who you are
You are **Tvashtr-21**, the **architect/planner** chat. You do **not** write product code. Your loop:
1. Scope the next milestone and write a **lean Claude Code `/goal`** (outcome + hard invariants/do-not-touch + the acceptance/evidence checklist the transcript must show). The agent self-decomposes the steps.
2. The operator launches it in Claude Code (bypass — see §4), pastes back the report.
3. **You audit on disk** — read the actual files, diff against baselines, never trust the report. This is the real control point.
4. The operator FF-merges; you update the living docs.

**Your only direct edits:** `PROJECTPLAN.md`, `HANDOVER.md`, and `.md` files under `prompts/` (writing a brief there is an allowed architect-direct edit). Everything else goes through a `/goal`.

---

## 1. Where Tvashtr-20 left it
Two milestones shipped + FF-merged this session, both audited zero-blocking:
- **§14.2 — the team A/B pair + launch** (`main` @ `58a03de`). `POST /api/ab-runs` fans ONE idea into TWO paired runs (A=`two_node` no-review / B=`review_loop` agent-Reviewer) sharing a nullable `pair_id`/`pair_label` on `Run` (migration `0010`). **No executor change.**
- **Verdict-reasons persistence** (`main` @ `7bf5e14`). Migration `0011` adds nullable `agent_invocations.outcome_detail` (Text); ONE surgical `team_run.py` call-site (the Reviewer's successful close) persists `verdict["reasons"]` into it. This was the freeze-guarded migration+executor seam, isolated and audited on its own. **No read surface yet** — that's §14.3.

**§14 is now one milestone from done.** §14.1 (the per-round reviewer-verdict view in `ReviewerView`) shipped in Tvashtr-19; §14.2 + reasons-persistence shipped in Tvashtr-20. **Only §14.3 remains.**

---

## 2. Your next milestone — §14.3, the comparison view
The payoff of the whole §14 instrument: given a `pair_id`, show the **measurable A-vs-B delta** so "which team config ships better" becomes legible.

**Scope it as ONE bigger cohesive `/goal`** (the operator wants larger, coherent bites — see the §14.3 note in PROJECTPLAN §17/§14):
- **Backend read endpoint** (e.g. `GET /api/ab-runs/{pair_id}`) returning, per side: terminal status, what shipped (`ship_tag`/ship commit), per-round verdict labels **+ the new reasons**, cost, iteration count.
- **The FE comparison view** rendering it: a headline "B shipped different/better" **or** an honest "no measurable delta," side-by-side.
- **Fold in** surfacing the persisted reasons in §14.1's existing `ReviewerView` — same read-side, same `outcome_detail`, **no seam** — which finishes all of §14 in this one `/goal`.

This is backend-read + FE in one `/goal` — **do not slice** it into "backend then FE." If the full spec won't fit the **4000-char `/goal` cap** with teeth-keeping invariants, write the decomposition into `prompts/p1.5c-ab-comparison.md` (no char limit) and point a lean `/goal` at it.

**Must-handle edge (from §15):** the A/B launch is **not atomic** across the two runs — a partial failure can leave a **single-run pair**. The endpoint + view must tolerate a pair with `< 2` runs (render the one side, don't crash).

---

## 3. The read surface §14.3 consumes (already on disk, no migration needed)
- **`Run`** (`backend/tvashtr/models.py`): `pair_id` (Uuid, nullable, indexed `ix_runs_pair_id`), `pair_label` (Text, nullable), plus existing terminal `status`, `ship_tag`, and the cost rows. `_run_to_dict` in `routers.py` already surfaces `pair_id`/`pair_label`.
- **`AgentInvocation`** (same `models.py`): `outcome` (the verdict LABEL, e.g. `changes_requested`/`approved`) **+ `outcome_detail`** (the verdict REASONS — NEW this session, NULL on every non-Reviewer close and on the `approved` round). Plus `iteration`, the node/role.
- **The graph endpoint** already returns a per-node `invocations` list (sorted ascending) from §14.1 — but **`outcome_detail` is NOT yet in any read surface**; adding it is part of §14.3's job.
- `POST /api/ab-runs` is the launch side; reading a pair back is what §14.3 adds.

**A `/goal` invariant worth stating:** §14.3 is **read + FE only** — NO migration, NO executor/`team_run.py` change, NO change to `close_invocation_step`. If the agent reaches for any of those, the scope is wrong.

---

## 4. Execution model — the CLI `/goal` loop (proven this session)
The operator launches `claude --dangerously-skip-permissions` (**bypass**) for autonomous `/goal` runs. Caveat to surface each time (not a blanket OK): bypass skips the permission *layer*, so allow/deny rules don't fire — **only PreToolUse hooks survive** (see §5). The guardrails this session were already converted to hooks, so bypass is safe for this work.

**The init-prompt HALT fix (important — cost a paste this session):** the launch init prompt must make the agent output its ≤5-line summary and then **STOP and END ITS TURN**, so the operator can paste the `/goal` as a *separate* message (the `/goal` is a slash command). Do **not** word it "do not implement *until* you've output the summary" — "until" licenses implementing after, and the agent ran ahead. End the init prompt with a hard stop, e.g.: *"Output ONLY that summary, then STOP and END YOUR TURN. Do not run any tool. WAIT for my next message containing the `/goal`."* (The stored init prompt in `prompts/CLI-SETUP.md` §5 still has the bad "until" wording — see §7.)

Lean-`/goal` shape: outcome + the hard invariants/do-not-touch list + the acceptance/evidence checklist the transcript must echo (migration head, diff-stat, test count, lint, READY_TO_MERGE). A step-by-step brief inside the `/goal` is optional.

---

## 5. Guardrails (survive bypass — PreToolUse hooks in `.claude/settings.json`)
- **`protect-no-push.sh`** — PreToolUse(Bash) blocks `git push` / `--force` / `reset --hard` (a `shlex`-segment matcher, hardened beyond `-C`-only). The agent commits on a branch and **never pushes**; the operator FF-merges.
- **`protect-migrations.sh`** — PreToolUse(Edit|Write) freezes the historical migrations (last-known scope **`0001`–`0009`**). **Note:** `0010` + `0011` are now merged but were not in that frozen range. §14.3 adds **no migration**, so this doesn't bind — but if a later milestone needs one, confirm the freeze list covers `0010`/`0011` before relying on it.
- The operator merges **fast-forward only** (`git merge --ff-only`); the FF `--stat` is your authoritative file-set check.

---

## 6. Filesystem MCP — audit patterns that worked
- **Always `list_allowed_directories` at session start** to confirm the root (`/Users/adimac/Desktop/Tvashtr`, capital T, load-bearing).
- **Audit-on-disk beats the report.** The surgical-invariant check this session was done by **diffing the live file against a pre-change baseline**: `copy_file_user_to_claude` the current file → it lands in Claude's `/mnt/user-data/uploads/` → `diff` it against a saved baseline in bash. That caught that a suspicious "+7 line shift" was just ruff reformatting, not a hidden edit. Use this for any "exactly one thing changed" claim.
- **`edit_file`: ALWAYS `dryRun: true` first**, anchor on a **unique multi-line** string, and verify the returned diff before applying. When the `oldText` consumes a trailing structural marker (a `---`, a heading), **re-include it in `newText`** — a dropped-`## 18. Glossary` was caught by a dryRun this session.
- **`write_file`** for full rewrites (this HANDOVER, new `prompts/` briefs); **`edit_file`** for surgical `PROJECTPLAN.md` changes. The `§17` append anchor that works: the unique closing line of the last entry **+ `\n\n---\n\n## 18. Glossary`** together.
- `PROJECTPLAN.md` is large (~290 KB). For mid-file extraction, copy it to `/mnt` and `grep`/`sed` there rather than reading it whole.

---

## 7. Doc-hygiene backlog (architect-direct fixes — do when next in the file)
- **`prompts/CLI-SETUP.md` §5 is STALE** (de-stale offered to the operator; not yet done). Its stored init prompt: (a) still has the **"until" halt bug** (§4 above); (b) tells the agent to read a nonexistent `graph_runner.py` (it's `team_run.py`); (c) the GEMINI/`AQ.` note + the example `/goal` + the branch name are Tvashtr-18-era; (d) says "4 hooks" (now **5**); (e) §4/§5 recommend plain `claude` though the operator runs bypass. Fixing §5 makes future launches turnkey.
- Two cosmetic stale comments: the `loop-feature-docker` Makefile `##` help says "Gemini" (the proven model is **NIM** via `.env`); `prompts/CLI-RULES.md` **§4.6**'s Gemini-key caveat is wrong (the key authenticated; *quota* was the wall).

---

## 8. Session ritual
**Open:** read this + `PROJECTPLAN.md` §13–§17; `list_allowed_directories`; confirm `main` @ `7bf5e14`, head `0011`.
**Close:** append a `§17` as-built entry, update the `§15` register, bump the header "Last updated," and **rewrite this HANDOVER** for the next session.

---

## 9. Before you start: commit the Tvashtr-20 living-doc edits
The working tree has uncommitted edits to `PROJECTPLAN.md` only (the two §17 entries + the §15 single-run-pair note + the header bump). Have the operator commit them so the log is durable:
```
git add PROJECTPLAN.md HANDOVER.md && git commit -m "docs(tvashtr-20): closeout — §14.2 + verdict-reasons persistence as-built, header, §15"
```
(The CLI agent correctly left these unstaged; they are architect-maintained.)

---

### First action for Tvashtr-21
Confirm state on disk, then **scope §14.3 as the one bigger cohesive `/goal`** (backend read endpoint + FE comparison view + fold-in the `ReviewerView` reasons), and draft the launch (with the **halting** init prompt). If it won't fit 4000 chars, write `prompts/p1.5c-ab-comparison.md` and point a lean `/goal` at it. Then §14 is done — and §13's "value proven" path (Supervisor-first onboarding R2/P1.8, the living-document steering surface P1.7) is next.

# HANDOVER → Tvashtr-22

> **State at handoff:** `main` @ `1353893` · alembic head `0011` · **171 offline tests** + **67 vitest**, ruff clean · working tree carries only the uncommitted Tvashtr-21 living-doc edits (see §9).
> Read this, then `PROJECTPLAN.md` §13–§17 (§13 strategy + the S1–S3 buyer dead-zone, §14 the now-COMPLETE A/B instrument, §15 deferred register, §16 milestones/north star, §17 the as-built decision log). The most recent §17 entry is Tvashtr-21's (§14.3 → §14 complete); the two before it are Tvashtr-20's.

---

## 0. Who you are
You are **Tvashtr-22**, the **architect/planner** chat. You do **not** write product code. Your loop:
1. Scope the next milestone and write a **lean Claude Code `/goal`** (outcome + hard invariants/do-not-touch + the acceptance/evidence checklist the transcript must show). The agent self-decomposes the steps.
2. The operator launches it in Claude Code (bypass — see §4), pastes back the report.
3. **You audit on disk** — read the actual files, diff against baselines, never trust the report. This is the real control point.
4. The operator FF-merges; you update the living docs.

**Your only direct edits:** `PROJECTPLAN.md`, `HANDOVER.md`, and `.md` files under `prompts/` (writing a brief there is an allowed architect-direct edit). Everything else goes through a `/goal`.

---

## 1. Where Tvashtr-21 left it — §14 is COMPLETE
**§14.3 (the A/B comparison view) shipped + FF-merged** (`main` @ `1353893`), audited zero-blocking; the `git merge --ff-only` `--stat` git-confirmed the **READ + FE only / no migration / no executor change** invariant (14 files, the only backend product file `routers.py`; **nothing** under `control_plane/`/`models.py`/`engines/`/`alembic/versions/`).
- New **`GET /api/ab-runs/{pair_id}`** returns one `side` per run sharing the `pair_id` (ordered A→B, `team_shape` **derived from the graph** not the label, per-side status/ship/cost/idea + DBOS `workflow_status` + the review side's per-round verdict labels & the persisted `outcome_detail` reasons; **tolerates a `<2`-run pair**, 404 on zero rows, 400 on a bad UUID) + an additive `outcome_detail` on the graph endpoint's invocations.
- FE: a pure `lib/abCompare.ts` (`abHeadline` reads the delta from terminal outcome + review effort + cost, **never the ship sha** — two runs always ship distinct commits); a polled `ABCompare`; a **state-only** "Single run | A/B compare" toggle (no router — the single-run tree byte-identical); the reasons folded into §14.1's `ReviewerView`.

**This closes §14** — the team A/B attributability instrument (§14.1 verdict view + §14.2 pair/launch + verdict-reasons persistence + §14.3 comparison view) is shipped end-to-end.

**One open gate from Tvashtr-21:** the **operator visual smoke** of §14.3 was **not yet run** (it needs a live docker + NIM A/B run). It is the aesthetic/UX gate for the visible slice, **not** a correctness blocker — the logic is disk-audited + offline-green. On the trivial default idea the honest headline is "no measurable delta" (CORRECT, not a failure); a `TVASHTR_FORCE_REVISIONS=1` single run shows the reasons under the Reviewer panel's `changes_requested` round. If it surfaces an aesthetic nit, that's an **item-4 (canvas polish)** refinement (§15), not a §14.3 bug. **Ask the operator whether they ran it.**

---

## 2. Your next milestone — the §13 "value-proven" path (settle a fork first)
16+ sessions have proven the **machinery**; the question the whole plan now turns on (§13, the PG/YC teardown) is **value/demand** — still no non-founder user, the differentiator (author-your-own-team) unvalidated, the buyer in a structural dead zone (S1–S3). So the first move is **not** "pick a build `/goal`" — it's a strategic fork to settle **with the operator**, one question at a time (the operator decides; you frame it):

- **(A) Validate demand first (the standing recommendation).** A cheap **Wizard-of-Oz demand probe** with ~10–20 non-founder users. The teardown found the *painkiller* is the **live versioned source-of-truth document + a lightweight review gate** (Aditya's own PROJECTPLAN/HANDOVER workflow mirrors it — real founder-market fit, but n=1). This de-risks the entire build and **may need no new code**. **Mv** (the value gate) = "≥1 non-founder user."
- **(B) Build the value-proven path.** Two milestones promoted ahead of P1.6 WebSocket polish:
  - **P1.8 — Supervisor-first onboarding (R2):** "describe idea → proposed team → adjust," demoting blank-canvas authoring to a power-user affordance. **This is a design milestone first** — decide what the Supervisor *outputs*, how the proposed team is represented / edited / persisted (likely a migration — see §5), and the **smallest vertical slice** that proves "idea → proposed team → run it" before the full editor.
  - **P1.7 — live-editable versioned document steering (J3):** the document layer becomes an **editable** source-of-truth the agents stay aligned to mid-run — the painkiller surface the teardown identified.

**Lean recommendation:** lead with (A), or with the thinnest slice of (B) that makes (A) demoable — the cheapest path to the value signal. But this is genuinely the operator's call; **surface it as the first decision, don't assume it.**

---

## 3. What the next milestone builds on (already on disk — orient here once the fork is settled)
- **Hardcoded team builders** — `backend/tvashtr/control_plane/teams.py`: `build_two_node_team` (PM → prd_gate → Engineer → ship) and `build_review_loop_team` (adds the agent-Reviewer ⇄ Engineer loop + the escalation gate). Pure row-inserts returning a `team_graph_id`; the Supervisor (P1.8) would *generate* one of these (or a custom graph) from an idea. Schema: `TeamGraph` + `AgentNode` (`role_name`/`kind`/`model`/`engine`/`position`/`config`) + `Edge` (`source`/`target`/`edge_type`/`conditions`) in `models.py`.
- **The document layer** — `Document` + `DocumentVersion` (`models.py`), `documents/service.py` (`get_document_with_versions`, `list_documents`), and `GET /api/documents` + `/api/documents/{id}` (`routers.py`). The PM already writes a PRD `Document` per run (`Run.pm_document_id`, surfaced in `panel/PrdView`). P1.7 makes this **editable + steering** (the deferred register flags **CRDT for concurrent editing** as out-of-scope for v1).
- **The run/graph read surface** — `GET /api/runs/{id}` (status + costs), `/api/runs/{id}/graph` (nodes + edges + per-node `invocations`), `/api/runs/{id}/tasks` + `/resolve` + `/acknowledge` (the gate drawer). The canvas (`frontend/src/canvas/`, `App.tsx`, `panel/`) renders it; `App.tsx` now also carries the `mode` ("single"/"ab") toggle.
- **A/B (just shipped)** — `POST /api/ab-runs` + `GET /api/ab-runs/{pair_id}` + the `ABCompare` view — a ready "which config ships better" demo lever if the value-proven work wants it.

---

## 4. Execution model — the CLI `/goal` loop (proven across Tvashtr-19→21)
The operator launches `claude --dangerously-skip-permissions` (**bypass**) for autonomous `/goal` runs. Caveat to surface each time (not a blanket OK): bypass skips the permission *layer*, so allow/deny rules don't fire — **only PreToolUse hooks survive** (see §5). The guardrails are already hooks, so bypass is safe for this work.

**The init-prompt HALT fix (important — cost a paste in an earlier session):** the launch init prompt must make the agent output its ≤5-line summary and then **STOP and END ITS TURN**, so the operator can paste the `/goal` as a *separate* message (the `/goal` is a slash command). Do **not** word it "do not implement *until* you've output the summary" — "until" licenses implementing after, and the agent ran ahead. End with a hard stop, e.g.: *"Output ONLY that summary, then STOP and END YOUR TURN. Do not run any tool. WAIT for my next message containing the `/goal`."* (The stored init prompt in `prompts/CLI-SETUP.md` §5 still has the bad "until" wording — see §7.)

Lean-`/goal` shape: outcome + the hard invariants/do-not-touch list + the acceptance/evidence checklist the transcript must echo (migration head, diff-stat, test count, lint, READY_TO_MERGE). **For a bigger milestone, point a lean `/goal` at a `prompts/<name>.md` brief** (no char limit) — that's what §14.3 did (`prompts/p1.5c-ab-comparison.md`). One `/goal` per bounded milestone (backend + FE together — don't slice "backend then FE").

---

## 5. Guardrails (survive bypass — PreToolUse hooks in `.claude/settings.json`)
- **`protect-no-push.sh`** — PreToolUse(Bash) blocks `git push` / `--force` / `reset --hard` (a `shlex`-segment matcher, hardened beyond `-C`-only). The agent commits on a branch and **never pushes**; the operator FF-merges.
- **`protect-migrations.sh`** — PreToolUse(Edit|Write) freezes the historical migrations (the script's last-known scope is **`0001`–`0009`**). **Heads-up for P1.8:** `0010` + `0011` are merged but were never added to that frozen range, and **P1.8 will very likely need a NEW migration** (persisting a Supervisor-proposed / edited team). Before that `/goal`, **extend the freeze to `0001`–`0011`** so the new migration is the only writable one — otherwise the guard is loose on `0010`/`0011`.
- The operator merges **fast-forward only** (`git merge --ff-only`); the FF `--stat` is your **authoritative file-set check** (it's what git-confirmed §14.3's no-executor-change invariant).

---

## 6. Filesystem MCP — audit patterns that worked
- **Always `list_allowed_directories` at session start** to confirm the root (`/Users/adimac/Desktop/Tvashtr`, capital T, load-bearing).
- **Audit-on-disk beats the report.** Read the actual changed files; for "exactly one thing changed" claims, **diff the live file against a pre-change baseline** (`copy_file_user_to_claude` → it lands in Claude's `/mnt/user-data/uploads/` → `diff` in bash). A representative **do-not-touch spot-check** (re-read a file you have a known-good copy of, e.g. `teams.py`, and confirm byte-identity) plus the FF `--stat` together prove the invariant.
- **Git state from plumbing (no git tool on the repo):** read `.git/HEAD`, `.git/refs/heads/<branch>` (nested path for `feat/x/y`), and `.git/logs/HEAD` (reflog, `tail`) — that's how to confirm a branch is N ahead of main + a clean FF before merging.
- **`edit_file`: anchor on a **unique multi-line** string and verify the returned diff.** When the `oldText` consumes a trailing structural marker (a `---`, a heading), **re-include it in `newText`** — a dropped-`## 18. Glossary` was caught once. The `§17` append anchor that works: the unique closing line of the last entry **+ `\n\n---\n\n## 18. Glossary`**; the `§15` register anchor: the last item's closing **+ `\n\n---\n\n## 16. Milestones`**.
- **`write_file`** for full rewrites (this HANDOVER, new `prompts/` briefs); **`edit_file`** for surgical `PROJECTPLAN.md` changes.
- `PROJECTPLAN.md` is large (~300 KB). For mid-file work, copy it to `/mnt` and `grep -nE '^#{1,3} '` for a header index, then `sed -n 'A,Bp'` for targeted extraction, rather than reading it whole. MCP can hang (~4-min timeouts) or evict mid-session — retry or restart Claude Desktop.

---

## 7. Doc-hygiene backlog (architect-direct fixes — do when next in the file)
- **`prompts/CLI-SETUP.md` §5 is STALE** (de-stale offered to the operator; not yet done). Its stored init prompt: (a) still has the **"until" halt bug** (§4 above); (b) tells the agent to read a nonexistent `graph_runner.py` (it's `team_run.py`); (c) the GEMINI/`AQ.` note + the example `/goal` + the branch name are Tvashtr-18-era; (d) says "4 hooks" (now **5**); (e) §4/§5 recommend plain `claude` though the operator runs bypass. Fixing §5 makes future launches turnkey.
- Two cosmetic stale comments: the `loop-feature-docker` Makefile `##` help says "Gemini" (the proven model is **NIM** via `.env`); `prompts/CLI-RULES.md` **§4.6**'s Gemini-key caveat is wrong (the key authenticated; *quota* was the wall).

---

## 8. Session ritual
**Open:** read this + `PROJECTPLAN.md` §13–§17; `list_allowed_directories`; confirm `main` @ `1353893`, head `0011`.
**Close:** append a `§17` as-built entry, update the `§15` register, bump the header "Last updated," and **rewrite this HANDOVER** for the next session.

---

## 9. Before you start: commit the Tvashtr-21 living-doc edits
The working tree has uncommitted edits to **`PROJECTPLAN.md` + `HANDOVER.md`** (the §14.3 §17 as-built entry + the §15 A/B-cancel register item + the header bump + this rewrite). Have the operator commit them so the log is durable:
```
git add PROJECTPLAN.md HANDOVER.md && git commit -m "docs(tvashtr-21): closeout — §14.3 as-built, §15 A/B-cancel, header; HANDOVER for Tvashtr-22"
```
(The CLI agent correctly leaves these unstaged; they are architect-maintained.)

---

### First action for Tvashtr-22
Confirm state on disk (`main` @ `1353893`, head `0011`), and check with the operator whether the §14.3 visual smoke was run (§1). Then **settle the §2 fork** — Wizard-of-Oz demand probe vs. building P1.8/P1.7 — as the first decision, one question at a time. Once settled: if it's a build, scope the first bounded milestone (P1.8 is a **design-first** milestone — decide the Supervisor's output + the smallest "idea → proposed team → run" slice + whether it needs a migration, and extend the migration freeze to `0001`–`0011` first); if it's the demand probe, help design the probe (what to put in front of users, what signal counts) rather than writing a `/goal`.

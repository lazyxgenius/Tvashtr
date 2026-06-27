# Tvashtr — Handover (Tvashtr-32 → Tvashtr-33)

> Structured continuity snapshot for the next architect chat. Read this, then the named
> `PROJECTPLAN.md` sections, then trace the relevant code on disk before designing anything.
> **The §17 decision log + §15 deferred register in `PROJECTPLAN.md` are the durable source of
> truth; this file is the fast-start.**

---

## 0. You are Tvashtr-33. First moves.

1. Read this file fully.
2. Read `PROJECTPLAN.md`: the header banner, §1 + "strategic direction", §13 S3/S4, §15 Phase 1.5 + the deferred register (esp. the new **"Brownfield / real-repo run mode"** group), §16, and the **2026-06-27 (Tvashtr-32) §17 entry** (the six decisions D1–D6 + the Slice 1 & 2 as-builts).
3. Read `prompts/CLI-RULES.md` (the Claude Code operating contract you write `/goal`s against).
4. Then pick up at **Slice 3** (§3 below). Don't design until you've read the above and traced the relevant code.

---

## 1. Where we are (state)

- **`main` @ `8f22592`** — the Slice 2 docs commit, on top of `5a99fc9` (Slice 2 code), on `6530ddb` (Slice 1 closeout), on `5f65904` (M2). Linear, clean, nothing pushed.
- **alembic head `0015`** (`0015_run_brownfield_target`). Migration freeze covers `0001`–`0015` (the `protect-migrations.sh` hook regex is `^00(0[1-9]|1[0-5])_`).
- **Test floors: 260 backend pytest / 144 vitest** (was 239/126 at the start of Tvashtr-32). `make lint` clean (ruff + prettier; scripts/ + FE under the gate).
- **Session Tvashtr-32 shipped both backend + frontend of the brownfield run mode** (M-brownfield Slices 1 & 2), each disk-audited + FF-merged by the operator.

**One housekeeping item for the operator (not yet done):** the **docs-closeout commit** — `PROJECTPLAN.md` (the Tvashtr-32 edits) + the two untracked briefs (`prompts/brownfield-1-backend-run-mode.md`, `prompts/brownfield-2-launch-panel.md`) are on disk but uncommitted. The command is in §7 below. (They don't affect anything; the agent leaves living docs untracked by design.)

---

## 2. What's done (this session — M-brownfield Slices 1 & 2, both merged)

The active bet is **local execution → brownfield**: Tvashtr runs locally and ships a *reviewed* feature into the user's **real existing repo** (the cheapest version on the current stack — NOT a native re-platform, NOT local-LLMs-as-a-pillar). The six design decisions (D1–D6) are fully recorded in the §17 Tvashtr-32 entry. Built so far:

- **Slice 1 — backend run mode (`6530ddb`).** `runs.repo_path IS NULL` ⇒ greenfield (legacy, byte-intact); non-NULL ⇒ brownfield. Migration `0015` (3 nullable cols: `repo_path`/`base_ref`/`ship_branch`); a new openhands-free `control_plane/worktree.py` (`repo_inspect`, idempotent `add_worktree` cutting `git worktree add -b tvashtr/<run_id>`, `build_repo_grounding`); `team_run.py` brownfield threading (greenfield call sites byte-intact); additive `AgentTask.workspace_mode`; `enumerate_push_files_git` + mode-branched docker push/pull; `POST /api/repo/inspect` + `create_run` `repo_path`/`base_ref` (422-validated); `make brownfield-check` (the live real-repo proof). **D6 grew an as-built:** the grounding now also carries a repo-agnostic **worker-protocol** (edit-in-place / land in the real module / run-tests-and-fix) — the correctness lever that made the live gate pass.
- **Slice 2 — launch-panel UI (`5a99fc9`, frontend-only).** Clicking "Run this team" opens `LaunchPanel.tsx` (idea textarea + "work on a local repo" toggle → typed path + `inspectRepo`-on-blur → base-branch `<select>` + a dismissible large-repo worker-model hint naming the team's `agent`-kind nodes by `role_name`); `runTeam(id, opts?)` (greenfield no-opts posts `{team_graph_id}` byte-for-byte); `RunBanner` shows the brownfield branch. `LARGE_REPO_FILE_THRESHOLD = 300`.

---

## 3. Immediate next step — Slice 3 (the M-brownfield exit-bar proof)

The run mode is built end-to-end, but the **exit bar is not yet cleared**: M-brownfield's definition is *a non-trivial feature, on a real existing repo, produces a correct **reviewed** change*. Two things remain, and they're entangled:

1. **The §15 worker-gating carry-forward (do this FIRST — it's a correctness prerequisite).** The D6 grounding's worker-protocol block ("implement by editing in place…") is currently appended to **all** `agent`-kind nodes via `agent_run_step`, **including reviewer-style nodes**. A brownfield review_loop would therefore hand a reviewer worker-implementer instructions — risking the reviewer *implementing* instead of *gating* (corrupting the review semantics). This path is **untested** (Slice 1's gate used `two_node`, no reviewer). **Before** the first brownfield review_loop run, gate the worker-protocol block to worker (non-reviewer) nodes — split it from the always-safe orientation block (conventions + structure + transparency line, which is fine for every node). *Design question to resolve:* how to tell a "worker" from a "reviewer" node at the `agent_run_step` seam — likely via `node_emits_outcome` / the verdict-harvest signal (a reviewer emits an outcome; a pure worker doesn't), but trace it on disk first.
2. **The brownfield review_loop run + the graduated real-repo ladder.** Prove a `review_loop` team (PM → Engineer ⇄ Reviewer → ship) ships a correct, reviewed change into a **real but tractable** repo first (per D4's graduated ladder — repo difficulty dominates success), then progressively harder repos. This is where the *correctness on existing code* bar (the 41–87%-vs-~80% question) actually gets answered. Decide: extend `make brownfield-check` (or a new live target) to drive a real review_loop run, and pick the first real test repo (a small real OSS repo, or a purpose-built one) + a scoped feature.

**Scope Slice 3 as ONE bounded `/goal`** (likely: the worker-gating fix + a brownfield review_loop live target on a tractable repo, with the worker/reviewer split proven). It's backend-side; the FE is done. Mind that this is the slice where the model-choice reality (D4) bites — be ready to recommend (not enforce) a stronger worker model if `llama-3.3-70b` underperforms on a real repo, and confirm whether the review_loop's reviewer should also run on a capable model.

Also on the horizon (not Slice 3 unless you choose): **P1.9** (push/PR — promote the local branch ship to a real GitHub PR; overlaps the brownfield ship target), the **selective git-diff pull** (becomes relevant the moment a real repo run is slow), and the broader §15 register.

---

## 4. FE-testing gotchas (referenced by CLI-RULES + the init prompts as "HANDOVER §4")

- **`user-event` ⊥ vitest fake timers** → use `fireEvent` in RTL tests (the launch-panel tests do this).
- **React Flow needs the jsdom shims** in `frontend/src/test/setup.ts` (ResizeObserver, matchMedia, etc.) — they're already wired; co-located `*.test.tsx` pick them up.
- **Playwright's full a11y snapshot (`browser_snapshot`) HANGS on the large editable React Flow canvas** → use targeted `browser_evaluate` on specific selectors + screenshots, or the scripted headless-Playwright fallback, NEVER a whole-tree snapshot. (The `launch-panel-e2e` proof does targeted evaluate + per-check screenshots.)
- **The architect can't read `/tmp`** — Claude Code's e2e screenshots land in `/tmp/...`, outside the architect's allowed dirs (project root only). So for a **visible** slice, the operator's eyeball (or a glance at the screenshots) is the real UI gate — give a detailed numbered visual script when you need it.

---

## 5. Key decisions + rationale (carry-forward; full text in §17)

- **D1–D6** (Tvashtr-32 §17): worktree mount / branch-only local ship + `0015` cols / git-aware sync / recommend-don't-enforce correctness / unified launch panel / invisible grounding. Each was decided **from the vision, one at a time, paired with its UX consequence** — the standing method.
- **The brownfield thesis:** *the hard part is correctness on existing code, not the mounting.* Slice 1's live gate confirmed it (the agent half-failed on a trivial task until the grounding worker-protocol was added). Slice 3 is where this thesis gets its real test.
- **Greenfield is sacred:** every brownfield path is additive + gated on `repo_path`/`grounding`/`workspace_mode`; proven byte-intact by the full suite + the greenfield smokes. Keep it that way.

---

## 6. Standing operator directives (inherit these — they are permanent)

- **Claude is ARCHITECT/PLANNER only.** ALL implementation (product code, throwaway/diagnostic scripts, build/Makefile/config) goes through Claude Code via a `/goal`. The only architect-direct edits: the two living docs, `prompts/*.md`, and trivial doc/comment/typo fixes. When tempted to write code, write a `/goal`.
- **The disk audit is the real control point.** Never trust Claude Code's self-report over disk. Diff "untouched" claims against a pre-image (copy the pre-image to a DISTINCT path like `/tmp/pre/` first — basename collision overwrites otherwise). Confirm tests are mutation-real (read the bodies). Scrutinize every deviation yourself — don't rubber-stamp the agent's self-justification.
- **Every Claude Code handoff = the COMPLETE copyable launch package, EVERY time:** (1) the shell launch command (with `--dangerously-skip-permissions`), (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. NEVER "same as before", never point them at a file to retrieve the init/goal text. The brief MAY live in `prompts/*.md` (the `/goal` references it), but the init + `/goal` are always reproduced inline.
- **Scope each `/goal` to ONE bounded milestone** whose completion is verifiable in a single transcript. Claude Code runs ALL verification itself (tests + lint + live targets) and debugs to green before `READY_TO_MERGE` — never hand the operator commands to run, never defer a live target to a "human gate". Tell it to echo each evidence line into the chat (CLI-RULES §4.3a).
- **Merge handoff = ALL commands, every time** (`cd`, `git checkout main`, `git merge --ff-only <branch>`, the verify `git log --oneline -N` + expected tip sha, the FF-fail instruction, optional `git branch -d`).
- **Visual/manual sign-off = a DETAILED, NUMBERED, click-by-click script** naming elements by visible label, with explicit pass/fail — never an abstract checklist. (Prefer Claude Code's Playwright self-sign-off + screenshots; the operator's eyeball is the optional-glance backstop, mandatory for visible slices since the architect can't read `/tmp`.)
- **Make design decisions from the vision, one at a time, each paired with its concrete UX consequence** (what the user sees/does on the canvas/UI). Don't present option menus for vision calls — decide; reserve "present both" for genuine strategic-direction calls. If the operator asks "are you deciding from the vision and not shying from work?", that's the calibration signal.
- **Build-first stance:** no demand validation until a real feature-shipping Tvashtr exists (M-brownfield). The Wizard-of-Oz demand probe is permanently deferred until then.
- **Execution = the CLI `/goal` loop under bypass** (`--dangerously-skip-permissions`). Surface the bypass caveat: allow/deny rules go inert; only PreToolUse hooks survive (the no-push + migration-freeze guards ARE hooks, so they hold). Containerize if handy (host is a MacBook Air). The built-in `/goal` already gives within-slice autonomy; **don't build a custom chaining loop** — the audit + FF-merge seam between slices is the load-bearing control point, not something to automate away.
- **Comms:** the operator is terse. "proceed"/"go"/"merged"/"done" = ratification + forward motion. "By the way" = wants a short answer. Give multi-step procedures ONE step at a time. Analogies help. Always hand over copyable artifacts — never make them scroll back or reconstruct.
- **Git state reconstruction (no git CLI in the MCP):** read `.git/refs/heads/<branch>` for SHAs, `.git/logs/refs/heads/<branch>` for the reflog (create→commit chain + parent → confirms FF-ability + nothing pushed). Loose refs only (no packed-refs here).
- **PROJECTPLAN editing:** ~84KB file; line 6 is a long single-line banner (unavoidable cost). Pattern: `copy_file_user_to_claude` → `grep -nE '^#{1,3} '` for the header index → `sed -n` targeted reads → `Filesystem:edit_file` with unique multi-line anchors (`dryRun:true` first). §17 is **append-only**.
- **Proven agent path:** `nvidia_nim/meta/llama-3.3-70b-instruct` (NIM, `NVIDIA_BUILD_API_KEY` in `.env`; ~1.4s/call). It's FLAKY on the live loop (the `loop-run-docker` + `brownfield-check` "passed on retry/clean roll" pattern) — a retry, not a code defect. `qwen3-next-80b` is PARKED (the `TextContent is not JSON serializable` SDK flake). `DEFAULT_MODEL` must be a non-reasoning instruct model.

---

## 7. The docs-closeout commit (operator runs this when ready)

Commits the Tvashtr-32 `PROJECTPLAN.md` edits + both untracked briefs together. (`HANDOVER.md` is also modified — include it.)

```
cd /Users/adimac/Desktop/Tvashtr
git add PROJECTPLAN.md HANDOVER.md prompts/brownfield-1-backend-run-mode.md prompts/brownfield-2-launch-panel.md
git commit -m "docs(tvashtr-32): M-brownfield Slices 1+2 as-built (PROJECTPLAN §15/§16/§17 + HANDOVER) + the slice briefs"
git log --oneline -1
```

(Optional; doesn't block Slice 3. If you'd rather batch it into Slice 3's closeout, that's fine too.)

---

## 8. Gotchas not already above

- **The worker-gating carry-forward is a correctness landmine for Slice 3** — don't run a brownfield reviewer until the worker-protocol is gated off reviewer nodes (§3.1). It's the first thing.
- **Stale parked runs** (known §15): if `loop-run`/`loop-crash` hang at interpreter shutdown after printing assertions, leftover PENDING runs are resurrecting — `docker compose down -v && make db-up && make migrate`, then re-run.
- **All git command blocks to the operator must be comment-free** — zsh runs inline `#` as a command in non-interactive mode.
- **`make` live targets needing docker+NIM** can be flaky (NIM); a confirmed outage/dead-credential is `NEEDS_HUMAN`, a throttle/retry is not.

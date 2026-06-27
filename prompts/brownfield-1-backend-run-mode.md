# Brief — M-brownfield, Slice 1: the backend "work on a real local folder" run mode

> Architect: Tvashtr-32. This brief is the authoritative spec for Slice 1 and SUPERSEDES the
> generic milestone section of `CLI-RULES.md §7` for this run. Read `CLI-RULES.md` (the operating
> contract) fully first, then this. The architect has already settled every DESIGN decision below —
> implement THIS design; do not redesign it. Slice 2 (the launch UI) is a SEPARATE later `/goal` —
> **do not build any frontend in this slice.**

---

## 0. Outcome (the one thing this slice delivers)

A backend **brownfield run mode**: when a run is launched against a real local git repo, the agent
works on an **isolated `git worktree` of that repo** (never the user's working tree), the change is
committed to a **real branch `tvashtr/<run_id>`** that lands in the user's repo, and the run is
**grounded** in the repo's conventions/structure — proven end-to-end by a real NIM+docker agent run
on a throwaway fixture repo. **Greenfield behavior is byte-for-byte unchanged.**

The discriminator is one column: `runs.repo_path IS NULL` ⇒ greenfield (the legacy path, untouched);
non-NULL ⇒ brownfield. Every brownfield code path is an ADDITIVE branch gated on that fact.

---

## 1. Context — current state on disk (verified by the architect)

**The run path.** `POST /api/runs` (`routers.py::create_run`) → builds/clones a team graph → creates
a `Run` row → `DBOS.start_workflow(run_team, idea)` keyed on `run_id`. `run_team(idea)`
(`control_plane/team_run.py`) → `load_graph_step(run_id)` (loads the Run row + the graph dict) →
`run_graph(run_id, graph, idea)` walks the graph.

**The workspace is created lazily at the first `agent` node** in `run_graph`'s body:
```python
if workspace is None:
    workspace = engineer_setup_step(run_id)
```
`engineer_setup_step(run_id)` (a `@DBOS.step`) today does, unconditionally:
```python
workspace = make_local_workspace(run_id)      # .tvashtr_workspaces/<run_id>/ (empty), from openhands_adapter
init_workspace_repo(workspace)                 # git init + repo-local identity + empty "init" commit (shipping.py)
_write_workspace_gitignore(workspace)          # writes __pycache__/, *.pyc, REVIEW_VERDICT.json
return workspace
```
`make_local_workspace` roots the dir at `_WORKSPACE_ROOT = backend/.tvashtr_workspaces`.

**Ship.** The `terminal` node (`terminal_kind == "ship"`) calls `ship_step(run_id, workspace)` →
`idempotent_ship(workspace, run_id)` (`shipping.py`): `git add -A` → commit `Ship: {run_id}` → tag
`ship-{run_id}`, recording `ship_commit_sha`/`ship_tag` on the Run. It is idempotent (tag-dedup +
a HEAD-subject recovery for the commit-but-not-tagged crash window). It operates on **whatever
`workspace_dir` is** — it has no greenfield-specific assumption beyond what it's handed.

**The agent step.** `agent_run_step(run_id, node_prompt, model, iteration, idea, prd_text, workspace,
vkey, reviewer_feedback, emits_outcome)` builds the instruction by appending the idea + live PRD
(+ a revision block on rework) UNIFORMLY:
```python
context = f"\n\n--- ORIGINAL IDEA ---\n{idea}\n\n--- PRD ---\n{prd_text}"
# (+ revision block iff iteration > 1 and reviewer_feedback)
instruction = node_prompt + context
task = AgentTask(instruction=instruction, workspace_dir=workspace, model=model, llm_api_key=vkey)
engine_name = "openhands-docker" if get_settings().agent_sandbox_mode == "docker" else "openhands"
adapter = resolve_adapter(engine_name); result = adapter.run(task, on_event=...)
```

**The adapters (the EngineAdapter seam — `engines/base.py`).** `AgentTask` is a frozen dataclass:
`instruction, workspace_dir, model=None, llm_api_key=None`. Note `llm_api_key` was ADDED additively
in P1.4b with a default — **additive defaulted fields are the established, allowed way to extend
`AgentTask`** (this is NOT "changing the interface signature" in the breaking sense). You will add ONE
more such field this slice.

- **`openhands_docker_adapter.py` (the product default).** No bind-mount. Per iteration it COPIES
  files host↔container:
  - `_push_workspace(workspace, host_dir)` seeds the fresh container from the host via
    `enumerate_push_files(host_dir)` (in `docker_runtime.py`).
  - `_pull_workspace(workspace, host_dir)` copies produced files back via container-side
    `find . -type f -not -path '*/.*'`, excluding the scaffolding dirs `bash_events/`,
    `conversations/`.
  - **Both directions EXCLUDE every hidden path at any depth** (`enumerate_push_files` skips any
    `.`-segment; the pull's `find` excludes `'*/.*'`). For greenfield the only hidden thing was
    `.git`. **For brownfield this is wrong** — a real repo's tracked config (`.github/`, `.eslintrc`,
    `.env.example`, …) must reach the container, and a dotfile the agent edits must be pulled back.
- **`openhands_adapter.py` (LOCAL sandbox; not the default).** Runs in-process with
  `workspace=task.workspace_dir`; computes `files_changed` from a non-hidden before/after `_snapshot`.

**`load_graph_step` already loads the Run row** (`select(Run).where(...)`) to get `team_graph_id`, so
it can cheaply also surface `repo_path`/`base_ref` — no extra query.

**Migrations.** Head is `0014`. `0001`–`0014` are frozen by the `protect-migrations.sh` PreToolUse
hook (regex `^00(0[1-9]|1[0-4])_`). A NEW `0015` Write is ALLOWED; **bump the regex to include `0015`
as the LAST step of the slice.**

**`Run` model (`models.py`)** already has `ship_commit_sha`, `ship_tag`, `pair_id`, etc. You will add
three nullable columns.

---

## 2. The settled design (D1–D6) — implement exactly this

**D1 — Mount = isolated `git worktree`, never in-place.** A brownfield run works on
`git worktree add -b tvashtr/<run_id> <workspace> <base_ref>` rooted at `repo_path`, where
`<workspace>` stays `.tvashtr_workspaces/<run_id>/`. The worktree SHARES the repo's object store, so
the branch lands directly in the user's real repo. The user's working tree is never touched.

**D2 — Ship = branch-only, fully local (no push/PR — that is the separate P1.9).** Commit onto the
worktree's HEAD, which IS `tvashtr/<run_id>`; the branch + tag land in the user's repo. New durable
state = three nullable `Run` columns (migration `0015`): `repo_path`, `base_ref`, `ship_branch`.

**D3 — Git-aware host↔container sync for brownfield (docker path).** Push the repo's tracked files +
the agent's untracked-not-ignored files (so tracked dotfiles reach the container, ignored junk does
not); pull all container files EXCEPT `.git/` + the scaffolding dirs (so edited dotfiles come back).
Host-side `git add -A` honors the repo's own `.gitignore`, so even an over-pulled regenerable file
can never reach the commit — **the diff is the source of truth.** Selective (git-diff-based) pull is
DEFERRED (§15) — keep the enumeration factored so it can replace this later; do NOT build it now.

**D4 — Correctness = recommend, don't enforce (and don't automate away judgment).** No model is
forced. (The contextual "use a stronger model on a big repo" hint is a Slice-2 FE concern — not here.)
For THIS slice's automated proof, the fixture task is trivial enough that the proven
`nvidia_nim/meta/llama-3.3-70b-instruct` clears it.

**D5 — (Slice-2 FE; out of scope here.)** `create_run` only needs to ACCEPT `repo_path`/`base_ref`
and the `inspect` endpoint must EXIST; no UI.

**D6 — Repo-grounding = invisible appended context, not an authored node.** For brownfield, append a
grounding block to the agent instruction the same way idea+PRD are appended — NOT a canvas node. The
block = (1) the repo's conventions file if present (first of `AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
`CONTRIBUTING.md`, in that priority; contents truncated to a budget, e.g. ~6 KB) and (2) a structure
summary = a depth-capped directory outline folded from `git ls-files` + the names of any top-level
manifest files (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `requirements.txt`,
`pom.xml`, …). NO other file contents. Plus a one-line transparency note appended to the context
(e.g. `--- REPO GROUNDING (<repo basename>; conventions: CLAUDE.md found | none) ---`). Greenfield
runs append NOTHING new.

---

## 3. Tasks (ordered; you self-decompose within each)

> TDD: write the test alongside each unit. Greenfield byte-intactness is provable by unit tests +
> the existing smokes; assert it.

1. **Migration `0015_run_brownfield_target.py`** — add nullable Text columns to `runs`:
   `repo_path`, `base_ref`, `ship_branch`. No FK, no index (per-run read-by-id). `down_revision="0014"`.
   Update `models.py::Run` with the three `Mapped[str | None]` columns + concise comments. Run
   `alembic upgrade head`; confirm head == `0015`.

2. **Pure git helpers (`shipping.py` or a new `control_plane/worktree.py` — your call; keep it
   openhands-free + unit-tested).** Add:
   - `repo_inspect(path) -> dict`: `{is_git, current_branch, branches, tracked_file_count}` or
     `{is_git: False, error}`. (`git -C path rev-parse --is-inside-work-tree`; `git branch
     --format=%(refname:short)`; `git symbolic-ref --short HEAD`; `git ls-files | wc -l`.) Pure,
     defensive, unit-tested with a temp fixture repo.
   - `add_worktree(repo_path, workspace, run_id, base_ref) -> str` (returns the branch name
     `tvashtr/<run_id>`): IDEMPOTENT on resume — if `<workspace>/.git` already exists, no-op and
     return the branch (mirror `init_workspace_repo`'s no-op-if-`.git`-exists). Else if branch
     `tvashtr/<run_id>` already exists, `git worktree add <workspace> tvashtr/<run_id>`; else
     `git worktree add -b tvashtr/<run_id> <workspace> <base_ref>`. Unit-test the create + the
     resume no-op paths.

3. **Brownfield grounding (`control_plane/team_run.py` + a pure builder).** Add a pure, unit-tested
   `build_repo_grounding(workspace, repo_basename) -> str` implementing D6 (conventions file pick +
   truncation + depth-capped structure summary + the transparency line). Wrap it in a
   `@DBOS.step brownfield_grounding_step(run_id, workspace, repo_basename) -> str` (recorded →
   deterministic on resume). Greenfield never calls it.

4. **Thread brownfield through the executor (`team_run.py`).**
   - `load_graph_step`: also return `graph["repo_path"]` + `graph["base_ref"]` from the Run row.
   - `run_graph`: read `repo_path = graph.get("repo_path")`. Compute `brownfield = repo_path is not None`.
   - `engineer_setup_step(run_id)` → make it brownfield-aware (read the Run's `repo_path`/`base_ref`
     INSIDE the step for determinism, OR pass them in — your call, but the step must replay
     deterministically). Brownfield branch: `add_worktree(...)`, record `ship_branch` on the Run, and
     do NOT write `_WORKSPACE_GITIGNORE` (the repo has its own). Greenfield branch: EXACTLY as today.
   - When brownfield, compute the grounding once via `brownfield_grounding_step` and thread it into
     each `agent_run_step` call as a new `grounding: str | None = None` param, appended AFTER idea+PRD
     +revision. Greenfield passes `None` → nothing appended.
   - `ship_step`/the terminal: `idempotent_ship` works as-is on the worktree (it commits whatever is
     in `workspace_dir`, honoring the repo `.gitignore`). Surface `ship_branch` in the returned dict
     so the run result/banner can show it. Greenfield unchanged.

5. **Additive `AgentTask` field + git-aware sync (`engines/base.py`, `docker_runtime.py`,
   `openhands_docker_adapter.py`).**
   - `base.py`: add `workspace_mode: Literal["greenfield", "brownfield"] = "greenfield"` to
     `AgentTask` (additive + defaulted, exactly like `llm_api_key`). Document it. `agent_run_step`
     sets it from `brownfield`.
   - `docker_runtime.py`: add a brownfield enumeration `enumerate_push_files_git(host_dir) -> list[str]`
     = `git -C host_dir ls-files -c -o --exclude-standard` (tracked + untracked-not-ignored, excludes
     `.git`, honors `.gitignore`). Unit-test it against a temp repo with a tracked dotfile + an
     ignored dir. **Leave the existing `enumerate_push_files` (greenfield) UNTOUCHED.**
   - `openhands_docker_adapter.py`: branch `_push_workspace` + `_pull_workspace` on
     `task.workspace_mode`. Greenfield → today's behavior, byte-identical. Brownfield → push via
     `enumerate_push_files_git`; pull via container-side `find . -type f -not -path './.git/*'` minus
     the scaffolding dirs (dotfiles included). Keep both directions' scaffolding exclusion.

6. **Router (`routers.py`).**
   - `POST /api/repo/inspect` (body `{path: str}`) → 200 with `repo_inspect(path)` (a discriminated
     result, not an exception, so the FE can render inline). Pydantic request/response models.
   - `CreateRunRequest` += `repo_path: str | None = None`, `base_ref: str | None = None`. In
     `create_run`: when `repo_path` is set, validate via `repo_inspect` (refuse 422 with a structured
     message if `is_git` is False or `base_ref` is given but not a known branch); default `base_ref`
     to the repo's `current_branch` when omitted; set `repo_path`/`base_ref` on the `Run` row. When
     `repo_path` is None, the path is **byte-for-byte the existing greenfield create.** (No dirty-tree
     refusal — a worktree cuts from `base_ref`'s commit, independent of the user's working tree.)
   - `_run_to_dict` / the run-status payload: surface `ship_branch` (+ `repo_path` if cheap) so a
     later FE/banner can show the produced branch. Additive.

7. **The live acceptance target — `make brownfield-check` → `scripts/brownfield_check.py`** (model it
   on the existing live targets). It must, end-to-end on a REAL docker+NIM run:
   - Create a throwaway fixture git repo in a temp dir: `calculator.py` with `add(a, b)` + a passing
     `test_calculator.py`; `git init` + commit on a known branch; capture the original HEAD sha.
   - `POST /api/repo/inspect` → assert `is_git`, a `current_branch`, `tracked_file_count >= 2`.
   - `POST /api/runs` with `build_two_node_team` (PM→Engineer→ship — fast, fewer LLM rounds than the
     review loop), `idea="Add a subtract(a, b) function to calculator.py and a unit test for it.",
     repo_path=<fixture>, base_ref=<current_branch>`, on `agent_sandbox_mode=docker` +
     `TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct`. Poll to terminal.
   - **Assert:** (a) branch `tvashtr/<run_id>` exists in the fixture repo; (b) its tip's
     `calculator.py` contains `subtract`; (c) checking out that branch and running the fixture's own
     `pytest` is GREEN (correctness + no regression of `add`); (d) the fixture's ORIGINAL branch HEAD
     is UNCHANGED (user tree untouched); (e) the `Run` row has `repo_path`/`base_ref`/`ship_branch`
     populated. Clean up the temp fixture in a `finally`.
   - (Two_node keeps the gate fast/robust for the hands-off loop; a review_loop brownfield run — the
     Reviewer gating the real diff — is the SAME machinery on this mount as greenfield M1, noted as a
     manual follow-up, NOT this automated gate.)

8. **Last step:** bump `protect-migrations.sh`'s freeze regex `^00(0[1-9]|1[0-4])_` →
   `^00(0[1-9]|1[0-5])_` (now `0015` is created). Confirm the hook still parses.

---

## 4. Do-NOT-touch / invariants (verify, don't assume)

- **Greenfield is byte-for-byte unchanged.** Every brownfield path is an additive branch gated on
  `repo_path`/`workspace_mode`. PROVE it: the full existing backend suite passes; `make skeleton-run`,
  `make loop-run`, `make loop-run-docker`, and `make seeding-smoke` (the greenfield docker push/pull
  proof) all stay green.
- `team_run.py` stays **openhands-free at import** (CLI-RULES §3.1). The worktree/grounding helpers
  must be stdlib/subprocess only.
- The `EngineAdapter` seam: extend `AgentTask` ONLY additively + defaulted (like `llm_api_key`). The
  Control Plane/executor must not learn which adapter is active.
- Do NOT do the deferred cosmetic renames (`pm_step`→`thinker`, `REVIEW_VERDICT.json`→`OUTCOME.json`,
  drop `config.agent_kind`, etc.) — keep the diff focused. A SMALL docstring accuracy note for the new
  workspace branching in `engineer_setup_step` is fine; no renames.
- Do NOT build selective (git-diff) pull, an allow-list on `repo_path`, a nicer branch name than
  `tvashtr/<run_id>`, push/PR, or ANY frontend — all are later/§15. (Register the allow-list +
  selective-pull as §15 notes in `STATE.md` Deviations.)
- New migration `0015` only; never edit `0001`–`0014`; bump the freeze regex LAST.

---

## 5. Acceptance (echo each decisive line into the transcript — CLI-RULES §4.3a)

Run every check yourself and debug to green:
- `make test` — the full backend suite, **≥ the session-start count, never regressing**, incl. the new
  unit tests (migration, `repo_inspect`, `add_worktree` create+resume, `build_repo_grounding`,
  `enumerate_push_files_git`, the `create_run` brownfield validation). Echo the `=== N passed ===` line.
- `make lint` — clean. Echo the result line.
- `make skeleton-run`, `make loop-run`, `make loop-run-docker`, `make seeding-smoke` — all green
  (greenfield byte-intactness on both sandbox modes). Echo each final status.
- `make brownfield-check` — PASSES (the real-repo fixture proof, §3.7). Echo its final PASS line.
- `STATE.md` updated (sha, branch, test count, the §15 deviations) with a final
  `READY_TO_MERGE: branch=feat/<slug>, sha=<sha>, tests=<N> passing`. Echo that line.

(No `make test-frontend` / `build-frontend` needed — **no frontend is touched this slice.**)

---

## 6. Stop conditions (CLI-RULES §5)

- Proceed autonomously on all code-level failures (test/import/migration/docker/timing) — self-heal,
  ≥3 distinct strategies before escalating a single cause.
- `NEEDS_HUMAN` to `STATE.md` + STOP for: a genuinely dead NIM credential (a throttle is NOT this —
  but NIM is the proven path here), a confirmed docker/NIM/service outage, a merge conflict on `main`,
  or **a second/unknown problem requiring a broad or unproven change**. A code-proven, contained,
  regression-guarded fix to a single identified cause may proceed.
- Hard cap: if the `brownfield-check` agent run cannot be made to land a correct change after genuine
  iteration AND the cause is the model/agent (not your plumbing), write `NEEDS_HUMAN` with the
  evidence (the branch state + the failing pytest output) rather than loosening the assertion — the
  architect decides whether to escalate the worker model. Do NOT weaken the check to force green.

---

## 7. Report-back (in the final message + `STATE.md`)

Files changed (with one-line why each), commands run WITH their decisive output (incl. `make test`,
`make lint`, the greenfield smokes, `brownfield-check`), the migration head, any deviation +
rationale, the §15 items registered, open questions, and the `READY_TO_MERGE` line. Branch:
`feat/brownfield-backend-run-mode`.

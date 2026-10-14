# M-hostedfix — a hosted brownfield run dies at workspace setup, before the first agent step

> Architect brief, Tvashtr Sidechat-14, 2026-09-13. Written for the Claude Code `/goal` of the same name.
> Read this in full before you touch anything.

---

## 1. The observation (operator, on the DEPLOYED app, 2026-09-13)

`tvashtr.fly.dev` was redeployed today. The release command ran `alembic upgrade head` and completed,
`make deploy-smoke` passed 7/7 including `db:"ok"`, so the deployed app is current and healthy.

The operator then signed in, created a team **with a GitHub repo attached**, and launched it.
The **PM node** failed with:

```
Command '['git', '-C', '/app/backend/.tvashtr_workspaces/1c4b4033-895f-4900-bc23-d3c43144490d',
'ls-files', '-c', '-o', '--exclude-standard', '-z']' returned non-zero exit status 128.
```

**Run id: `1c4b4033-895f-4900-bc23-d3c43144490d`.**

### A prior failure in the same session that is NOT this bug

An earlier run failed at the Engineer with an OpenRouter `402 in_flight_budget_exhausted`. That was
an account-credit condition on a spent OpenRouter key, not a defect. The key has since been removed
from the prod account. **Do not chase it, do not "fix" failover for it, do not touch the 402
classifier.** It is recorded here only so you do not rediscover it and mistake it for scope.

---

## 2. What the architect established on disk — facts, not inference

Verify any of these yourself if you want; none of them are assumptions.

- **`make_local_workspace`** (`backend/tvashtr/engines/openhands_adapter.py`, ~line 59) creates
  `<root>/backend/.tvashtr_workspaces/<run_id>` with a bare `mkdir(parents=True, exist_ok=True)`.
  It does **not** `git init`, and it does not clone anything.
- `_WORKSPACE_ROOT = Path(__file__).resolve().parents[2] / ".tvashtr_workspaces"` resolves inside
  the deployed image to exactly `/app/backend/.tvashtr_workspaces`, which matches the failing path
  character for character. So the directory in the traceback **is** the greenfield workspace.
- **`backend/tvashtr/engines/openhands_fly_adapter.py`, ~line 451** carries this comment:
  `` `task.workspace_dir` is the HOST dir (created + git-init'd by the setup step) ``.
  The adapter then calls `_push_workspace(handle.workspace, host_dir, task.workspace_mode)` and
  `_pull_workspace(handle.workspace, host_dir, task.workspace_mode, task.pull_paths)`, both
  imported **unchanged** from `openhands_docker_adapter.py`. So the fly and docker sandboxes share
  one host-sync implementation, and that implementation is handed a `workspace_mode`.
- **The failing command string does not appear anywhere in Tvashtr's own source.** Searched:
  `control_plane/worktree.py`, `run_diff.py`, `shipping.py`, `team_run.py`,
  `engines/openhands_adapter.py`, `openhands_docker_adapter.py`, `openhands_fly_adapter.py`.
  Every `ls-files` call in `worktree.py` passes `check=False`, so none of them can raise.
  Treat the call as coming from the OpenHands SDK or something it invokes. **Confirm this yourself
  — find the real call site.** Knowing who runs it decides whether the fix is ours or a guard.
- `git -C <dir> ls-files` exits **128** when the directory is not a git work tree, or does not exist.
- **`make demo-proof` (local leg) runs `TVASHTR_AGENT_SANDBOX=local`**, so it never exercises
  `_push_workspace` / `_pull_workspace` at all. The deployed app runs `TVASHTR_AGENT_SANDBOX=fly`
  (set in `fly.toml [env]`). The prod leg of the harness has never completed a run.
  **This is why a green local gate did not catch it.** That gap is part of what this milestone fixes.

---

## 3. Hypothesis — UNPROVEN. Do not fix from it.

The run was tagged brownfield because a repo was attached, but the node's `workspace_dir` was the
plain `.tvashtr_workspaces/<run_id>` directory instead of a clone or worktree under
`.tvashtr_clones/<run_id>`. A brownfield-mode sync then ran git against a folder that is not a
repository. The node that failed is a **thinker** (PM), and thinkers have historically not been
given a repo worktree — see the worker-gating split in `PROJECTPLAN.md` §17 (Tvashtr-33/34).

That is **one candidate**. Sidechat-13's banked lesson is that an inferred cause written down as
fact propagates through sessions and wastes milestones: the "131,072-token overflow" was never
measured, and two sessions plus an architect brief were built on it.

**So: prove it or refute it.** Establish the root cause from the code and from a real run. If the
evidence contradicts the paragraph above, say so plainly in your report and fix what is actually
broken. You will not be penalised for the architect being wrong; you will be penalised for
inheriting his guess.

---

## 4. What must be true when you are finished

1. The root cause is **named and evidenced**, not asserted.
2. A brownfield run in a **sandboxed** posture (docker or fly, repo attached, hosted mode) gets past
   workspace setup and runs its nodes. The `exit status 128` failure is gone at its cause, not
   swallowed by a `try/except`.
3. A **regression test guards it**, and that test genuinely fails on the pre-fix code.
4. If the real cause turns out to be a node kind (thinker vs worker) or a run mode (greenfield vs
   brownfield) being mismatched to the workspace it is handed, the fix makes the pairing explicit
   rather than papering over the symptom with a "git init it anyway" call. A folder that is not a
   repository is a **symptom**; the wrong folder being chosen is the **defect**.
5. Note in the report whether `make demo-proof`'s local leg should grow a sandboxed variant so this
   class of bug cannot hide again. **Do not build it** in this milestone — register it for the
   architect.

---

## 5. Out of scope — do not touch

- The OpenRouter 402 and anything in the failover / credit classifier path.
- `PROVIDER_CATALOGUE` and `_PROVIDER_DEFAULT_ORDER`, including the registered
  `nvidia_nim/openai/gpt-oss-20b` worker-preset deletion. That is a separate hardening pass.
- The fifth probe gate and `scripts/seat_probe.py`.
- Any new Alembic migration. The set is frozen at 31 files, head `0031`.
- `fly.toml`, deployment configuration, and the concurrency ceilings.
- `PROJECTPLAN.md`, `HANDOVER.md`, and `prompts/*.md`. `STATE.md` is yours.

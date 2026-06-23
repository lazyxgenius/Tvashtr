# Tvashtr — CLI prerequisite: convert the no-push guard from a deny-rule into a PreToolUse(Bash) hook

> **Run mode:** run this in Claude Code with the **normal permission layer** (NOT
> `--dangerously-skip-permissions`). This is the one-time bootstrap that makes bypass mode safe;
> bypass starts with the §14 work that follows. Minimal approvals — it is a 2-file config change +
> verification.

## Objective
Add a `PreToolUse(Bash)` hook that **blocks `git push`, `git push --force`, and `git reset --hard`**
so the "the agent never pushes to main" invariant (CLI-RULES §3) **survives bypass mode**
(`--dangerously-skip-permissions`) — where `.claude/settings.json`'s `permissions.deny` rules are
**inert** (bypass skips the permission *layer*; only `PreToolUse` hooks still fire).

## Context
- **Why:** under bypass, the existing deny rules in `.claude/settings.json` — `Bash(git push *)`,
  `Bash(git push --force*)`, `Bash(git reset --hard*)` — stop being enforced. `PreToolUse` hooks are
  the only guard that survives bypass (already proven by the migration-freeze hook). So the
  no-push / no-destructive-reset guard must also become a hook.
- **Pattern to mirror EXACTLY** — `.claude/hooks/protect-migrations.sh` (the existing
  `PreToolUse(Edit|Write)` guard), verbatim:
  ```bash
  #!/usr/bin/env bash
  # Tvashtr PreToolUse(Edit|Write) guard.
  # Blocks edits to frozen Alembic migrations 0001-0009 (matched by filename, any directory).
  # Invoked as:  bash .claude/hooks/protect-migrations.sh   (no execute bit needed)
  # Uses python3 (guaranteed present in this project) instead of jq.

  INPUT="$(cat)"
  FILE_PATH="$(printf '%s' "$INPUT" | python3 -c 'import sys, json
  try:
      print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
  except Exception:
      print("")' 2>/dev/null)"

  BASENAME="$(basename -- "$FILE_PATH" 2>/dev/null)"

  if [[ "$BASENAME" =~ ^000[1-9]_.*\.py$ ]]; then
    echo "Blocked: '$BASENAME' is a frozen migration (0001-0009). Per CLI-RULES section 3, create a NEW migration instead of editing this one." >&2
    exit 2
  fi

  exit 0
  ```
  It reads the hook payload from **stdin** (JSON), extracts a field via **python3** (no `jq`), prints
  a message to **stderr** + `exit 2` to **block**, `exit 0` to **allow**; it needs **no execute bit**
  (invoked via `bash …`).
- **Current `.claude/settings.json` `hooks.PreToolUse`** has ONE entry (matcher `Edit|Write` →
  `protect-migrations.sh`):
  ```json
  "PreToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-migrations.sh" }
      ]
    }
  ]
  ```
- The new hook differs from the migration hook in **two ways only**: it matches the **`Bash`** tool,
  and it extracts **`tool_input.command`** (not `tool_input.file_path`).
- The repo has **no git remote**, so `git push` would fail regardless — but the point is the **hook**
  blocks it **deterministically** and **under bypass**, independent of remote state.

## Constraints
- **Mirror `protect-migrations.sh`'s shape:** bash; read stdin JSON; **python3** (no `jq`); no execute
  bit; invoked via `bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/protect-no-push.sh`; `exit 2` + stderr
  message to **block**, `exit 0` to **allow**.
- **Match robustly via python (NOT a naive substring).** A naive `grep "git push"` would
  false-positive on a commit message like `git commit -m "add git push docs"`. Parse the command:
  - split the command on shell separators `&&`, `||`, `;`, `|`, and newlines into **segments**;
  - tokenize each segment with `shlex.split` (on a `shlex` exception, fall back to **blocking** that
    segment if it contains both `git` and (`push` or `reset`) — conservative);
  - drop leading `VAR=value` env-assignment tokens, then skip a leading `git` and any git **global**
    options (tokens starting with `-`, plus a `-C <path>` pair) to find the **subcommand**;
  - **block** (`exit 2`) if a segment is a `git` invocation whose subcommand is **`push`**, OR a
    `git` invocation with subcommand **`reset`** that also contains the token **`--hard`**;
  - otherwise allow.
- **KEEP the existing `permissions.deny` rules** (they remain the non-bypass layer). Do **not** remove
  or alter them.
- **Add a SECOND `PreToolUse` entry** (matcher `Bash` → the new hook). Do **not** modify the existing
  `Edit|Write` entry, the `allow` list, the other hook groups, or any other part of `settings.json`.
  `settings.json` must remain **valid JSON**.
- **Block message references CLI-RULES** (like `protect-migrations.sh`): e.g.
  `Blocked: 'git push' / 'git reset --hard' is not permitted. Per CLI-RULES section 3, the agent never pushes — the operator merges (branch-per-step, fast-forward).`
- **Do NOT touch:** any product code, any Alembic migration, the `Makefile`,
  `prompts/CLI-RULES.md` / `CLI-SETUP.md` (those doc updates are the architect's),
  `.claude/settings.local.json`.
- **Git hygiene:** work on a branch `chore/cli-no-push-hook` off `main`. Commit **only**
  `.claude/hooks/protect-no-push.sh` and `.claude/settings.json` (explicit `git add` of exactly those
  two paths — **never** `git add -A` / `git commit -am` over the whole tree). The working tree also
  contains **uncommitted edits to `HANDOVER.md` and `PROJECTPLAN.md`** (the architect's in-flight
  living-doc work) — **do NOT stage or commit them.** Do **not** push, do **not** merge (the operator
  FF-merges).

## Tasks (ordered)
1. Create `.claude/hooks/protect-no-push.sh` implementing the matcher above (mirror
   `protect-migrations.sh`'s structure; python3; stderr + `exit 2` to block; `exit 0` to allow).
2. Add the second `PreToolUse` entry to `.claude/settings.json` (matcher `Bash` →
   `bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/protect-no-push.sh`), leaving everything else
   byte-for-byte.
3. Confirm the JSON parses:
   `python3 -c "import json; json.load(open('.claude/settings.json')); print('settings.json OK')"`.
4. **Unit-test the hook by invoking it directly** (it is NOT loaded into this session — hooks load at
   launch — so simulate the payload on stdin). Run each and record the exit code:
   - block: `printf '%s' '{"tool_input":{"command":"git push origin main"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=2**
   - block: `printf '%s' '{"tool_input":{"command":"git push --force"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=2**
   - block: `printf '%s' '{"tool_input":{"command":"git reset --hard HEAD~1"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=2**
   - block: `printf '%s' '{"tool_input":{"command":"make test && git push"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=2** (chained push caught)
   - block: `printf '%s' '{"tool_input":{"command":"git -C . push"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=2** (global option skipped)
   - allow: `printf '%s' '{"tool_input":{"command":"git commit -m \"add git push docs\""}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=0** (no false-positive on a commit message)
   - allow: `printf '%s' '{"tool_input":{"command":"git status"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=0**
   - allow: `printf '%s' '{"tool_input":{"command":"git reset --soft HEAD~1"}}' | bash .claude/hooks/protect-no-push.sh; echo "exit=$?"` → **exit=0** (only `--hard` is destructive)
5. Commit per the git-hygiene constraint. Report back.

## Acceptance criteria
- `.claude/hooks/protect-no-push.sh` exists and mirrors `protect-migrations.sh`'s structure
  (bash / stdin-JSON / python3 / no-jq / no-exec-bit / stderr + exit2-blocks).
- `.claude/settings.json` is valid JSON and `hooks.PreToolUse` now has **two** entries
  (`Edit|Write` + `Bash`); the `deny` rules + `allow` list + other hook groups are **unchanged**.
- All eight unit-test cases produce the expected exit codes (blocks: push / push --force /
  reset --hard / chained-push / `git -C . push`; allows: commit-msg-mentioning-push / status /
  reset --soft).
- The commit contains **only** the two `.claude` paths; `HANDOVER.md` / `PROJECTPLAN.md` remain
  uncommitted.

## Report-back spec
- Files changed (the new hook + a `git diff` of `.claude/settings.json`).
- Each verification command run **with its exact output** (the JSON-parse check + all eight hook
  unit-test cases with their exit codes).
- The python matcher logic, and a one-line note on why it avoids the commit-message false-positive.
- `git log --oneline -1` + `git status --short` (to confirm only the two `.claude` paths are
  committed and the docs remain unstaged).
- Deviations from this prompt (if any).
- Open questions.
- Suggested next step.

> After this lands and you've confirmed it, **the next Claude Code session can run with
> `--dangerously-skip-permissions`** — the first thing it should do is attempt a dummy `git push` and
> confirm the hook blocks it (the live confirmation the unit tests stand in for). That bypass session
> picks up §14.1.

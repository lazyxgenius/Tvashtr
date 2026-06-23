# Tvashtr — CLI Autonomous Setup

> Companion to `prompts/CLI-RULES.md`. CLI-RULES is the in-session operating contract the
> agent reads; THIS file is the one-time machine setup that makes autonomous runs work
> (permissions + hooks) and the launch/resume sequence. Read once, set up once.

---

## 0. What this configures (and why)

Three layers, because prose instructions to an agent are not enforcement — config is.

| Layer | File | What it guarantees |
|:------|:-----|:-------------------|
| Permissions | `.claude/settings.json` (`permissions`) | Standing approval for the project's command surface (make/uv/npm/docker/git non-push) so the loop runs without per-command prompts; a hard `deny` on `git push` so the agent never pushes (operator merges). |
| Hooks | `.claude/settings.json` (`hooks`) | Deterministic behavior at lifecycle points: re-inject state on resume + after compaction; breadcrumb on rate-limit; block edits to frozen migrations. |
| Guard script | `.claude/hooks/protect-migrations.sh` | The actual migration-freeze check, called by the PreToolUse hook. |

The completion driver (`/goal`) and the per-session rules (`CLI-RULES.md`) sit on top of this.

---

## 1. Prerequisites

- **Claude Code** recent enough for the `StopFailure` event and `SessionStart` resume/compact
  matchers. Check with `claude --version`; if a hook silently doesn't appear under `/hooks`,
  update Claude Code.
- **python3** — already present (this is a Python project). The guard script uses it instead
  of `jq`, so there is no extra dependency to install.
- No `chmod` needed: the hook invokes the script via `bash <path>`, not as an executable.

---

## 2. `.claude/settings.json` (already created)

Permissions + the four hooks, in one valid JSON object:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Bash(make *)",
      "Bash(uv run *)",
      "Bash(uv sync *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(docker compose *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git checkout *)",
      "Bash(git switch *)",
      "Bash(git branch *)",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)",
      "Bash(git stash *)"
    ],
    "deny": [
      "Bash(git push *)",
      "Bash(git push --force*)",
      "Bash(git reset --hard*)"
    ]
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "resume",
        "hooks": [
          { "type": "command", "command": "cat /Users/adimac/Desktop/Tvashtr/STATE.md 2>/dev/null || echo 'No STATE.md yet - read prompts/CLI-RULES.md section 7.'" }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          { "type": "command", "command": "echo 'POST-COMPACTION REMINDER: re-read prompts/CLI-RULES.md section 3 (invariants) and section 7 (milestones). Current STATE.md below:'; cat /Users/adimac/Desktop/Tvashtr/STATE.md 2>/dev/null" }
        ]
      }
    ],
    "StopFailure": [
      {
        "matcher": "rate_limit",
        "hooks": [
          { "type": "command", "command": "echo \"PAUSED_RATE_LIMIT $(date '+%Y-%m-%d %H:%M'): resume with 'claude --continue'\" >> /Users/adimac/Desktop/Tvashtr/STATE.md" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-migrations.sh" }
        ]
      }
    ]
  }
}
```

### What each hook does
- **`SessionStart` / `resume`** — when you relaunch with `claude --continue` or `--resume`,
  this prints `STATE.md` into context so the agent re-orients automatically. Pairs with the
  native goal-restore (the active `/goal` carries over on relaunch).
- **`SessionStart` / `compact`** — when the context window fills and compacts (it will, on a
  long run), this re-injects the invariants reminder + current state. This is the main defense
  against mid-run drift.
- **`StopFailure` / `rate_limit`** — fires when a turn dies on a rate limit. Its output is
  ignored by Claude Code, but it leaves a timestamped `PAUSED_RATE_LIMIT ... resume with
  'claude --continue'` line in `STATE.md` so the handoff is explicit.
- **`PreToolUse` / `Edit|Write`** — runs the guard before any file edit; exit 2 blocks edits
  to `0001`–`0009` migrations and feeds the reason back to the agent. This fires **even under
  `--dangerously-skip-permissions`**, so the freeze holds in any mode.

### Note on scope
This lives in `.claude/settings.json` (committable, reproducible). If you'd rather keep the
standing command-approval off version control, move it to `.claude/settings.local.json`
(Claude Code gitignores that one). `defaultMode: acceptEdits` is honored from project
settings; `auto` would not be (it must live in `~/.claude`), which is one more reason we use
the curated allow-list rather than auto mode.

---

## 3. `.claude/hooks/protect-migrations.sh` (already created)

```bash
#!/usr/bin/env bash
# Blocks edits to frozen Alembic migrations 0001-0009 (matched by filename, any directory).
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

To freeze additional files later (e.g. the `EngineAdapter` interface), add more basename or
path patterns to this script — it's the single chokepoint for the do-not-touch list.

---

## 4. Permission posture — the honest tradeoff

You asked for "run everything without asking." The literal mechanism is the launch flag
`claude --dangerously-skip-permissions` (bypass mode). But bypass disables all safety checks
and is meant for isolated containers/VMs — on this MacBook Air there's no backstop against a
bad command or a prompt-injection from a fetched page. So the recommended launch is **plain
`claude`**, which picks up the curated allow-list above: near-zero prompts for the real
workflow, with `git push` hard-denied and migrations hook-frozen. A genuinely novel command
still pauses — which is exactly the "stop only when a human is actually needed" behavior.

Use `--dangerously-skip-permissions` only if you move the run into a container/devcontainer.
The migration-freeze hook holds either way.

---

## 5. Launch sequence

1. `cd /Users/adimac/Desktop/Tvashtr`
2. `claude`  (plain launch — uses `.claude/settings.json`)
3. `/hooks` — confirm 4 hooks appear (SessionStart x2, StopFailure, PreToolUse).
4. `/permissions` — confirm the allow-list and the `git push` deny.
5. Paste the **initialization prompt** (see below) — the agent reads CLI-RULES + HANDOVER +
   PROJECTPLAN, then returns a 5-line summary.
6. Review the summary. If sane, paste the **`/goal`** (see below).
7. The loop runs. Auto mode within each turn is provided by `acceptEdits` + the allow-list;
   `/goal` drives turn-after-turn until the condition's evidence appears in the transcript or
   the 30-turn cap hits.

### Initialization prompt
```
Read and internalize, in order:
  /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md   (your operating contract)
  /Users/adimac/Desktop/Tvashtr/HANDOVER.md
  /Users/adimac/Desktop/Tvashtr/PROJECTPLAN.md  (sections 6, 15, 16, 17 - rest is background)
Then read the current state of:
  /Users/adimac/Desktop/Tvashtr/backend/tvashtr/config.py
  /Users/adimac/Desktop/Tvashtr/backend/tvashtr/graph_runner.py

This session runs under a curated permission allow-list and hooks (.claude/settings.json) -
you have standing approval for make/uv/npm/docker/git non-push commands, you will NOT push to
main (operator merges), and edits to migrations 0001-0009 are hard-blocked by a hook.

After reading, output a 5-line summary: (1) milestone position, (2) what the GEMINI_API_KEY
presence + its AQ. prefix means for Step 0, (3) your first concrete action, (4) the branch
you'll create, (5) confirmation you understand evidence must be echoed into the chat for the
goal evaluator (CLI-RULES section 4.3a).

Do not implement anything until you've output that summary.
```

### The `/goal` (this session: Step 0 + the M1 capstone)
```
/goal The transcript shows ALL of: (1) `make agent-smoke` completing successfully with a gemini/ model; (2) `make test` reporting >= 148 passed; (3) `make lint` clean; (4) `make loop-feature-docker` having run with the REVIEW_VERDICT.json harvest confirmed in its output; (5) a READY_TO_MERGE line echoed for both feat/p1.5c-provider-routing and feat/p1.5c-capstone-live. Echo each piece of evidence into the chat as you complete it. If blocked on a credential or external login, write NEEDS_HUMAN to STATE.md and stop. Stop after 30 turns regardless and write the blocking reason to STATE.md.
```

---

## 6. Resume story (rate limit / crash / closed terminal)

1. Session pauses (rate limit leaves a `PAUSED_RATE_LIMIT` line in `STATE.md` via the hook).
2. Wait for the limit to reset.
3. `claude --continue`  — restores the active `/goal` (condition carries over; turn count and
   timer reset) AND fires the `SessionStart/resume` hook, which re-injects `STATE.md`.
4. The agent picks up from the "In Progress" section with no re-prompt. The manual word
   **"resume"** is a belt-and-suspenders nudge if you want to force a re-read without
   relaunching.

---

## 7. Per-milestone, not "all at once"

One `/goal` per milestone. The evaluator is a small model reading only the transcript, and
Stop hooks have an 8-consecutive-block breaker, so "until every milestone is complete" is not
a sound single condition. The `/goal` above covers Step 0 + the M1 capstone. When the operator
fast-forward merges the two branches, issue the next `/goal` for the section-14 attributability
instrument, and so on. The arc lives in `CLI-RULES.md` section 7 and `PROJECTPLAN.md` 15/16.

---

## 8. Verification checklist (first launch)

- [ ] `/hooks` shows 4 hooks.
- [ ] `/permissions` shows the allow-list + `git push` deny.
- [ ] Sanity-test the guard from a shell:
      `echo '{"tool_input":{"file_path":"backend/x/0009_foo.py"}}' | bash .claude/hooks/protect-migrations.sh; echo "exit=$?"`
      → prints the Blocked message and `exit=2`. A non-frozen path
      (`.../0011_bar.py` or `config.py`) should print nothing and `exit=0`.
- [ ] The init prompt returns a 5-line summary before any code is written.
- [ ] First branch created is `feat/p1.5c-provider-routing`.

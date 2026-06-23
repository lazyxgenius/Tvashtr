#!/usr/bin/env bash
# Tvashtr PreToolUse(Bash) guard.
# Blocks `git push`, `git push --force`, and `git reset --hard` so the no-push
# invariant (CLI-RULES section 3) survives BYPASS mode (--dangerously-skip-permissions),
# where settings.json permissions.deny rules are inert and only PreToolUse hooks still fire.
# Invoked as:  bash .claude/hooks/protect-no-push.sh   (no execute bit needed)
# Uses python3 (guaranteed present in this project) instead of jq.
#
# Matching is structural, NOT a naive substring: the command is split on shell
# separators into segments, each tokenized with shlex; leading VAR=value env
# assignments and git global options (incl. a -C <path> pair) are skipped to find
# the real subcommand; only a `git push`, or a `git reset` carrying `--hard`, blocks.
# So `git commit -m "add git push docs"` is allowed (push is inside a string token).

INPUT="$(cat)"

DECISION="$(printf '%s' "$INPUT" | python3 -c 'import sys, json, shlex, re


def is_blocked(segment):
    segment = segment.strip()
    if not segment:
        return False
    try:
        tokens = shlex.split(segment)
    except ValueError:
        # Unparseable (e.g. unbalanced quotes): conservatively block anything that
        # smells like a git push/reset rather than let it slip through.
        low = segment.lower()
        return ("git" in low) and (("push" in low) or ("reset" in low))
    if not tokens:
        return False
    # Drop leading VAR=value env-assignment tokens.
    i = 0
    while (
        i < len(tokens)
        and ("=" in tokens[i])
        and not tokens[i].startswith("-")
        and tokens[i].split("=", 1)[0].isidentifier()
    ):
        i += 1
    if i >= len(tokens) or tokens[i] != "git":
        return False
    i += 1  # skip the leading "git"
    # Skip git GLOBAL options (tokens starting with "-") to reach the real subcommand.
    # The options below take their value as a SEPARATE token that does NOT start with "-"
    # (e.g. `-c http.sslVerify=false`, `--git-dir /tmp`); we must consume that value too,
    # else it is mistaken for the subcommand and `git --git-dir /x push` / `git -c k=v
    # reset --hard` slip past the guard (real, git-accepted bypasses). The glued `--opt=value`
    # forms are a single token and need no special handling. We ENUMERATE (rather than "any
    # long option consumes the next token") because no-value globals like `--no-pager`,
    # `--bare`, `--paginate` are followed directly by the subcommand -- consuming it there
    # would WRONGLY let `git --no-pager push` through.
    value_opts = (
        "-C", "-c", "--git-dir", "--work-tree", "--namespace",
        "--config-env", "--super-prefix", "--attr-source", "--shallow-file",
    )
    while i < len(tokens) and tokens[i].startswith("-"):
        if tokens[i] in value_opts:
            i += 2  # bare value-taking option: skip the option AND its value token
        else:
            i += 1  # flag / no-value option / glued --opt=value
    if i >= len(tokens):
        return False
    subcommand = tokens[i]
    rest = tokens[i + 1:]
    if subcommand == "push":
        return True
    if subcommand == "reset" and "--hard" in rest:
        return True
    return False


try:
    command = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    command = ""

segments = re.split(r"&&|\|\||;|\||\n", command)
print("BLOCK" if any(is_blocked(s) for s in segments) else "ALLOW")
' 2>/dev/null)"

if [[ "$DECISION" == "BLOCK" ]]; then
  echo "Blocked: 'git push' / 'git reset --hard' is not permitted. Per CLI-RULES section 3, the agent never pushes — the operator merges (branch-per-step, fast-forward)." >&2
  exit 2
fi

exit 0

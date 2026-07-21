#!/usr/bin/env bash
# Tvashtr PreToolUse(Edit|Write) guard.
# Blocks edits to frozen Alembic migrations 0001-0031 (matched by filename, any directory).
# Invoked as:  bash .claude/hooks/protect-migrations.sh   (no execute bit needed)
# Uses python3 (guaranteed present in this project) instead of jq.

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | python3 -c 'import sys, json
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
except Exception:
    print("")' 2>/dev/null)"

BASENAME="$(basename -- "$FILE_PATH" 2>/dev/null)"

if [[ "$BASENAME" =~ ^00(0[1-9]|1[0-9]|2[0-9]|3[01])_.*\.py$ ]]; then
  echo "Blocked: '$BASENAME' is a frozen migration (0001-0031). Per CLI-RULES section 3, create a NEW migration instead of editing this one." >&2
  exit 2
fi

exit 0

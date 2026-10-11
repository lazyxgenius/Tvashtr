# Shared by video/stack/{up,down,reset}. The filming stack: the Postgres in .env's DATABASE_URL,
# database tvashtr_film, the backend on :8000 and Vite on :5173 — this checkout's, never another's.
# .env is never opened, copied or printed here: the backend reads it itself (pydantic settings and
# the Makefile's `include .env`), and DATABASE_URL is overridden per command.
set -euo pipefail
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
FILM_DB=tvashtr_film
LOGS="$ROOT/video/out/stack"
mkdir -p "$LOGS"
# The filming account (F1): the app shows its name from the email.
export TVASHTR_SEED_EMAIL="${TVASHTR_SEED_EMAIL:-lazyx@tvashtr.local}"

say() { echo "[stack] $*"; }

# .env's DATABASE_URL with the database swapped for tvashtr_film (never echoed).
film_url() {
  (cd "$ROOT/backend" && uv run --quiet python -c '
from urllib.parse import urlsplit, urlunsplit
from tvashtr.config import get_settings
u = urlsplit(get_settings().database_url)
print(urlunsplit(u._replace(path="/'"$FILM_DB"'")))')
}

# create | drop | exists — only ever the tvashtr_film database.
film_db() {
  (cd "$ROOT/backend" && FILM_URL="$FILM_URL" uv run --quiet python - "$1" <<'PY'
import os, sys
from urllib.parse import urlsplit, urlunsplit
import psycopg
u = urlsplit(os.environ["FILM_URL"])
assert u.path == "/tvashtr_film", "refusing: not the filming database"
with psycopg.connect(urlunsplit(u._replace(path="/postgres")), autocommit=True) as c:
    exists = c.execute("select 1 from pg_database where datname = 'tvashtr_film'").fetchone()
    op = sys.argv[1]
    if op == "create" and not exists:
        c.execute("create database tvashtr_film")
        print("created")
    elif op == "drop" and exists:
        c.execute("drop database tvashtr_film with (force)")
        print("dropped")
    else:
        print("exists" if exists else "absent")
PY
  )
}

# The PIDs listening on a port, and their working directories.
listeners() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }
cwd_of() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1; }

kill_tree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null || true); do kill_tree "$c"; done
  kill "$1" 2>/dev/null || true
}

wait_http() { # url what seconds
  local i
  for ((i = 0; i < $3; i++)); do
    curl -fsS -o /dev/null "$1" 2>/dev/null && { say "$2 up"; return 0; }
    sleep 1
  done
  say "$2 did not come up in $3 s (see $LOGS)"
  return 1
}

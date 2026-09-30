#!/usr/bin/env bash
#
# Connectors E2E (plan §10 T.1). NO model and NO provider key: a fake OAuth MCP server stands in
# for a provider (backend/tests/fake_connector_server.py).
#
#   1. frontend/e2e/connectors.spec.ts, in a real browser: a fresh account → Toolkit → Connectors
#      lands on Browse → Custom connector → the fake server → Allow in its window → Tvashtr's own
#      confirm page → Connected, read only → its page shows create_thing "Off · write" → Give an
#      agent access → that agent's drawer shows it ticked → Disconnect names the agent.
#   2. scripts/connectors_proxy_probe.py: a run token against the mounted /mcp/connectors of the
#      running backend (only reads listed, a write blocked, both recorded, nothing after DELETE).
#
# Isolated from a dev session: backend :8043, Vite :5243, the fake server :9911, and its own
# database (created and migrated here). Three settings are not optional:
#   * TVASHTR_HOSTED_MODE=false: the repo .env may say true, and connector_net (rightly) ignores
#     TVASHTR_CONNECTORS_ALLOW_LOCAL in hosted mode, so the fake's http://127.0.0.1 address would
#     be refused. The posture is asserted before anything is started.
#   * TVASHTR_PUBLIC_BASE_URL=http://localhost:<backend port>: where the fake sends the browser
#     back, and the proxy address an agent is given.
#   * The app is opened on 127.0.0.1, so that callback (on localhost) carries no session cookie and
#     the confirm page is what the spec sees, as in Desktop's system browser.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8043}"
VITE_PORT="${VITE_PORT:-5243}"
FAKE_PORT="${FAKE_PORT:-9911}"
BASE="http://127.0.0.1:${PORT}"
FAKE="http://127.0.0.1:${FAKE_PORT}"
BACKEND_LOG="/tmp/tvashtr_connectors_backend.log"
VITE_LOG="/tmp/tvashtr_connectors_vite.log"
FAKE_LOG="/tmp/tvashtr_connectors_fake.log"
# The specs to run, relative to frontend/. Any spec that needs no model can be named instead, to
# run it on this isolated stack: a worktree must not migrate the database .env names.
SPECS=("$@")
[[ ${#SPECS[@]} -eq 0 ]] && SPECS=(e2e/connectors.spec.ts)

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# After .env, so these win over it.
export DATABASE_URL="${TVASHTR_CONNECTORS_E2E_DATABASE_URL:-postgresql://tvashtr:tvashtr@localhost:5433/tvashtr_conn_e2e}"
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_HOSTED_MODE=false
export TVASHTR_CONNECTORS_ALLOW_LOCAL=1
export TVASHTR_PUBLIC_BASE_URL="http://localhost:${PORT}"
export TVASHTR_API_PROXY_TARGET="$BASE"
export TVASHTR_CONNECTORS_FAKE_URL="$FAKE"
# Full-page screenshots of the key screens, when a directory is named.
export TVASHTR_CONNECTORS_SHOTS_DIR="${TVASHTR_CONNECTORS_SHOTS_DIR:-}"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }

# wait_for <name> <pid> <url> <log>: the process is up once the address answers.
wait_for() {
  for _ in $(seq 1 120); do
    if ! kill -0 "$2" 2>/dev/null; then
      echo "ERROR: $1 exited early. Log tail:" >&2; tail -n 25 "$4" >&2; exit 1
    fi
    if curl -sf "$3" >/dev/null 2>&1; then echo "$1 up (pid $2)"; return; fi
    sleep 0.5
  done
  echo "ERROR: $1 never answered at $3. Log tail:" >&2; tail -n 25 "$4" >&2; exit 1
}

hr
echo "STEP A: Postgres, the e2e database, migrations"
hr
docker compose up -d 2>/dev/null || echo "(postgres already running: reusing it)"
(
  cd "$BACKEND"
  uv run python - <<'PY'
import os

import sqlalchemy as sa

from tvashtr.db import sqlalchemy_url

url = sa.make_url(sqlalchemy_url())
admin = sa.create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
with admin.connect() as conn:
    if not conn.scalar(sa.text("select 1 from pg_database where datname = :n"), {"n": url.database}):
        conn.execute(sa.text(f'CREATE DATABASE "{url.database}"'))
        print(f"created database {url.database}")
print(f"database: {url.database} on {url.host}:{url.port}")
PY
  uv run alembic upgrade head
  echo "migrations at $(uv run alembic current 2>/dev/null | tail -n 1)"
)

hr
echo "STEP B: the posture the fake server needs"
hr
(
  cd "$BACKEND"
  uv run python - <<PY
from tvashtr.config import get_settings
from tvashtr.control_plane import connector_net

s = get_settings()
assert not s.hosted_mode, "TVASHTR_HOSTED_MODE must be false (allow-local is ignored in hosted mode)"
connector_net.check_url("${FAKE}/mcp")  # raises UnsafeUrl when the address would be refused
print("hosted_mode=false, ${FAKE}/mcp is allowed, public base", s.public_base_url)
PY
)

hr
echo "STEP C: the fake connector server on :${FAKE_PORT}"
hr
"$VENV_PY" "$BACKEND/tests/fake_connector_server.py" --port "$FAKE_PORT" >"$FAKE_LOG" 2>&1 &
PIDS+=($!)
wait_for "fake server" "$!" "$FAKE/.well-known/oauth-authorization-server" "$FAKE_LOG"

hr
echo "STEP D: the backend (LOCAL sandbox) on :${PORT}"
hr
( cd "$BACKEND" && exec "$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" \
  --log-level warning ) >"$BACKEND_LOG" 2>&1 &
PIDS+=($!)
wait_for "backend" "$!" "$BASE/health" "$BACKEND_LOG"

hr
echo "STEP E: the Vite dev server on :${VITE_PORT} (proxy -> :${PORT})"
hr
( cd "$FRONTEND" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$VITE_PORT" --strictPort ) >"$VITE_LOG" 2>&1 &
PIDS+=($!)
wait_for "vite" "$!" "http://127.0.0.1:${VITE_PORT}/" "$VITE_LOG"

hr
echo "STEP F: the Playwright chromium browser (idempotent)"
hr
( cd "$FRONTEND" && npx playwright install chromium )

hr
echo "STEP G: the browser spec (${SPECS[*]})"
hr
set +e
( cd "$FRONTEND" && TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" \
  npx playwright test "${SPECS[@]}" )
PW_EXIT=$?
set -e

hr
echo "STEP H: the proxy probe (scripts/connectors_proxy_probe.py)"
hr
set +e
( cd "$BACKEND" && uv run python ../scripts/connectors_proxy_probe.py \
  --backend "http://localhost:${PORT}" --fake "$FAKE" )
PROBE_EXIT=$?
set -e

hr
[[ "$PW_EXIT" == "0" ]] && echo "BROWSER SPEC PASSED" || echo "BROWSER SPEC FAILED (exit $PW_EXIT)"
[[ "$PROBE_EXIT" == "0" ]] && echo "PROXY PROBE PASSED" || echo "PROXY PROBE FAILED (exit $PROBE_EXIT)"
if [[ -n "$TVASHTR_CONNECTORS_SHOTS_DIR" ]]; then
  echo "screenshots:"
  ls -la "$TVASHTR_CONNECTORS_SHOTS_DIR"/*.png 2>/dev/null || echo "  (none in $TVASHTR_CONNECTORS_SHOTS_DIR)"
fi
if [[ "$PW_EXIT" != "0" || "$PROBE_EXIT" != "0" ]]; then
  echo "backend log tail ($BACKEND_LOG):"; tail -n 30 "$BACKEND_LOG" || true
  hr
  exit 1
fi
echo "CONNECTORS E2E PASSED"
hr

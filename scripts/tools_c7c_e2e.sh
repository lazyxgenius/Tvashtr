#!/usr/bin/env bash
#
# M-tools C7.C frontend self-sign-off harness (NO NIM / NO agent run). Starts Postgres + migrates +
# a LOCAL-sandbox backend + the Vite dev server, then runs the headless Playwright spec that drives
# the real app and screenshots: (a) the account Tool + Skill library shelves, (b) the Tools section
# "Add from library" -> a Library-badged row, (c) the same in the Skills section, (d) the "overridden"
# tag when an inline server shares a name with a library ref. Orchestration mirrors scripts/auth_e2e.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_c7c_backend.log"
VITE_LOG="/tmp/tvashtr_c7c_vite.log"
SHOTS_DIR="${TVASHTR_C7C_SHOTS_DIR:-/tmp/tvashtr_c7c_shots}"

cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_C7C_SHOTS_DIR="$SHOTS_DIR"

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

BACKEND_PID=""
VITE_PID=""
cleanup() {
  [[ -n "$VITE_PID" ]] && kill -9 "$VITE_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill -9 "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "STEP A: Postgres + migrate to head"
docker compose up -d
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    echo "postgres ready"; break
  fi
  sleep 1
done
( cd "$BACKEND" && uv run alembic upgrade head )

echo "STEP B: start the backend (LOCAL sandbox)"
mkdir -p "$SHOTS_DIR"
"$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" \
  --log-level warning >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
for _ in $(seq 1 60); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "ERROR: backend exited early. Log tail:" >&2; tail -n 25 "$BACKEND_LOG" >&2; exit 1
  fi
  if curl -sf "$BASE/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -sf "$BASE/health" >/dev/null || { echo "ERROR: backend not healthy" >&2; exit 1; }
echo "backend up (pid $BACKEND_PID)"

echo "STEP C: start the Vite dev server"
( cd "$FRONTEND" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$VITE_PORT" --strictPort ) >"$VITE_LOG" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "ERROR: vite exited early. Log tail:" >&2; tail -n 25 "$VITE_LOG" >&2; exit 1
  fi
  if curl -sf "http://127.0.0.1:${VITE_PORT}/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -sf "http://127.0.0.1:${VITE_PORT}/" >/dev/null || { echo "ERROR: vite not serving" >&2; exit 1; }
echo "vite up (pid $VITE_PID) on :${VITE_PORT}"

echo "STEP D: install the Playwright chromium browser (idempotent)"
( cd "$FRONTEND" && npx playwright install chromium )

echo "STEP E: run the C7.C Playwright spec"
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/tools-c7c.spec.ts
PW_EXIT=$?
set -e

if [[ "$PW_EXIT" == "0" ]]; then
  echo "C7C E2E PASSED — screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "C7C E2E FAILED (exit $PW_EXIT)"
fi
exit "$PW_EXIT"

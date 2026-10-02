#!/usr/bin/env bash
#
# M6 My agents E2E (brief §4 M6, ruling R4): an agent saved from its panel (More › Save as my agent),
# used in another team from Instructions › Templates › My agents at once with Undo, Detach, saved
# again as v2 and the other team brought up from Toolkit › My agents › Update; Home's composer shows
# Recent tasks as you type and picking one fills the task and its team. Needs one provider key
# (TVASHTR_E2E_PROVIDER, default openai) for the launch that makes a recent task; LOCAL sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8016}"
VITE_PORT="${VITE_PORT:-5189}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_my_agents_backend.log"
VITE_LOG="/tmp/tvashtr_my_agents_vite.log"
SHOTS_DIR="${TVASHTR_MY_AGENTS_SHOTS_DIR:-/tmp/tvashtr_my_agents_shots}"
export TVASHTR_MY_AGENTS_SHOTS_DIR="$SHOTS_DIR"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# The run is stopped as soon as it starts; LOCAL sandbox, self-hosted posture.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_HOSTED_MODE=false

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

BACKEND_PID=""
VITE_PID=""
cleanup() {
  [[ -n "$VITE_PID" ]] && kill -9 "$VITE_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill -9 "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }

hr
echo "STEP A/B: start Postgres + run migrations"
hr
docker compose up -d
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    echo "postgres ready"; break
  fi
  sleep 1
done
( cd "$BACKEND" && uv run alembic upgrade head )

hr
echo "STEP C: start the backend (LOCAL sandbox)"
hr
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

hr
echo "STEP D: start the Vite dev server on :${VITE_PORT} (proxying /api → :${PORT})"
hr
( cd "$FRONTEND" && TVASHTR_API_PROXY_TARGET="http://127.0.0.1:${PORT}" \
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$VITE_PORT" --strictPort ) >"$VITE_LOG" 2>&1 &
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

hr
echo "STEP E: install the Playwright chromium browser (idempotent)"
hr
( cd "$FRONTEND" && npx playwright install chromium )

hr
echo "STEP F: run the my-agents Playwright spec"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/my-agents.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "MY-AGENTS E2E PASSED (save → use with Undo → Detach → v2 → Update; Recent tasks fill the task and its team)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "MY-AGENTS E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

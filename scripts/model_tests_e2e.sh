#!/usr/bin/env bash
#
# Models 1 E2E (brief prompts/models-1.md): frontend/e2e/model-tests.spec.ts on a real stack with real
# model calls: A = TVASHTR_E2E_MODEL_A (default vertex_ai/gemini-3-flash-preview, Google Cloud, whose
# credits pay), B = TVASHTR_E2E_MODEL_B (default deepseek/deepseek-chat). Keys come from .env, which
# is sourced and never echoed. Skips cleanly when either key is absent.
#
# Orchestration mirrors scripts/agent_tests_e2e.sh on its own ports (backend :8024, Vite :5197) and
# its own database, so a live gate never migrates or fills the dev one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8024}"
VITE_PORT="${VITE_PORT:-5197}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_model_tests_backend.log"
VITE_LOG="/tmp/tvashtr_model_tests_vite.log"
SHOTS_DIR="${TVASHTR_MODEL_TESTS_SHOTS_DIR:-/tmp/tvashtr_model_tests_shots}"
export TVASHTR_MODEL_TESTS_SHOTS_DIR="$SHOTS_DIR"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${GOOGLE_CLOUD_API_KEY:-}" || -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "[model-tests-e2e] GOOGLE_CLOUD_API_KEY or DEEPSEEK_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi

export TVASHTR_HOSTED_MODE=false
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_E2E_MODEL_A="${TVASHTR_E2E_MODEL_A:-vertex_ai/gemini-3-flash-preview}"
export TVASHTR_E2E_MODEL_B="${TVASHTR_E2E_MODEL_B:-deepseek/deepseek-chat}"

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="tvashtr_model_tests_e2e"
export DATABASE_URL="${DATABASE_URL%/*}/${PG_DB}"

BACKEND_PID=""
VITE_PID=""
cleanup() {
  [[ -n "$VITE_PID" ]] && kill -9 "$VITE_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill -9 "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }

hr
echo "STEP A/B: start Postgres + a fresh ${PG_DB} + run migrations"
hr
docker compose up -d
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    echo "postgres ready"; break
  fi
  sleep 1
done
docker compose exec -T postgres psql -q -U "$PG_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${PG_DB} WITH (FORCE)" -c "CREATE DATABASE ${PG_DB}"
docker compose exec -T postgres psql -q -U "$PG_USER" -d "$PG_DB" \
  -c "CREATE EXTENSION IF NOT EXISTS vector"
( cd "$BACKEND" && uv run alembic upgrade head )

hr
echo "STEP C: start the backend on :${PORT}"
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
echo "STEP F: run the model-tests Playwright spec (A=${TVASHTR_E2E_MODEL_A} B=${TVASHTR_E2E_MODEL_B})"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/model-tests.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "MODEL-TESTS E2E PASSED"
  echo "screenshots:"
  ls "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "MODEL-TESTS E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

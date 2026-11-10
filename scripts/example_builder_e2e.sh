#!/usr/bin/env bash
#
# M2 E2E (brief prompts/m2-examples.md): frontend/e2e/example-builder.spec.ts on a real stack with
# real agent runs in the local docker sandbox, every seat on TVASHTR_E2E_MODEL (default
# vertex_ai/gemini-3-flash-preview, Google Cloud, whose credits pay). The Domain's files are read with
# the OpenAI embedding key. Keys come from .env, which is sourced and never echoed. Skips cleanly
# without GOOGLE_CLOUD_API_KEY; stops with a line naming the missing embedding key.
#
# Orchestration mirrors scripts/model_tests_e2e.sh on its own ports (backend :8026, Vite :5199) and
# its own database, so a live gate never migrates or fills the dev one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8026}"
VITE_PORT="${VITE_PORT:-5199}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_example_builder_backend.log"
VITE_LOG="/tmp/tvashtr_example_builder_vite.log"
SHOTS_DIR="${TVASHTR_EXAMPLE_BUILDER_SHOTS_DIR:-/tmp/tvashtr_example_builder_shots}"
export TVASHTR_EXAMPLE_BUILDER_SHOTS_DIR="$SHOTS_DIR"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${GOOGLE_CLOUD_API_KEY:-}" ]]; then
  echo "[example-builder-e2e] GOOGLE_CLOUD_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "[example-builder-e2e] NEEDS_HUMAN: OPENAI_API_KEY (the Domain's reading key, openai/text-embedding-3-small) is missing."
  exit 1
fi

export TVASHTR_HOSTED_MODE=false
export TVASHTR_AGENT_SANDBOX="${TVASHTR_AGENT_SANDBOX:-docker}"
export TVASHTR_PUBLIC_BASE_URL="http://127.0.0.1:${PORT}"
export TVASHTR_E2E_MODEL="${TVASHTR_E2E_MODEL:-vertex_ai/gemini-3-flash-preview}"
export TVASHTR_E2E_FIXTURES="$BACKEND/tests/fixtures/claims_handbook"

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="tvashtr_example_builder_e2e"
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
  --log-level info >"$BACKEND_LOG" 2>&1 &
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
echo "STEP F: run the example-builder Playwright spec (every seat on ${TVASHTR_E2E_MODEL}, sandbox ${TVASHTR_AGENT_SANDBOX})"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/example-builder.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "EXAMPLE-BUILDER E2E PASSED"
  echo "screenshots:"
  ls "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "EXAMPLE-BUILDER E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

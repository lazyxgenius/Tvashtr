#!/usr/bin/env bash
#
# Live FE E2E for M-changes (the run-view "Changes" tab). Registers a fresh account, seeds its
# deepseek key, creates a review_loop team from the template, and drives a REAL run to completion in
# the LOCAL sandbox on deepseek/deepseek-chat with a FORCED reviewer-approve
# (TVASHTR_FORCE_REVISIONS=0 -> the reviewer short-circuits to "approved", makes NO LLM call; only the
# PM + Engineer call deepseek; NO docker agent containers). Then it opens the run view, clicks
# "Changes", and asserts the run's produced file(s) render with a per-file, expandable diff —
# screenshotting each check.
#
# Orchestration mirrors scripts/edits_toggle_e2e.sh (Postgres + migrate + backend + Vite + headless
# Playwright) on PARALLEL-SAFE ports (backend :8002, Vite :5175 -> proxy :8002). Needs
# DEEPSEEK_API_KEY (in .env); skips cleanly otherwise (not a failure).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8002}"
VITE_PORT="${VITE_PORT:-5175}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_run_diff_backend.log"
VITE_LOG="/tmp/tvashtr_run_diff_vite.log"
export TVASHTR_RUN_DIFF_SHOTS_DIR="${TVASHTR_RUN_DIFF_SHOTS_DIR:-/tmp/tvashtr_run_diff_shots}"

cd "$ROOT"

# Load .env so the backend + the Playwright child inherit DATABASE_URL + TVASHTR_AGENT_MODEL +
# DEFAULT_MODEL + DEEPSEEK_API_KEY. (set -a exports every sourced var to child processes.)
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Hands-off + deterministic: LOCAL sandbox (NO docker agent containers), auto-approve every gate, and
# a FORCED reviewer-APPROVE (0 = reviewer short-circuits to approved on round 1, makes no LLM call).
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1
export TVASHTR_FORCE_REVISIONS=0
# The review_loop Engineer + Reviewer models come from TVASHTR_AGENT_MODEL; the PM from DEFAULT_MODEL.
# .env already pins both to deepseek/deepseek-chat; assert the agent slug so the run is deepseek.
export TVASHTR_AGENT_MODEL="${TVASHTR_AGENT_MODEL:-deepseek/deepseek-chat}"

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "[run-diff-e2e] DEEPSEEK_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi

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
echo "STEP A/B: ensure Postgres is up + run migrations"
hr
# Shared, FIXED-name container (tvashtr-postgres): only `up` if not already reachable (parallel-safe).
PG_CONTAINER="${PG_CONTAINER:-tvashtr-postgres}"
if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
  echo "postgres already up (container $PG_CONTAINER)"
else
  docker compose up -d
  for _ in $(seq 1 30); do
    if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
      echo "postgres ready"; break
    fi
    sleep 1
  done
fi
( cd "$BACKEND" && uv run alembic upgrade head )

hr
echo "STEP C: start the backend on :${PORT} (LOCAL sandbox, auto-approve, forced reviewer-approve, deepseek)"
hr
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
echo "backend up (pid $BACKEND_PID) on :${PORT}, agent model = ${TVASHTR_AGENT_MODEL}"

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
echo "STEP F: run the M-changes run-diff Playwright spec"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/run-diff.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "RUN-DIFF E2E PASSED (real run shipped on deepseek; the Changes tab renders the produced file(s) + per-file diff)"
  echo "screenshots: $TVASHTR_RUN_DIFF_SHOTS_DIR"
  ls -la "$TVASHTR_RUN_DIFF_SHOTS_DIR"/*.png 2>/dev/null || true
else
  echo "RUN-DIFF E2E FAILED at the Playwright proof (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

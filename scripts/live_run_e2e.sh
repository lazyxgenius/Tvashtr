#!/usr/bin/env bash
#
# M2 live run view E2E (brief §4 M2): a fresh account, a review_loop team from the template and a
# REAL run to completion in the LOCAL sandbox with a FORCED reviewer-approve (TVASHTR_FORCE_REVISIONS=0
# -> the reviewer makes no LLM call; only the PM + Engineer call the model; no docker containers),
# then frontend/e2e/live-run.spec.ts checks the run view: the Now bar, the Activity feed growing, the
# filter by agent and the Done summary.
#
# The provider is chosen here (a provider outage must not block the proof): TVASHTR_E2E_PROVIDER
# (default openai) + TVASHTR_E2E_MODEL (default openai/gpt-4.1-mini); its key comes from .env.
# Orchestration mirrors scripts/run_diff_e2e.sh on its own ports (backend :8012, Vite :5185).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8012}"
VITE_PORT="${VITE_PORT:-5185}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_live_run_backend.log"
VITE_LOG="/tmp/tvashtr_live_run_vite.log"
export TVASHTR_LIVE_RUN_SHOTS_DIR="${TVASHTR_LIVE_RUN_SHOTS_DIR:-/tmp/tvashtr_live_run_shots}"

cd "$ROOT"

# Load .env so the backend + the Playwright child inherit DATABASE_URL + TVASHTR_AGENT_MODEL +
# DEFAULT_MODEL + the provider keys. (set -a exports every sourced var to child processes.)
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
# The model is this launcher's (TVASHTR_E2E_MODEL), whatever .env pins.
export TVASHTR_E2E_PROVIDER="${TVASHTR_E2E_PROVIDER:-openai}"
export TVASHTR_AGENT_MODEL="${TVASHTR_E2E_MODEL:-openai/gpt-4.1-mini}"
export DEFAULT_MODEL="${TVASHTR_E2E_MODEL:-openai/gpt-4.1-mini}"

case "$TVASHTR_E2E_PROVIDER" in
  openai) KEY_VAR=OPENAI_API_KEY ;; deepseek) KEY_VAR=DEEPSEEK_API_KEY ;; nvidia_nim) KEY_VAR=NVIDIA_BUILD_API_KEY ;;
  *) KEY_VAR=UNKNOWN ;;
esac
if [[ -z "${!KEY_VAR:-}" ]]; then
  echo "[live-run-e2e] ${KEY_VAR} not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend on :${PORT} (LOCAL sandbox, auto-approve, forced reviewer-approve, ${TVASHTR_AGENT_MODEL})"
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
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/live-run.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "LIVE-RUN E2E PASSED (real run on ${TVASHTR_AGENT_MODEL}: Now bar, growing Activity, filter, Done summary)"
  echo "screenshots: $TVASHTR_LIVE_RUN_SHOTS_DIR"
  ls -la "$TVASHTR_LIVE_RUN_SHOTS_DIR"/*.png 2>/dev/null || true
else
  echo "LIVE-RUN E2E FAILED at the Playwright proof (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

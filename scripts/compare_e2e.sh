#!/usr/bin/env bash
#
# M8 Compare E2E (brief §4 M8, ruling R5): a fresh account, a review_loop team from the template saved
# as two versions (v2 changes the Reviewer's instructions), then frontend/e2e/compare.spec.ts opens
# Compare from the canvas header, runs v1 vs v2 on one task in the LOCAL sandbox (reviewer round 1
# forced "Approved": TVASHTR_FORCE_REVISIONS=0), watches both lanes and reads the results. No global
# auto-approve: the compare approves its own gates; nothing ships (no PR) for either side.
#
# Provider: TVASHTR_E2E_PROVIDER (default openai) + TVASHTR_E2E_MODEL (default openai/gpt-4.1-mini).
# Own ports (backend :8019, Vite :5192).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8019}"
VITE_PORT="${VITE_PORT:-5192}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_compare_backend.log"
VITE_LOG="/tmp/tvashtr_compare_vite.log"
export TVASHTR_COMPARE_SHOTS_DIR="${TVASHTR_COMPARE_SHOTS_DIR:-/tmp/tvashtr_compare_shots}"

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
unset TVASHTR_AUTO_APPROVE_GATES  # M8: a compare approves its own gates (R5)
export TVASHTR_FORCE_REVISIONS=0
# The first run's Engineer round 1 fails at once (no LLM call); the resumed run is never forced.
unset TVASHTR_FORCE_FAIL_ROLE TVASHTR_FORCE_FAIL_ROUND TVASHTR_FORCE_HANG_ROLE
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
  echo "[compare-e2e] ${KEY_VAR} not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend on :${PORT} (LOCAL sandbox, auto-approve, forced Engineer round-1 failure, forced reviewer-approve, ${TVASHTR_AGENT_MODEL})"
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
echo "STEP F: run the M8 compare Playwright spec"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/compare.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "COMPARE E2E PASSED (two versions → Compare → both lanes → results; no PR, gates approved by the compare)"
  echo "screenshots: $TVASHTR_COMPARE_SHOTS_DIR"
  ls -la "$TVASHTR_COMPARE_SHOTS_DIR"/*.png 2>/dev/null || true
else
  echo "COMPARE E2E FAILED at the Playwright proof (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

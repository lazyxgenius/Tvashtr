#!/usr/bin/env bash
#
# M7 Agent tests E2E (brief §4 M7, rulings R6 R7 R12): a fresh account, a review_loop team from the
# template and a REAL run in the LOCAL sandbox (gates auto-approved, the Reviewer's round 1 forced
# "Approved" with no LLM call: TVASHTR_FORCE_REVISIONS=0), then frontend/e2e/agent-tests.spec.ts
# makes a test from the Reviewer's round (team drawer › Runs › round ⋯ › Make this a test: the
# prefilled check removed, Must not say "banana-split-xyz" added), a second one through the API
# (Must say "banana-split-xyz"), clicks Run all 2 and sees one Passed and one Failed with
# "Must say: banana-split-xyz · not met". Replays are real model calls (forced verdicts never apply
# to them).
#
# The provider is chosen here: TVASHTR_E2E_PROVIDER (default openai) + TVASHTR_E2E_MODEL (default
# openai/gpt-4.1-mini); its key comes from .env. Orchestration mirrors scripts/my_agents_e2e.sh on
# its own ports (backend :8017, Vite :5190).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8017}"
VITE_PORT="${VITE_PORT:-5190}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_agent_tests_backend.log"
VITE_LOG="/tmp/tvashtr_agent_tests_vite.log"
SHOTS_DIR="${TVASHTR_AGENT_TESTS_SHOTS_DIR:-/tmp/tvashtr_agent_tests_shots}"
export TVASHTR_AGENT_TESTS_SHOTS_DIR="$SHOTS_DIR"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Hands-off + deterministic run: LOCAL sandbox, every gate approved, the Reviewer's round 1 forced
# "Approved" (no LLM call), self-hosted posture. No forced failures.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_HOSTED_MODE=false
export TVASHTR_AUTO_APPROVE_GATES=1
export TVASHTR_FORCE_REVISIONS=0
unset TVASHTR_FORCE_FAIL_ROLE TVASHTR_FORCE_FAIL_ROUND
export TVASHTR_E2E_PROVIDER="${TVASHTR_E2E_PROVIDER:-openai}"
export TVASHTR_AGENT_MODEL="${TVASHTR_E2E_MODEL:-openai/gpt-4.1-mini}"
export DEFAULT_MODEL="${TVASHTR_E2E_MODEL:-openai/gpt-4.1-mini}"

case "$TVASHTR_E2E_PROVIDER" in
  openai) KEY_VAR=OPENAI_API_KEY ;; deepseek) KEY_VAR=DEEPSEEK_API_KEY ;; nvidia_nim) KEY_VAR=NVIDIA_BUILD_API_KEY ;;
  *) KEY_VAR=UNKNOWN ;;
esac
if [[ -z "${!KEY_VAR:-}" ]]; then
  echo "[agent-tests-e2e] ${KEY_VAR} not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend (LOCAL sandbox, auto-approve, forced reviewer-approve, ${TVASHTR_AGENT_MODEL})"
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
echo "STEP F: run the agent-tests Playwright spec"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/agent-tests.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "AGENT-TESTS E2E PASSED (a test from a round + one from the API → Run all 2 → 1 passed, 1 failed with why)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "AGENT-TESTS E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

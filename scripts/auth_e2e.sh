#!/usr/bin/env bash
#
# Live M-accounts Slice A auth E2E — the whole app sits behind a minimal email/password login.
#
#   1. A fresh visit shows the LOGIN screen (not the canvas).
#   2. Registering a brand-new unique account lands on the canvas.
#   3. Logout returns to the login screen.
#   4. Logging in as the SEEDED operator account lands on the canvas.
#
# Orchestration mirrors scripts/launch_panel_e2e.sh (Postgres + migrate + a real backend on the
# LOCAL sandbox + the Vite dev server + a headless Playwright run). The one addition: after migrate
# and before Playwright we SEED the operator account and export TVASHTR_SEED_EMAIL/PASSWORD so the
# spec can log in as it (CHECK 4). This gate drives NO agent run — it needs NO NVIDIA key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_auth_backend.log"
VITE_LOG="/tmp/tvashtr_auth_vite.log"
SHOTS_DIR="${TVASHTR_AUTH_SHOTS_DIR:-/tmp/tvashtr_auth_shots}"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# The auth gate drives no agent loop; LOCAL sandbox keeps the backend cheap. Seed creds are the
# dev defaults (overridable) and are exported so BOTH the seed step and the Playwright spec see them.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTH_SHOTS_DIR="$SHOTS_DIR"
export TVASHTR_SEED_EMAIL="${TVASHTR_SEED_EMAIL:-operator@tvashtr.local}"
export TVASHTR_SEED_PASSWORD="${TVASHTR_SEED_PASSWORD:-tvashtr-dev}"

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
echo "STEP B2: seed the operator account (idempotent) so CHECK 4 can log in as it"
hr
( cd "$BACKEND" && uv run python -m tvashtr.seed )

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
echo "STEP D: start the Vite dev server"
hr
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

hr
echo "STEP E: install the Playwright chromium browser (idempotent)"
hr
( cd "$FRONTEND" && npx playwright install chromium )

hr
echo "STEP F: run the auth Playwright spec (screenshots each of the 4 checks)"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/auth.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "AUTH E2E PASSED (login required; register→canvas; logout→login; seeded-login→canvas)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "AUTH E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

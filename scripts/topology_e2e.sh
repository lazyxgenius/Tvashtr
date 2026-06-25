#!/usr/bin/env bash
#
# Live P1.8d topology-editing E2E — author your own wiring, through the real UI + API.
#
#   (1) From a BLANK team, author a runnable graph from scratch (root thinker → Engineer worker →
#       Ship): the canvas palette drops the worker; the edges go through the same team-edge CRUD the
#       connect-gesture calls. Then RUN it through the UI (real NIM) and assert it SHIPS.
#   (2) A graph made invalid (an unconnected just-dropped node) greys out Run with the reason AND the
#       server refuses create_run with a 422 carrying the structured errors.
#
# Orchestration mirrors scripts/capability_edit_e2e.sh (Postgres + migrate + a real backend + the
# Vite dev server + a headless Playwright run). The Engineer build uses a real model, so it needs
# NVIDIA_BUILD_API_KEY; skips otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_topology_backend.log"
VITE_LOG="/tmp/tvashtr_topology_vite.log"

cd "$ROOT"

# Load .env so the backend inherits DATABASE_URL + TVASHTR_AGENT_MODEL + NVIDIA_BUILD_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1

if [[ -z "${NVIDIA_BUILD_API_KEY:-}" ]]; then
  echo "[topology-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend (LOCAL sandbox, auto-approve gates)"
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
echo "backend up (pid $BACKEND_PID)"

hr
echo "STEP D: start the Vite dev server"
hr
# Bind 127.0.0.1 explicitly: vite's default `localhost` can resolve to IPv6 ::1 only, which the
# IPv4 health probe + Playwright (TVASHTR_E2E_BASE_URL) would never reach.
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
echo "STEP F: run the live P1.8d topology-editing Playwright spec"
hr
cd "$FRONTEND"
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/topology.spec.ts
PW_EXIT=$?

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "TOPOLOGY E2E PASSED (authored thinker→Engineer→Ship from a blank team, ran it, it shipped; invalid graph blocked in UI + 422)"
else
  echo "TOPOLOGY E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

#!/usr/bin/env bash
#
# Live FE E2E for M-unify U3 (the edits surface) — drives the authoring canvas + node drawer through
# the real UI. Pure authoring: NO agent run, NO real LLM, so (unlike the sibling live e2e scripts) it
# needs NO NVIDIA/DeepSeek key (it holds a dummy one). It REGISTERS a fresh account, creates the
# review_loop "My team" (new accounts start with no team) and checks:
#   A) flip a non-start node (Engineer) Edits allowed → Not allowed + an action-verb prompt, Save →
#      persists (edits_allowed=false) + the card re-labels "Edits off";
#   B) the start node (PM) Edits toggle is locked off;
#   C) the Tools editor is present on an edits-off node (the Reviewer);
#   (the old Check D, the launch panel's edits-off advisory, was retired with it in bc8d69e);
#   plus the seeded Reviewer ships edits-off (piece 4).
#
# Orchestration mirrors scripts/capability_edit_e2e.sh (Postgres + migrate + backend + Vite + headless
# Playwright), but on PARALLEL-SAFE ports (backend :8002, Vite :5175) so it never collides with a dev
# server or a parallel session. Vite's /api proxy is pointed at the :8002 backend via
# TVASHTR_API_PROXY_TARGET (vite.config.ts reads it; default stays :8000).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8002}"
VITE_PORT="${VITE_PORT:-5175}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_edits_toggle_backend.log"
VITE_LOG="/tmp/tvashtr_edits_toggle_vite.log"
export TVASHTR_EDITS_TOGGLE_SHOTS_DIR="${TVASHTR_EDITS_TOGGLE_SHOTS_DIR:-/tmp/tvashtr_edits_toggle_shots}"

cd "$ROOT"

# Load .env so the backend inherits DATABASE_URL (the worktree Postgres).
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1

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
# The worktree's Postgres runs as a shared, FIXED-name container (tvashtr-postgres); a blind
# `docker compose up -d` collides on that name when it is already running. So only bring it up if it
# is NOT already reachable, and probe by exec-ing the container directly (not via `compose`, whose
# project scoping differs across worktrees).
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
echo "STEP C: start the backend on :${PORT} (LOCAL sandbox, auto-approve gates)"
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
echo "backend up (pid $BACKEND_PID) on :${PORT}"

hr
echo "STEP D: start the Vite dev server on :${VITE_PORT} (proxying /api → :${PORT})"
hr
# Bind 127.0.0.1 explicitly (vite's default localhost can resolve to IPv6 ::1 only). Point the /api
# proxy at THIS backend via TVASHTR_API_PROXY_TARGET (vite.config.ts reads it).
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
echo "STEP F: run the M-unify U3 edits-toggle Playwright spec"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/edits-toggle.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "EDITS-TOGGLE E2E PASSED (edits toggle persists + re-labels; tools on every node; start locked)"
  echo "screenshots: $TVASHTR_EDITS_TOGGLE_SHOTS_DIR"
else
  echo "EDITS-TOGGLE E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

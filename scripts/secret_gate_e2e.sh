#!/usr/bin/env bash
#
# M-rails C8 secret-gate E2E — the gate drawer is editable + flips to the secret_leak_scan guardrail.
#
#   Register a fresh account, "New team" from the review_loop template (it carries a PRD gate), open
#   the gate on the canvas, pick "Secret leak scan" in the Gate type picker, Save, and assert the
#   config PERSISTED (config.gate_kind === "secret_leak_scan" via a live /api/teams/{id}/graph read).
#   A screenshot per check. NO agent run — needs NO NVIDIA key; just Postgres + a real backend + Vite.
#
# Isolated ports (this worktree runs alongside a parallel session on :8000/:5173): backend :8001,
# Vite :5174, and the Vite proxy is pointed at :8001 via TVASHTR_API_PROXY_TARGET. Orchestration
# mirrors scripts/launch_panel_e2e.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8001}"
VITE_PORT="${VITE_PORT:-5174}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_secret_gate_backend.log"
VITE_LOG="/tmp/tvashtr_secret_gate_vite.log"
SHOTS_DIR="${TVASHTR_SECRET_GATE_SHOTS_DIR:-/tmp/tvashtr_secret_gate_shots}"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# The gate-config flow drives no agent loop; LOCAL sandbox keeps the backend cheap.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_SECRET_GATE_SHOTS_DIR="$SHOTS_DIR"
# Point the Vite dev server's proxy at THIS worktree's backend port (default :8000 otherwise).
# `TVASHTR_API_PROXY_TARGET` is the var vite.config.ts reads (reconciled with M-unify U3 on merge).
export TVASHTR_API_PROXY_TARGET="http://127.0.0.1:${PORT}"

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
# Tolerant of an already-running container (this worktree's postgres may have been started by a
# sibling compose project sharing the container name) — the migrate + backend-health steps below
# confirm real DB connectivity via the .env DATABASE_URL regardless.
docker compose up -d 2>/dev/null || echo "(postgres already running — reusing it)"
( cd "$BACKEND" && uv run alembic upgrade head )
echo "migrations at head"

hr
echo "STEP C: start the backend (LOCAL sandbox) on :${PORT}"
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
echo "backend up (pid $BACKEND_PID) on :${PORT}"

hr
echo "STEP D: start the Vite dev server on :${VITE_PORT} (proxy -> :${PORT})"
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
echo "STEP F: run the secret-gate Playwright spec (screenshots the canvas + editable drawer + save)"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/secret-gate.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "SECRET-GATE E2E PASSED (gate drawer editable; flipped to secret_leak_scan; config persisted)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "SECRET-GATE E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

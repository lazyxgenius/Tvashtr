#!/usr/bin/env bash
#
# M-endpoint-editable E2E — the Ship endpoint drawer is editable + flips to Stop.
#
#   Register a fresh account, "New team" blank skeleton (thinker → Ship), open the Ship endpoint on
#   the canvas, click Stop, Save, assert config.terminal_kind + role_name PERSISTED via a live
#   /api/teams/{id}/graph read, and that the canvas card re-renders with its in-edge still attached.
#   Reload proves durability. A screenshot per check. NO agent run — needs NO provider key; just
#   Postgres + a real backend + Vite.
#
# Isolated ports (this worktree runs alongside a parallel session on :8000/:5173): backend :8001,
# Vite :5174, and the Vite proxy is pointed at :8001 via TVASHTR_API_PROXY_TARGET. Orchestration
# mirrors scripts/secret_gate_e2e.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8001}"
VITE_PORT="${VITE_PORT:-5174}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_endpoint_edit_backend.log"
VITE_LOG="/tmp/tvashtr_endpoint_edit_vite.log"
SHOTS_DIR="${TVASHTR_ENDPOINT_EDIT_SHOTS_DIR:-/tmp/tvashtr_endpoint_edit_shots}"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  # Load only valid bash identifiers. Make's `include .env` accepts hyphens (e.g. `x-api-key`),
  # but `source` treats those lines as commands and aborts under `set -e`.
  set -a
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// }" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      # shellcheck disable=SC2163
      export "$line"
    fi
  done < "$ROOT/.env"
  set +a
fi

# The endpoint-edit flow drives no agent loop; LOCAL sandbox keeps the backend cheap.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_ENDPOINT_EDIT_SHOTS_DIR="$SHOTS_DIR"
# Point the Vite dev server's proxy at THIS worktree's backend port (default :8000 otherwise).
export TVASHTR_API_PROXY_TARGET="http://127.0.0.1:${PORT}"

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
echo "STEP F: run the endpoint-edit Playwright spec (screenshots the canvas + editable drawer + save)"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/endpoint-edit.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "ENDPOINT-EDIT E2E PASSED (Ship drawer editable; flipped to Stop; config+role_name persisted; edges kept)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "ENDPOINT-EDIT E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

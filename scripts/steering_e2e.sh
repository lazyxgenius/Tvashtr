#!/usr/bin/env bash
#
# Live J3 steering E2E (P1.7b) — the real UI chain end to end.
#
#   POST a review_loop run via the UI -> it pauses at the PRD gate (awaiting_human) -> a human
#   REWRITES the PRD in the real TipTap editor and Saves it (a new created_by="human"
#   DocumentVersion) -> approve the gate (and the escalation gate if the Reviewer cycles to the
#   cap) -> the run ships -> assert the committed greeting.txt is the human's SENTINEL line, NOT
#   DEFAULT_IDEA's line. That is the full living-document loop: the document, not agent memory,
#   is the source of truth, and a human edit propagates to the agents on their next read.
#
# Orchestration mirrors scripts/hitl_demo.sh (Postgres + migrate + a real backend) and adds the
# Vite dev server + a headless Playwright run. The agent is the REAL NIM model from .env
# (TVASHTR_AGENT_MODEL); the PRD gate is REAL (auto-approve is forced OFF). Needs
# NVIDIA_BUILD_API_KEY (the proven nvidia_nim agent); skips cleanly otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_steering_backend.log"
VITE_LOG="/tmp/tvashtr_steering_vite.log"

cd "$ROOT"

# Load .env so the backend inherits DATABASE_URL + TVASHTR_AGENT_MODEL + NVIDIA_BUILD_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Real gate, local sandbox (this is an orchestration/UI proof, not a containment proof).
unset TVASHTR_AUTO_APPROVE_GATES || true
export TVASHTR_AGENT_SANDBOX=local

if [[ -z "${NVIDIA_BUILD_API_KEY:-}" ]]; then
  echo "[steering-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend (real NIM agent, LOCAL sandbox, REAL gate)"
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
echo "backend up (pid $BACKEND_PID), agent model = ${TVASHTR_AGENT_MODEL:-<default>}"

hr
echo "STEP D: start the Vite dev server"
hr
# Bind 127.0.0.1 explicitly: vite's default `localhost` can resolve to IPv6 ::1 only, which
# the IPv4 health probe + Playwright (TVASHTR_E2E_BASE_URL) would never reach.
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
echo "STEP F: run the live J3 steering Playwright spec"
hr
cd "$FRONTEND"
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/steering.spec.ts
PW_EXIT=$?

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "STEERING E2E PASSED (human PRD edit shipped through the real TipTap editor)"
else
  echo "STEERING E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

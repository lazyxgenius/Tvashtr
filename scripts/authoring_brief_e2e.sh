#!/usr/bin/env bash
#
# Live M2 authoring-brief E2E — the per-node "last run" brief in the AUTHORING node panel.
#
#   Run a real review_loop through the UI, return to the authoring view, click the PM (thinker) node,
#   and assert its TeamNodePanel surfaces the "Last run" brief ("Drafted the spec from the idea.") +
#   a relative-time provenance tag — proving the cloned_from_node_id linkage + the authoring read +
#   the view-switch re-fetch end to end. Captures a screenshot of the panel.
#
# Orchestration mirrors scripts/work_brief_e2e.sh (Postgres + migrate + a real backend + the Vite dev
# server + a headless Playwright run). The Engineer build uses a real model, so it needs
# NVIDIA_BUILD_API_KEY; skips otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_authoring_brief_backend.log"
VITE_LOG="/tmp/tvashtr_authoring_brief_vite.log"
SHOTS_DIR="${TVASHTR_AUTHORING_SHOTS_DIR:-/tmp/tvashtr_authoring_brief_shots}"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Hands-off run: LOCAL sandbox, auto-approve the PRD gate, Reviewer approves round 1 (no forced loop
# needed — the proof is the PM's brief surfacing in authoring, and one Engineer build is faster).
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1
export TVASHTR_FORCE_REVISIONS=0
export TVASHTR_AUTHORING_SHOTS_DIR="$SHOTS_DIR"

if [[ -z "${NVIDIA_BUILD_API_KEY:-}" ]]; then
  echo "[authoring-brief-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend (LOCAL sandbox, auto-approve gates, Reviewer auto-approve)"
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
echo "STEP F: run the live authoring-brief Playwright spec (screenshots the authoring PM panel)"
hr
cd "$FRONTEND"
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/authoring-brief.spec.ts
PW_EXIT=$?

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "AUTHORING-BRIEF E2E PASSED (the PM's last-run brief + provenance surfaced in the authoring node panel)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "AUTHORING-BRIEF E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

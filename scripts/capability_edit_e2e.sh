#!/usr/bin/env bash
#
# Live P1.8c capability-authoring E2E — flip a node's capability on the canvas, through the real UI.
#
#   Sign in as a fresh account -> Home's "New team" -> the plan_review template (PM -> Architect ->
#   Engineer <-> Reviewer) -> name it -> its canvas opens -> click the Architect (a non-start thinker)
#   -> flip its Edits toggle (M-unify U3: the node's one capability distinction) from "Not allowed"
#   to "Edits allowed" -> Save (PATCH the node-update endpoint) -> assert (a) GET the team graph shows
#   the Architect now edits_allowed=true (the flip PERSISTED), (b) the canvas card re-labels
#   "Edits on", and (c) the PM (start node) toggle is disabled/locked. This is the toggle-plumbing +
#   start-lock proof; the "a graph with a non-start thinker runs correctly"
#   proof is carried by the offline keystone (test_thinker_chain.py) + `make thinker-chain-e2e`.
#
# Orchestration mirrors scripts/team_library_e2e.sh (Postgres + migrate + a real backend + the Vite
# dev server + a headless Playwright run). No agent runs (pure authoring), but the skip guard +
# orchestration mirror the siblings. Needs NVIDIA_BUILD_API_KEY; skips otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_capedit_backend.log"
VITE_LOG="/tmp/tvashtr_capedit_vite.log"

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
  echo "[capability-edit-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
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
echo "STEP F: run the live P1.8c capability-edit Playwright spec"
hr
cd "$FRONTEND"
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/capability-edit.spec.ts
PW_EXIT=$?

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "CAPABILITY-EDIT E2E PASSED (flipped the Architect to Edits allowed; persisted + re-labelled; PM locked)"
else
  echo "CAPABILITY-EDIT E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

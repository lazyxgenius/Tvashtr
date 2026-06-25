#!/usr/bin/env bash
#
# Live P1.8b team-library E2E — the create-from-template → edit → run vertical through the real UI.
#
#   Open the app -> "+ New team" -> pick the review_loop template -> name it -> the new team becomes
#   current -> click its Engineer agent node -> rewrite the PROMPT (its whole identity) so the
#   deliverable is a unique per-run SENTINEL + set its MODEL -> Save (PATCH the node-update endpoint)
#   -> "Run this team" (clone-on-launch) -> the run ships -> assert the committed greeting.txt is the
#   human's SENTINEL line, NOT the template DEFAULT_IDEA line. That proves the whole library vertical
#   (drop a preset, edit a node, run it) drives a real build — not a hardcoded pipeline.
#
# Orchestration mirrors scripts/team_edit_e2e.sh (Postgres + migrate + a real backend + the Vite dev
# server + a headless Playwright run). The agent is the REAL NIM model from .env
# (TVASHTR_AGENT_MODEL). Gates AUTO-APPROVE and the Reviewer is forced-approve (FORCE_REVISIONS=0),
# so the run is hands-off and fast: PM (real) -> prd_gate (auto) -> Engineer (real agent, the edited
# prompt) -> Reviewer (forced approve, no LLM) -> ship. Needs NVIDIA_BUILD_API_KEY; skips otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_teamlibrary_backend.log"
VITE_LOG="/tmp/tvashtr_teamlibrary_vite.log"

cd "$ROOT"

# Load .env so the backend + the spec inherit DATABASE_URL + TVASHTR_AGENT_MODEL + NVIDIA_BUILD_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Hands-off, local sandbox (an authoring/UI proof, not a containment or HitL proof): auto-approve the
# PRD gate, force the Reviewer to approve round 1 (no LLM, no escalation) so the run ships fast on the
# Engineer's first build — which is deterministically the edited SENTINEL deliverable.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1
export TVASHTR_FORCE_REVISIONS=0

if [[ -z "${NVIDIA_BUILD_API_KEY:-}" ]]; then
  echo "[team-library-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
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
echo "STEP C: start the backend (real NIM agent, LOCAL sandbox, auto-approve gates, forced-approve reviewer)"
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
echo "STEP F: run the live P1.8b team-library Playwright spec"
hr
cd "$FRONTEND"
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/team-library.spec.ts
PW_EXIT=$?

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "TEAM-LIBRARY E2E PASSED (created a team from a template, edited it, and it shipped the authored prompt)"
else
  echo "TEAM-LIBRARY E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

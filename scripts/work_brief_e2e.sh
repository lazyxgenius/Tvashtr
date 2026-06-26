#!/usr/bin/env bash
#
# Live per-node work-brief E2E (Option A) — two proofs in one target:
#
#   (§6.1) executor-populate proof (API-driven, the most important + cheapest): run a REAL
#          review_loop on the NIM agent with forced revisions, then GET /api/runs/{id}/graph and
#          assert the THINKER (PM) AND WORKER (Engineer) latest outcome_detail are non-NULL,
#          well-formed briefs (populated for MORE than just the Reviewer) while the Reviewer's
#          detail stays its verdict reasons. Echoes the asserted values. (scripts/work_brief_check.py)
#   (§6.2) FE proof (scripted headless Playwright): drive a real run through the UI, click the
#          thinker node then the Engineer node in the run view, assert each panel shows its own
#          "Last run" brief, and capture >=2 element screenshots. (frontend/e2e/work-brief.spec.ts)
#
# Orchestration mirrors scripts/topology_e2e.sh. The Engineer build uses a real model, so it needs
# NVIDIA_BUILD_API_KEY; skips otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_work_brief_backend.log"
VITE_LOG="/tmp/tvashtr_work_brief_vite.log"
SHOTS_DIR="${TVASHTR_WB_SHOTS_DIR:-/tmp/tvashtr_work_brief_shots}"

cd "$ROOT"

# Load .env so the backend + the checker inherit DATABASE_URL + DEFAULT_MODEL + TVASHTR_AGENT_MODEL +
# NVIDIA_BUILD_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Hands-off executor proof: LOCAL sandbox, auto-approve the PRD gate, force one revision so the
# Engineer↔Reviewer loop genuinely cycles (Engineer x2).
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1
export TVASHTR_FORCE_REVISIONS=1
export TVASHTR_WB_SHOTS_DIR="$SHOTS_DIR"

if [[ -z "${NVIDIA_BUILD_API_KEY:-}" ]]; then
  echo "[work-brief-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
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
echo "STEP C: executor-populate proof (API-driven, in-process TestClient) — the §6.1 assertion"
hr
mkdir -p "$SHOTS_DIR"
( cd "$BACKEND" && uv run python ../scripts/work_brief_check.py )
CHECK_EXIT=$?
if [[ "$CHECK_EXIT" != "0" ]]; then
  echo "WORK-BRIEF E2E FAILED at the executor-populate proof (exit $CHECK_EXIT)" >&2
  exit "$CHECK_EXIT"
fi

hr
echo "STEP D: start the backend (LOCAL sandbox, auto-approve gates, Reviewer auto-approve)"
hr
# The FE proof only needs the per-node briefs populated, not a forced loop (the §6.1 checker already
# proved the forced cycle) — so the UI-driven run uses FORCE_REVISIONS=0 (Reviewer approves round 1,
# one Engineer build) for a faster, less flaky Playwright run.
TVASHTR_FORCE_REVISIONS=0 "$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" \
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
echo "STEP E: start the Vite dev server"
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
echo "STEP F: install the Playwright chromium browser (idempotent)"
hr
( cd "$FRONTEND" && npx playwright install chromium )

hr
echo "STEP G: run the live work-brief Playwright spec (screenshots the thinker + worker panels)"
hr
cd "$FRONTEND"
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/work-brief.spec.ts
PW_EXIT=$?

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "WORK-BRIEF E2E PASSED (thinker + worker briefs populated via the executor AND surfaced in the run-view panel)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "WORK-BRIEF E2E FAILED at the Playwright proof (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

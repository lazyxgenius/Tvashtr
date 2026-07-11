#!/usr/bin/env bash
#
# Live M-brownfield scoped-mount Slice 2 SCOPE-PICKER E2E — the launch panel's Scope dropdown + the
# extended repo-inspect round-trip.
#
#   Register a fresh account, open the seeded team, click "Run this team" (assert the panel OPENS),
#   flip "work on a local repo" On, type a REAL multi-package fixture git repo path the spec creates,
#   and assert the base-branch dropdown AND the new Scope dropdown populate from the LIVE POST
#   /api/repo/inspect round-trip (which now returns `subpaths`); pick a package and assert the launch
#   POST /api/runs body carries `subpath`. A screenshot per check.
#
# Orchestration mirrors scripts/launch_panel_e2e.sh (a real backend + the Vite dev server + a headless
# Playwright run) — but this gate drives NO agent run (the keyless fresh account 422s the create
# pre-flight, so no LLM/key is needed), and it runs on ISOLATED ports (backend :8001, Vite :5174) so
# it never collides with a sibling worktree. Postgres is the SHARED container (this worktree's own DB
# is isolated via .env DATABASE_URL → tvashtr_scope), so we do NOT `docker compose up` a second one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8001}"
VITE_PORT="${VITE_PORT:-5174}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_scope_picker_backend.log"
VITE_LOG="/tmp/tvashtr_scope_picker_vite.log"
SHOTS_DIR="${TVASHTR_SCOPE_SHOTS_DIR:-/tmp/tvashtr_scope_picker_shots}"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# The panel + inspect gate drives no agent loop; LOCAL sandbox keeps the backend cheap.
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_SCOPE_SHOTS_DIR="$SHOTS_DIR"
# Vite (:5174) proxies /api + /health to THIS worktree's backend (:8001), not the default :8000.
export TVASHTR_API_PROXY_TARGET="$BASE"

BACKEND_PID=""
VITE_PID=""
cleanup() {
  [[ -n "$VITE_PID" ]] && kill -9 "$VITE_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill -9 "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }

hr
echo "STEP A/B: ensure Postgres is up (shared container) + migrate this worktree's DB (tvashtr_scope)"
hr
# Best-effort start (a sibling worktree usually already holds the shared tvashtr-postgres container;
# the hardcoded container_name then conflicts — tolerated, the running one serves our isolated DB).
docker compose up -d >/dev/null 2>&1 || true
# `alembic upgrade head` is the readiness gate (it connects via .env DATABASE_URL → tvashtr_scope);
# retry briefly in case a cold Postgres is still starting.
migrated=""
for _ in $(seq 1 30); do
  if ( cd "$BACKEND" && uv run alembic upgrade head ) >/dev/null 2>&1; then migrated=1; break; fi
  sleep 1
done
[[ -n "$migrated" ]] || { echo "ERROR: could not migrate — is Postgres up on :5433?" >&2; exit 1; }
echo "migrated tvashtr_scope to head"

hr
echo "STEP C: start the backend on :$PORT (LOCAL sandbox)"
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
echo "backend up (pid $BACKEND_PID) on :$PORT"

hr
echo "STEP D: start the Vite dev server on :$VITE_PORT (proxying /api -> :$PORT)"
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
echo "STEP F: run the scope-picker Playwright spec (screenshots the panel + the Scope round-trip)"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/scope-picker.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "SCOPE-PICKER E2E PASSED (panel opens; inspect round-trip populates base-branch + Scope; a picked package threads subpath)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "SCOPE-PICKER E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

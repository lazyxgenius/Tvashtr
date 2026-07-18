#!/usr/bin/env bash
# M-h2b LIVE gate — the milestone capstone: a hosted Fly run SURVIVES the backend process dying
# while parked at a human-approval gate, and resumes against its EXISTING microVM.
#
# The shape is `skeleton_crash_demo.sh`'s real kill+restart, pointed at a Fly-sandboxed hosted run:
#
#   uvicorn #1  ->  run parks at a genuinely-blocking budget gate, machine Fly-SUSPENDED
#   kill -9     ->  the process that held the in-memory handle is GONE (not a graceful shutdown)
#   uvicorn #2  ->  DBOS recovery re-enters the workflow and re-blocks on the durable gate
#   approve     ->  the run RECONSTRUCTS its handle from Fly + the HMAC-derived key,
#                   RESUMES the suspended machine, and ships a REAL PR
#
# `kill -9` (not SIGTERM) is the point: no teardown hook runs, no handle is flushed anywhere. The
# only things that survive are the run_id, the server secret, and the app on Fly — which is exactly
# the claim under test.
#
# Skips cleanly without TVASHTR_FLY_API_TOKEN / GITHUB_APP_* / the model key. Spends real money.
# Needs an ACTIVE WireGuard tunnel. NOT in `make test`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
CHECK="$ROOT/scripts/fly_suspend_restart_check.py"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG1="/tmp/tvashtr_fly_suspend_1.log"
LOG2="/tmp/tvashtr_fly_suspend_2.log"
STATE="$(mktemp /tmp/tvashtr_fly_suspend_state.XXXXXX.json)"
echo '{}' >"$STATE"
cd "$ROOT"

# Load .env WITHOUT `source`: a plain source chokes on lines like `x-api-key=…` whose key is not a
# valid shell identifier (the same gotcha every Python script here documents). Take only well-formed
# assignments, so both uvicorn processes inherit the Fly token, the GitHub App and the model key.
if [[ -f "$ROOT/.env" ]]; then
  while IFS= read -r line; do
    export "${line?}"
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env" || true)
fi

# THE POSTURE. Auto-approve OFF is load-bearing: the gate must genuinely block, or this proves
# nothing. Fly sandbox, hosted mode, no forced revisions.
export TVASHTR_HOSTED_MODE=true
export TVASHTR_AGENT_SANDBOX=fly
export TVASHTR_AUTO_APPROVE_GATES=0
export TVASHTR_FORCE_REVISIONS=0
export TVASHTR_AGENT_MODEL="${TVASHTR_AGENT_MODEL:-deepseek/deepseek-chat}"
export TVASHTR_SUSPEND_E2E_BASE="$BASE"

if [[ -z "${TVASHTR_FLY_API_TOKEN:-}" ]]; then
  echo "[suspend-e2e] TVASHTR_FLY_API_TOKEN not set — skipping. (Not a failure.)"
  exit 0
fi
if [[ -z "${GITHUB_APP_ID:-}" || -z "${GITHUB_APP_PRIVATE_KEY_B64:-}" ]]; then
  echo "[suspend-e2e] GITHUB_APP_* not fully set — skipping. (Not a failure.)"
  exit 0
fi

CURRENT_PID=""
LAST_LOG="$LOG1"

cleanup() {
  if [[ -n "$CURRENT_PID" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    kill -9 "$CURRENT_PID" 2>/dev/null || true
  fi
  # Never leave a machine billing, whatever happened above. Reads the app name this run recorded
  # and deletes it; a 404 is fine (the happy path already tore it down).
  "$VENV_PY" - "$STATE" <<'PY' 2>/dev/null || true
import json, sys, os
from pathlib import Path
try:
    state = json.loads(Path(sys.argv[1]).read_text())
    app_name = state.get("app_name")
except Exception:
    app_name = None
if app_name:
    sys.path.insert(0, str(Path.cwd() / "backend"))
    os.environ.setdefault("TVASHTR_AGENT_SANDBOX", "fly")
    from tvashtr.config import get_settings
    from tvashtr.engines.fly_machines import FlyMachines
    s = get_settings()
    fly = FlyMachines(token=s.fly_api_token, org=s.fly_org, image=s.fly_agent_image)
    try:
        if fly.app_exists(app_name):
            fly.delete_app(app_name)
            print(f"[suspend-e2e] cleanup: deleted stray app {app_name}")
    finally:
        fly.close()
PY
  rm -f "$STATE"
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }

start_uvicorn() {
  LAST_LOG="$1"
  ( cd "$BACKEND" && "$VENV_PY" -m uvicorn tvashtr.main:app \
      --host 127.0.0.1 --port "$PORT" --log-level warning >"$LAST_LOG" 2>&1 ) &
  CURRENT_PID=$!
}

wait_for_health() {
  for _ in $(seq 1 120); do
    if ! kill -0 "$CURRENT_PID" 2>/dev/null; then
      echo "ERROR: uvicorn (pid $CURRENT_PID) exited early. Log tail:" >&2
      tail -n 30 "$LAST_LOG" >&2
      return 1
    fi
    if curl -sf "$BASE/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "ERROR: uvicorn did not become healthy within 60s" >&2
  tail -n 30 "$LAST_LOG" >&2
  return 1
}

hr
echo ">>> STEP A — Postgres + migrations"
docker compose up -d postgres >/dev/null
for _ in $(seq 1 60); do
  docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-tvashtr}" >/dev/null 2>&1 && break
  sleep 0.5
done
( cd "$BACKEND" && uv run alembic upgrade head >/dev/null )

hr
echo ">>> STEP B — backend process #1"
start_uvicorn "$LOG1"
wait_for_health
PID1="$CURRENT_PID"
echo "[suspend-e2e] uvicorn #1 pid=$PID1"

hr
echo ">>> STEP C — park the run at a blocking gate with the machine SUSPENDED"
( cd "$BACKEND" && "$VENV_PY" "$CHECK" phase1 "$STATE" )

hr
echo ">>> STEP D — kill -9 the backend (the process holding the in-memory handle)"
kill -9 "$PID1"
while kill -0 "$PID1" 2>/dev/null; do sleep 0.2; done
CURRENT_PID=""
echo "[suspend-e2e] killed uvicorn #1 (pid $PID1) — the _RUNS handle is now GONE"

hr
echo ">>> STEP E — backend process #2 (DBOS recovery re-enters and re-blocks on the gate)"
start_uvicorn "$LOG2"
wait_for_health
echo "[suspend-e2e] uvicorn #2 pid=$CURRENT_PID"
( cd "$BACKEND" && "$VENV_PY" "$CHECK" phase2 "$STATE" )

hr
echo ">>> STEP F — approve for real; reconstruct + resume + ship a REAL PR"
( cd "$BACKEND" && "$VENV_PY" "$CHECK" phase3 "$STATE" )

hr
echo "[suspend-e2e] PASS — a hosted run survived a kill -9 while parked, and shipped."

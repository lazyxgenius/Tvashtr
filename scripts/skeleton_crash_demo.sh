#!/usr/bin/env bash
#
# Skeleton crash-resume demo (P0.4b) — the milestone-M0 exit test.
#
#   1. start uvicorn (process 1), POST a 2-node run (PM -> Engineer)
#   2. wait until the agent is mid-run (first run_event), then kill -9 process 1
#   3. restart uvicorn (process 2); DBOS recovers the in-flight run_team
#   4. the agent step re-runs in the NEW process; assert exactly-once outcome:
#      one ship tag/commit, one PRD version, one agent-cost row, file matches,
#      and >= 2 engineer attempts with distinct pids (OLD_PID -> NEW_PID).
#
# Opt-in (needs OPENROUTER_API_KEY); skips cleanly otherwise. Exits non-zero on
# any failed assertion or timeout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG1="/tmp/tvashtr_skeleton_1.log"
LOG2="/tmp/tvashtr_skeleton_2.log"

cd "$ROOT"

# Load .env so BOTH uvicorn processes inherit OPENROUTER_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Auto-approve the P1.1a PRD gate so this deterministic crash demo doesn't block
# on a human. Exported -> inherited by both uvicorn processes; the workflow reads
# it inside a recorded step, so the gate decision replays identically post-crash.
export TVASHTR_AUTO_APPROVE_GATES="${TVASHTR_AUTO_APPROVE_GATES:-1}"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "[skeleton-crash] OPENROUTER_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

CURRENT_PID=""
LAST_LOG="$LOG1"
cleanup() {
  if [[ -n "$CURRENT_PID" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    kill -9 "$CURRENT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }
psql_c() { docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" "$@"; }

start_uvicorn() {
  LAST_LOG="$1"
  "$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" \
    --log-level warning >"$LAST_LOG" 2>&1 &
  CURRENT_PID=$!
}

wait_for_health() {
  for _ in $(seq 1 60); do
    if ! kill -0 "$CURRENT_PID" 2>/dev/null; then
      echo "ERROR: uvicorn (pid $CURRENT_PID) exited early. Log tail:" >&2
      tail -n 25 "$LAST_LOG" >&2
      return 1
    fi
    if curl -sf "$BASE/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "ERROR: uvicorn did not become healthy within 30s" >&2
  return 1
}

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
echo "STEP C/D: start uvicorn (process 1) + POST a run"
hr
start_uvicorn "$LOG1"
OLD_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 1 PID = $OLD_PID  (healthy)"

RUN_ID="$(curl -sf -X POST "$BASE/api/runs" -H 'content-type: application/json' -d '{}' \
  | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')"
WS="$BACKEND/.tvashtr_workspaces/$RUN_ID"
echo "started run_id = $RUN_ID"

hr
echo "STEP E: wait until the agent is mid-run (first run_event appears)"
hr
EVENTS=0
for _ in $(seq 1 180); do
  EVENTS="$(curl -sf "$BASE/api/spike/run-events/$RUN_ID" \
    | "$VENV_PY" -c 'import sys,json;print(len(json.load(sys.stdin)["events"]))' 2>/dev/null || echo 0)"
  if [[ "${EVENTS:-0}" -ge 1 ]]; then break; fi
  sleep 1
done
if [[ "${EVENTS:-0}" -lt 1 ]]; then
  echo "ERROR: no run_event appeared — the agent never started" >&2
  tail -n 25 "$LOG1" >&2
  exit 1
fi
echo "agent is mid-run: $EVENTS run_event(s) recorded"

hr
echo "STEP F: state at crash (expect: 1 attempt pid=$OLD_PID, NO ship tag, run not completed)"
hr
ATTEMPT_PID="$(psql_c -At -c "select pid from engineer_run_attempts where run_id='$RUN_ID' order by id" | tr -d '[:space:]')"
SHIP_AT_CRASH="$(git -C "$WS" tag --list "ship-$RUN_ID" 2>/dev/null || true)"
RUN_STATUS_AT_CRASH="$(psql_c -At -c "select status from runs where workflow_id='$RUN_ID'" | tr -d '[:space:]')"
echo "  run_events=$EVENTS  attempt_pid=$ATTEMPT_PID  ship_tag='${SHIP_AT_CRASH:-<none>}'  run.status=$RUN_STATUS_AT_CRASH"
[[ "$ATTEMPT_PID" == "$OLD_PID" ]] || { echo "ERROR: attempt pid $ATTEMPT_PID != OLD_PID $OLD_PID" >&2; exit 1; }
[[ -z "$SHIP_AT_CRASH" ]] || { echo "ERROR: already shipped before crash" >&2; exit 1; }
[[ "$RUN_STATUS_AT_CRASH" != "completed" ]] || { echo "ERROR: run already completed before crash" >&2; exit 1; }

hr
echo "STEP G: kill -9 process 1 mid agent-run"
hr
kill -9 "$OLD_PID"
while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.2; done
CURRENT_PID=""
echo ">>> killed uvicorn process 1 (PID $OLD_PID) <<<"

hr
echo "STEP H: restart uvicorn (process 2) — DBOS recovers the in-flight run_team"
hr
start_uvicorn "$LOG2"
NEW_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 2 PID = $NEW_PID  (healthy)"

hr
echo "STEP I: poll until the run completes in process 2 (timeout 360s)"
hr
STATUS=""; RUN_ST=""
for _ in $(seq 1 90); do
  RESP="$(curl -sf "$BASE/api/runs/$RUN_ID" || echo '{}')"
  STATUS="$(echo "$RESP" | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin).get("workflow_status",""))' 2>/dev/null || echo "")"
  RUN_ST="$(echo "$RESP" | "$VENV_PY" -c 'import sys,json;b=json.load(sys.stdin);print((b.get("run") or {}).get("status",""))' 2>/dev/null || echo "")"
  echo "  workflow=${STATUS:-<none>} run=${RUN_ST:-<none>}"
  if [[ "$RUN_ST" == "completed" || "$STATUS" == "SUCCESS" ]]; then break; fi
  if [[ "$STATUS" == "ERROR" || "$STATUS" == "CANCELLED" || "$STATUS" == "MAX_RECOVERY_ATTEMPTS_EXCEEDED" || "$RUN_ST" == "failed" ]]; then
    echo "ERROR: run ended in workflow=$STATUS run=$RUN_ST" >&2; exit 1
  fi
  sleep 4
done
if [[ "$RUN_ST" != "completed" && "$STATUS" != "SUCCESS" ]]; then
  echo "ERROR: run did not complete within 360s (last: workflow=$STATUS run=$RUN_ST)" >&2
  exit 1
fi

hr
echo "STEP J: assertions"
hr
( cd "$BACKEND" && "$VENV_PY" "$ROOT/scripts/check_skeleton_crash.py" "$RUN_ID" "$OLD_PID" "$NEW_PID" "$BASE" )

hr
echo "SKELETON CRASH-RESUME PASSED"
hr

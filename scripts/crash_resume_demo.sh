#!/usr/bin/env bash
#
# Crash-resume demo: prove DBOS durable execution survives a kill -9.
#
#   1. bring up Postgres and run migrations
#   2. start uvicorn (process 1), start the hello_durable workflow
#   3. wait until step 1 has checkpointed, then kill -9 process 1 mid-sleep
#   4. restart uvicorn (process 2); DBOS auto-recovers the pending workflow
#   5. assert: one row per step, step 1 ran in process 1, steps 2-3 in process 2,
#      and the final DBOS status is SUCCESS
#
# Exits non-zero on any failed assertion or timeout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG1="/tmp/tvashtr_uvicorn_1.log"
LOG2="/tmp/tvashtr_uvicorn_2.log"

cd "$ROOT"

# Load .env, then set the durable sleep long enough to kill mid-sleep.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export HELLO_SLEEP_SECONDS="${HELLO_SLEEP_SECONDS:-10}"
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

psql_c() {
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" "$@"
}

print_events() {
  psql_c -c \
    "select id, step_name, pid, executed_at from spike_hello_events where workflow_id='$WF_ID' order by id;"
}

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
    if curl -sf "$BASE/health" >/dev/null 2>&1; then
      return 0
    fi
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
    echo "postgres ready"
    break
  fi
  sleep 1
done
( cd "$BACKEND" && uv run alembic upgrade head )
psql_c -c "TRUNCATE spike_hello_events RESTART IDENTITY;" >/dev/null
echo "spike_hello_events truncated for a clean run"

hr
echo "STEP C/D: start uvicorn (process 1) + start workflow (durable sleep=${HELLO_SLEEP_SECONDS}s)"
hr
start_uvicorn "$LOG1"
OLD_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 1 PID = $OLD_PID  (healthy)"

WF_ID="$(curl -sf -X POST "$BASE/api/spike/hello-durable" \
  | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["workflow_id"])')"
echo "started workflow_id = $WF_ID"

hr
echo "STEP E: wait until step 1 has checkpointed (row exists)"
hr
STEP1_OK=0
for _ in $(seq 1 40); do
  CNT="$(psql_c -At -c "select count(*) from spike_hello_events where workflow_id='$WF_ID';" | tr -d '[:space:]')"
  if [[ "${CNT:-0}" -ge 1 ]]; then STEP1_OK=1; break; fi
  sleep 0.3
done
if [[ "$STEP1_OK" -ne 1 ]]; then
  echo "ERROR: step 1 row never appeared" >&2
  exit 1
fi
echo "step 1 row present — workflow is now in its durable sleep"

hr
echo "STEP F/G: kill -9 process 1 mid-sleep, then show state at crash"
hr
kill -9 "$OLD_PID"
while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.2; done
CURRENT_PID=""
echo ">>> killed uvicorn process 1 (PID $OLD_PID) <<<"
echo "STATE AT CRASH (expect only step1_start, pid=$OLD_PID):"
print_events

hr
echo "STEP H: restart uvicorn (process 2) — DBOS recovers the pending workflow"
hr
start_uvicorn "$LOG2"
NEW_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 2 PID = $NEW_PID  (healthy)"

hr
echo "STEP I: poll workflow status until SUCCESS (timeout 60s)"
hr
STATUS=""
for _ in $(seq 1 120); do
  STATUS="$(curl -sf "$BASE/api/spike/hello-durable/$WF_ID" \
    | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["status"])' 2>/dev/null || echo "")"
  echo "  status: ${STATUS:-<none>}"
  if [[ "$STATUS" == "SUCCESS" ]]; then break; fi
  if [[ "$STATUS" == "ERROR" || "$STATUS" == "CANCELLED" || "$STATUS" == "MAX_RECOVERY_ATTEMPTS_EXCEEDED" ]]; then
    echo "ERROR: workflow ended in $STATUS" >&2
    break
  fi
  sleep 0.5
done
if [[ "$STATUS" != "SUCCESS" ]]; then
  echo "ERROR: workflow did not reach SUCCESS within 60s (last status: ${STATUS:-<none>})" >&2
  exit 1
fi

hr
echo "STEP J: final events + assertions"
hr
echo "FINAL EVENTS:"
print_events
echo
( cd "$BACKEND" && "$VENV_PY" "$ROOT/scripts/check_crash_result.py" "$WF_ID" "$OLD_PID" "$NEW_PID" "$BASE" )

hr
echo "CRASH-RESUME DEMO PASSED"
hr

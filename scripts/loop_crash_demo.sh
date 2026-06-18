#!/usr/bin/env bash
#
# Mid-LOOP crash-resume demo (P1.5a, prompt 3) — the cyclic analog of
# scripts/skeleton_crash_demo.sh. Proves the Engineer<->Reviewer cycle resumes
# MID-CYCLE across a kill -9 and keeps cycling to a single ship.
#
#   1. start uvicorn (process 1), POST a 3-node review_loop run with
#      TVASHTR_FORCE_REVISIONS=2 (Reviewer requests changes rounds 1 & 2, then
#      approves round 3 -> the Engineer runs exactly 3 times, BELOW the cap, so
#      no review-escalation fires).
#   2. wait until the Engineer's 2nd iteration has begun — detected by the
#      engineer_run_attempts row count reaching 2 (one row is inserted at the
#      START of each engineer_run_step, so 2 ⟺ iteration 1 completed, the
#      Reviewer returned changes_requested (a REAL loop-back), and iteration 2 is
#      now building). Then kill -9 process 1 mid agent-run.
#   3. restart uvicorn (process 2); DBOS recovers the in-flight run_team: it
#      replays the recorded Engineer-1 / Reviewer-1(changes_requested) /
#      Engineer-2-prefix, RE-RUNS the in-flight Engineer-2 agent step in the new
#      process, then CONTINUES the loop — Reviewer-2(changes_requested),
#      Engineer-3, Reviewer-3(approved) — and ships once.
#   4. run the checker: exactly-once-per-iteration durable state (Engineer
#      [1,2,3] done, Reviewer [changes_requested, changes_requested, approved],
#      3 agent-cost rows, one ship) + the keystone re-execution span
#      (EngineerRunAttempt pids OLD_PID -> NEW_PID, count > the no-crash 3).
#
# Opt-in (needs OPENROUTER_API_KEY); skips cleanly otherwise. Exits non-zero on
# any failed assertion or timeout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG1="/tmp/tvashtr_loop_crash_1.log"
LOG2="/tmp/tvashtr_loop_crash_2.log"

cd "$ROOT"

# Load .env so BOTH uvicorn processes inherit OPENROUTER_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Auto-approve the PRD gate so this deterministic crash demo doesn't block on a
# human (like skeleton-crash). At FORCE=2 the loop approves at round 3 BELOW the
# cap, so the review-escalation gate never fires — nothing else to auto-resolve.
# Exported -> inherited by both processes; the workflow reads it inside a recorded
# step, so the gate decision replays identically post-crash.
export TVASHTR_AUTO_APPROVE_GATES="${TVASHTR_AUTO_APPROVE_GATES:-1}"
# This is the LOCAL loop crash proof (orchestration, not containment) — pin local,
# exactly like skeleton_crash_demo.sh. (Docker-mode loop seeding is a §15 item.)
export TVASHTR_AGENT_SANDBOX=local
# Force two real loop-backs so the crash lands genuinely mid-cycle: Reviewer returns
# changes_requested for rounds 1 & 2, then approved at round 3 (Engineer x3, no cap
# trip). Read inside the recorded reviewer step, so the verdicts replay post-crash.
export TVASHTR_FORCE_REVISIONS="${TVASHTR_FORCE_REVISIONS:-2}"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "[loop-crash] OPENROUTER_API_KEY not set — skipping. (Not a failure.)"
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
attempt_count() {
  psql_c -At -c "select count(*) from engineer_run_attempts where run_id='$RUN_ID'" \
    | tr -d '[:space:]'
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
echo "STEP C/D: start uvicorn (process 1) + POST a review_loop run (FORCE_REVISIONS=$TVASHTR_FORCE_REVISIONS)"
hr
start_uvicorn "$LOG1"
OLD_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 1 PID = $OLD_PID  (healthy)"

RUN_ID="$(curl -sf -X POST "$BASE/api/runs" -H 'content-type: application/json' \
  -d '{"team_shape":"review_loop"}' \
  | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')"
WS="$BACKEND/.tvashtr_workspaces/$RUN_ID"
echo "started run_id = $RUN_ID"

hr
echo "STEP E: wait until the Engineer's 2nd iteration has begun (engineer_run_attempts >= 2)"
hr
# >= 2 attempt rows ⟺ iteration 1 finished, the Reviewer returned changes_requested (a real
# loop-back), and iteration 2 (or a later iteration) is now building — i.e. we are genuinely
# MID-CYCLE, not merely in a last build. One row is inserted at the START of each
# engineer_run_step (committed before the long agent call), so the row count is a reliable
# mid-cycle signal. The poll uses sleep 0.3 (was 1) so detection — and thus the immediate kill
# below — tends to land while iteration 2 is still in flight rather than after it loops to 3.
# (1000 x 0.3 = ~300s of polling budget: PM + Engineer-1 + Reviewer-1 + Engineer-2 start.)
ATTEMPTS=0
for _ in $(seq 1 1000); do
  ATTEMPTS="$(attempt_count || echo 0)"
  if [[ "${ATTEMPTS:-0}" -ge 2 ]]; then break; fi
  sleep 0.3
done
if [[ "${ATTEMPTS:-0}" -lt 2 ]]; then
  echo "ERROR: engineer_run_attempts never reached 2 — the loop did not cycle into iteration 2" >&2
  tail -n 25 "$LOG1" >&2
  exit 1
fi
echo "engineer_run_attempts == $ATTEMPTS  =>  iteration $ATTEMPTS has begun after $((ATTEMPTS - 1)) real loop-back(s) — genuinely mid-cycle"

hr
echo "STEP F: kill -9 process 1 mid-cycle, then assert the FROZEN crash-state (race-free)"
hr
# Kill FIRST, before reading any state. The original harness read the crash-state BETWEEN
# detection and the kill, so the still-running loop could finish iteration 2 and start
# iteration 3, racing the attempt count upward (the observed `got 3` abort). Here we kill the
# instant we are mid-cycle, wait for the process to die, THEN read: with process 1 dead and
# process 2 not yet started, the DB + workspace are frozen, so the assertions below cannot race.
echo "killed mid-cycle at engineer_run_attempts=$ATTEMPTS"
kill -9 "$OLD_PID"
while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.2; done
CURRENT_PID=""
echo ">>> killed uvicorn process 1 (PID $OLD_PID) <<<"

# Read the now-stable state ONCE (nothing is running that can advance it).
ATTEMPT_COUNT_AT_CRASH="$(attempt_count)"
DISTINCT_PIDS_AT_CRASH="$(psql_c -At -c "select distinct pid from engineer_run_attempts where run_id='$RUN_ID'" | tr -d '[:space:]')"
SHIP_AT_CRASH="$(git -C "$WS" tag --list "ship-$RUN_ID" 2>/dev/null || true)"
RUN_STATUS_AT_CRASH="$(psql_c -At -c "select status from runs where workflow_id='$RUN_ID'" | tr -d '[:space:]')"
echo "  frozen state: attempts=$ATTEMPT_COUNT_AT_CRASH  distinct_pids=$DISTINCT_PIDS_AT_CRASH  ship_tag='${SHIP_AT_CRASH:-<none>}'  run.status=$RUN_STATUS_AT_CRASH"
# Fail-closed: a genuine mid-cycle crash means >= 2 attempts (>= 1 real loop-back), all from the
# original process, nothing shipped, and the run NOT terminal. If the loop outran detection and
# shipped/finished before the kill, these abort non-zero — never a vacuous PASS.
[[ "${ATTEMPT_COUNT_AT_CRASH:-0}" -ge 2 ]] || { echo "ERROR: expected >= 2 engineer attempts at crash (>= 1 real loop-back), got $ATTEMPT_COUNT_AT_CRASH" >&2; exit 1; }
[[ "$DISTINCT_PIDS_AT_CRASH" == "$OLD_PID" ]] || { echo "ERROR: pre-crash attempts not all pid=$OLD_PID (distinct=$DISTINCT_PIDS_AT_CRASH)" >&2; exit 1; }
[[ -z "$SHIP_AT_CRASH" ]] || { echo "ERROR: already shipped before the kill — the loop outran detection" >&2; exit 1; }
case "$RUN_STATUS_AT_CRASH" in
  completed|failed|rejected|over_budget|cancelled)
    echo "ERROR: run reached terminal status '$RUN_STATUS_AT_CRASH' before the kill — the loop outran detection; failing closed" >&2
    exit 1
    ;;
esac
echo "  frozen crash-state OK: mid-cycle (>= 1 loop-back), all attempts pid=$OLD_PID, nothing shipped, run not terminal"

hr
echo "STEP H: restart uvicorn (process 2) — DBOS recovers the in-flight run_team"
hr
start_uvicorn "$LOG2"
NEW_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 2 PID = $NEW_PID  (healthy)"

hr
echo "STEP I: poll until the run completes in process 2 (timeout 480s — 3 Engineer iters + restart)"
hr
STATUS=""; RUN_ST=""
for _ in $(seq 1 120); do
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
  echo "ERROR: run did not complete within 480s (last: workflow=$STATUS run=$RUN_ST)" >&2
  exit 1
fi

hr
echo "STEP J: assertions"
hr
( cd "$BACKEND" && "$VENV_PY" "$ROOT/scripts/check_loop_crash.py" "$RUN_ID" "$OLD_PID" "$NEW_PID" "$BASE" )

hr
echo "LOOP MID-CYCLE CRASH-RESUME PASSED"
hr

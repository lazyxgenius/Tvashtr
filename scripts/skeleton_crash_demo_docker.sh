#!/usr/bin/env bash
#
# Skeleton crash-resume demo — DOCKER sandbox (P1.3b). The crash-resume proof over
# the CONTAINER: the coarse agent @DBOS.step now spans an agent-server container.
#
#   1. start uvicorn (process 1) in docker mode, POST a 2-node run (PM -> Engineer)
#   2. wait until the agent is mid-run (first run_event), then kill -9 process 1.
#      kill -9 skips DockerWorkspace.__exit__ -> the container is ORPHANED (--rm only
#      removes on a clean stop), still running, still holding its (ephemeral) port.
#   3. ASSERT at crash: an orphaned agent-server container EXISTS (proves kill -9
#      orphaned a real running container — the precondition for testing reaping).
#   4. restart uvicorn (process 2); its lifespan BOOT SWEEP reaps the orphan BEFORE
#      DBOS recovers the in-flight run_team; recovery re-runs the step, which starts
#      a FRESH container on a NEW (ephemeral) free port — no wait on the orphan's
#      ~30s host-port release (the whole point of P1.3b's ephemeral ports).
#   5. ASSERT after recovery: NO agent-server container remains (THE reaping proof
#      under ephemeral ports — see the note below).
#   6. durable-outcome assertions via check_skeleton_crash.py (UNCHANGED): exactly
#      one ship tag/commit, one PRD version, one agent-cost row, file matches, and
#      >= 2 engineer attempts with distinct pids (OLD_PID -> NEW_PID).
#
# WHY the explicit orphan assertions (and not just the exactly-once outcome): under
# EPHEMERAL ports the fresh container gets a DIFFERENT port than the orphan, so the
# run completes even if reaping silently failed (no port collision to block it).
# So exactly-once proves crash-resume + idempotent ship, but does NOT prove reaping.
# Reaping is proven ONLY by the explicit orphan assertions below (the docker CLI is
# at hand here; the Python checker can't observe the at-crash state post-hoc, so it
# stays mode-agnostic and unchanged).
#
# Opt-in: needs OPENROUTER_API_KEY + Docker + the agent-server image; skips cleanly
# without the key. Exits non-zero on any failed assertion or timeout. A few minutes,
# real (small) LLM spend. The LOCAL proof (`make skeleton-crash`) is a separate,
# byte-for-byte-unchanged script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG1="/tmp/tvashtr_skeleton_docker_1.log"
LOG2="/tmp/tvashtr_skeleton_docker_2.log"

cd "$ROOT"

# Load .env so BOTH uvicorn processes inherit OPENROUTER_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Run BOTH uvicorn processes in the DOCKER sandbox (the whole point of this demo) and
# auto-approve the P1.1a PRD gate so the deterministic crash demo doesn't block on a
# human. Exported -> inherited by both processes; the gate decision replays
# identically post-crash (read inside a recorded step).
export TVASHTR_AGENT_SANDBOX=docker
export TVASHTR_AUTO_APPROVE_GATES="${TVASHTR_AUTO_APPROVE_GATES:-1}"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "[skeleton-crash-docker] OPENROUTER_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

# Resolve the agent-server image from config (NOT a hardcoded literal) so the docker
# filters match exactly what the adapter/reaper target (ancestor=<image>).
IMAGE="$(cd "$BACKEND" && "$VENV_PY" -c 'from tvashtr.config import get_settings; print(get_settings().agent_server_image)')"
echo "[skeleton-crash-docker] agent-server image = $IMAGE"

CURRENT_PID=""
LAST_LOG="$LOG1"
cleanup() {
  if [[ -n "$CURRENT_PID" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    kill -9 "$CURRENT_PID" 2>/dev/null || true
  fi
  # Never leave an agent-server container behind, even if the demo failed mid-run.
  if [[ -n "${IMAGE:-}" ]]; then
    local leftover
    leftover="$(docker ps -aq --filter "ancestor=$IMAGE" 2>/dev/null || true)"
    if [[ -n "$leftover" ]]; then
      echo "[skeleton-crash-docker] cleanup: reaping leftover container(s): $leftover" >&2
      # shellcheck disable=SC2086
      docker rm -f $leftover >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }
psql_c() { docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" "$@"; }

# All agent-server containers (running or stopped) descended from the image.
running_containers() { docker ps -q --filter "ancestor=$IMAGE" 2>/dev/null || true; }
all_containers() { docker ps -aq --filter "ancestor=$IMAGE" 2>/dev/null || true; }
count_lines() { grep -c . 2>/dev/null || true; }

start_uvicorn() {
  LAST_LOG="$1"
  "$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" \
    --log-level warning >"$LAST_LOG" 2>&1 &
  CURRENT_PID=$!
}

wait_for_health() {
  # Wider than the local demo: in docker mode the lifespan BOOT SWEEP runs before
  # the app is ready (process 2 reaps the orphan first), so health can lag a beat.
  for _ in $(seq 1 120); do
    if ! kill -0 "$CURRENT_PID" 2>/dev/null; then
      echo "ERROR: uvicorn (pid $CURRENT_PID) exited early. Log tail:" >&2
      tail -n 25 "$LAST_LOG" >&2
      return 1
    fi
    if curl -sf "$BASE/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "ERROR: uvicorn did not become healthy within 60s" >&2
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
echo "STEP C/D: start uvicorn (process 1, docker mode) + POST a run"
hr
start_uvicorn "$LOG1"
OLD_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 1 PID = $OLD_PID  (healthy, TVASHTR_AGENT_SANDBOX=docker)"

RUN_ID="$(curl -sf -X POST "$BASE/api/runs" -H 'content-type: application/json' -d '{}' \
  | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')"
WS="$BACKEND/.tvashtr_workspaces/$RUN_ID"
echo "started run_id = $RUN_ID"

hr
echo "STEP E: wait until the agent is mid-run (first run_event appears)"
hr
# Wider than the local demo's 180s: docker adds the container bring-up (~3s) before
# the agent starts producing events.
EVENTS=0
for _ in $(seq 1 300); do
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
echo "agent is mid-run: $EVENTS run_event(s) recorded (container is up)"

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
echo "STEP G: kill -9 process 1 mid agent-run (orphans the running container)"
hr
kill -9 "$OLD_PID"
while kill -0 "$OLD_PID" 2>/dev/null; do sleep 0.2; done
CURRENT_PID=""
echo ">>> killed uvicorn process 1 (PID $OLD_PID) <<<"

hr
echo "STEP G2: ASSERT an orphaned agent-server container EXISTS at crash"
hr
ORPHAN_IDS="$(running_containers)"
N_ORPHANS="$(printf '%s\n' "$ORPHAN_IDS" | count_lines)"
echo "  running agent-server containers (ancestor=$IMAGE): ${ORPHAN_IDS//$'\n'/ }  (count=$N_ORPHANS)"
if [[ "${N_ORPHANS:-0}" -lt 1 ]]; then
  echo "ERROR: expected >= 1 ORPHANED agent-server container after kill -9, found $N_ORPHANS" >&2
  echo "       (kill -9 should have orphaned the running container — --rm only removes on a clean stop)" >&2
  exit 1
fi
echo "  OK: kill -9 orphaned a real running container (the precondition for testing reaping)"

hr
echo "STEP H: restart uvicorn (process 2) — boot sweep reaps the orphan, THEN DBOS recovers"
hr
start_uvicorn "$LOG2"
NEW_PID="$CURRENT_PID"
wait_for_health
echo "uvicorn process 2 PID = $NEW_PID  (healthy)"

hr
echo "STEP I: poll until the run completes in process 2 (timeout 600s — two bring-ups)"
hr
STATUS=""; RUN_ST=""
for _ in $(seq 1 150); do
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
  echo "ERROR: run did not complete within 600s (last: workflow=$STATUS run=$RUN_ST)" >&2
  exit 1
fi

hr
echo "STEP I2: ASSERT no agent-server container remains (THE reaping proof under ephemeral ports)"
hr
# Retry briefly: the fresh container's --rm teardown (docker stop) finalizes removal
# asynchronously, so allow a beat after completion before asserting empty.
REMAIN=""
for _ in $(seq 1 15); do
  REMAIN="$(all_containers)"
  [[ -z "$REMAIN" ]] && break
  sleep 2
done
if [[ -n "$REMAIN" ]]; then
  echo "ERROR: agent-server container(s) still present after recovery: ${REMAIN//$'\n'/ }" >&2
  echo "       (the boot sweep should have reaped the orphan, and the fresh container's --rm should have removed itself)" >&2
  exit 1
fi
echo "  OK: no agent-server container remains — orphan reaped + fresh container self-removed"

hr
echo "STEP I3 (report-only): confirm the BOOT SWEEP (not just reap-before-start) cleared the orphan"
hr
# The boot sweep runs in process 2's lifespan BEFORE DBOS recovery; it logs the
# warning below via docker_runtime.reap_agent_containers (captured at --log-level
# warning). In process 2 the orphan is reaped FIRST by the sweep, so this line being
# present nails the ordering. Report-only: never fails the demo.
SWEEP_LINES="$(grep -c "reaped .* orphaned agent-server container" "$LOG2" 2>/dev/null || true)"
echo "  process-2 boot-sweep reap lines in $LOG2 = ${SWEEP_LINES:-0}  (expect >= 1)"
grep -E "reaped .* orphaned agent-server container" "$LOG2" 2>/dev/null | sed 's/^/    /' || true

hr
echo "STEP J: durable-outcome assertions (check_skeleton_crash.py, UNCHANGED)"
hr
( cd "$BACKEND" && "$VENV_PY" "$ROOT/scripts/check_skeleton_crash.py" "$RUN_ID" "$OLD_PID" "$NEW_PID" "$BASE" )

hr
echo "SKELETON CRASH-RESUME (DOCKER) PASSED"
echo "  proved: orphan existed at crash -> boot sweep reaped it -> fresh container on a"
echo "          new ephemeral port -> shipped EXACTLY ONCE; no container left behind."
hr

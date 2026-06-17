#!/usr/bin/env bash
#
# Human-in-the-loop gate demo (P1.1a) — two live scenarios against a real backend.
#
# Scenario 1 — APPROVE:
#   POST a run -> it pauses at the PRD gate (run.status=awaiting_human + a pending
#   HumanTask) -> resolve {approve} -> the run resumes and ships exactly once
#   (run.status=completed, git tag ship-<run_id> exists).
#
# Scenario 2 — CANCEL-AT-GATE (the kill switch):
#   POST a run -> at the gate -> cancel -> assert workflow CANCELLED,
#   run.status=cancelled, no ship tag, no engineer attempt. Then (mirroring
#   skeleton-crash's real-process harness) kill -9 the backend and restart it:
#   DBOS recovery must NOT resurrect a CANCELLED run — it stays cancelled and
#   never ships. Cancel-at-gate is cheap: the agent never runs.
#
# Opt-in (needs OPENROUTER_API_KEY — the PM step is a real LLM call); skips cleanly
# otherwise. Exits non-zero on any failed assertion or timeout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG1="/tmp/tvashtr_hitl_1.log"
LOG2="/tmp/tvashtr_hitl_2.log"

cd "$ROOT"

# Load .env so the backend inherits OPENROUTER_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# This demo exercises the REAL gate — make sure auto-approve is OFF even if the
# caller's environment set it (skeleton-run/-crash turn it on; we must not).
unset TVASHTR_AUTO_APPROVE_GATES || true
# P1.3b part 3: default is docker; this orchestration demo doesn't need containment.
export TVASHTR_AGENT_SANDBOX=local

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "[hitl-demo] OPENROUTER_API_KEY not set — skipping. (Not a failure.)"
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

stop_uvicorn() {
  if [[ -n "$CURRENT_PID" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    kill -9 "$CURRENT_PID" 2>/dev/null || true
    while kill -0 "$CURRENT_PID" 2>/dev/null; do sleep 0.2; done
  fi
  CURRENT_PID=""
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

# --- JSON / state helpers (read through the real HTTP + SQL surfaces) ---
run_status() {
  curl -sf "$BASE/api/runs/$1" 2>/dev/null \
    | "$VENV_PY" -c 'import sys,json;b=json.load(sys.stdin);print((b.get("run") or {}).get("status") or "")' 2>/dev/null || echo ""
}
wf_status() {
  curl -sf "$BASE/api/runs/$1" 2>/dev/null \
    | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin).get("workflow_status") or "")' 2>/dev/null || echo ""
}
pending_task_id() {
  curl -sf "$BASE/api/runs/$1/tasks" 2>/dev/null \
    | "$VENV_PY" -c 'import sys,json;ts=[t for t in json.load(sys.stdin)["tasks"] if t["status"]=="pending"];print(ts[0]["id"] if ts else "")' 2>/dev/null || echo ""
}
ship_tag() {
  local ws="$BACKEND/.tvashtr_workspaces/$1"
  if [[ -d "$ws/.git" ]]; then git -C "$ws" tag --list "ship-$1" 2>/dev/null || true; fi
}
attempts_count() {
  psql_c -At -c "select count(*) from engineer_run_attempts where run_id='$1'" 2>/dev/null | tr -d '[:space:]'
}

wait_for_gate() {
  local rid="$1" st=""
  for _ in $(seq 1 180); do
    st="$(run_status "$rid")"
    if [[ "$st" == "awaiting_human" ]]; then return 0; fi
    if [[ "$st" == "failed" || "$st" == "completed" || "$st" == "rejected" ]]; then
      echo "ERROR: run $rid ended '$st' before reaching the gate" >&2; return 1
    fi
    sleep 2
  done
  echo "ERROR: run $rid did not reach the gate within 360s" >&2; return 1
}

post_run() {
  curl -sf -X POST "$BASE/api/runs" -H 'content-type: application/json' -d '{}' \
    | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["run_id"])'
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

start_uvicorn "$LOG1"
wait_for_health
echo "backend up (pid $CURRENT_PID)"

# =====================================================================
hr
echo "SCENARIO 1 — APPROVE: run pauses at the PRD gate, approve, then ships"
hr
RUN1="$(post_run)"
echo "started run_id = $RUN1"

wait_for_gate "$RUN1"
TASK1="$(pending_task_id "$RUN1")"
echo "  at gate: run.status=awaiting_human  pending_task_id=${TASK1:-<none>}"
[[ -n "$TASK1" ]] || { echo "ERROR: no pending HumanTask at the gate" >&2; exit 1; }
[[ -z "$(ship_tag "$RUN1")" ]] || { echo "ERROR: shipped before approval" >&2; exit 1; }

echo "  -> POST resolve {decision: approve}"
curl -sf -X POST "$BASE/api/runs/$RUN1/tasks/$TASK1/resolve" \
  -H 'content-type: application/json' -d '{"decision":"approve","note":"demo approve"}' >/dev/null

echo "  polling for the Engineer to build + ship (live OpenHands — be patient)…"
RUN1_ST=""
for _ in $(seq 1 120); do
  RUN1_ST="$(run_status "$RUN1")"
  echo "    run=${RUN1_ST:-<none>}"
  if [[ "$RUN1_ST" == "completed" ]]; then break; fi
  if [[ "$RUN1_ST" == "failed" || "$RUN1_ST" == "cancelled" || "$RUN1_ST" == "rejected" ]]; then
    echo "ERROR: run ended '$RUN1_ST' after approval" >&2; exit 1
  fi
  sleep 4
done
TAG1="$(ship_tag "$RUN1")"
echo "  final: run.status=$RUN1_ST  ship_tag='${TAG1:-<none>}'"
[[ "$RUN1_ST" == "completed" ]] || { echo "ERROR: run did not complete after approve" >&2; exit 1; }
[[ "$TAG1" == "ship-$RUN1" ]] || { echo "ERROR: expected ship tag ship-$RUN1, got '${TAG1:-<none>}'" >&2; exit 1; }
echo ">>> SCENARIO 1 PASSED: approve -> shipped exactly once (tag $TAG1) <<<"

# =====================================================================
hr
echo "SCENARIO 2 — CANCEL-AT-GATE: cancel at the gate, then prove no resurrection"
hr
RUN2="$(post_run)"
echo "started run_id = $RUN2"
wait_for_gate "$RUN2"
echo "  at gate: run.status=awaiting_human  wf=$(wf_status "$RUN2")"

echo "  -> POST cancel"
CANCEL_RESP="$(curl -sf -X POST "$BASE/api/runs/$RUN2/cancel" -H 'content-type: application/json')"
echo "  cancel response: $CANCEL_RESP"

WF2="$(wf_status "$RUN2")"; RST2="$(run_status "$RUN2")"; TAG2="$(ship_tag "$RUN2")"; ATT2="$(attempts_count "$RUN2")"
echo "  after cancel: wf=$WF2  run.status=$RST2  ship_tag='${TAG2:-<none>}'  engineer_attempts=$ATT2"
[[ "$WF2"  == "CANCELLED"  ]] || { echo "ERROR: workflow not CANCELLED (got $WF2)" >&2; exit 1; }
[[ "$RST2" == "cancelled"  ]] || { echo "ERROR: run.status not cancelled (got $RST2)" >&2; exit 1; }
[[ -z "$TAG2" ]] || { echo "ERROR: a cancelled run shipped (tag $TAG2)" >&2; exit 1; }
[[ "${ATT2:-0}" == "0" ]] || { echo "ERROR: engineer ran on a cancelled-at-gate run ($ATT2 attempts)" >&2; exit 1; }

hr
echo "STEP: kill -9 the backend and restart — DBOS recovery must NOT resume a CANCELLED run"
hr
stop_uvicorn
echo ">>> killed backend <<<"
start_uvicorn "$LOG2"
wait_for_health
echo "backend restarted (pid $CURRENT_PID); recovery has run on launch"

# Give any (erroneous) recovery a generous window to act, then assert nothing moved.
for _ in $(seq 1 8); do
  WF2="$(wf_status "$RUN2")"; RST2="$(run_status "$RUN2")"
  if [[ "$WF2" != "CANCELLED" || "$RST2" != "cancelled" ]]; then
    echo "ERROR: cancelled run changed after restart (wf=$WF2 run=$RST2)" >&2; exit 1
  fi
  sleep 2
done
TAG2="$(ship_tag "$RUN2")"; ATT2="$(attempts_count "$RUN2")"
echo "  post-restart (stable ~16s): wf=$WF2  run.status=$RST2  ship_tag='${TAG2:-<none>}'  engineer_attempts=$ATT2"
[[ -z "$TAG2" ]] || { echo "ERROR: cancelled run shipped after restart (tag $TAG2)" >&2; exit 1; }
[[ "${ATT2:-0}" == "0" ]] || { echo "ERROR: engineer ran after restart ($ATT2 attempts)" >&2; exit 1; }
echo ">>> SCENARIO 2 PASSED: cancel-at-gate stops the run AND is not resurrected <<<"

hr
echo "HITL DEMO PASSED (approve->ship + cancel-at-gate->no-resurrect)"
hr

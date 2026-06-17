#!/usr/bin/env bash
#
# Budget cost-cap demo (P1.2) — one live scenario against a real backend.
#
# BREACH -> AUTO-APPROVE -> SHIP:
#   Start a run with a *tiny* per-run cap (TVASHTR_DEMO_BUDGET_CAP) and
#   TVASHTR_AUTO_APPROVE_GATES=1. The PM completion is far too cheap to cross the
#   cap, so the pre-engineer checkpoint passes; the Engineer's agent run then
#   pushes accumulated spend over the cap, so the **pre-ship** budget checkpoint
#   fires, opens a `budget_approval` blocker, auto-approves it (= "continue to
#   completion"), records the override, and ships exactly once.
#
#   Asserts: a `budget_approval` HumanTask was created AND resolved (approved),
#   and the run shipped (run.status=completed, git tag ship-<run_id>).
#
# The cap default (1e-4) sits comfortably above any 400-token PM completion and
# below a typical gpt-4o-mini agent run, so the pre-ship checkpoint is the one
# that fires. Tune via TVASHTR_DEMO_BUDGET_CAP if your costs differ.
#
# Opt-in (needs OPENROUTER_API_KEY — PM + a live OpenHands agent run); skips
# cleanly otherwise. Exits non-zero on any failed assertion or timeout.
#
# NOTE: this is a LIVE target (real spend; the agent run is still unsandboxed) —
# it is OPERATOR-run, never run autonomously by the build loop.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
LOG="/tmp/tvashtr_budget.log"
BUDGET_CAP="${TVASHTR_DEMO_BUDGET_CAP:-0.0001}"

cd "$ROOT"

# Load .env so the backend inherits OPENROUTER_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# This demo wants gates auto-approved (the PRD gate AND the budget gate), so the
# breach resolves itself and the run ships without a human.
export TVASHTR_AUTO_APPROVE_GATES=1
# P1.3b part 3: default is docker; this budget demo tests orchestration, not containment.
export TVASHTR_AGENT_SANDBOX=local

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "[budget-demo] OPENROUTER_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

CURRENT_PID=""
cleanup() {
  if [[ -n "$CURRENT_PID" ]] && kill -0 "$CURRENT_PID" 2>/dev/null; then
    kill -9 "$CURRENT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

hr() { printf '%s\n' "============================================================"; }

start_uvicorn() {
  "$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" \
    --log-level warning >"$LOG" 2>&1 &
  CURRENT_PID=$!
}

wait_for_health() {
  for _ in $(seq 1 60); do
    if ! kill -0 "$CURRENT_PID" 2>/dev/null; then
      echo "ERROR: uvicorn (pid $CURRENT_PID) exited early. Log tail:" >&2
      tail -n 25 "$LOG" >&2
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
ship_tag() {
  local ws="$BACKEND/.tvashtr_workspaces/$1"
  if [[ -d "$ws/.git" ]]; then git -C "$ws" tag --list "ship-$1" 2>/dev/null || true; fi
}
# Print "<status>|<resolution>|<topic>" for the run's budget_approval task (empty if none).
budget_task() {
  curl -sf "$BASE/api/runs/$1/tasks" 2>/dev/null | "$VENV_PY" -c '
import sys, json
ts = [t for t in json.load(sys.stdin)["tasks"] if t["kind"] == "budget_approval"]
print("|".join([ts[0]["status"], ts[0]["resolution"], ts[0]["topic"]]) if ts else "")
' 2>/dev/null || echo ""
}
post_run() {
  curl -sf -X POST "$BASE/api/runs" -H 'content-type: application/json' \
    -d "{\"budget_cap_usd\": $BUDGET_CAP}" \
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

start_uvicorn
wait_for_health
echo "backend up (pid $CURRENT_PID), gates auto-approve, per-run cap = \$$BUDGET_CAP"

# =====================================================================
hr
echo "SCENARIO — breach at pre-ship -> auto-approve -> ship"
hr
RUN="$(post_run)"
echo "started run_id = $RUN  (budget_cap_usd = \$$BUDGET_CAP)"

echo "  polling (PM completion, the budget breach, then a live OpenHands agent — be patient)…"
RUN_ST=""
for _ in $(seq 1 150); do
  RUN_ST="$(run_status "$RUN")"
  echo "    run=${RUN_ST:-<none>}  budget_task=[$(budget_task "$RUN")]"
  if [[ "$RUN_ST" == "completed" ]]; then break; fi
  if [[ "$RUN_ST" == "failed" || "$RUN_ST" == "cancelled" || "$RUN_ST" == "rejected" || "$RUN_ST" == "over_budget" ]]; then
    echo "ERROR: run ended '$RUN_ST' instead of shipping" >&2; exit 1
  fi
  sleep 4
done

TAG="$(ship_tag "$RUN")"
BT="$(budget_task "$RUN")"
echo "  final: run.status=$RUN_ST  ship_tag='${TAG:-<none>}'  budget_task=[$BT]"

# Assertions.
[[ "$RUN_ST" == "completed" ]] || { echo "ERROR: run did not complete" >&2; exit 1; }
[[ "$TAG" == "ship-$RUN" ]] || { echo "ERROR: expected ship tag ship-$RUN, got '${TAG:-<none>}'" >&2; exit 1; }
[[ -n "$BT" ]] || { echo "ERROR: no budget_approval task was created (the cap never breached — lower TVASHTR_DEMO_BUDGET_CAP)" >&2; exit 1; }
BT_STATUS="${BT%%|*}"; BT_REST="${BT#*|}"; BT_RESOLUTION="${BT_REST%%|*}"; BT_TOPIC="${BT_REST#*|}"
[[ "$BT_STATUS" == "resolved" ]] || { echo "ERROR: budget task not resolved (status=$BT_STATUS)" >&2; exit 1; }
[[ "$BT_RESOLUTION" == "approved" ]] || { echo "ERROR: budget task not approved (resolution=$BT_RESOLUTION)" >&2; exit 1; }

hr
echo "BUDGET DEMO PASSED — budget_approval created + approved (topic: $BT_TOPIC); shipped once (tag $TAG)"
hr

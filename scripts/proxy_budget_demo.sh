#!/usr/bin/env bash
#
# P1.4b proxy budget-cutoff demo — the felt signal of this stretch.
#
# THE MID-LOOP CUTOFF: with the LiteLLM proxy ON and the agent in DOCKER mode, a run is
# started with a *tiny* per-run cap. The PM completion is far too cheap to cross it, so the
# pre-engineer budget gate passes and a per-run virtual key is minted with the REMAINING
# budget. The agent then runs INSIDE the container, its LLM calls flowing through the proxy
# under that key — and partway through its loop the proxy errors MID-CALL (the key's
# max_budget is crossed). The adapter classifies that budget error, the run finalizes
# `over_budget`, and NOTHING ships.
#
#   Asserts: run.status == over_budget; NO ship tag; and — the DISTINGUISHING assertion vs
#   `make budget-demo` — NO `budget_approval` HumanTask was ever created (proving the
#   *mid-loop proxy cutoff* stopped the agent, not P1.2's between-steps gate). Prints the
#   partial agent cost if one was recorded.
#
# The cap default (1e-3) sits ABOVE the ~$0 PM completion (OpenRouter-Llama prices $0 in
# litellm's static map) so the pre-engineer gate passes, and BELOW a full gpt-4o-mini agent
# run (~$0.0027 live in P1.4a) so `remaining` is exhausted DURING the agent's loop. If the
# cutoff lands before the agent starts or never fires, the cap is mis-tuned —
# tune TVASHTR_DEMO_BUDGET_CAP and note the working value.
#
# Opt-in: needs OPENROUTER_API_KEY + LITELLM_MASTER_KEY (matching the running proxy) + Docker
# + the proxy healthy. Skips cleanly (exit 0, NOT a failure) if any is absent.
#
# NOTE: a LIVE target — real spend UNTIL the cutoff; the agent runs in a real container —
# it is OPERATOR-run, never run autonomously by the build loop.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
BASE="http://127.0.0.1:${PORT}"
PROXY="http://127.0.0.1:4000"
LOG="/tmp/tvashtr_proxy_budget.log"
BUDGET_CAP="${TVASHTR_DEMO_BUDGET_CAP:-0.001}"

cd "$ROOT"

# Load .env so the backend (and the proxy, already up via compose) share OPENROUTER_API_KEY +
# LITELLM_MASTER_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# --- Preflight: skip cleanly (not a failure) if the live prerequisites are absent. ---
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "[proxy-budget-demo] OPENROUTER_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi
if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  echo "[proxy-budget-demo] LITELLM_MASTER_KEY not set — skipping. The proxy-enabled agent "
  echo "                    authenticates with this (it must MATCH the running proxy's key). (Not a failure.)"
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  echo "[proxy-budget-demo] Docker not available — skipping (docker mode needs it). (Not a failure.)"
  exit 0
fi

# The proxy enforces the per-run key budget mid-call; the agent reaches it (docker mode) at
# host.docker.internal. The mid-loop cutoff is the whole point — the PRD gate auto-approves.
export LITELLM_PROXY_ENABLED=1
export TVASHTR_AGENT_SANDBOX=docker
export TVASHTR_AUTO_APPROVE_GATES=1

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

# --- JSON / state helpers (read through the real HTTP + git surfaces) ---
run_status() {
  curl -sf "$BASE/api/runs/$1" 2>/dev/null \
    | "$VENV_PY" -c 'import sys,json;b=json.load(sys.stdin);print((b.get("run") or {}).get("status") or "")' 2>/dev/null || echo ""
}
run_cost() {
  curl -sf "$BASE/api/runs/$1" 2>/dev/null \
    | "$VENV_PY" -c 'import sys,json;b=json.load(sys.stdin);print((b.get("run") or {}).get("cost_total_usd") or "")' 2>/dev/null || echo ""
}
ship_tag() {
  local ws="$BACKEND/.tvashtr_workspaces/$1"
  if [[ -d "$ws/.git" ]]; then git -C "$ws" tag --list "ship-$1" 2>/dev/null || true; fi
}
# Count the run's budget_approval HumanTasks (the between-steps gate's signature; must be 0).
budget_task_count() {
  curl -sf "$BASE/api/runs/$1/tasks" 2>/dev/null | "$VENV_PY" -c '
import sys, json
print(sum(1 for t in json.load(sys.stdin)["tasks"] if t["kind"] == "budget_approval"))
' 2>/dev/null || echo "0"
}
post_run() {
  curl -sf -X POST "$BASE/api/runs" -H 'content-type: application/json' \
    -d "{\"budget_cap_usd\": $BUDGET_CAP}" \
    | "$VENV_PY" -c 'import sys,json;print(json.load(sys.stdin)["run_id"])'
}

hr
echo "STEP A/B: bring up Postgres + the LiteLLM proxy, run migrations"
hr
docker compose up -d
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    echo "postgres ready"; break
  fi
  sleep 1
done
# The proxy must be reachable from the host (the agent reaches it from inside the container
# via host.docker.internal — proven by `make proxy-smoke`).
PROXY_OK=""
for _ in $(seq 1 30); do
  if curl -sf "$PROXY/health/liveliness" >/dev/null 2>&1; then PROXY_OK=1; break; fi
  sleep 1
done
if [[ -z "$PROXY_OK" ]]; then
  echo "[proxy-budget-demo] proxy not healthy at $PROXY/health/liveliness — skipping. Bring it"
  echo "                    up with 'make db-up' (or 'docker compose up -d') and retry. (Not a failure.)"
  exit 0
fi
echo "proxy healthy at $PROXY"
( cd "$BACKEND" && uv run alembic upgrade head )

start_uvicorn
wait_for_health
echo "backend up (pid $CURRENT_PID), proxy ON, docker sandbox, gates auto-approve, per-run cap = \$$BUDGET_CAP"

# =====================================================================
hr
echo "SCENARIO — mid-loop proxy cutoff -> over_budget (no ship, no budget_approval task)"
hr
RUN="$(post_run)"
echo "started run_id = $RUN  (budget_cap_usd = \$$BUDGET_CAP)"

echo "  polling (PM, then the containerized agent runs through the proxy until the cutoff — be patient;"
echo "   the first run pulls the agent-server image, and once the budget trips the agent client"
echo "   retries the 429 a few times with backoff before the run finalizes over_budget)…"
RUN_ST=""
for _ in $(seq 1 150); do
  RUN_ST="$(run_status "$RUN")"
  echo "    run=${RUN_ST:-<none>}  budget_tasks=$(budget_task_count "$RUN")"
  if [[ "$RUN_ST" == "over_budget" ]]; then break; fi
  if [[ "$RUN_ST" == "completed" ]]; then
    echo "ERROR: run COMPLETED instead of hitting the cutoff — the cap is too high; lower TVASHTR_DEMO_BUDGET_CAP." >&2
    exit 1
  fi
  if [[ "$RUN_ST" == "failed" || "$RUN_ST" == "cancelled" || "$RUN_ST" == "rejected" ]]; then
    echo "ERROR: run ended '$RUN_ST' (expected over_budget). See $LOG." >&2; exit 1
  fi
  sleep 4
done

TAG="$(ship_tag "$RUN")"
BT_COUNT="$(budget_task_count "$RUN")"
COST="$(run_cost "$RUN")"
echo "  final: run.status=$RUN_ST  ship_tag='${TAG:-<none>}'  budget_tasks=$BT_COUNT  cost_total_usd=${COST:-<none>}"

# Assertions.
[[ "$RUN_ST" == "over_budget" ]] || { echo "ERROR: run did not reach over_budget (got '${RUN_ST:-<none>}')" >&2; exit 1; }
[[ -z "$TAG" ]] || { echo "ERROR: a ship tag exists ('$TAG') — the run shipped despite the cutoff" >&2; exit 1; }
[[ "$BT_COUNT" == "0" ]] || { echo "ERROR: $BT_COUNT budget_approval task(s) created — the between-steps gate fired, not the proxy cutoff" >&2; exit 1; }

hr
echo "PROXY BUDGET DEMO PASSED — mid-loop proxy cutoff: over_budget, nothing shipped, and NO"
echo "budget_approval task (the agent's loop was cut off MID-CALL by the proxy). partial cost=\$${COST:-0}"
hr

#!/usr/bin/env bash
#
# Live M-memory S5a Memory-shelf E2E — the account Memory shelf's six acceptance checks, driven end
# to end in a real browser:
#
#   1. add an Account-tier fact via the form -> it renders with its polarity badge;
#   2. pin it -> the pin persists across a reload;
#   3. edit its text -> the edit persists across a reload;
#   4. toggle review mode ON -> the switch stays ON across a reload;
#   5. a SEEDED pending fact shows in the inbox -> Confirm moves it into the live facts;
#   6. delete a fact -> it is gone.
#
# Orchestration mirrors scripts/accounts_e2e.sh (Postgres + migrate + seed the operator + a real
# backend on the LOCAL sandbox + Vite + a headless Playwright run). NO agent run is driven, so it
# needs NO NVIDIA/DEEPSEEK key. It DOES exercise POST /api/memories, which embeds — so the seeded
# operator needs an OpenAI key (the seed imports the .env OPENAI_API_KEY into the operator's
# provider_credentials). The single pending fact for check 5 is seeded directly below.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"
BASE="http://127.0.0.1:${PORT}"
BACKEND_LOG="/tmp/tvashtr_memory_backend.log"
VITE_LOG="/tmp/tvashtr_memory_vite.log"
SHOTS_DIR="${TVASHTR_MEMORY_SHELF_SHOTS_DIR:-/tmp/tvashtr_memory_shots}"

cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  # Defensive load: export only well-formed KEY=VALUE lines whose key is a valid shell identifier,
  # skipping comments/blanks and header-style keys (e.g. `x-api-key=…`) that would break `source`.
  while IFS= read -r _line || [[ -n "$_line" ]]; do
    [[ "$_line" =~ ^[[:space:]]*# ]] && continue
    [[ "$_line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    _key="${_line%%=*}"
    _val="${_line#*=}"
    _val="${_val%\"}" && _val="${_val#\"}"
    _val="${_val%\'}" && _val="${_val#\'}"
    export "$_key=$_val"
  done <"$ROOT/.env"
fi

export TVASHTR_AGENT_SANDBOX=local
# The email/password sign-in this spec drives exists only in the self-hosted posture; .env may
# set TVASHTR_HOSTED_MODE=true, so pin it off for this backend.
export TVASHTR_HOSTED_MODE=false
export TVASHTR_MEMORY_SHELF_SHOTS_DIR="$SHOTS_DIR"
export TVASHTR_SEED_EMAIL="${TVASHTR_SEED_EMAIL:-operator@tvashtr.local}"
export TVASHTR_SEED_PASSWORD="${TVASHTR_SEED_PASSWORD:-tvashtr-dev}"

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "WARNING: OPENAI_API_KEY is not set — POST /api/memories embeds will 502 and check 1 will fail." >&2
fi

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
echo "STEP B2: seed the operator account (imports the .env OpenAI key for embeds)"
hr
( cd "$BACKEND" && uv run python -m tvashtr.seed )

hr
echo "STEP B3: reset review-mode OFF + seed ONE pending fact for the operator (deterministic check 5)"
hr
( cd "$BACKEND" && uv run python - <<'PY'
import os

from sqlalchemy import delete, select

from tvashtr.db import session_scope
from tvashtr.models import NodeMemory, User

email = os.environ.get("TVASHTR_SEED_EMAIL", "operator@tvashtr.local").strip().lower()
PENDING = "e2e-seeded pending fact awaiting review"
emb = [0.0] * 1536
emb[7] = 1.0  # a distinct unit vector — matches nothing active, so promote just activates it
with session_scope() as session:
    user = session.execute(select(User).where(User.email == email)).scalar_one()
    user.memory_review_mode = False
    session.execute(
        delete(NodeMemory).where(NodeMemory.owner_id == user.id, NodeMemory.content == PENDING)
    )
    session.add(
        NodeMemory(
            owner_id=user.id,
            content=PENDING,
            polarity="prefer",
            repo_key=None,
            node_id=None,
            status="pending_review",
            embedding=emb,
            confirmation_count=1,
        )
    )
print("[memory-e2e] reset review-mode OFF + seeded a pending fact for", email)
PY
)

hr
echo "STEP C: start the backend (LOCAL sandbox)"
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
echo "backend up (pid $BACKEND_PID)"

hr
echo "STEP D: start the Vite dev server"
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
echo "STEP F: run the memory-shelf Playwright spec (a screenshot per check)"
hr
cd "$FRONTEND"
set +e
TVASHTR_E2E_BASE_URL="http://127.0.0.1:${VITE_PORT}" npx playwright test e2e/memory_shelf.spec.ts
PW_EXIT=$?
set -e

hr
if [[ "$PW_EXIT" == "0" ]]; then
  echo "MEMORY SHELF E2E PASSED (add -> pin -> edit -> review-toggle -> confirm-pending -> delete)"
  echo "screenshots:"
  ls -la "$SHOTS_DIR"/*.png 2>/dev/null || echo "  (no screenshots found in $SHOTS_DIR)"
else
  echo "MEMORY SHELF E2E FAILED (exit $PW_EXIT)"
fi
hr
exit "$PW_EXIT"

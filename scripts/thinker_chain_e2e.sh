#!/usr/bin/env bash
#
# Live P1.8c thinker-chain E2E — the non-start thinker, end to end with real models.
#
#   Instantiate the thinker_chain library team (PM → Architect → prd_gate → Engineer → ship),
#   launch a run on a clone of it, and assert the SECOND thinker (the Architect — a non-start
#   completion node, the residue this milestone unblocks) genuinely ran: the run ships exactly once
#   AND the spec document has 2 versions (PM v1 + the Architect's refined v2). The structural
#   2-versions proof is robust — it does NOT depend on an LLM echoing a sentinel.
#
# API-driven via the in-process TestClient (scripts/thinker_chain_check.py), so no Vite/Playwright:
# Postgres + migrate + the checker. Thinkers (PM + Architect) run on DEFAULT_MODEL; the Engineer
# worker runs on the real NIM agent (TVASHTR_AGENT_MODEL). Gates AUTO-APPROVE and the sandbox is
# LOCAL, so the run is hands-off. Needs NVIDIA_BUILD_API_KEY; skips otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"

cd "$ROOT"

# Load .env so the backend + the checker inherit DATABASE_URL + DEFAULT_MODEL + TVASHTR_AGENT_MODEL +
# NVIDIA_BUILD_API_KEY.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Hands-off, local sandbox (an executor proof, not a containment or HitL proof): auto-approve the
# PRD gate so the run ships straight through (linear, no review loop).
export TVASHTR_AGENT_SANDBOX=local
export TVASHTR_AUTO_APPROVE_GATES=1

if [[ -z "${NVIDIA_BUILD_API_KEY:-}" ]]; then
  echo "[thinker-chain-e2e] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)"
  exit 0
fi

PG_USER="${POSTGRES_USER:-tvashtr}"
PG_DB="${POSTGRES_DB:-tvashtr}"

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
echo "STEP C: run the live thinker-chain checker (real PM + Architect + Engineer, LOCAL sandbox)"
hr
cd "$BACKEND"
uv run python ../scripts/thinker_chain_check.py
CHECK_EXIT=$?

hr
if [[ "$CHECK_EXIT" == "0" ]]; then
  echo "THINKER-CHAIN E2E PASSED (the non-start Architect refined the spec; shipped once; 2 versions)"
else
  echo "THINKER-CHAIN E2E FAILED (exit $CHECK_EXIT)"
fi
hr
exit "$CHECK_EXIT"

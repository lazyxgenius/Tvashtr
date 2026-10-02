#!/usr/bin/env bash
#
# M10 Start-from-a-run E2E (brief §4 M10, ruling R9): the seeded operator (+ its .env provider keys
# and the GitHub installation fixture, as `make demo-proof` seeds them), then scripts/compare_e2e.sh's
# stack (HOSTED mode, LOCAL sandbox, the Reviewer forced to approve round 1, no global auto-approve)
# driving frontend/e2e/start-from.spec.ts: a real run on a real GitHub repo to a pull request, then
# "Start the next run from this" → the carried context in the new run → its run log. Needs
# GITHUB_APP_* (skips cleanly without the App, as demo-proof does).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then set -a; . "$ROOT/.env"; set +a; fi
if [[ -z "${GITHUB_APP_ID:-}" ]]; then
  echo "[start-from-e2e] GITHUB_APP_ID not set — skipping (no GitHub App). (Not a failure.)"
  exit 0
fi
# Postgres first (compare_e2e.sh brings it up too, but the seed below needs it now).
PG_CONTAINER="${PG_CONTAINER:-tvashtr-postgres}"
if ! docker exec "$PG_CONTAINER" pg_isready -U "${POSTGRES_USER:-tvashtr}" >/dev/null 2>&1; then
  ( cd "$ROOT" && docker compose up -d )
  for _ in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U "${POSTGRES_USER:-tvashtr}" >/dev/null 2>&1 && break
    sleep 1
  done
fi
( cd "$ROOT/backend" && uv run alembic upgrade head >/dev/null )
# The operator, its .env keys and the GitHub installation fixture. Exit 2 is demo-proof's own
# provider bar (>= 2 keys incl. nvidia_nim), which this spec doesn't need: a warning here.
set +e
( cd "$ROOT/backend" && uv run python ../scripts/demo_proof_seed.py )
seed_rc=$?
set -e
if [[ "$seed_rc" == "2" ]]; then
  echo "[start-from-e2e] (demo-proof's provider bar not met — not needed here; carrying on)"
elif [[ "$seed_rc" != "0" ]]; then
  echo "[start-from-e2e] seed failed (exit $seed_rc)"; exit "$seed_rc"
fi
export TVASHTR_HOSTED_MODE=true

export TVASHTR_COMPARE_SHOTS_DIR="${TVASHTR_COMPARE_SHOTS_DIR:-/tmp/tvashtr_start_from_shots}"
PORT="${PORT:-8021}" VITE_PORT="${VITE_PORT:-5194}" SPEC=e2e/start-from.spec.ts E2E_NAME="START-FROM E2E" \
  PASSED_LINE="a run to a pull request → Start the next run from this → carried context → the run log" \
  exec "$ROOT/scripts/compare_e2e.sh"

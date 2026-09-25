#!/usr/bin/env bash
#
# M-proof — ONE harness, three legs. `scripts/demo_proof.sh <local|prod|login>`.
#
#   local  Brings up Postgres + migrations + `make seed` + the GithubInstallation fixture, starts a
#          backend in HOSTED mode on the LOCAL sandbox and a Vite dev server, then drives
#          frontend/e2e/demo-proof.spec.ts (checks C1-C12) against it. Real GitHub clone, real PR;
#          no Fly microVM, so it is minutes and cents. Gates are approved by CLICKING the real
#          Approve button and the Reviewer's verdict is never forced -- TVASHTR_AUTO_APPROVE_GATES
#          and TVASHTR_FORCE_REVISIONS are explicitly unset even if .env sets them.
#   prod   Drives the SAME spec against $TVASHTR_DEPLOY_URL using the session captured by `login`.
#          Mutates no prod configuration: no installation rows, no provider keys.
#   login  A one-off HEADED browser at $TVASHTR_DEPLOY_URL. The operator finishes the GitHub OAuth
#          by hand; Playwright saves the resulting session to a GITIGNORED storageState file. The
#          prod account was created through the OAuth callback and carries
#          auth.UNUSABLE_PASSWORD_HASH, so /api/auth/login can never succeed for it -- this is the
#          only honest way in, and github.com's own login form is never automated.
#
# Exit codes: 0 pass (or a clean skip), 2 NEEDS_HUMAN (a §6 stop condition), 1 failure.
# These targets are PERMANENT. They are not part of `make test` (live credentials, real spend).
set -uo pipefail

LEG="${1:-local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV_PY="$BACKEND/.venv/bin/python"
PORT="${PORT:-8003}"
VITE_PORT="${VITE_PORT:-5176}"
BACKEND_LOG="/tmp/tvashtr_demo_proof_backend.log"
VITE_LOG="/tmp/tvashtr_demo_proof_vite.log"
SESSION_FILE="${TVASHTR_PROOF_STORAGE_STATE:-$ROOT/.playwright/prod-session.json}"

cd "$ROOT"

# Load .env, skipping any line whose key is not a valid shell identifier (the `x-api-key=` line
# would otherwise abort a plain `source` -- registered in PROJECTPLAN §15).
#
# Via a temp FILE, deliberately: `source <(grep ...)` silently sources NOTHING under some sandboxed
# shells (process substitution's /dev/fd is unreadable there), which reads as "no credentials" and
# turns a real failure into a clean skip. A temp file has no such dependency.
if [[ -f "$ROOT/.env" ]]; then
  _env_filtered="$(mktemp)"
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ROOT/.env" > "$_env_filtered"
  set -a
  # shellcheck disable=SC1090
  . "$_env_filtered"
  set +a
  rm -f "$_env_filtered"
fi

DEPLOY_URL="${TVASHTR_DEPLOY_URL:-https://tvashtr.fly.dev}"
export TVASHTR_PROOF_LEG="$LEG"
export TVASHTR_PROOF_REPO="${TVASHTR_PROOF_REPO:-lazyxgenius/trade_mcp}"
export TVASHTR_PROOF_STORAGE_STATE="$SESSION_FILE"
export TVASHTR_PROOF_SHOTS_DIR="${TVASHTR_PROOF_SHOTS_DIR:-$ROOT/artifacts/demo-proof/$LEG}"

hr() { printf '%s\n' "============================================================"; }
skip() { echo "[demo-proof:$LEG] skipped: $1 (Not a failure.)"; exit 0; }
stop() { echo; echo "NEEDS_HUMAN: $1"; exit 2; }

BACKEND_PID=""
VITE_PID=""
cleanup() {
  [[ -n "$VITE_PID" ]] && kill -9 "$VITE_PID" 2>/dev/null
  [[ -n "$BACKEND_PID" ]] && kill -9 "$BACKEND_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

# Playwright's chromium, idempotently (all three legs need it).
ensure_browser() { ( cd "$FRONTEND" && npx playwright install chromium >/dev/null ); }

# Run the shared spec. $1 = base URL, remaining args go to `playwright test`.
run_spec() {
  local base="$1"; shift
  mkdir -p "$TVASHTR_PROOF_SHOTS_DIR"
  cd "$FRONTEND"
  TVASHTR_E2E_BASE_URL="$base" npx playwright test e2e/demo-proof.spec.ts "$@" 2>&1 | tee /tmp/tvashtr_demo_proof_pw.log
  local rc="${PIPESTATUS[0]}"
  cd "$ROOT"
  if grep -q '^NEEDS_HUMAN: ' /tmp/tvashtr_demo_proof_pw.log; then
    hr
    grep -m1 '^NEEDS_HUMAN: ' /tmp/tvashtr_demo_proof_pw.log
    hr
    return 2
  fi
  return "$rc"
}

case "$LEG" in
  login)
    hr; echo "M-proof LOGIN: capture a prod session for $DEPLOY_URL (HEADED browser)"; hr
    ensure_browser
    run_spec "$DEPLOY_URL" --headed --workers=1
    rc=$?
    if [[ "$rc" == "0" ]]; then
      hr; echo "PROD SESSION SAVED -> $SESSION_FILE (gitignored; never printed, never committed)"
      echo "Now run: make demo-proof-prod"; hr
    else
      hr; echo "LOGIN LEG FAILED (exit $rc) — the session was NOT saved."; hr
    fi
    exit "$rc"
    ;;

  prod)
    hr; echo "M-proof PROD leg: C1-C12 against $DEPLOY_URL"; hr
    [[ -f "$SESSION_FILE" ]] || stop \
      "no prod session file at $SESSION_FILE — run \`make demo-proof-login\`, complete the GitHub sign-in in the browser it opens, then re-run \`make demo-proof-prod\`. Do NOT substitute a password: the prod account was created through the OAuth callback and holds auth.UNUSABLE_PASSWORD_HASH, so /api/auth/login can never succeed for it."
    ensure_browser
    run_spec "$DEPLOY_URL"
    rc=$?
    hr
    if [[ "$rc" == "0" ]]; then
      echo "DEMO-PROOF PROD PASSED — C1-C12 green against $DEPLOY_URL (real PR echoed above)"
      ls -la "$TVASHTR_PROOF_SHOTS_DIR"/*.png 2>/dev/null
    else
      echo "DEMO-PROOF PROD FAILED (exit $rc)"
    fi
    hr
    exit "$rc"
    ;;

  local) ;;
  *) echo "usage: $0 <local|prod|login>" >&2; exit 64 ;;
esac

# ------------------------------- the LOCAL leg -------------------------------
for v in GITHUB_APP_ID GITHUB_APP_CLIENT_ID GITHUB_APP_CLIENT_SECRET GITHUB_APP_PRIVATE_KEY_B64; do
  [[ -n "${!v:-}" ]] || skip "$v is not set in .env — the hosted repo picker and the PR need the GitHub App"
done

# Hosted posture (the composer's GitHub repo picker) on the cheap LOCAL sandbox. Gates are
# approved by a real click and the Reviewer runs for real: unset both harness short-circuits.
export TVASHTR_HOSTED_MODE=true
export TVASHTR_AGENT_SANDBOX=local
unset TVASHTR_AUTO_APPROVE_GATES
unset TVASHTR_FORCE_REVISIONS

hr; echo "STEP A/B: Postgres up + migrations"; hr
PG_CONTAINER="${PG_CONTAINER:-tvashtr-postgres}"
PG_USER="${POSTGRES_USER:-tvashtr}"
if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
  echo "postgres already up (container $PG_CONTAINER)"
else
  docker compose up -d || skip "docker compose could not start Postgres"
  for _ in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1 && { echo "postgres ready"; break; }
    sleep 1
  done
fi
( cd "$BACKEND" && uv run alembic upgrade head ) || exit 1

hr; echo "STEP C: seed the operator, its .env provider keys, and the GitHub installation fixture"; hr
( cd "$BACKEND" && uv run python ../scripts/demo_proof_seed.py )
seed_rc=$?
if [[ "$seed_rc" == "2" ]]; then
  stop "the seeded operator does not clear the C2 provider bar — see the [demo-proof-seed] line above."
elif [[ "$seed_rc" != "0" ]]; then
  echo "seed pre-flight failed (exit $seed_rc)"; exit "$seed_rc"
fi

hr; echo "STEP D: backend on :$PORT (HOSTED mode, LOCAL sandbox, NO auto-approve, NO forced revisions)"; hr
"$VENV_PY" -m uvicorn tvashtr.main:app --host 127.0.0.1 --port "$PORT" --log-level warning \
  >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
for _ in $(seq 1 90); do
  kill -0 "$BACKEND_PID" 2>/dev/null || { echo "ERROR: backend exited early:" >&2; tail -n 30 "$BACKEND_LOG" >&2; exit 1; }
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$PORT/health" >/dev/null || { echo "ERROR: backend not healthy" >&2; tail -n 30 "$BACKEND_LOG" >&2; exit 1; }
echo "backend up (pid $BACKEND_PID) on :$PORT"

hr; echo "STEP E: Vite on :$VITE_PORT (proxying /api -> :$PORT)"; hr
( cd "$FRONTEND" && TVASHTR_API_PROXY_TARGET="http://127.0.0.1:$PORT" \
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$VITE_PORT" --strictPort ) >"$VITE_LOG" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$VITE_PID" 2>/dev/null || { echo "ERROR: vite exited early:" >&2; tail -n 30 "$VITE_LOG" >&2; exit 1; }
  curl -sf "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$VITE_PORT/" >/dev/null || { echo "ERROR: vite not serving" >&2; exit 1; }
echo "vite up (pid $VITE_PID) on :$VITE_PORT"

hr; echo "STEP F: drive C1-C12 in a real browser"; hr
ensure_browser
run_spec "http://127.0.0.1:$VITE_PORT"
rc=$?
hr
if [[ "$rc" == "0" ]]; then
  echo "DEMO-PROOF LOCAL PASSED — C1-C12 green (real PR echoed above)"
  ls -la "$TVASHTR_PROOF_SHOTS_DIR"/*.png 2>/dev/null
else
  echo "DEMO-PROOF LOCAL FAILED (exit $rc). Backend log tail:"
  tail -n 30 "$BACKEND_LOG"
fi
hr
exit "$rc"

#!/usr/bin/env bash
#
# M9 Task set E2E (brief §4 M9, rulings R11, R12): scripts/compare_e2e.sh's stack (LOCAL sandbox,
# reviewer round 1 forced Approved, no global auto-approve) driving frontend/e2e/task-set.spec.ts: a
# task set of two tasks made in the Task sets tab, then v1 vs v2 compared on it — four runs, each
# followed by its hidden check — the set table and the cards read back, nothing ships. Then R11 on the
# live database: the checks' marker appears in NO table but `task_set_items` (where the command is
# kept) and `hidden_check_results` (its own output) — not in runs, run events, invocations, documents,
# memories, compares or DBOS's recorded step outputs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TVASHTR_HIDDEN_MARKER="TVHIDDEN_$(date +%s)"
export TVASHTR_COMPARE_SHOTS_DIR="${TVASHTR_COMPARE_SHOTS_DIR:-/tmp/tvashtr_task_set_shots}"
rm -f "$TVASHTR_COMPARE_SHOTS_DIR/run_ids.txt"

PORT="${PORT:-8020}" VITE_PORT="${VITE_PORT:-5193}" SPEC=e2e/task-set.spec.ts E2E_NAME="TASK SET E2E" \
  PASSED_LINE="a set of two → v1 vs v2 → four runs, each hidden check → set table → cards; no PR" \
  "$ROOT/scripts/compare_e2e.sh" | tee /tmp/tvashtr_task_set_e2e.log
[[ "${PIPESTATUS[0]}" == "0" ]] || exit 1
grep -q "^TASK SET E2E PASSED" /tmp/tvashtr_task_set_e2e.log || exit 0  # skipped (no key)

if [[ -f "$ROOT/.env" ]]; then set -a; . "$ROOT/.env"; set +a; fi
DB="${DATABASE_URL##*/}"; DB="${DB%%\?*}"
echo "R11: looking for ${TVASHTR_HIDDEN_MARKER} in every table of ${DB}"
HITS="$(docker exec "${PG_CONTAINER:-tvashtr-postgres}" pg_dump -U "${POSTGRES_USER:-tvashtr}" -d "$DB" --data-only \
  | awk -v m="$TVASHTR_HIDDEN_MARKER" '/^COPY /{t=$2} index($0,m){print t}' | sort | uniq -c)"
echo "${HITS:-  (none)}"
BAD="$(echo "$HITS" | awk '$2 != "public.task_set_items" && $2 != "public.hidden_check_results" && NF {print}')"
if [[ -n "$BAD" ]]; then
  echo "TASK SET E2E FAILED: R11 — the hidden check reached a table an agent can read:"; echo "$BAD"; exit 1
fi
echo "$HITS" | grep -q "public.task_set_items" || { echo "TASK SET E2E FAILED: the marker isn't in task_set_items (scan broken?)"; exit 1; }
echo "R11 PASSED: the hidden checks live only in task_set_items and hidden_check_results"

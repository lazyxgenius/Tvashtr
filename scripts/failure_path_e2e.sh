#!/usr/bin/env bash
#
# M11 Failure path E2E (brief §4 M11, ruling R13): scripts/compare_e2e.sh's stack (HOSTED mode, LOCAL
# sandbox) driving frontend/e2e/failure-path.spec.ts — a review_loop team whose Engineer has a
# failure path to a gate "Ask me what to do" → Stop; the Engineer's round 1 fails at once (the
# forced-failure harness, no LLM call), and the run takes the path instead of failing. The PM runs on
# a real model: TVASHTR_E2E_PROVIDER / TVASHTR_E2E_MODEL (default deepseek/deepseek-chat).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TVASHTR_COMPARE_SHOTS_DIR="${TVASHTR_COMPARE_SHOTS_DIR:-/tmp/tvashtr_failure_path_shots}"
export TVASHTR_E2E_PROVIDER="${TVASHTR_E2E_PROVIDER:-deepseek}"
export TVASHTR_E2E_MODEL="${TVASHTR_E2E_MODEL:-deepseek/deepseek-chat}"
export TVASHTR_FORCE_FAIL_ROLE=engineer TVASHTR_FORCE_FAIL_ROUND=1 KEEP_FORCED_FAILURE=1
PORT="${PORT:-8022}" VITE_PORT="${VITE_PORT:-5195}" SPEC=e2e/failure-path.spec.ts E2E_NAME="FAILURE-PATH E2E" \
  PASSED_LINE="the Engineer fails → its failure path → Ask me what to do (Needs you) → Stop, never Failed" \
  exec "$ROOT/scripts/compare_e2e.sh"

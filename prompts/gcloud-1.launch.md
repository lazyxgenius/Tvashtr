# Launch package — Google Cloud 1 (handed to the operator by Tvashtr Sidechat-28, 2026-11-01)

Brief: `prompts/gcloud-1.md`. Main checkout, auto mode, one session (Claude Pro plan). Runs BEFORE Models 1.
Builds on a new branch `feat/gcloud-1` — nothing ships.

## 0. Before you start
- Terminal: `cd /Users/adimac/Desktop/Tvashtr && git config --get remote.origin.pushurl && git rev-parse --short HEAD`
  → `DISABLED-no-push-during-video-work` and `52986900`.
- Docker Desktop open; Mac on power; no other Code-tab session working in this folder.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus 5.5 · effort High.

## 2. Init prompt
```
You are the Google Cloud 1 agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode, on the Claude Pro plan (Opus 5.5, high effort). It adds a "Google Cloud" provider so Tvashtr's agents can run Gemini on Vertex AI with a Google Cloud API key — so the operator's Google Cloud credits pay — on a new branch feat/gcloud-1. No migration, no push, no deploy. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/gcloud-1.md — the brief; it wins wherever it differs from the others.
2. prompts/CLI-RULES.md — the working discipline, the stop conditions and the §4.7 final report.
3. backend/tvashtr/gateway/gateway.py, backend/tvashtr/config.py (agent_llm_routing), the three engines/openhands_*adapter.py call sites of agent_llm_routing, control_plane/teams.py (PROVIDER_CATALOGUE and _PROVIDER_DEFAULT_ORDER), control_plane/provider_directory.py, control_plane/provider_models.py, seed.py (ENV_PROVIDER_MAP).
4. In backend/.venv: litellm/llms/vertex_ai/vertex_llm_base.py (_get_token_and_url and _check_custom_proxy) — the route the brief relies on.
5. scripts/seat_probe.py, scripts/live_run_e2e.sh and frontend/e2e/_keys.ts.
6. The top of STATE.md (SHIP LANDING-1) — the floors, how the DBOS application versions were computed, and how the gates were run.

Claude Pro: one thing at a time, no ultracode or dynamic workflows, at most one subagent at a time. Use the superpowers skills where they fit (test-driven-development for the translation; systematic-debugging when a live call fails; verification-before-completion before any "done"). Write STATE.md after every step.

Now reply in at most 5 lines: main's sha and the push guard's value; whether the tracked tree is clean; whether Docker runs and :8000/:5173 are free; the team_run.py blob, the @DBOS. count; and whether .env has GOOGLE_CLOUD_API_KEY (present/absent only — never a value). If it is absent, then post the brief's "YOUR TURN 1" box exactly as written. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/gcloud-1.md: a "Google Cloud" provider (slug vertex_ai) so Tvashtr's thinker calls and agent loops run Gemini on Vertex AI with a Google Cloud API key — billed to the operator's Google Cloud credits — on a new branch feat/gcloud-1 from main 52986900. No migration, no new DBOS workflow, no push, deploy or Desktop release.

In order, echoing each evidence line the brief lists as it completes and writing it to STATE.md: PREFLIGHT → TRANSLATE-RED then TRANSLATE-GREEN (one pure module; the gateway hook; agent_llm_routing; the never-untranslated guard) → YOUR TURN 1 if GOOGLE_CLOUD_API_KEY is absent (post it, wait for "added") → PROBE (seat_probe.py over the brief's six Gemini models, both seats; the model-list, key-shape and embedding probes) → the catalogue entry from that evidence, the default order, Engines' directory, the seed map, the provider-name maps → LIVE (a real local run on Google Cloud to Done, then one in the docker sandbox; run ids, status, cost) → YOUR TURN 2 → SIGNOFF G1–G4 → GATES on the final head → INVARIANTS → NET.

Invariants, each with its proof: only the brief's listed files change, with no removed line except re-pointed test expectations (listed); complete()'s diff is the hook only, embed() byte-identical, no other module imports litellm, google_cloud.py imports neither litellm nor openhands; model_used stays vertex_ai/<id>; the gemini provider's calls unchanged (tested); team_run.py 9a22d313d5c9; alembic unchanged; @DBOS. count 75 and DBOS app versions unchanged; no package or lock change; no key in any log, output, screenshot or commit; untracked files and prompts/, design/, HANDOVER.md, PROJECTPLAN.md, STATE.md never staged.

Gates: make test on tvashtr_gate 0 failed, ≥ 3550 + new; vitest ≥ 2757 + new (the CompareView.tsx:96 unhandled error may remain, no new one); tsc; build; desktop 161; make lint: no new finding, the exit code may stay non-zero (ruff baseline 38); revamp-shell and model-picker e2e pass.

Rules: Claude Pro — Opus high, no ultracode or workflows, at most one subagent; STATE.md after every step; auto mode; no push, deploy, tag, force, reset --hard, stash, rebase, amend or git-config change; .env fenced: check names and source it only, never print a value; tests never on tvashtr_film or next to a live stack; one stack at a time; caffeinate -dimsu; live calls only as the brief lists (they spend the operator's credits); three-attempt rule; time box 6 working hours.

Done when every evidence line is in this chat, then READY_TO_MERGE feat/gcloud-1 <sha> and the eight-section FINAL REPORT (CLI-RULES §4.7) with YOUR TURN 3 in section 7. Waiting for the operator at YOUR TURN 1 is a valid pause: if re-prompted, say in one line that you're waiting for the key, and check .env again. Also done, as a valid stop, on a blocker the brief names (main not 52986900, push guard not the dummy, tracked changes at start, a port held, Google refusing the key, the Vertex route failing for a reason the translation can't fix, an existing file outside the list must change, a failing existing test not caused by this branch, a safeguards notice): write NEEDS_HUMAN: <reason> to STATE.md, echo it with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```

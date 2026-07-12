SHELL := /bin/bash

# Load .env (if present) and export to all recipe environments.
ifneq (,$(wildcard ./.env))
include .env
export
endif

POSTGRES_USER ?= tvashtr
POSTGRES_DB ?= tvashtr

# M-brownfield rung 2: the live-proof target repo (overridable in .env or on the command line). The
# committed default is the operator's real trade_mcp; absent on CI / other machines -> the driver skips.
TVASHTR_RUNG2_REPO ?= /Users/adimac/Desktop/trade_mcp
# scoped-mount Slice 1: the sub-path the brownfield agent's context map + FOCUS scope to (default the
# DEMA target package `core`, so the Engineer's surface is core/'s handful of files, not 264). The
# independent numeric gate is unaffected (it runs host-side at the repo ROOT).
TVASHTR_RUNG2_SUBPATH ?= core

.PHONY: setup db-up db-down migrate backend frontend test test-frontend build-frontend smoke agent-smoke model-bench proxy-smoke skeleton-run skeleton-run-docker skeleton-crash skeleton-crash-docker loop-run loop-crash loop-run-docker loop-feature-docker sandbox-reuse-check brownfield-check brownfield-loop-check brownfield-rung2 seeding-smoke containment-smoke containment-demo crash-demo hitl-demo budget-demo proxy-budget-demo steering-e2e team-edit-e2e team-library-e2e thinker-chain-e2e capability-edit-e2e edits-toggle-e2e run-diff-e2e node-ask-e2e topology-e2e work-brief-e2e authoring-brief-e2e launch-panel-e2e scope-picker-e2e auth-e2e accounts-e2e model-picker-e2e secret-gate-e2e skills-e2e tools-e2e seed lint fmt help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Install backend (uv) and frontend (npm) dependencies
	cd backend && uv sync --extra dev
	cd frontend && npm install

db-up: ## Start Postgres + the LiteLLM proxy and wait until healthy (postgres hard-gates tests; the proxy warns-not-fails so an offline run is never wedged)
	docker compose up -d
	@echo "waiting for postgres to be ready..."
	@for i in $$(seq 1 30); do \
		if docker compose exec -T postgres pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB) >/dev/null 2>&1; then \
			echo "postgres ready"; break; \
		fi; \
		if [ $$i -eq 30 ]; then echo "postgres did not become ready in time" >&2; exit 1; fi; \
		sleep 1; \
	done
	@echo "waiting for the litellm proxy to be healthy (P1.4a)..."
	@for i in $$(seq 1 60); do \
		health=$$(docker inspect -f '{{.State.Health.Status}}' tvashtr-litellm 2>/dev/null || echo missing); \
		if [ "$$health" = "healthy" ]; then echo "litellm proxy healthy"; exit 0; fi; \
		sleep 2; \
	done; \
	echo "WARNING: litellm proxy not healthy yet — postgres is up so tests can run. See 'docker compose logs litellm'; 'make proxy-smoke' asserts it." >&2

db-down: ## Stop Postgres (keeps the named volume)
	docker compose down

migrate: ## Apply Alembic migrations
	cd backend && uv run alembic upgrade head

seed: ## Seed the operator account (M-accounts Slice A; idempotent — run after migrate). Reads TVASHTR_SEED_EMAIL/PASSWORD (dev defaults). A second run is a no-op.
	cd backend && uv run python -m tvashtr.seed

backend: ## Run the FastAPI backend (dev, with reload)
	cd backend && uv run uvicorn tvashtr.main:app --reload --host 127.0.0.1 --port 8000

frontend: ## Run the Vite dev server
	cd frontend && npm run dev

test: ## Run backend tests (requires db-up + migrate first)
	cd backend && uv run pytest

test-frontend: ## Run the frontend vitest suite (jsdom; no DB — kept separate from `make test`, which needs Postgres)
	cd frontend && npm test

build-frontend: ## Frontend build gate: tsc --noEmit (strict types) + vite build
	cd frontend && npm run build

smoke: ## Live gateway smoke — one real LLM call (needs OPENROUTER_API_KEY; skips cleanly otherwise)
	cd backend && uv run python ../scripts/smoke_gateway.py

memory-smoke: ## Live memory embedding round-trip (M-memory S1): POST /api/memories stores a REAL text-embedding-3-small vector(1536) in pgvector, read back from the DB. Needs OPENAI_API_KEY in .env + Postgres up/migrated; FAILS (not skips) without the key — the live embed is the point
	cd backend && uv run python ../scripts/memory_smoke.py

agent-smoke: ## Live OpenHands agent smoke — trivial task in a local workspace (needs key; skips otherwise)
	cd backend && uv run python ../scripts/smoke_agent.py

model-bench: ## C9 model bench (M-ctx0): race the worker/reviewer candidates (llama-3.3-70b baseline + Nemotron-3 super/nano + Kimi-K2; override via TVASHTR_BENCH_MODELS) through the LiteLLM→NIM gateway on fixed tasks, scoring task success / tokens / cost / latency / 429s — the reviewer seat scored separately (does it correctly REJECT a deliberately-wrong build, per D4). Emits a flat JSON + a summary table. Skips cleanly without a provider key; `python scripts/model_bench.py --dry-run` proves the harness offline (no NIM). Operator-run.
	cd backend && uv run python ../scripts/model_bench.py

proxy-smoke: ## Live LiteLLM-proxy plumbing smoke (P1.4a): host->proxy + container->host.docker.internal + 1 cheap completion if keyed (operator-run; needs the proxy up + Docker; skips cleanly otherwise)
	cd backend && uv run python ../scripts/proxy_smoke.py

skeleton-run: ## Live 2-node skeleton run, LOCAL sandbox: PM -> Engineer ships a file (needs key; skips otherwise)
	cd backend && TVASHTR_AGENT_SANDBOX=local TVASHTR_AUTO_APPROVE_GATES=1 uv run python ../scripts/skeleton_run.py

skeleton-run-docker: ## Live CONTAINERIZED run via the Docker sandbox (TVASHTR_AGENT_SANDBOX=docker; needs key + Docker + agent-server image; operator-run, P1.3a)
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 uv run python ../scripts/skeleton_run.py

skeleton-crash: ## Prove the 2-node run resumes across a kill -9 mid agent-run (needs key; skips otherwise)
	./scripts/skeleton_crash_demo.sh

loop-run: ## Live 3-node review-loop run, LOCAL sandbox + forced revisions: prove the Engineer<->Reviewer cycle genuinely ran (Engineer x2, one loop-back, ships once). Needs key; skips otherwise (P1.5a)
	cd backend && TVASHTR_AGENT_SANDBOX=local TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_FORCE_REVISIONS=1 uv run python ../scripts/loop_run.py

loop-crash: ## Prove the review LOOP resumes MID-CYCLE across a kill -9 mid Engineer-iteration-2 (FORCE_REVISIONS=2 -> Engineer x3) and keeps cycling -> ships exactly once (needs key; skips otherwise, P1.5a)
	./scripts/loop_crash_demo.sh

seeding-smoke: ## Prove docker-mode loop seeding (P1.5c, NO LLM): push the host workspace into a fresh container (flat + nested + the revise-then-pull round-trip); host<->container sync proven. Needs Docker + agent-server image; operator-run
	cd backend && uv run python ../scripts/seeding_smoke.py

loop-run-docker: ## Live 3-node review-loop run, DOCKER sandbox + forced revisions: the Engineer<->Reviewer cycle ships once on the containerized substrate (iter-2 seeded from the host). Needs key + Docker + agent-server image; operator-run (P1.5c)
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_FORCE_REVISIONS=1 uv run python ../scripts/loop_run.py

loop-feature-docker: ## P1.5c CAPSTONE: the REAL stdlib task-list feature, DOCKER sandbox, REAL Engineer build + REAL agent-Reviewer (runs the build's unittest suite, emits REVIEW_VERDICT.json, Control Plane harvests it) — ships on green or cycles on red. Uses the NIM agent model from .env (TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct). Needs NVIDIA_BUILD_API_KEY + Docker + agent-server image; operator-run.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_FEATURE_RUN=1 TVASHTR_AGENT_MAX_ITERATIONS=40 uv run python ../scripts/loop_run.py

sandbox-reuse-check: ## M-unify U2 LIVE gate: a docker review_loop where the Engineer runs >=2 rounds — round 2 REUSES its warm container (NO 2nd ~20s spin-up; scraped from the adapter logs) AND continues the SAME Conversation (carried >0 prior tokens), beating the 20.2s docker cold-start baseline; a DIFFERENT node (PM) gets its own container. Inherits .env TVASHTR_AGENT_MODEL (deepseek/deepseek-chat; override to the NIM slug if deepseek trips the serialization wall). In-process TestClient (no port needed; backend :8001 is the worktree convention if one were). Needs Docker + agent-server image + a provider key; skips cleanly otherwise; operator-run. NOT in `make test`.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_FORCE_REVISIONS=1 uv run python ../scripts/sandbox_reuse_check.py

brownfield-check: ## M-brownfield Slice 1 LIVE gate: a REAL docker+NIM two_node run lands a correct change on branch tvashtr/<run_id> in a throwaway fixture repo (calculator.py gains subtract, the fixture's own pytest is GREEN on that branch), the user's original HEAD is UNTOUCHED, and the Run row carries repo_path/base_ref/ship_branch. Agent = nvidia_nim/meta/llama-3.3-70b-instruct. Needs NVIDIA_BUILD_API_KEY + Docker + agent-server image; skips cleanly otherwise; operator-run.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct TVASHTR_AGENT_MAX_ITERATIONS=40 uv run python ../scripts/brownfield_check.py

brownfield-loop-check: ## M-brownfield Slice 3 EXIT-BAR gate: a REAL docker+NIM review_loop (PM -> Engineer <-> Reviewer) ships a CORRECT, reviewer-APPROVED change into a rung-1 real-shaped repo (a `shop` package the driver builds) — bulk_discount added to an EXISTING module, the repo's tests GREEN on branch tvashtr/<run_id>, the user's HEAD UNTOUCHED, and the reviewer's FINAL outcome is "approved" (not an escalation auto-approve). Agent = nvidia_nim/meta/llama-3.3-70b-instruct. Needs NVIDIA_BUILD_API_KEY + Docker + agent-server image; skips cleanly otherwise; operator-run.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct TVASHTR_AGENT_MAX_ITERATIONS=40 uv run python ../scripts/brownfield_loop_check.py

brownfield-rung2: ## M-brownfield rung 2 LIVE proof: a REAL docker+NIM review_loop ships a DEMA indicator into a FRESH CLONE of the real trade_mcp repo (TVASHTR_RUNG2_REPO; operator repo NEVER touched), gated by an INDEPENDENT numeric check (compute("dema") == 2*EMA-EMA(EMA) within ~1e-8 on a non-constant series, >=2 lengths) + the count tripwire — NOT the 70b reviewer (D4 rubber-stamps). Records PASS or a RUNG-2 FINDING + the shipped indicators.py diff. Agent = nvidia_nim/meta/llama-3.3-70b-instruct. Needs NVIDIA_BUILD_API_KEY + Docker + agent-server image; skips cleanly otherwise; operator-run. NOT in `make test`.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct TVASHTR_AGENT_MAX_ITERATIONS=40 TVASHTR_RUNG2_REPO=$(TVASHTR_RUNG2_REPO) TVASHTR_RUNG2_SUBPATH=$(TVASHTR_RUNG2_SUBPATH) uv run python ../scripts/trade_mcp_rung2_check.py

skeleton-crash-docker: ## Prove crash-resume OVER THE CONTAINER: kill -9 mid-run -> orphan reaped by the boot sweep -> fresh container on a new ephemeral port -> ships exactly once (needs key + Docker + agent-server image; operator-run, P1.3b)
	./scripts/skeleton_crash_demo_docker.sh

containment-smoke: ## Prove the Docker sandbox CONTAINS a forced write-escape (Layer A, NO LLM): 3 escapes land in-container, host stays clean, the real pull ships only the deliverable (needs Docker + agent-server image; operator-run, P1.3b part 2)
	cd backend && uv run python ../scripts/containment_smoke.py

containment-demo: ## Real-agent forced-escape containment (Layer B, the P0.4b inverse): the agent attempts 3 escapes -> contained, host clean, only the deliverable ships (needs key + Docker + agent-server image; operator-run, P1.3b part 2)
	cd backend && uv run python ../scripts/containment_demo.py

crash-demo: ## Prove durable resume across a kill -9
	./scripts/crash_resume_demo.sh

hitl-demo: ## Live HitL gate demo: approve->ship + cancel-at-gate->no-resurrect (needs key; skips otherwise)
	./scripts/hitl_demo.sh

steering-e2e: ## Live J3 steering E2E (P1.7b): start a review_loop in the UI, rewrite the PRD at the gate through the real TipTap editor, Save (new human DocumentVersion), approve, and assert the shipped greeting.txt reflects the human's SENTINEL edit (not DEFAULT_IDEA's line). Real NIM agent + Vite dev server + headless Playwright; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/steering_e2e.sh

team-edit-e2e: ## Live P1.8b authoring E2E: open the persistent team in the UI, edit the Engineer node's PROMPT (+ model) so the deliverable carries a unique SENTINEL, Save, "Run this team" (clone-on-launch), and assert the shipped greeting.txt reflects the AUTHORED prompt (not the template default). Auto-approve gates + forced reviewer-approve. Real NIM agent + Vite dev server + headless Playwright; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/team_edit_e2e.sh

team-library-e2e: ## Live P1.8b team-library E2E: "+ New team" from a template, edit its Engineer node's PROMPT (+ model) to a unique SENTINEL, Save, "Run this team" (clone-on-launch), and assert the shipped greeting.txt reflects the AUTHORED prompt (not the template default). Auto-approve gates + forced reviewer-approve. Real NIM agent + Vite dev server + headless Playwright; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/team_library_e2e.sh

thinker-chain-e2e: ## Live P1.8c thinker-chain E2E (API-driven): instantiate the thinker_chain team (PM → Architect → Engineer), run it (LOCAL sandbox, auto-approve gates), and assert it ships once AND the spec document has 2 versions — the structural proof the non-start Architect thinker genuinely refined the spec. Real models (thinkers on DEFAULT_MODEL, Engineer on TVASHTR_AGENT_MODEL); needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/thinker_chain_e2e.sh

capability-edit-e2e: ## Live P1.8c capability-authoring E2E: "+ New team" from the thinker_chain template, click the Architect node, flip the Capability toggle thinker→worker, Save, and assert the flip PERSISTED (kind=agent/engine=openhands), the canvas RE-LABELS it as a Worker, and the PM (start node) toggle is LOCKED. Vite dev server + headless Playwright; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/capability_edit_e2e.sh

edits-toggle-e2e: ## Live M-unify U3 edits-surface E2E: register → open the seeded review_loop team → flip a non-start node's Edits toggle (persists + re-labels the card), assert the Tools editor on an edits-off node, the pre-launch AMBER action-verb advisory, and the start-node lock. Pure authoring (NO LLM/key); backend :8002 + Vite :5175 (parallel-safe).
	./scripts/edits_toggle_e2e.sh

run-diff-e2e: ## Live M-changes run-diff E2E: register a fresh account, seed its deepseek key, create a review_loop team + run it to completion (LOCAL sandbox, deepseek/deepseek-chat, forced reviewer-approve — NO docker containers), open the run view, click "Changes", assert the produced file(s) render with an expandable per-file diff + a screenshot per check. Backend :8002 + Vite :5175 (parallel-safe). Needs DEEPSEEK_API_KEY; skips otherwise.
	./scripts/run_diff_e2e.sh

node-ask-e2e: ## Live Mode A "Ask the node" E2E: register a fresh account, seed its deepseek key, run a review_loop to completion (LOCAL sandbox, deepseek/deepseek-chat, forced reviewer-approve — NO docker), open the run view, click a node → "Ask", ask a question, and assert a NON-EMPTY answer renders + a screenshot per check. Backend :8002 + Vite :5175 (parallel-safe). Needs DEEPSEEK_API_KEY; skips otherwise.
	./scripts/node_ask_e2e.sh

topology-e2e: ## Live P1.8d topology-editing E2E: from a BLANK team author root thinker → Engineer → Ship (palette + edge CRUD), RUN it through the UI and assert it ships (real NIM); PLUS an invalid graph (an unconnected node) greys out Run with the reason AND create_run is refused 422. Vite dev server + headless Playwright; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/topology_e2e.sh

work-brief-e2e: ## Live per-node work-brief E2E (Option A): (1) API-driven — a REAL review_loop on NIM with forced revisions, then assert the THINKER (PM) AND WORKER (Engineer) latest outcome_detail are non-NULL well-formed briefs (populated for MORE than the Reviewer) while the Reviewer's stays its verdict reasons; (2) scripted headless Playwright — drive a real run, click the thinker then the Engineer node in the run view, assert each panel shows its "Last run" brief, capture 2 screenshots. Real NIM agent + Vite dev server; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/work_brief_e2e.sh

authoring-brief-e2e: ## Live M2 authoring-brief E2E: create a review_loop team, Run it, return to the AUTHORING view, click the PM (thinker) node, and assert its node panel's "Last run" section shows "Drafted the spec from the idea." + a relative-time provenance tag (the cloned_from_node_id linkage + authoring read + view-switch re-fetch). Captures a screenshot. Real NIM agent + Vite dev server; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/authoring_brief_e2e.sh

launch-panel-e2e: ## Live M-brownfield Slice 2 launch-panel E2E: open the app, click "Run this team" (assert the launch panel OPENS), flip "work on a local repo", type a REAL fixture git repo path (assert the base-branch dropdown populates from the live POST /api/repo/inspect round-trip), and confirm the greenfield path still launches ({ team_graph_id } only). A screenshot per check. NO agent run — needs NO NVIDIA key; just Postgres + a real backend + Vite + Playwright.
	./scripts/launch_panel_e2e.sh

scope-picker-e2e: ## Live M-brownfield scoped-mount Slice 2 SCOPE-PICKER E2E: register a fresh account, open the seeded team, click "Run this team", flip "work on a local repo" On, type a REAL multi-package fixture git repo path (assert the base-branch dropdown AND the new Scope dropdown populate from the live POST /api/repo/inspect round-trip), pick a package, and assert the launch POST /api/runs body carries `subpath`. A screenshot per check. Isolated ports (backend :8001, Vite :5174 -> proxy :8001). NO agent run — needs NO provider keys; just Postgres + a real backend + Vite + Playwright.
	./scripts/scope_picker_e2e.sh

auth-e2e: ## Live M-accounts Slice A auth E2E: the whole app sits behind login — unauthenticated→landing, register→dashboard, logout→landing, seeded-login→dashboard. Seeds the operator account first. A screenshot per check. NO agent run — needs NO NVIDIA key; just Postgres + a real backend + Vite + Playwright.
	./scripts/auth_e2e.sh

accounts-e2e: ## Live M-accounts Slice B accounts E2E: the full account journey — logged-out→landing (no canvas/create-team), register→empty dashboard, add a provider key (•••• last4), open a team→canvas, back→dashboard. Seeds the operator first. A screenshot per step. NO agent run — needs NO NVIDIA key; just Postgres + a real backend + Vite + Playwright.
	./scripts/accounts_e2e.sh

model-picker-e2e: ## Live M-accounts Slice C model-picker E2E: register a FRESH account, self-seed dummy encrypted provider creds via the API (.env-FREE), open a team → click the Engineer node (the Provider select lists the seeded providers + the Model field), inline-add a provider (appears in the panel + the dashboard), open the Reviewer (the same-model hint shows) + the PM thinker (absent). NO agent run / NO real LLM — needs NO provider keys; just Postgres + a real backend + Vite + Playwright.
	./scripts/model_picker_e2e.sh

secret-gate-e2e: ## M-rails C8 secret-gate E2E: register a fresh account, create a review_loop team (it carries a PRD gate), OPEN it on the canvas, click the gate (its drawer is now EDITABLE), pick "Secret leak scan" in the Gate type picker, Save, and assert config.gate_kind persisted via a live /api/teams/{id}/graph read. Isolated ports (backend :8001, Vite :5174 -> proxy :8001). A screenshot per check. NO agent run — needs NO provider keys; just Postgres + a real backend + Vite + Playwright.
	./scripts/secret_gate_e2e.sh

budget-demo: ## Live budget cap demo: tiny per-run cap -> breach -> auto-approve -> ship (needs key; skips otherwise)
	./scripts/budget_demo.sh

proxy-budget-demo: ## Live P1.4b mid-loop cutoff: proxy ON + docker + tiny cap -> per-run virtual key -> proxy errors mid-call -> over_budget, no ship, no budget_approval task (needs key + LITELLM_MASTER_KEY + Docker + the proxy up; operator-run)
	./scripts/proxy_budget_demo.sh

lint: ## Whole-repo lint gate: backend+scripts ruff (check + format-check) + frontend eslint (--max-warnings 0) + prettier --check. No DB needed.
	cd backend && uv run ruff check . ../scripts && uv run ruff format --check . ../scripts
	cd frontend && npm run lint
	cd frontend && npm run format:check

fmt: ## Autofix twin of lint: backend+scripts ruff format+fix + frontend eslint --fix + prettier --write
	cd backend && uv run ruff format . ../scripts && uv run ruff check --fix . ../scripts
	cd frontend && npm run lint:fix
	cd frontend && npm run format


tools-e2e: ## M-tools C7.A LIVE gate: a REAL docker+NIM worker whose inline tool_config names the public fetch MCP server (mcp-server-fetch via uvx) invokes the MCP tool THROUGH the docker sandbox (proves brief section 6: resolved plaintext mcp_config survives to the container, not redacted) + a secret-bearing variant resolved from a seeded mcp_secrets row. Needs NVIDIA_BUILD_API_KEY + Docker + agent-server image; skips cleanly otherwise; operator-run. NOT in make test.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct TVASHTR_AGENT_MAX_ITERATIONS=25 uv run python ../scripts/tools_e2e.py

skills-e2e: ## M-tools C7.B LIVE gate: a WORKER node with an `always` inline skill (a distinctive file-marker rule) runs through the DOCKER sandbox on NIM; PASS iff the produced file carries the marker (proof the inline skill reached the agent via AgentContext, end-to-end). Needs NVIDIA_BUILD_API_KEY + Docker + agent-server image; skips cleanly otherwise; operator-run. NOT in `make test`.
	cd backend && TVASHTR_AGENT_SANDBOX=docker TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct uv run python ../scripts/skills_e2e.py


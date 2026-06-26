SHELL := /bin/bash

# Load .env (if present) and export to all recipe environments.
ifneq (,$(wildcard ./.env))
include .env
export
endif

POSTGRES_USER ?= tvashtr
POSTGRES_DB ?= tvashtr

.PHONY: setup db-up db-down migrate backend frontend test test-frontend build-frontend smoke agent-smoke proxy-smoke skeleton-run skeleton-run-docker skeleton-crash skeleton-crash-docker loop-run loop-crash loop-run-docker loop-feature-docker seeding-smoke containment-smoke containment-demo crash-demo hitl-demo budget-demo proxy-budget-demo steering-e2e team-edit-e2e team-library-e2e thinker-chain-e2e capability-edit-e2e topology-e2e work-brief-e2e lint fmt help

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

agent-smoke: ## Live OpenHands agent smoke — trivial task in a local workspace (needs key; skips otherwise)
	cd backend && uv run python ../scripts/smoke_agent.py

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

topology-e2e: ## Live P1.8d topology-editing E2E: from a BLANK team author root thinker → Engineer → Ship (palette + edge CRUD), RUN it through the UI and assert it ships (real NIM); PLUS an invalid graph (an unconnected node) greys out Run with the reason AND create_run is refused 422. Vite dev server + headless Playwright; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/topology_e2e.sh

work-brief-e2e: ## Live per-node work-brief E2E (Option A): (1) API-driven — a REAL review_loop on NIM with forced revisions, then assert the THINKER (PM) AND WORKER (Engineer) latest outcome_detail are non-NULL well-formed briefs (populated for MORE than the Reviewer) while the Reviewer's stays its verdict reasons; (2) scripted headless Playwright — drive a real run, click the thinker then the Engineer node in the run view, assert each panel shows its "Last run" brief, capture 2 screenshots. Real NIM agent + Vite dev server; needs NVIDIA_BUILD_API_KEY, skips otherwise.
	./scripts/work_brief_e2e.sh

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

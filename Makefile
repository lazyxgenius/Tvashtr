SHELL := /bin/bash

# Load .env (if present) and export to all recipe environments.
ifneq (,$(wildcard ./.env))
include .env
export
endif

POSTGRES_USER ?= tvashtr
POSTGRES_DB ?= tvashtr

.PHONY: setup db-up db-down migrate backend frontend test smoke agent-smoke proxy-smoke skeleton-run skeleton-run-docker skeleton-crash skeleton-crash-docker loop-run containment-smoke containment-demo crash-demo hitl-demo budget-demo proxy-budget-demo lint fmt help

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

budget-demo: ## Live budget cap demo: tiny per-run cap -> breach -> auto-approve -> ship (needs key; skips otherwise)
	./scripts/budget_demo.sh

proxy-budget-demo: ## Live P1.4b mid-loop cutoff: proxy ON + docker + tiny cap -> per-run virtual key -> proxy errors mid-call -> over_budget, no ship, no budget_approval task (needs key + LITELLM_MASTER_KEY + Docker + the proxy up; operator-run)
	./scripts/proxy_budget_demo.sh

lint: ## ruff check + format check
	cd backend && uv run ruff check . && uv run ruff format --check .

fmt: ## ruff autofix + format
	cd backend && uv run ruff format . && uv run ruff check --fix .

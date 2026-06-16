SHELL := /bin/bash

# Load .env (if present) and export to all recipe environments.
ifneq (,$(wildcard ./.env))
include .env
export
endif

POSTGRES_USER ?= tvashtr
POSTGRES_DB ?= tvashtr

.PHONY: setup db-up db-down migrate backend frontend test smoke agent-smoke skeleton-run skeleton-crash crash-demo hitl-demo budget-demo lint fmt help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Install backend (uv) and frontend (npm) dependencies
	cd backend && uv sync --extra dev
	cd frontend && npm install

db-up: ## Start Postgres and wait until healthy
	docker compose up -d
	@echo "waiting for postgres to be ready..."
	@for i in $$(seq 1 30); do \
		if docker compose exec -T postgres pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB) >/dev/null 2>&1; then \
			echo "postgres ready"; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "postgres did not become ready in time" >&2; exit 1

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

skeleton-run: ## Live 2-node skeleton run: PM -> Engineer ships a file (needs key; skips otherwise)
	cd backend && TVASHTR_AUTO_APPROVE_GATES=1 uv run python ../scripts/skeleton_run.py

skeleton-crash: ## Prove the 2-node run resumes across a kill -9 mid agent-run (needs key; skips otherwise)
	./scripts/skeleton_crash_demo.sh

crash-demo: ## Prove durable resume across a kill -9
	./scripts/crash_resume_demo.sh

hitl-demo: ## Live HitL gate demo: approve->ship + cancel-at-gate->no-resurrect (needs key; skips otherwise)
	./scripts/hitl_demo.sh

budget-demo: ## Live budget cap demo: tiny per-run cap -> breach -> auto-approve -> ship (needs key; skips otherwise)
	./scripts/budget_demo.sh

lint: ## ruff check + format check
	cd backend && uv run ruff check . && uv run ruff format --check .

fmt: ## ruff autofix + format
	cd backend && uv run ruff format . && uv run ruff check --fix .

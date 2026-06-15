# Tvashtr

A canvas for composing and running teams of AI agents that take a product idea to
working software. The heart of the architecture is a deterministic **Control
Plane** built on a durable workflow engine.

This repository is at **Phase 0 / P0.3 — the walking skeleton's first agent**. On
top of the P0.1 durable-execution spine (a FastAPI backend running **DBOS
Transact** in-process over Postgres, proven by a 3-step workflow that survives a
deliberate `kill -9` mid-run and completes after restart **without re-executing
finished steps**), it adds three provider/engine-agnostic commodities behind clean
boundaries:

- a **Model Gateway** — the single metering chokepoint — that wraps **LiteLLM** to
  route a completion to *any* `provider/model` (defaulting to **OpenRouter** with
  an ordered fallback list) and records token usage + cost;
- a **versioned Document layer**: a `Document` is an ordered chain of immutable
  `DocumentVersion`s; and
- an **`EngineAdapter`** boundary with its first implementation over the
  **OpenHands** Software Agent SDK — an agent that actually touches a filesystem,
  with its actions/observations streamed into a persisted `RunEvent` log.

Two proofs tie it together: a durable `generate_doc` workflow makes one real,
metered LLM call and writes the output as an immutable document version (surviving
a mid-run crash without double-charging or duplicating); and `make agent-smoke`
runs a real OpenHands agent in a throwaway local workspace to create a file. (The
2-node agent graph and the canvas come in later steps.)

## Prerequisites

- [**uv**](https://docs.astral.sh/uv/) (manages Python 3.12 automatically — you do
  not need a system Python 3.12)
- **Docker** + **Docker Compose v2** (runs Postgres only)
- **Node 20+** and npm (for the frontend stub)
- A free host port **5433** (Postgres) and **8000** (backend), **5173** (frontend)

## Quickstart

```bash
cp .env.example .env        # local config (gitignored)
make setup                  # uv sync (backend) + npm install (frontend)
make db-up                  # start Postgres on :5433, wait until healthy
make migrate                # create app tables (spike, costs, documents, run_events)
make test                   # backend tests (gateway, idempotency, contract, durable)
make smoke                  # optional: one live LLM call (needs OPENROUTER_API_KEY)
make agent-smoke            # optional: a real OpenHands agent run (needs a key)
```

Run the app (two terminals):

```bash
make backend                # FastAPI on http://localhost:8000  (GET /health)
make frontend               # Vite on   http://localhost:5173  (live health dot)
```

Prove durable execution survives a crash:

```bash
make crash-demo             # starts the workflow, kill -9 mid-run, restarts, asserts
```

### Make targets

| Target         | What it does                                              |
| -------------- | --------------------------------------------------------- |
| `setup`        | Install backend (uv) and frontend (npm) dependencies      |
| `db-up`        | Start Postgres and wait until healthy                     |
| `db-down`      | Stop Postgres (keeps the named volume)                    |
| `migrate`      | Apply Alembic migrations                                  |
| `backend`      | Run FastAPI (uvicorn, reload) on :8000                    |
| `frontend`     | Run the Vite dev server on :5173                          |
| `test`         | Run backend tests (needs `db-up` + `migrate` first)       |
| `smoke`        | Live gateway smoke — one real LLM call (skips without key) |
| `agent-smoke`  | Live OpenHands agent run in a local workspace (skips w/o key) |
| `crash-demo`   | Run the crash-resume proof (exits non-zero on failure)    |
| `lint` / `fmt` | ruff check + format check / autofix                       |

## What the crash demo proves

`make crash-demo` starts `hello_durable`, a DBOS workflow whose three steps each
write a row (recording the OS pid) into `spike_hello_events`, with a **durable
10-second sleep** between step 1 and step 2. The script waits until step 1 has
checkpointed, then `kill -9`s the backend process **mid-sleep** and prints the
table (only step 1, with the original pid). It restarts the backend; on launch
DBOS automatically recovers the pending workflow, resumes the durable sleep for
its *remaining* time, and runs steps 2–3 in the **new** process. The script then
asserts there is **exactly one row per step**, that **step 1's pid differs from
steps 2–3's pid** (so step 1 was *not* re-executed and the survivors ran in the
restarted process), and that the final DBOS status is **SUCCESS**. That is the
whole point: workflow progress is checkpointed to Postgres and resumes across a
hard crash without redoing completed work — the durable foundation everything
else in Tvashtr is built on.

## Model gateway & document layer (P0.2)

The **gateway** is the only place that imports LiteLLM; everything else calls
`gateway.complete(request)` and gets back a Tvashtr-owned `CompletionResult`
(tokens, computed `cost_usd`, `model_used`, latency). That boundary is what lets
the gateway be swapped — or fronted by the LiteLLM proxy — later. Model
identifiers are free-form `provider/model` pass-through strings (no enum); the
default and the ordered fallback list live in `tvashtr/config.py`.

Every side-effecting write (`CostRecord`, `DocumentVersion`) is **idempotent on a
deterministic key** (`{workflow_id}:llm` / `{workflow_id}:v1`), so DBOS's
at-least-once step retries never double-write: a re-run with the same key returns
the existing row instead of inserting a duplicate.

### Provider keys

Secrets come from the environment / `.env` only — never committed, never logged.
Copy the commented slots from `.env.example` and fill the ones you need;
**OpenRouter is the default** (one key reaches Llama/Gemini/GPT/etc.):

```bash
OPENROUTER_API_KEY=sk-or-...      # default route; start here
# OPENAI_API_KEY=...              # only for direct-provider models / fallbacks
# GEMINI_API_KEY=...
# ANTHROPIC_API_KEY=...
# HUGGINGFACE_API_KEY=...
```

With a key set, `make smoke` makes one live completion and prints the token counts
+ cost (a `cost_usd` of `0.0` is valid on a free tier — not an error). Without a
key it skips cleanly, so the test suite never depends on a paid endpoint.

### Endpoints

| Method & path                       | What it does                                              |
| ----------------------------------- | -------------------------------------------------------- |
| `POST /api/spike/generate-doc`      | `{topic}` → start `generate_doc`, returns `{workflow_id}` |
| `GET  /api/spike/generate-doc/{id}` | DBOS status + (if finished) result + the cost rows       |
| `GET  /api/documents`               | list documents                                           |
| `GET  /api/documents/{id}`          | a document + its ordered, immutable versions             |
| `GET  /api/costs?workflow_id=`      | cost rows (all, or filtered by workflow)                 |

## Engine adapter & agent runs (P0.3)

`EngineAdapter` (in `tvashtr/engines/base.py`) is the uniform, **engine-neutral**
contract the Control Plane uses to drive *any* coding-agent engine: `name` plus
`run(task, on_event) -> AgentRunResult`, exchanging only Tvashtr-owned `AgentTask`
/ `AgentRunResult` / `EngineEvent` types. The interface is the durable asset;
**OpenHands** is just the first engine plugged into it (`OpenHandsAdapter`, the
only module importing `openhands.*`). A second engine (e.g. the Claude Agent SDK)
can be added as adapter #2 without touching any caller.

During a run the adapter normalizes the engine's native events into ordered
`EngineEvent`s (kinds `action` / `observation` / `message` / `error`), streams
them live via `on_event`, and the run-event **sink** persists each to `run_events`
— **insert-or-ignore on `(run_id, seq)`**, so an at-least-once re-emit never
duplicates a row (the same convention as P0.2's metering).

> **⚠️ Local-unsandboxed.** The agent runs against a throwaway directory under
> `.tvashtr_workspaces/` (gitignored); its shell/file tools execute **as your user
> on the real filesystem, with no isolation**. Dev / trusted-tasks only — Docker
> isolation (via the OpenHands Agent Server) is a planned later step.

`make agent-smoke` (needs a provider key) runs a real OpenHands agent on a trivial
task (`create hello.txt`) and prints the resolved status, the captured event kinds,
`files_changed`, and the produced file's contents. It skips cleanly without a key.

| Method & path                        | What it does                            |
| ------------------------------------ | --------------------------------------- |
| `GET /api/spike/run-events/{run_id}` | the persisted, ordered events for a run |

## Layout

```
backend/            FastAPI + DBOS + SQLAlchemy/Alembic (Python package `tvashtr`)
  tvashtr/          app code: config, db, models, main, routers (FastAPI)
    gateway/        the Model Gateway — the only module importing LiteLLM
    documents/      versioned-document service (Document + DocumentVersion)
    engines/        EngineAdapter contract + OpenHands adapter + run-event sink
    metering.py     persist a gateway result as an idempotent CostRecord
    control_plane/  durable DBOS workflows (hello_durable, doc_writer)
  alembic/          migrations (owns app tables only)
  tests/            pytest integration + unit tests
frontend/           Vite + React + TS + Tailwind stub (health indicator)
scripts/            crash_resume_demo.sh, smoke_gateway.py, smoke_agent.py
docker-compose.yml  Postgres 16 (host port 5433)
Makefile            developer entrypoints
```

## Notes

- **DBOS vs Alembic.** DBOS manages its own system tables in a separate `dbos`
  schema in the same database. Alembic owns only Tvashtr's app tables (`public`).
- **Postgres URL.** `DATABASE_URL` uses the bare `postgresql://` scheme (what DBOS
  and `psql` expect); the SQLAlchemy engine is pinned to psycopg 3 in code.
- **Single Postgres** backs both the app tables and DBOS's durable state, on host
  port 5433 to avoid clashing with a local Postgres.
- **Gateway boundary.** Only `tvashtr/gateway/gateway.py` imports `litellm`; the
  rest of the app depends on `gateway.complete()` + Tvashtr types. Cost is stored
  as token counts *and* computed USD, so the data stays meaningful even when a
  free-tier call legitimately costs `0.0`.
- **Idempotent writes.** A *completed* DBOS step is exactly-once, but a crash
  *mid-step* re-runs it — so `CostRecord`, `DocumentVersion`, and `RunEvent`
  writes derive a deterministic key and insert-or-return, making them safe under
  at-least-once retries.
- **Engine boundary.** Only `tvashtr/engines/openhands_adapter.py` imports
  `openhands.*`; the Control Plane depends solely on the `EngineAdapter` protocol
  + Tvashtr engine types. The agent's *internal* LLM calls go through the SDK's own
  LiteLLM (configured from our `Settings`), not `gateway.complete()` — the gateway
  remains the path for *direct* completions.
- **⚠️ Local-unsandboxed agent mode (P0.3).** Agent shell/file tools execute as
  your user on the real filesystem, confined only to a throwaway
  `.tvashtr_workspaces/` dir. Dev-only; Docker isolation is planned.

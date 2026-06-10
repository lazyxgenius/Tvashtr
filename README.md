# Tvashtr

A canvas for composing and running teams of AI agents that take a product idea to
working software. The heart of the architecture is a deterministic **Control
Plane** built on a durable workflow engine.

This repository is at **Phase 0 / P0.1 — the durable-execution spine**: a FastAPI
backend running **DBOS Transact** in-process over Postgres, proven by a 3-step
workflow that survives a deliberate `kill -9` mid-run and completes after restart
**without re-executing finished steps**. (Agent runs, the model gateway, the
document layer, and the canvas come in later steps.)

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
make migrate                # create the spike_hello_events table
make test                   # backend tests (health + durable happy-path) -> green
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

## Layout

```
backend/            FastAPI + DBOS + SQLAlchemy/Alembic (Python package `tvashtr`)
  tvashtr/          app code: config, db, models, main (FastAPI), control_plane/
  alembic/          migrations (owns app tables only)
  tests/            pytest integration tests
frontend/           Vite + React + TS + Tailwind stub (health indicator)
scripts/            crash_resume_demo.sh + assertion helper
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

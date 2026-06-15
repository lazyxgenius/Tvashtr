# M0 — Phase 0 exit walkthrough

Phase 0 set out to prove one thing: that Tvashtr's orchestration spine can carry an
idea through a small team of agents into working, committed software — and survive a
crash without doing the work twice. This document maps each Phase-0 exit criterion to
the artifact that proves it, names the command or screen that demonstrates it, and
closes Phase 0.

## What we were proving

**Phase-0 exit criteria (PROJECTPLAN §15):**
> idea → 2-agent run → one PRD doc → trivial feature committed, resumable across a
> deliberate crash.

**Milestone M0 — "Spine proven" (PROJECTPLAN §16):** the 2-node run (idea → PRD →
committed feature) resumes across a `kill -9` mid-agent-run and ships **exactly once**.

The spine is deliberately the smallest real slice: a fixed two-node team — a **product
manager** (a direct, metered LLM completion via the gateway) that writes a versioned
mini-PRD, then an **engineer** (the OpenHands adapter) that reads it and ships one
trivial feature into a local git repo as a single, idempotent, tagged commit. The whole
run is one durable DBOS workflow, so a crash anywhere resumes from the last checkpoint.

## Each criterion → its proof

| Exit criterion | What proves it | How to see it |
|---|---|---|
| **idea → 2-agent run** | `run_team` — one DBOS workflow runs a PM node then an Engineer node. | `make skeleton-run`, or the UI **Start the run**: two nodes go idle → running → done on the canvas. |
| **one versioned PRD doc** | A `documents` row + an ascending `document_versions` chain (`v1`), written idempotently by the PM step. | Select the **Product manager** node → the side panel renders the PRD text and a version list (today: `v1`). |
| **trivial feature committed** | A `greeting.txt` file shipped as the `ship-{run_id}` tagged commit in the run's workspace repo. | The run banner shows **Shipped** + cost + the ship sha; the tag/commit is in `.tvashtr_workspaces/{run_id}/`. |
| **resumable across a deliberate crash** | `make skeleton-crash`: `kill -9` mid agent-run → DBOS recovers the workflow in a fresh process → ships **exactly once** (distinct attempt pids; one tag, one PRD version, one agent-cost row). | `make skeleton-crash` (the M0 exit test). |
| **the spine is now observable** | The living canvas (live per-node status, polled) + the PM's PRD view + the Engineer's run-event feed. | The UI: watch the run, then inspect each node's output. |

Every side-effecting write inside a `@DBOS.step` is idempotent on a key derived from
`DBOS.workflow_id` (`{run_id}:pm-prd-v1`, `{run_id}:agent-cost`, the `ship-{run_id}`
git tag), which is what makes "exactly once" hold across the crash.

## The proving commands

All green as of Phase-0 close:

- `make skeleton-run` — idea → PRD → tagged `greeting.txt` commit, both cost rows recorded.
- `make skeleton-crash` — the M0 exit test: killed mid-agent-run, recovered in a fresh
  process, the agent step re-executed, shipped exactly once.
- `make test` — the offline suite (no network, no `openhands.*` import at app start).
- `make lint` — clean.
- `make smoke` / `make agent-smoke` — the gateway and the OpenHands adapter against a live key.

## Walk it yourself

With `OPENROUTER_API_KEY` set:

1. `make backend` (FastAPI + DBOS on `:8000`) and `make frontend` (Vite on `:5173`).
2. Open `http://localhost:5173` and click **Start the run**.
3. Watch the two nodes move **idle → running → done**; the edge warms from ink to
   coral while the engineer works, then settles to sage.
4. Click the **Product manager** node — the panel opens with the PRD it wrote and a
   `v1` version row. Click a version to read its content.
5. Click the **Engineer** node — the panel shows the agent's action/observation feed,
   appended live (~2s polling) while the run is active.
6. The run banner reads **Shipped** with the total cost and the ship sha.

Selecting a node splits the canvas (the panel takes the right edge and the canvas
re-fits) so the node you clicked stays reachable; clicking the canvas background or the
panel's close button dismisses it.

## What this does *not* add (still deferred — tracked in PROJECTPLAN §15)

P0.5b makes the proven spine **readable**; it does not extend it. Consciously deferred:

- **TipTap rich/live document editing + CRDT (Yjs)** — Phase 1. The PRD here is a plain,
  read-only render.
- **WebSocket push transport** — Phase 1. Today everything is ~2s polling.
- **Cancel / abort a run from the UI** — a killed-and-abandoned `run_team` is *resumed*
  by DBOS on the next launch; there is still no intentional stop.
- **Graph authoring** (add/rewire nodes, gates) — Phase 2. The canvas is read-only.
- **Docker-sandboxed engine workspace** — before any untrusted code. The local-unsandboxed
  mode's write-escape risk was demonstrated in P0.4b; this remains the named upgrade.

## Phase 0: closed

Every Phase-0 exit criterion is now met **and** observable through the UI: the resumable
idea → PRD → committed-feature spine is proven by `make skeleton-crash`, and its
artifacts — the team graph, the versioned PRD, and the agent's run events — are
inspectable on the canvas. M0 is achieved.

Phase 0 is functionally complete. The final stamp is the architect's verification and the
update to PROJECTPLAN §16; the next build (Phase 1) opens on this same DBOS + canvas +
document foundation with Supervisor MCQ scoping and a real default team.

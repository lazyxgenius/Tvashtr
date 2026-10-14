# Brief — M-reaper-S2: make the live-container registry HOST-GLOBAL

_Architect brief for the `/goal` on branch `feat/m-reaper-hostglobal`. Written by Tvashtr-65.
Follow this exactly. Do not redesign. If you think something here is wrong, say so in your
report — do not silently deviate._

---

## 1. The bug (verified on disk — this fully re-opens what `de2f515` just closed)

`backend/tvashtr/engines/sandbox_cache.py` defines:

```python
_REGISTRY_PATH = (
    Path(__file__).resolve().parents[2] / ".tvashtr_workspaces" / "live_containers.json"
)
```

`parents[2]` of `<checkout>/backend/tvashtr/engines/sandbox_cache.py` is `<checkout>/backend`.
So the registry resolves to:

```
<checkout>/backend/.tvashtr_workspaces/live_containers.json
```

**It is derived from the module's own location, so it is CHECKOUT-LOCAL.**

But docker containers are **HOST-GLOBAL**, and `docker_runtime.reap_agent_containers()` selects
them with `docker ps -aq --filter ancestor=<agent_server_image>` — which returns **every**
container on the machine from that image, regardless of which checkout started it.

### The failure sequence

1. A run starts from the **main checkout** → its container is registered in
   `/Users/adimac/Desktop/Tvashtr/backend/.tvashtr_workspaces/live_containers.json`.
2. A **git worktree** (a different directory, same repo) runs `make test`.
   `backend/tests/conftest.py` builds its session client with `with TestClient(app)`, which **runs
   the FastAPI lifespan**, which calls `sweep_orphaned_agent_containers()` (the sandbox default is
   `docker`, and `.env` does not override it).
3. The sweep calls `spared_container_ids()` → reads **the worktree's OWN registry** →
   **empty** → spares nothing.
4. `docker ps --filter ancestor=` finds the main checkout's **live** container → `docker rm -f` →
   **the live run is destroyed.**

**A checkout-local guard cannot protect a host-global resource.** Every M-reaper gate passed only
because they all run inside ONE checkout — the tests could not see this case.

---

## 2. The design (DECIDED — implement exactly this)

- Move the registry to a **host-global** path that does **NOT** derive from `__file__`.
  **Default: `~/.tvashtr/live_containers.json`** — per-user and host-scoped, matching the docker
  daemon's own scope. Create the parent directory on demand.
- Make it **overridable** via a **`TVASHTR_LIVE_CONTAINER_REGISTRY`** environment variable, so
  tests and CI can isolate it.
- Preserve **every** existing behaviour exactly:
  - tolerant reads — missing / corrupt / not-a-list ⇒ `[]` + a warning, **never raise**;
  - atomic writes — temp file + `os.replace`;
  - dead-pid self-GC on register;
  - best-effort — a registry hiccup must never crash a run or block boot;
  - the `_pid_alive` spare logic (`os.kill(pid, 0)`), unchanged.
- The conftest `_isolate_live_container_registry` autouse fixture **must keep working**
  (it monkeypatches `sandbox_cache._REGISTRY_PATH`).

---

## 3. EXPLICITLY OUT OF SCOPE — do NOT implement

- **The `started_at`-qualified liveness check / the pid-reuse residual.** That is a **separate
  registered follow-on**. `started_at` stays recorded-but-unread. Set it aside entirely.
- **Any new dependency.** Do **NOT** add `psutil` or anything else.
  `backend/pyproject.toml` and `backend/uv.lock` must stay **byte-unchanged**.

If you believe either is a hole in this goal's scope, **say so in the report — do not implement it.**

---

## 4. Invariants (prove each on disk, in the transcript)

- **NO migration.** `cd backend && uv run alembic heads` still prints `0027`.
- `git diff main -- backend/tvashtr/control_plane/team_run.py` prints **EMPTY**.
- `git diff main --stat -- frontend` prints **EMPTY**.
- `git diff main -- backend/pyproject.toml backend/uv.lock` prints **EMPTY**.

---

## 5. RIDER — two docstrings in `docker_runtime.py` are now FALSE

Doc-only. No behaviour change. Both must be made to tell the truth:

1. **`reap_agent_containers`'s docstring** still says the boot sweep *"passes NONE (the default) so
   it still reaps EVERYTHING — the crash backstop, unchanged."*
   That is contradicted by `sweep_orphaned_agent_containers()` two definitions below, which now
   passes `keep_ids=spared_container_ids()`.
2. **The MODULE docstring** still says *"reaping is all-or-nothing across runs — fine while runs
   are serial; per-run isolation is a named upgrade if concurrency ever lands."*
   Per-run isolation **has landed** — that is commit `de2f515`.

_(Context: a stale docstring in `main.py` claiming "No-op in the default `local` mode" is precisely
what hid the original bug. Stale docstrings in this module family are load-bearing hazards, not
cosmetics.)_

---

## 6. Acceptance

1. **REPRODUCE-FIRST** — a regression proving the registry path does **not** resolve inside the repo
   checkout. **Show it RED on the current code** (paste the failing output) **before** any fix.
   A test that cannot fail pre-fix is not accepted.
2. A test proving the `TVASHTR_LIVE_CONTAINER_REGISTRY` override is honoured.
3. `make test` ≥ **667** passed · `make lint` clean · `make build-frontend` clean.
4. `make reaper-check` still **PASSES** end to end — paste its output.
5. The rider (section 5) applied.
6. Branch `feat/m-reaper-hostglobal`; commit **only** your own changed paths. Never `git add -A`.
   Leave untracked: `design/`, `DEEPDIVE-*.md`, `Making Small Models*.md`, `NVIDIA's*.md`,
   `prompts/*.md`.
7. Print `READY_TO_MERGE` + the branch tip sha.

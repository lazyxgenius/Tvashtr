# M-h2b — Fly durability + economics: suspend-on-gate · the orphan reaper · the durable handle across a backend restart

**Read this whole file before writing code. Start from `main` @ `5bc2c25` (alembic head `0030`; floors 776 backend / 379 vitest). Branch: `feat/m-h2b-fly-durability`.**

## Outcome (one milestone)
A **hosted (Fly) run survives the backend process dying while parked at a human-approval gate**: on backend restart + gate approval it **resumes against its existing per-run microVM and ships a real PR** — with no re-boot of a new machine and no re-clone. While parked at the gate the machine is **SUSPENDED** (Fly *suspend*, storage-only billing, no CPU/RAM charge). Any **orphaned `tv-run-*` Fly app** (left behind by a crash/skip) is **reaped**. **NO new migration** — the durable handle is storage-free. The Docker sandbox path stays **byte-identical**.

This is the durability + economics layer on top of M-h2a (which made hosted runs isolated + demoable). Three pieces + zero migration.

---

## Piece 1 — Suspend on a human gate (Fly *suspend*, NOT *stop*)

**Why suspend, not stop:** a *stopped* machine is completely reset to its original state on restart — it throws the agent's whole conversation away. *Suspend* snapshots memory (Firecracker snapshot) and a later start resumes from it. A run parked at an approval gate (park at 11pm, approve at 8am) would otherwise hold a live paid VM for nine hours; suspend drops it to **storage-only billing (no CPU/RAM charge)** for the wait.

**Fly facts (verified against Fly docs 2026; re-verify live before relying):**
- Suspend: `POST {FLY_MACHINES_API}/apps/<app>/machines/<machine_id>/suspend`
- Confirm suspended (bounded, best-effort): `GET .../machines/<id>/wait?state=suspended`
- Resume = the **standard start**: `POST .../machines/<id>/start`. Resume is **best-effort**: Fly attempts snapshot-restore (typically a few hundred ms) but may **silently cold-boot** (host migration / capacity / maintenance / snapshot loss). On a cold boot the **rootfs is NOT reset** (so `/workspace/<node_id>` survives) — only in-memory conversations are lost. "Always design for both resume and cold-start paths."
- **Suspend REQUIREMENTS the machine must meet:** **≤ 2 GB RAM**, **no swap**, **no schedule**, **no GPU**, machine current. M-h2a's `machine_config` already has no swap/schedule/GPU; its guest is **2048 MB (exactly the boundary)** and M-h2a MEASURED only **570 MB** peak. **Drop `fly_guest_memory_mb` default to 1024** (comfortably under the limit → suspend-eligible; smaller/faster snapshot; cheaper running). Keep it a knob (`TVASHTR_FLY_GUEST_MEMORY_MB`).
- After resume the machine "thinks its connections are still live" → first calls may `ECONNRESET`/timeout. Mitigation: `wait_healthy` after start re-establishes the backend↔machine connection; the agent's existing BYOK retry envelope covers a stale first LLM call. Clock lags a few seconds until NTP — benign here (the session key is a static header compare, not a JWT; LLM auth is a static provider key).

**The seam (where suspend fires):**
- Add to `engines/fly_machines.py`: `suspend_machine(app, machine_id)`, `wait_suspended(app, machine_id, timeout_s)` (best-effort), `start_machine(app, machine_id)` (resume), `get_run_machine(app)` (`GET .../machines` → the app's single machine's `id` / `state` / `private_ip`). All pure `httpx`, scrubbed errors, mirror the existing methods.
- Add to `engines/openhands_fly_adapter.py`: `suspend_run_machine(run_id)` — suspend the run's machine via the in-process handle and mark it suspended. Best-effort (a suspend failure logs + returns; never fails the run — worst case the machine keeps billing during the wait, which is strictly no worse than today).
- In `control_plane/team_run.py`, add a **`@DBOS.step` `suspend_fly_machine_step(run_id)`** and call it **right BEFORE each `wait_at_gate(...)`** in the workflow body — both the human/escalation gate arm and the `budget_approval` gate — **gated at the call site on `get_settings().agent_sandbox_mode == "fly"`** (so docker/local runs' DBOS step sequences are UNCHANGED — the step is simply absent from their walk). As a step, a crash-replay returns its recorded output and does NOT re-suspend (and so never needs the lost in-process handle).
- **Resume is LAZY** — the next agent node's boot ensures the machine is started (see Piece 3's `_ensure_run_sandbox`, which resumes a suspended machine + `wait_healthy`). If a terminal (ship/stop) follows the gate instead of an agent node, the suspended machine is simply **deleted at teardown** (`delete_app` works on a suspended machine). One reconstruction/resume path, **snapshot-agnostic** (identical whether Fly restored the snapshot or cold-booted — the next node opens a fresh conversation either way).
- **`control_plane/gates.py` MUST NOT change** (it stays free of `openhands`/`litellm`/engine imports — suspend does NOT go there).

**UX:** park at a gate at 11pm → the machine suspends (storage-only billing) → approve at 8am → brief resume → the team picks up mid-thought (or re-seeds from where it left off if Fly had to cold-boot) → not billed for compute while it waited.

---

## Piece 2 — The orphan reaper (`tv-run-*` apps)

M-h2a guarantees only no *self*-leak (teardown in a `finally` + the run-end `close_run_sandboxes` hook). A backend crash mid-run before teardown — or a cancel/skip that missed teardown — can orphan a `tv-run-*` app that bills. The reaper closes that.

**Liveness signal = the `runs` table (NOT a host pid registry).** Fly apps are cross-process/cross-host durable, so the DB is the source of truth for "is this run alive." Reconcile Fly's real app list against `runs`:
- Add `list_apps()` to `fly_machines.py`: `GET {FLY_MACHINES_API}/apps?org_slug=<org>` → the org's apps + names. (M-h2a's live gate already hit this endpoint for its `total_apps` proof.)
- For each app whose name **starts with `tv-run-`**: parse the run_id, look up `Run.status`. **KEEP** iff status ∈ `{pending, running, awaiting_human}` (an `awaiting_human` = a legitimately parked/suspended run — MUST be spared). **REAP** (`delete_app`) iff the Run is **terminal** (`completed/failed/rejected/cancelled/over_budget`) **or the Run row is absent** (deleted run).
- **Any app whose name does NOT start with `tv-run-` is NEVER touched** — the org's one pre-existing app `cryptoground-data` does not match the prefix. This is a written invariant: **assert `cryptoground-data` is never deleted by name in a unit test** (mock a list containing `cryptoground-data` + a terminal-run `tv-run-X` + a live-run `tv-run-Y`; only `tv-run-X` is deleted).
- No grace window is needed: an app only exists once its Run row exists with a non-terminal status (the Run is created before the workflow, the app is created inside it), so there is no window where a live app lacks a protecting Run row.

**Cadence — boot sweep + periodic (both here):**
- **Boot sweep:** a new `sweep_orphaned_fly_apps()` called in `main.py`'s `_lifespan` **before DBOS recovery** (like the existing `sweep_orphaned_agent_containers()`), **guarded to `agent_sandbox_mode == "fly"`**, `openhands`-free, **never-raising** (Fly API down / DB not ready → log + skip; startup must never block). Catches backend-crash orphans on the next restart.
- **Periodic sweep:** a **`@DBOS.scheduled("*/10 * * * *")`** workflow that, in fly mode, calls the same reap function. Catches an orphan that lingers **while the backend is up** (a skipped/failed teardown, a cancel). Never-raising. Defense in depth with the boot sweep.

**UX:** none — pure cost hygiene ("no orphaned VMs billing forever").

---

## Piece 3 — The durable handle across a backend restart (storage-free — NO migration)

**The gap:** the per-run machine handle (address, the per-run key, the per-node conversations) lives in the in-process `_RUNS` dict, filled as a side effect inside `agent_run_step`. On a backend restart, DBOS re-enters `run_team` and **replays completed steps from their checkpoints** — it does NOT re-run them, so it does NOT refill `_RUNS`. But the Fly app still exists (suspended). So a fresh process can't currently re-attach — and `create_app` on the existing app would 409.

**Fix — reconstruct, do not persist. Everything the backend needs is derivable from the run_id or readable back off Fly live:**
- **App name / flycast host** — derived from run_id (`app_name_for_run` / `flycast_host`), free.
- **machine_id / state / private_ip** — re-discovered via `get_run_machine(app)` (the app has exactly one machine).
- **The per-run session key** — **replace `mint_session_key()` (random) with `derive_session_key(run_id) = HMAC-SHA256(fly_session_secret, run_id)`** (urlsafe-encoded), used at BOTH create and reconstruct so they agree. Same input → same key, so a fresh backend re-cuts the identical key **without ever storing it** (honors the C8 "the per-run key is never logged/persisted/serialized" invariant). New config `TVASHTR_FLY_SESSION_SECRET` (dev-insecure default like `session_secret`/`secret_key`; must be stable + strong in prod; document in `.env.example`). Still fresh-per-run; the M-h2a key fence (unkeyed `/api/*` → 401) still holds.
- **Conversation ids are NOT persisted** — a node that already ran and would run *again* after a restart re-attaching to its conversation is the already-deferred "agent-native resume (Option B)". The safe fallback is a re-run seeded from the host workspace (the durable source of truth) — exactly the existing coarse-agent-step behavior. Do not build conversation-id re-attach here.

**The reconstruction path — extend the adapter's per-run boot into `_ensure_run_sandbox(run_id)`:**
1. In-process HIT (`_RUNS[run_id]` present): if the handle is marked suspended, `start_machine` + `wait_healthy` (resume) + clear the flag; return it.
2. App exists on Fly but no in-process handle (a fresh process after a restart): **reconstruct** — `get_run_machine(app)` → if `state == suspended`, `start_machine` + `wait_healthy`; re-derive the key; build a `_FlyRunSandbox` with an EMPTY nodes dict; store in `_RUNS`; return it. **Do NOT `create_app`.**
3. Neither (a brand-new run's first node): the existing fresh-boot path (`start_run_sandbox`), with the key now HMAC-derived.

The next node after a restart is a MISS in the reconstructed empty `_RUNS` → it opens a fresh conversation + working dir + re-seeds from the host dir (which survived on disk). Correctness rests on the host workspace + DBOS checkpoints, never on guest RAM — so a cold-boot resume degrades gracefully to a node re-run.

**NO new table. The reaper uses the existing `runs` table. → NO migration `0031`. Head stays `0030`; the freeze is NOT bumped.**

**UX:** overnight the backend restarts (crash/reboot) → you click Approve in the morning → the run reconstructs its microVM handle from the run_id + the server secret, resumes the suspended machine, and ships. The run no longer depends on one process staying alive for hours — only on the run_id and a secret that never left `.env`.

---

## Hard invariants (express AS acceptance evidence — checkable on disk)
- **NO migration.** Alembic head stays `0030`; the freeze hook is NOT bumped (it already allows `0031`, but the slice adds none). Echo `alembic heads` / `alembic current` = `0030`.
- **The Docker path stays byte-identical.** These four files' git blob SHAs must equal `main`'s: `engines/openhands_docker_adapter.py` = `a7db0684e84d…`, `engines/docker_runtime.py` = `af15fca9041d…`, `engines/sandbox_cache.py` = `e2645c855e64…`, `engines/base.py` = `9593aa76ddb7…`. `control_plane/gates.py` also unchanged. Diff each vs `main` and echo the result. Only the *fly* files + `team_run.py` + `main.py` + `config.py` + `.env.example` change.
- **The per-run key is NEVER persisted.** No DB row, no DBOS step checkpoint, no log line carries it. A test asserts the key is derived (deterministic given run_id + secret) and never returned/stored.
- **Suspend, not stop.** A test asserts the gate path calls `/suspend` (not `/stop`); assert resume goes through `/start`. Assert `fly_guest_memory_mb` default is ≤ 2048 (1024) so suspend is eligible.
- **The reaper never touches a non-`tv-run-*` app** — asserted by name (`cryptoground-data`) with a mocked app list.
- **Every Fly UNIT test fakes the API** — bind `httpx.MockTransport` + a fake token; NO socket opens, NO spend (the Makefile leaks the real token into `make test`). Mirror M-h2a exactly.
- **Reproduce-first on any bug you fix** — a regression confirmed RED on the pre-fix code (quote the failing assertion), then GREEN.

## Acceptance / evidence — YOU run ALL of it and debug to green BEFORE `READY_TO_MERGE`
Never hand the operator commands to run. Echo each piece of evidence into the chat as it passes.
- `make test` — GREEN, floor ≥ 776 (report the new count). `make lint` — clean.
- `make build-frontend` + vitest — GREEN, ≥ 379 (this milestone is backend-only; confirm no FE regression).
- The four Docker blob-SHA diffs vs `main` = empty; `gates.py` diff vs `main` = empty; `alembic current` = `0030` (echo all).
- **Live gate — `make fly-suspend-restart-e2e`** (new; extends `scripts/skeleton_crash_demo.sh`'s real kill+restart shape + `scripts/github_pr_fly_e2e_check.py`'s Fly setup): a hosted `fly`-sandbox run that PARKS at a genuinely-blocking approval gate (do NOT auto-approve the target gate — it must reach `Run.status == "awaiting_human"` with the machine SUSPENDED) → **`kill -9` the backend process** → **restart** it (DBOS recovery re-enters the workflow, re-blocks on the gate, machine still suspended) → **resolve the gate via the real approve API** → the run **reconstructs the handle from Fly + the HMAC key, resumes the suspended machine, and opens a REAL PR** (operator consented). Assert + echo: the machine reached `suspended`; after restart NO new `tv-run-*` app was created (the existing one was reused — reconstruct, not re-create); `run.status=completed`; a non-empty `pr_url`; the app deleted after. Skips cleanly without the token/keys. Spends real money. NOT in `make test`. **Needs the WireGuard `tvashtr-wg` tunnel ACTIVE.**
- **Live gate — `make fly-reaper-check`** (new; mirrors `make reaper-check`): create a real `tv-run-<fake terminal run>` Fly app → run `sweep_orphaned_fly_apps()` → assert it is DELETED; create a `tv-run-*` app for a LIVE run row → assert it SURVIVES; assert `cryptoground-data` (the pre-existing app) is untouched. Tears down its fixtures in a `finally`. Skips cleanly without the token. NOT in `make test`. Needs the tunnel.
- Offline coverage (in `make test`, all mocked): `_ensure_run_sandbox` reconstruction when `_RUNS` is empty + the app exists (mocked Fly) — re-derives the key, re-discovers the machine, resumes a suspended machine, does NOT `create_app`; the suspend step is fly-mode-gated and replay-safe; the reaper's keep/reap/never-touch-non-`tv-run` logic; the HMAC key is deterministic + never stored; suspend requirements (guest ≤ 2 GB, no swap/schedule/GPU) hold in `machine_config`.

## Stop conditions (write `NEEDS_HUMAN` to `STATE.md` and stop)
- An **external blocker** (Fly API surface differs from the above and the correct call is unclear; the tunnel is down so a live gate can't run; a provider outage).
- Distinguish clearly: **a second/unknown problem that would need a broad or unproven change → STOP + `NEEDS_HUMAN`** (e.g., suspend/resume behaves unexpectedly on real Fly in a way that needs a design change; the true process-restart proof is genuinely impractical in this environment). **A code-proven, contained, regression-guarded fix → may proceed.**
- A hard turn cap: if you are not at `READY_TO_MERGE` after a long, clearly-stalled stretch, stop and write `NEEDS_HUMAN` with the exact blocker.

## Definition of done
All of the above GREEN and echoed; the branch is a clean linear chain off `5bc2c25`; nothing pushed (the operator merges); end with a single `READY_TO_MERGE` line naming the branch tip SHA + the new backend/vitest floors.

# M-h2a — the Fly sandbox works at all: per-run microVM + the two fences + a real PR through it

> Architect brief for Tvashtr-70's launch. The `/goal` points here. This brief SUPERSEDES
> `CLI-RULES.md` §7 for this run, and overrides CLI-RULES anywhere they conflict — the ground truth
> below is architect-verified on disk. Read it FULLY before writing any code.

---

## 1. Objective (one sentence)

Make a **hosted** run execute its agent inside a **throwaway Fly Firecracker microVM, one machine per
run**, on the user's **own private network**, reached only through a **one-way Flycast door** behind a
**per-run API key** — and prove it by cloning a real GitHub repo and opening a **real Pull Request**
whose agent work ran on Fly, with the **Docker path left byte-identical** as the control harness.

Branch: **`feat/m-h2a-fly-sandbox`**

This is **M-h2a only**. M-h2b (suspend-on-gate, the reaper, the durable-handle-across-backend-restart
proof + its migration) is a SEPARATE later milestone — see §9. Do not build it here.

---

## 2. Ground truth (architect-verified on disk — trust THIS over CLI-RULES §2/§4.6/§7, which are STALE)

- `main` @ **`16cb41d`**. **No `[remote]` in `.git/config`** — pushing Tvashtr's own repo is
  structurally impossible. (The push you rely on is *product* code pushing the USER's repo to GitHub
  via the already-shipped M-h1b chain — a different thing, and not what you build here.)
- Alembic head **`0030_hosted_github_run`**. Freeze hook blocks `0001`–`0030`, allows `0031`.
  **M-h2a adds NO migration** (§5.4). The head stays `0030`. Do **not** bump the freeze.
- Floors: **737 backend / 379 vitest**. Backend goes UP (new tests + the flake fix makes it
  deterministically green). Vitest stays **≥ 379** — the frontend is untouched this milestone.
- Agent model is **DeepSeek** (`.env` `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`). CLI-RULES §4.6
  ("proven model = `nvidia_nim/…70b`") and §2 ("head `0014`", test counts) are STALE — ignore them.
- **The sandbox seam you extend:** `config.py` has
  `agent_sandbox_mode: Literal["local", "docker"]` (alias `TVASHTR_AGENT_SANDBOX`, default `docker`).
  `control_plane/team_run.py` (~line 1068) maps it to an engine name:
  `engine_name = "openhands-docker" if get_settings().agent_sandbox_mode == "docker" else "openhands"`
  then `resolve_adapter(engine_name)`. `engines/registry.py` dispatches `"openhands"` /
  `"openhands-docker"` to two adapters. **You add a THIRD value `"fly"` → a third engine name
  `"openhands-fly"` → a third adapter.**
- **The Docker adapter is your template, NOT your edit target.** In
  `engines/openhands_docker_adapter.py`: the ONLY Docker-specific work in `run()` is *construct
  `DockerWorkspace(...)` (which starts the container) → the reap step*. Everything else is reusable:
  the LLM build, `Conversation(...)` creation + event streaming, and the pure host↔workspace sync
  helpers `_push_workspace(workspace, host_dir, mode)` / `_pull_workspace(...)` — which operate on any
  object exposing the inherited `RemoteWorkspace` HTTP (`execute_command` / `file_upload` /
  `file_download`). **`RemoteWorkspace(host=…, working_dir=…, api_key=…)` is directly constructible —
  no subclass.**
- **Fly setup is DONE and PROVEN (operator-side, this is real):** org slug **`personal`** (the
  dashboard's `aditya-sharma-664` is a URL handle, NOT the slug); token in `.env` as
  **`TVASHTR_FLY_API_TOKEN`** (org-scoped, 90d); a WireGuard tunnel (App-Store client, tunnel
  **tvashtr-wg**) that must be **Active** for the laptop backend to reach a `.flycast` address —
  proven working via `dig @fdaa:75:f644::3 _apps.internal txt +short` → `"cryptoground-data"`.
- **The operator's default Fly network id is `75:f644`** (every Fly private address is
  `fdaa:<network-id>:…`; the id reads straight off the address). This is a HARD acceptance lever —
  see §5.7.
- **The org's one pre-existing app is `cryptoground-data`** — it does not match `tv-run-*`.

---

## 3. WHY this shape — read this, it constrains everything below

Today the agent server runs in a Docker container **bound to `127.0.0.1`**, and `DockerWorkspace`
sets `object.__setattr__(self, "api_key", None)` — **the server runs with NO password.** That is safe
today *only* because loopback is the fence: nothing but the host can dial it.

Move that same unauthenticated server to Fly and it must bind the network to be reachable — so it
lands on a network shared with every other tenant's sandbox, the backend, and Postgres. **Naive Fly
is a DOWNGRADE:** Firecracker is a stronger *wall* but a weaker *door* — any tenant's sandbox could
read any other tenant's repo. **So the fence is the whole content of this milestone.** The split from
M-h3 is clean: M-h3 = the agent reaching **OUT** (internet/pip/exfil/spend); **M-h2a = the agent
reaching IN** — to us, and to each other. You are building the door, not the outbound policy.

**The four ratified design decisions you are implementing (do not relitigate them):**

- **D1 — ONE microVM per RUN, not per node.** The trust boundary is between tenants, not between a
  user's own nodes. One machine serves all of a run's nodes, sequentially.
- **D2 — TWO fences, both here.** (a) A **private network per user** (`u<owner_id>-net`), set at
  app-create. (b) The agent server's **`X-Session-API-Key` turned ON**, fresh random per run — because
  what is behind that door is a shell, so belt AND braces.
- **D4 — one machine per run, but ONE WORKING DIR PER NODE** (`/workspace/<node_id>`). Docker gives
  each node its own fresh container ⇒ a fresh empty `/workspace`. A shared `/workspace` on Fly would
  let node B see node A's leftovers and **silently diverge the Fly path from the Docker proof
  harness**. Isolation between a team's nodes is a **folder**, not a VM. You get this for free by
  constructing the `RemoteWorkspace` with `working_dir=/workspace/<node_id>` — the reused
  `_push_workspace` / `_pull_workspace` then target that dir.

(D3 — suspend-on-gate — is **M-h2b**, deliberately out of scope here.)

---

## 4. Tasks

Self-decompose the implementation. The shape below is the contract, not a step list. **USE the
ultracode / dynamic-workflows / superpowers skills** as instructed in the init prompt.

### Task A — PROVE UNVERIFIED-(a) FIRST, cheaply, before wiring the full adapter

The entire D1+D4 shape rests on one unproven fact: **does one OpenHands agent server host N
*sequential* conversations, one per node, each in its own working dir?** Nodes are sequential in the
graph walk, so this is N-sequential, not N-concurrent — but it is UNPROVEN.

Before building the full run path, write a **minimal live probe** (a `scripts/` throwaway, skips
cleanly without the Fly token + tunnel): create ONE Fly machine from the agent image, then against its
one agent server open **≥ 2 sequential `Conversation`s**, each bound to a `RemoteWorkspace` with a
**different** `working_dir` (`/workspace/n1`, `/workspace/n2`), each running a trivial instruction
(e.g. "write hello to ./out.txt"), and confirm **both complete and each writes into its own dir**.
Tear the machine down in a `finally`. Echo the result.

**STOP CONDITION:** if one server cannot host N sequential node-conversations, write
`NEEDS_HUMAN: one Fly agent server cannot host N sequential per-node conversations — D1/D4 shape needs
review` to `STATE.md` and STOP. **Do NOT improvise a per-node-machine rewrite** — that reopens D1 and
is an architect call, not yours.

### Task B — the flake ride-along (do early; it makes `make test` deterministically green)

`backend/tests/test_auth.py::test_session_cookie_signs_reads_and_expires` line 204:
`tampered = value[:-1] + ("A" if value[-1] != "A" else "B")`. itsdangerous signs with a 20-byte HMAC →
base64 **without padding**; Python writes the final char's 2 slack bits as zero, so the last char is
one of only **16** values, and `'A'`→`'B'` (when the last char *is* `'A'`, ~1/16 of runs) flips only a
discarded slack bit → **identical decoded signature bytes** → the "tamper" is a **no-op** → the cookie
still validates → `assert … is None` FAILS. ~6% phantom red per `make test`; PRE-EXISTING since
M-accounts.

**Reproduce-first (deterministic):** demonstrate the no-op class deterministically — e.g. construct or
select a cookie whose signature's last base64 char lands in the zero-low-2-bits set and show the
current tamper leaves `read_session_cookie` returning the uid (RED). **Fix:** mutate a signature
**DATA byte** (flip a byte in the middle of the signature payload), which deterministically
invalidates. Confirm GREEN and deterministic. Floor 737 holds and stops flaking.

### Task C — config: the `"fly"` sandbox value + the Fly knobs

- Extend `agent_sandbox_mode` to `Literal["local", "docker", "fly"]` (default stays `docker`).
- Add Fly config knobs (env-dialable, sane defaults, follow the existing `agent_server_image` /
  `Field(validation_alias=AliasChoices(...))` style):
  - `fly_api_token` (alias `TVASHTR_FLY_API_TOKEN`) — already present in `.env`.
  - `fly_org` (default `"personal"`), `fly_region` (default `"bom"`).
  - `fly_agent_image` (alias `TVASHTR_FLY_AGENT_IMAGE`) — **default to the same value as
    `agent_server_image`** (the heavy image), so Fly works out of the box AND can be pointed at a slim
    image later. THE image is the cost lever (§6).
  - guest size knobs (e.g. `fly_guest_cpus`, `fly_guest_memory_mb`) — sane defaults, tunable.
- Document all new knobs in `.env.example` (commented, matching the file's convention). **Never** put
  the real token in `.env.example`.
- Config tests mirroring `backend/tests/test_config_sandbox.py`: the `"fly"` value + each knob's
  default + its env override.

### Task D — the Fly machine lifecycle module (NEW file — all `httpx`, NO CLI shell-out)

New module (e.g. `engines/fly_machines.py` or `control_plane/fly_machines.py` — your call, keep it
openhands-free). **The whole point is NO CLI shell-out** — the Docker-CLI shell-out is the *registered
blocker*; do not repeat it. Machines lifecycle is REST; IP allocation is one GraphQL mutation:

- `POST https://api.machines.dev/v1/apps` with `{"app_name": "tv-run-<run_id>", "org_slug":
  "<fly_org>", "network": "u<owner_id>-net"}`. **The network is set at app-create and can NEVER
  change ⇒ isolation granularity IS the app.** Derive `<owner_id>` from the run's owner; sanitize both
  the app name (`^[a-z0-9-]+$`, ≤63) and the network name to Fly-valid strings.
- Allocate a **Flycast** IP via GraphQL `mutation { allocateIpAddress(input:{appId, type: private_v6})
  { … } }` at `https://api.fly.io/graphql`. **Allocate it on the DEFAULT network, not the run's
  network — this is the one-way door:** the backend (default net) can reach the run app; the run app
  can NEVER dial back ("won't be accessible via Flycast from its own network"). An app with a Flycast
  address gets DNS at **`<app-name>.flycast`** ⇒ no IP bookkeeping.
- `POST …/apps/<name>/machines` with the guest config + `image=<fly_agent_image>` + the agent server's
  own flags `--host 0.0.0.0 --port 8000` (Flycast requires binding `0.0.0.0` — exactly what Docker
  already passes; do NOT use `fly-local-6pn`). Then `GET …/machines/<id>/wait?state=started`.
- Teardown: `DELETE …/v1/apps/<name>` — **atomic and total** (machine + Flycast IP + everything). The
  #1 way to burn money on Fly is a machine that outlives its job.
- **Report the machine's `private_ip`** (needed for the §5.7 fence check) and **measure**: image pull
  + cold-boot seconds, and (if readable) observed peak guest memory.

**Unit tests MUST fake the Fly API entirely** (§5.5) — construct a fake `httpx` transport / monkeypatch
the client; assert the exact request bodies (app name, `network: u<owner>-net`, Flycast allocation on
the default net, the machine image + `--host 0.0.0.0`, the DELETE on teardown) and simulate the
`wait?state=started` transition. **No unit test may reach the real API or spend a cent.**

### Task E — the Fly engine adapter (NEW file `engines/openhands_fly_adapter.py`)

Mirror `OpenHandsDockerAdapter.run()`, but:
- **REUSE, do not copy-then-diverge, and do NOT modify** the pure helpers from
  `openhands_docker_adapter.py` — import `_push_workspace`, `_pull_workspace`, and the LLM-build helper
  and call them unchanged. (If a helper is not importable cleanly, prefer a tiny refactor that **leaves
  the Docker file byte-identical** — extract the shared pure function into a NEW shared module and have
  the docker adapter import it; but that changes the docker file, which §5.1 forbids. So the safe path
  is: import the existing helpers as-is. Only if that is genuinely impossible, STOP and `NEEDS_HUMAN`.)
- **Per-run machine, reused across nodes:** key an in-process cache by **`run_id`** (parse it from
  `task.session_key`, which is `"{run_id}::{node_id}"`). First node of a run ⇒ create the machine +
  allocate Flycast + wait started. Later nodes of the same run ⇒ reuse it. Use a NEW small cache in
  this adapter — **do NOT touch `engines/sandbox_cache.py`** (that is the Docker path's, and §5.1
  forbids touching it).
- **Per-node working dir + fresh conversation:** for each node, construct
  `RemoteWorkspace(host="http://tv-run-<run_id>.flycast:8000", working_dir="/workspace/<node_id>",
  api_key=<the per-run key>)` and a fresh `Conversation` bound to it (this is the same
  `RemoteConversation`-by-id path the Docker adapter uses). Within a node's own repeated goals (same
  `session_key`) reuse its conversation, exactly as the Docker adapter reuses across rounds.
- **The per-run API key is ON (D2b):** mint a **fresh random** key per run, hold it in the run's cache
  entry, pass it as the `RemoteWorkspace` `api_key` (→ the `X-Session-API-Key` header). The Fly agent
  server is **NOT** passwordless (unlike the Docker path, which nulls it). The machine must be told the
  same key so it requires it — pass it to the agent server at machine create (env/arg per the image's
  contract; read the image's server flags). Assert the header is set on the workspace (§5.6).
- **Proxy stays OFF for M-h2a** (the live gate runs proxy-off / BYOK, the owner's DeepSeek key via
  `task.llm_api_key`, exactly like `github-pr-e2e`). The agent inside the Fly machine reaches its
  provider directly — Fly egress is open by default; **restricting egress is M-h3, not here.**
- Teardown the run's machine (the whole app) when the run's last node is done — and in a `finally`
  path so a mid-run failure still tears down. (Cross-run orphan reaping is M-h2b; here, just don't leak
  the app you created.)

Unit-test with BOTH the Fly API and the workspace/Conversation faked: the two-level cache
(machine-per-run, working-dir+conversation-per-node), the per-run key threading, and the D4 per-node
working dir. `test_docker_adapter.py` is the shape to mirror.

### Task F — wire the dispatch

- `engines/registry.py`: add the `"openhands-fly"` branch (lazy import of the new adapter, same shape
  as the other two).
- `team_run.py` (~1068): make the engine-name selection 3-way so
  `agent_sandbox_mode == "fly"` → `"openhands-fly"`. Keep `local`/`docker` byte-behaviour identical
  (a dict or an explicit 3-branch — your call; the change is small).
- `test_registry.py`: the new engine name resolves to the new adapter.

### Task G — the live gate: `make github-pr-fly-e2e`

**This gate runs a REAL agent inside a REAL Fly microVM and opens a REAL PR on
`lazyxgenius/trade_mcp` (this will be pull/3 — the operator has consented in advance).**

- Mirror the existing `github-pr-e2e` recipe + `scripts/github_pr_e2e_check.py` (read them), but set
  **`TVASHTR_AGENT_SANDBOX=fly`** inline (a posture, not a model pin — never hardcode a model slug;
  `TVASHTR_PR_FLY_E2E_MODEL ?= $(TVASHTR_AGENT_MODEL)`). Use the same defensive `.env` loader.
- **Skip cleanly** (exit 0, "not a failure") when `TVASHTR_FLY_API_TOKEN`, `GITHUB_APP_*`, or the
  model's provider key are absent. (The tunnel being Active is the operator's prerequisite; if the
  token is present but Flycast is unreachable, that is a §8 infra stop, not a skip.)
- A hosted run clones `lazyxgenius/trade_mcp`, the agent runs **inside the Fly microVM**, and a real PR
  is opened. Keep the idea **trivial** (e.g. add a docstring) — you are proving the **Fly substrate +
  the fences**, not re-proving the agent loop.
- It must assert, and **echo verbatim into the transcript**:
  1. `run.status == 'completed'`, a **terminal DBOS workflow** status, a **non-empty `pr_url`** (print
     the URL so the operator can open/close it).
  2. **THE FENCE:** the run machine's `private_ip` **does NOT contain `75:f644`** (⇒ it is on
     `u<owner>-net`, NOT the default network shared with the backend/Postgres). Print the `private_ip`.
     This is the strongest evidence — off the address, not a config flag.
  3. **The per-run key was ON** (the agent server rejected an unkeyed request, or the workspace carried
     the `X-Session-API-Key` — assert the fence, don't just claim it).
  4. **No leaked app:** after teardown, the `tv-run-<run_id>` app is **gone** (a list/get returns
     absent). Never touch `cryptoground-data`.
- **MEASURE + REPORT** (do not guess): the agent image **size**, the **cold-boot seconds**, and
  observed **peak guest memory**. These feed the guest-size / slim-image tuning lever.
- **Re-runnable:** a second run must not fail on a leftover app/branch/PR from the first (teardown in a
  `finally`, idempotent PR create — the M-h1b `open_pull_request_idempotent` list-first pattern).

---

## 5. Hard invariants (each must be PROVEN, not asserted)

1. **The Docker path is BYTE-IDENTICAL to `main`.** ⚠️ NOT a subtree hash of `engines/` — you ADD a
   new fly file to `engines/`, so its subtree hash WILL change; that is expected. Prove instead that
   these four files are unchanged:
   `git diff main -- backend/tvashtr/engines/openhands_docker_adapter.py backend/tvashtr/engines/docker_runtime.py backend/tvashtr/engines/sandbox_cache.py backend/tvashtr/engines/base.py`
   → **EMPTY output.** Echo the command and its empty result. (`registry.py` and `team_run.py` DO
   change — minimally — and `config.py` gains the fly knobs; those are expected.)
2. **The `local` and `docker` sandbox paths are byte-unchanged in behaviour.** The engine-name
   selection gains a branch; `local`/`docker` resolve exactly as before. The existing suite stays
   green; the docker live gates are unaffected.
3. **`team_run.py` stays openhands-free at import.** The Fly adapter imports `openhands.*` only inside
   the lazily-resolved adapter, exactly like the docker one. The lifecycle module is openhands-free.
4. **NO migration.** Head stays `0030`. The freeze is **NOT** bumped. (`alembic heads` ⇒ `0030`.)
5. **NO Fly unit test EVER reaches the real Fly API or spends a cent.** The `Makefile` does
   `include .env` + `export`, so the **live `TVASHTR_FLY_API_TOKEN` is ambient in `make test`** — pin
   every Fly test to a fake transport / monkeypatched client. Prove `make test` creates no machine
   (the fakes are the proof). Only `make github-pr-fly-e2e` may hit the real API.
6. **The per-run API key is ON.** The Fly agent server is not passwordless — the workspace carries the
   `X-Session-API-Key`, fresh random per run. Assert with a test.
7. **The private-network fence holds off the address.** The run app is created with
   `network=u<owner_id>-net`; the Flycast IP is allocated on the DEFAULT network (one-way door). The
   live gate's `private_ip`-not-`75:f644` check is the proof.
8. **Secrets discipline (the C8 invariant) extends unchanged.** The Fly API token and the per-run key
   are **never persisted, never logged, never serialised into a response, never in an error message**.
   New helpers follow the rule. Assert it.

---

## 6. The cost lever — measure, don't assume

- The **per-user network is FREE** — one interpolated string in a `POST /v1/apps` body already being
  sent. Compute is noise (a ~2GB machine, per-second, dying with the run).
- **THE cost is the IMAGE.** `config.py` says the sandbox image bakes in VSCode + VNC we never open. On
  the laptop that is paid once; on Fly it is paid on **every cold host** — as the operator's bandwidth
  AND the user's stare at "Starting sandbox…". That is why `fly_agent_image` is a knob and why §4.G
  **MEASURES + REPORTS** image size + cold-boot seconds — so tuning to a slim image is an
  evidence-based follow-up, not a guess.
- The **pre-warmed machine pool is REJECTED** (a standing hourly bill with zero users, and it breaks
  the per-user fence). Pay per run. Do not build it.

---

## 7. Acceptance — run every one of these YOURSELF, debug to green, echo the decisive line

Do **not** hand the operator a list of commands to run. Echo each piece of evidence into the chat as
you complete it (CLI-RULES §4.3a).

- [ ] **Task A probe** — the ≥2-sequential-conversations-per-server result echoed (or the §4.A
      `NEEDS_HUMAN` stop).
- [ ] `make test` — **≥ 737** backend passing, and **deterministically green** (the flake is fixed).
      Echo the `=== N passed ===` line.
- [ ] `make lint` — clean. **Re-run the FULL lint AFTER adding the gate/lifecycle/adapter files** (a
      prior session shipped unlinted deliverables by linting before adding them).
- [ ] `make test-frontend` — **≥ 379** vitest (frontend untouched — regression check). Echo the count.
- [ ] `make build-frontend` — green.
- [ ] `make github-pr-fly-e2e` — green, with **all four asserted values** (status+pr_url, the
      `private_ip`-not-`75:f644` fence, the per-run-key proof, the app-deleted proof) and the **three
      measurements** (image size, cold-boot s, peak mem) echoed. PR URL printed.
- [ ] `alembic heads` ⇒ `0030` (unchanged). Echo it.
- [ ] The §5 invariant proofs with their actual output — **especially the empty Docker-file diff**.
- [ ] `READY_TO_MERGE: branch=feat/m-h2a-fly-sandbox, sha=<sha>, tests=<N>` in `STATE.md`.

*(There is no Playwright/visual step — M-h2a is backend + infra; the frontend is untouched. The
hosted-mode visible surface remains a registered pre-M-h4 item, not this milestone's job.)*

## 8. Stop conditions

- **UNVERIFIED-(a) fails** (Task A: one server can't host N sequential per-node conversations) ⇒
  `NEEDS_HUMAN` + STOP. Do NOT rewrite toward per-node machines (reopens D1).
- **The live Fly gate fails for an INFRA reason** — Fly API 5xx, the tunnel is down / Flycast
  unreachable, a machine won't boot — that is **not** a code bug you can prove and contain ⇒
  `NEEDS_HUMAN: <exact reason>` + STOP. **Do not loop retrying a money-spending gate.**
- **A second/unknown problem needing a broad or unproven change ⇒ STOP + `NEEDS_HUMAN`.** A
  code-proven, contained, regression-guarded fix to a SINGLE identified cause may proceed.
- If reusing the Docker adapter's helpers is genuinely impossible without editing a §5.1-frozen Docker
  file ⇒ STOP + `NEEDS_HUMAN` (the refactor boundary is an architect call).
- Hard cap: **70 turns**.
- Emit the CLI-RULES §4.7 **FINAL REPORT** (all sections) at the end, whatever the terminal.

## 9. Explicitly OUT of scope (registered as deferred — do NOT build)

- **M-h2b:** suspend-on-gate (D3 — must be Fly *suspend*, not *stop*); the reaper (list `tv-run-*`,
  kill any app with no live run row, **never** `cryptoground-data`); the durable-handle-across-
  backend-restart proof (the handle becomes `tv-run-<id>.flycast` + a conversation-id — both strings)
  and its migration (`0031`) / persistence-vs-re-derivation of the per-run key.
- **M-h3:** egress policy (the agent reaching OUT — internet/pip/exfil/spend), quotas/abuse caps.
- **M-h4:** deploy, TLS (`set_session_cookie` hardcodes `secure=False`), the domain, the region for
  *users'* machines, Tvashtr's runs in their own org (blast radius), retiring the dev tunnel.
- The pre-warmed machine pool (§6 — rejected; tune only on measured evidence).
- Any frontend change. Any change to `sandbox_cache.py` or the Docker adapter files.

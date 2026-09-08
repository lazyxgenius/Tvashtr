"""The Fly-sandboxed OpenHands engine adapter — Tvashtr's HOSTED ``EngineAdapter`` path (M-h2a).

Same engine-neutral contract as the local and docker adapters (status / events / files_changed /
usage), but the agent server runs inside a **throwaway Fly Firecracker microVM, ONE machine per
RUN**, on the run owner's own private network, reached only through a one-way Flycast door behind a
fresh-per-run ``X-Session-API-Key``.

WHY THIS EXISTS AT ALL — the thing it is defending against. Today's docker sandbox runs the agent
server bound to ``127.0.0.1`` with **no password** (``DockerWorkspace`` literally does
``object.__setattr__(self, "api_key", None)``). That is safe only because loopback is the fence.
Lift that same unauthenticated server onto Fly and it must bind the network to be reachable —
landing
it on a network shared with every other tenant's sandbox, the backend, and Postgres. Naive Fly is
therefore a *downgrade*: Firecracker is a stronger wall but a weaker door. So this adapter is
mostly fence, and the fence is two layers (D2): a **private network per user**, plus the agent
server's session key actually turned **on**.

THE TWO-LEVEL CACHE (D1 + D4), which is the whole structural idea:

- **Per RUN — one microVM.** The trust boundary is between *tenants*, not between a user's own
  nodes, so all of a run's nodes share one machine, sequentially. Keyed by ``run_id``, parsed out of
  ``task.session_key`` (``"{run_id}::{node_id}"``).
- **Per NODE — its own working dir AND its own conversation.** Docker hands every node a fresh
  container ⇒ a fresh empty ``/workspace``. A *shared* ``/workspace`` on Fly would let node B read
  node A's leftovers and silently diverge the Fly path from the docker proof harness — so each node
  gets ``/workspace/<node_id>``. Isolation between a team's own nodes is a **folder**, not a VM.
  Within one node's repeated goals (the Engineer/Reviewer across review-loop rounds) the SAME
  conversation continues, exactly as the docker adapter reuses across rounds.

REUSE, NOT COPY: ``_push_workspace`` / ``_pull_workspace`` and the whole event-mapping + usage-read
helper set are IMPORTED from the docker adapter and the local adapter and called unchanged. They
were already pure functions over anything exposing the inherited ``RemoteWorkspace`` HTTP seam
(``execute_command`` / ``file_upload`` / ``file_download``), which a Fly-backed ``RemoteWorkspace``
is. Nothing in the docker path is edited — it stays byte-identical as the control harness.

TEARDOWN: the run's whole Fly **app** is deleted at run-end via the Control Plane's existing
``close_run_sandboxes(run_id)`` hook — this adapter registers a teardown-only entry in the
engine-neutral ``sandbox_cache`` (its public API, whose documented purpose is exactly "an
adapter-provided ``close``"), with ``container_id=None`` so the docker reaper never sees it. A
mid-run failure that never reached the cache is torn down in this module's own ``finally``. Deleting
the app is atomic and total — machine, Flycast IP and app in one call — because the #1 way to burn
money on Fly is a machine that outlives its job. (Cross-run orphan reaping is M-h2b.)
"""

import logging
import os
import threading
import time
import uuid
from itertools import count

from openhands.sdk import LLM, Agent, Conversation, LLMSummarizingCondenser, Tool
from openhands.sdk.context import AgentContext
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from openhands.sdk.workspace import RemoteWorkspace
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool

from tvashtr.config import agent_llm_routing, get_settings
from tvashtr.engines import sandbox_cache
from tvashtr.engines.base import AgentRunResult, AgentTask, EngineEvent
from tvashtr.engines.fly_machines import (
    FlyMachines,
    FlyRunMachine,
    app_name_for_run,
    derive_session_key,
    parse_egress_ports,
    parse_regions,
)

# The engine-neutral event mapping + post-run usage read, shared with BOTH other adapters so the
# EngineEvent shape is identical across all three sandbox modes.
from tvashtr.engines.openhands_adapter import (
    _MAX_ITERATIONS,
    _is_budget_error,
    _is_provider_error,
    _kind_of,
    _payload_of,
    _read_usage,
    _text_has_budget_signature,
    _text_has_provider_signature,
)

# The host<->workspace sync helpers, REUSED from the docker adapter unchanged (they are pure
# functions over the RemoteWorkspace HTTP seam, which is precisely what a Fly workspace exposes).
# Importing them — rather than extracting them into a new shared module — is what keeps the docker
# files byte-identical to main.
from tvashtr.engines.openhands_docker_adapter import _pull_workspace, _push_workspace

logger = logging.getLogger("tvashtr.engines.openhands_fly")

WORKSPACE_MODE = "fly-microvm"

# Every node's working dir lives under this root (D4). The docker path gets per-node isolation for
# free from a fresh container; on one shared machine it has to be a directory.
_WORKSPACE_ROOT = "/workspace"

# The per-run sandbox registry. Keyed by run_id — NOT by session_key — because the machine is
# per-RUN while conversations are per-NODE. A module-level dict guarded by a lock, exactly like
# ``sandbox_cache``: runs are serial in v1, but the lock keeps a concurrent teardown consistent.
_RUNS: dict[str, "_FlyRunSandbox"] = {}
_LOCK = threading.Lock()

# The sandbox_cache key suffix under which each run registers its teardown hook. It is a reserved
# pseudo-node id: ``close_run_sandboxes`` matches entries by the run_id BEFORE the "::", so this
# rides the existing run-end teardown with no change to the Control Plane.
_TEARDOWN_NODE = "__fly_machine__"


class _FlyNodeHandle:
    """One node's live state on the shared machine: its own ``RemoteWorkspace`` (pinned to
    ``/workspace/<node_id>``) plus the live ``RemoteConversation`` bound to it, and a repointable
    event ``sink``.

    The sink indirection is load-bearing for round-to-round reuse, exactly as in the docker adapter:
    the Conversation's callback is bound ONCE at construction to :meth:`dispatch`, and each round
    repoints ``sink`` at that round's collector closure — a reused Conversation must stream into
    THIS round's collector, not round 1's stale one."""

    def __init__(self, workspace: RemoteWorkspace) -> None:
        self.workspace = workspace
        self.conversation = None
        self.sink = None

    def dispatch(self, oh_event) -> None:
        sink = self.sink
        if sink is not None:
            sink(oh_event)


class _FlyRunSandbox:
    """One run's microVM: the Fly client, the live machine, the per-run session key, and the
    per-node handles that share it.

    The session key is held HERE — in process memory, for the life of the run — and deliberately
    nowhere else: not on the ``FlyRunMachine`` (which gets logged), not in the DB, not in any step
    checkpoint. **M-h2b answered the "persist vs re-derive across a restart" question with
    RE-DERIVE** (:func:`~tvashtr.engines.fly_machines.derive_session_key`): the key is a pure
    function of the run_id and the server secret, so a fresh process re-cuts it on demand and the
    "never persisted" invariant survives durability."""

    def __init__(
        self, fly: FlyMachines, machine, session_api_key: str, *, suspended: bool = False
    ) -> None:
        self.fly = fly
        self.machine = machine
        self.session_api_key = session_api_key
        self.nodes: dict[str, _FlyNodeHandle] = {}
        # M-h2b: set when the workflow suspended this machine at a gate, so the next node's boot
        # knows to resume it. In-process bookkeeping only — the DURABLE reading of the same fact is
        # the machine's own ``state`` on Fly, which is what the reconstruct path consults instead.
        self.suspended = suspended

    def resume_if_suspended(self, *, health_timeout_s: float = 300.0) -> bool:
        """Start a suspended machine and wait for its agent server to answer again. Returns whether
        a resume actually happened.

        The ``wait_healthy`` is NOT optional padding. A machine that has just resumed "thinks its
        connections are still live", so the first calls across the Flycast door can ``ECONNRESET``
        or hang; re-establishing the backend↔machine connection here is what turns that into a
        non-event. It also transparently covers the case where Fly COLD-BOOTED instead of restoring
        the snapshot — the agent server takes longer to answer, and we simply wait for it."""
        if not self.suspended:
            return False
        logger.warning(
            "OpenHandsFlyAdapter (%s): resuming suspended machine %s (app=%s)",
            WORKSPACE_MODE,
            self.machine.machine_id,
            self.machine.app_name,
        )
        self.fly.start_machine(self.machine.app_name, self.machine.machine_id)
        self.fly.wait_healthy(self.machine.flycast_host, timeout_s=health_timeout_s)
        self.suspended = False
        return True

    def suspend(self) -> bool:
        """Suspend this run's machine (Firecracker memory snapshot; storage-only billing).

        Best-effort by construction: returns ``False`` and logs rather than raising, because the
        only
        thing a failed suspend costs is money we were already spending. A run must never fail
        because an economy measure did."""
        try:
            self.fly.suspend_machine(self.machine.app_name, self.machine.machine_id)
        except Exception:
            logger.warning(
                "fly: suspend failed for app %s (machine keeps billing)",
                self.machine.app_name,
                exc_info=True,
            )
            return False
        self.suspended = True
        self.fly.wait_suspended(self.machine.app_name, self.machine.machine_id)
        return True

    def close(self) -> None:
        """Destroy the whole app (machine + Flycast IP + app) and drop the HTTP client. Works on a
        SUSPENDED machine too — ``DELETE /v1/apps/<name>`` is total regardless of machine state, so
        a run that ends at a terminal right after a gate never needs waking up just to be
        destroyed."""
        try:
            self.fly.delete_app(self.machine.app_name)
        finally:
            self.fly.close()


def _resolve_owner_id(run_id: str | None) -> str:
    """The owner whose private network this run's app joins (D2a).

    Resolved from the DB by run_id, mirroring how ``team_run._owner_api_key`` resolves the owner for
    BYOK. ``AgentTask`` cannot carry it: ``engines/base.py`` is frozen byte-identical this
    milestone,
    so an additive field is not available.

    FALLBACK: when there is no run row to read (``session_key`` unset — the older/test call sites
    that thread no key), fall back to the run's own id as the network discriminator. That yields a
    network per RUN rather than per USER, which is *stricter*, never looser — a fence that fails
    closed."""
    if run_id:
        try:
            from sqlalchemy import select

            from tvashtr.db import session_scope
            from tvashtr.models import Run

            with session_scope() as session:
                owner_id = session.execute(
                    select(Run.owner_id).where(Run.id == uuid.UUID(run_id))
                ).scalar_one_or_none()
            if owner_id is not None:
                return str(owner_id)
        except Exception:
            # Never let an owner lookup fail the run — degrade to the stricter per-run network.
            logger.warning("fly: owner lookup failed for run %s; using a per-run network", run_id)
    return run_id or uuid.uuid4().hex


def _new_fly_client() -> FlyMachines:
    """One place that builds the Fly client from settings, so the boot, reconstruct and reap paths
    can never drift apart on org/region/image/guest — or, since M-h3, on the EGRESS ALLOWLIST.

    Parsing the ports HERE (rather than inside ``fly_machines``) is what keeps that module free of
    the app's config layer, exactly as it is free of ``openhands``. A malformed knob therefore
    fails at client construction — loudly, before any app exists — instead of at policy-post time
    with a half-built sandbox already billing. M-h4 threads the REGION LADDER through the same
    seam for the same reason: ``TVASHTR_FLY_REGION`` is now an ordered comma-separated list
    (``"sin,iad,fra"``), and its default single ``"bom"`` parses to a 1-element ladder that behaves
    byte-identically to the pre-M-h4 single-region client."""
    settings = get_settings()
    return FlyMachines(
        token=settings.fly_api_token.get_secret_value(),
        org=settings.fly_org,
        regions=parse_regions(settings.fly_region),
        image=settings.fly_agent_image,
        guest_cpus=settings.fly_guest_cpus,
        guest_memory_mb=settings.fly_guest_memory_mb,
        egress_ports=parse_egress_ports(settings.fly_egress_allowed_ports),
    )


def _ensure_run_sandbox(run_id: str) -> tuple["_FlyRunSandbox", bool]:
    """Return this run's microVM, by whichever of THREE routes applies. ``(sandbox, is_new_here)``,
    where ``is_new_here`` means "newly entered into THIS process's ``_RUNS``" — true for both a
    fresh boot and a reconstruct, because in both cases this process must also register the run-end
    teardown hook (``sandbox_cache`` is process-local and a restart empties it too).

    THE THREE ARMS, in order:

    1. **In-process HIT** — the ordinary case, and the one that must stay cheap. Resume the machine
       first if the workflow suspended it at a gate.
    2. **RECONSTRUCT** (M-h2b Piece 3) — no in-process handle, but the app still exists on Fly. This
       is the backend-restart case: DBOS replays completed steps from their checkpoints rather than
       re-running them, so ``_RUNS`` is never refilled, yet the run's machine is very much alive
       (and paid for). Re-derive the key, re-discover the machine, resume it if suspended, and
       rebuild the handle. **Emphatically NOT ``create_app``** — that would 409 against the existing
       app, and even if it didn't, it would abandon a billing machine and re-clone from scratch.
    3. **Fresh boot** — a genuinely new run's first node.

    The reconstructed handle deliberately carries an **EMPTY nodes dict**. Conversation ids are not
    persisted (agent-native resume is a separate, deferred bet), so the next node is a MISS: it
    opens
    a fresh conversation and re-seeds its working dir from the HOST workspace, which survived on
    disk.
    That makes the path **snapshot-agnostic** — identical whether Fly restored the memory snapshot
    or
    silently cold-booted — so correctness rests on the host workspace + DBOS checkpoints and never
    on guest RAM."""
    with _LOCK:
        existing = _RUNS.get(run_id)
    if existing is not None:
        existing.resume_if_suspended()
        return existing, False

    settings = get_settings()
    # D2b + M-h2b: DERIVED, not minted — the same key is re-cut by any process that knows the
    # run_id and the secret, which is exactly what makes the reconstruct arm above possible.
    session_api_key = derive_session_key(run_id, settings.fly_session_secret.get_secret_value())
    fly = _new_fly_client()
    app_name = app_name_for_run(run_id)

    # --- ARM 2: the app outlived the process that booted it -> re-attach, never re-create.
    try:
        info = fly.get_run_machine(app_name)
    except Exception:
        logger.warning("fly: machine re-discovery failed for %s; booting fresh", app_name)
        info = None
    if info is not None:
        machine = FlyRunMachine(
            app_name=app_name,
            machine_id=info.machine_id,
            private_ip=info.private_ip,
            flycast_address="",  # not needed to dial: flycast_host is derived from app_name
            boot_seconds=0.0,  # this process did not boot it; claiming a number would be a lie
            ready_seconds=0.0,
        )
        sandbox = _FlyRunSandbox(fly, machine, session_api_key, suspended=info.is_suspended)
        logger.warning(
            "OpenHandsFlyAdapter (%s): RECONSTRUCTED run %s from Fly "
            "(app=%s machine=%s state=%s) — no new app, no re-clone",
            WORKSPACE_MODE,
            run_id,
            app_name,
            info.machine_id,
            info.state or "unknown",
        )
        sandbox.resume_if_suspended()
        with _LOCK:
            raced = _RUNS.get(run_id)
            if raced is not None:
                fly.close()
                return raced, False
            _RUNS[run_id] = sandbox
        return sandbox, True

    # An app with NO machine is a husk from a half-finished create. Clear it, or the fresh boot
    # below would 409 on create_app and strand the run.
    try:
        if fly.app_exists(app_name):
            logger.warning("fly: app %s exists with no machine; deleting the husk", app_name)
            fly.delete_app(app_name)
    except Exception:
        logger.warning("fly: husk check failed for %s; attempting a fresh boot", app_name)

    # --- ARM 3: a brand-new run's first node.
    owner_id = _resolve_owner_id(run_id)
    logger.warning(
        "OpenHandsFlyAdapter (%s): booting per-run microVM image=%s region=%s guest=%sc/%sMB",
        WORKSPACE_MODE,
        settings.fly_agent_image,
        settings.fly_region,
        settings.fly_guest_cpus,
        settings.fly_guest_memory_mb,
    )
    machine = fly.start_run_sandbox(
        run_id=run_id, owner_id=owner_id, session_api_key=session_api_key
    )
    logger.warning(
        "OpenHandsFlyAdapter (%s): microVM ready app=%s private_ip=%s boot=%.1fs ready=%.1fs",
        WORKSPACE_MODE,
        machine.app_name,
        machine.private_ip,
        machine.boot_seconds,
        machine.ready_seconds,
    )
    sandbox = _FlyRunSandbox(fly, machine, session_api_key)
    with _LOCK:
        # A concurrent booter would have won the race; prefer the winner and destroy ours.
        raced = _RUNS.get(run_id)
        if raced is not None:
            loser = sandbox
            sandbox = raced
        else:
            _RUNS[run_id] = sandbox
            loser = None
    if loser is not None:
        loser.close()
        return sandbox, False
    return sandbox, True


def suspend_run_machine(run_id: str) -> bool:
    """Suspend ``run_id``'s microVM while the run waits at a human gate. Returns whether it worked.

    **NEVER raises and never fails a run.** Everything this does is an economy measure: the downside
    of failure is that we keep paying for a machine we are already paying for, which is exactly the
    status quo it improves on. A run must not die because a cost optimization did.

    TWO ROUTES, because the in-process handle is not guaranteed to be here:

    1. **In-process handle** — the ordinary path, straight after this run's own agent node ran.
    2. **No handle** — the backend restarted between the agent node and the gate, so ``_RUNS`` is
       empty (DBOS replays completed steps from checkpoints, it does not re-run them). We still
       suspend, by deriving the app name from the run_id and reading the machine back off Fly. This
       deliberately does NOT go through :func:`_ensure_run_sandbox`: that path RESUMES a suspended
       machine, and resuming one purely in order to suspend it again would be perverse. A machine
       that is already suspended, or an app that is already gone, is a no-op."""
    with _LOCK:
        sandbox = _RUNS.get(run_id)
    if sandbox is not None:
        return sandbox.suspend()

    fly = None
    try:
        app_name = app_name_for_run(run_id)
        fly = _new_fly_client()
        info = fly.get_run_machine(app_name)
        if info is None or info.is_suspended:
            return False
        fly.suspend_machine(app_name, info.machine_id)
        fly.wait_suspended(app_name, info.machine_id)
        logger.warning(
            "OpenHandsFlyAdapter (%s): suspended %s for run %s without an in-process handle",
            WORKSPACE_MODE,
            app_name,
            run_id,
        )
        return True
    except Exception:
        logger.warning("fly: handle-free suspend failed for run %s", run_id, exc_info=True)
        return False
    finally:
        if fly is not None:
            fly.close()


def close_run_machine(run_id: str) -> None:
    """Destroy ``run_id``'s microVM and forget it. Idempotent + best-effort — a failing teardown is
    logged, never raised, so it can't break a workflow's terminal (mirrors
    ``sandbox_cache.close_run_sandboxes``). Also the public seam a test uses to assert no leak."""
    with _LOCK:
        sandbox = _RUNS.pop(run_id, None)
    if sandbox is None:
        return
    try:
        sandbox.close()
    except Exception:
        logger.warning("fly: teardown failed for run %s (evicted anyway)", run_id, exc_info=True)


class OpenHandsFlyAdapter:
    """Drive the OpenHands agent inside a per-run Fly microVM behind Tvashtr's ``EngineAdapter``.
    Returns the identical ``AgentRunResult`` shape as the local and docker adapters; the microVM +
    the two fences are the boundary."""

    name = "openhands-fly"

    def run(self, task: AgentTask, on_event=None) -> AgentRunResult:
        settings = get_settings()
        model = task.model or settings.default_model

        # ``task.workspace_dir`` is the HOST dir (created + git-init'd by the setup step) — the
        # pull-target + ship root, not the agent's working dir (which lives in the microVM).
        host_dir = task.workspace_dir
        os.makedirs(host_dir, exist_ok=True)

        # The two-level identity. No session_key (older/test call sites) ⇒ a synthetic single-node
        # run: its own machine, torn down in the finally — byte-for-byte the no-reuse posture.
        run_id = sandbox_cache.run_id_from_session_key(task.session_key)
        ephemeral = run_id is None
        if ephemeral:
            run_id = uuid.uuid4().hex
            node_id = "n0"
        else:
            node_id = task.session_key.split("::", 1)[1] or "n0"

        seq = count()
        collected: list[EngineEvent] = []
        lock = threading.Lock()
        error_event_texts: list[str] = []

        def _on_oh_event(oh_event) -> None:
            if isinstance(oh_event, ConversationErrorEvent):
                # As in docker mode, the SDK genericizes the raised exception over a remote
                # conversation — the proxy's budget message survives only in this event's detail.
                with lock:
                    error_event_texts.append(f"{oh_event.code}: {oh_event.detail}")
            kind = _kind_of(oh_event)
            if kind is None:
                return
            with lock:
                event = EngineEvent(
                    seq=next(seq),
                    kind=kind,
                    payload=_payload_of(oh_event, kind),
                    ts=time.time(),
                )
                collected.append(event)
            if on_event is not None:
                on_event(event)

        status = "completed"
        error: str | None = None
        provider_failure = False
        prompt_tokens = 0
        completion_tokens = 0
        cost_usd = 0.0
        files_changed: list[str] = []
        conversation = None
        handle = None  # M-fail: referenced by the best-effort failure pull in the except block
        usage_before = (0, 0, 0.0)
        try:
            sandbox, created_now = _ensure_run_sandbox(run_id)
            if created_now and not ephemeral:
                # Register the run-end teardown on the engine-neutral cache the Control Plane
                # already calls (``close_run_sandboxes(run_id)``), so the app is destroyed with NO
                # change to team_run.py or sandbox_cache.py. ``container_id=None`` keeps this entry
                # invisible to the docker reaper's keep-set.
                sandbox_cache.put(
                    f"{run_id}::{_TEARDOWN_NODE}",
                    sandbox_cache.CachedSandbox(
                        handle=sandbox,
                        close=lambda rid=run_id: close_run_machine(rid),
                        container_id=None,
                    ),
                )

            handle = sandbox.nodes.get(node_id)
            if handle is None:
                # MISS — this node's first goal. Give it its OWN working dir on the shared machine
                # (D4) and open a fresh conversation bound to it.
                working_dir = f"{_WORKSPACE_ROOT}/{node_id}"
                workspace = RemoteWorkspace(
                    host=sandbox.machine.flycast_host,
                    working_dir=working_dir,
                    api_key=sandbox.session_api_key,  # D2b -> the X-Session-API-Key header
                )
                # The dir must exist before the conversation binds to it.
                workspace.execute_command(f"mkdir -p {working_dir}", cwd="/tmp", timeout=30.0)

                llm = LLM(
                    **agent_llm_routing(settings, model, "fly", api_key_override=task.llm_api_key),
                    temperature=0.0,
                    usage_id="tvashtr-agent",
                    # M-thrift: an EXPLICIT output ceiling. Unset, the SDK resolves the model's own
                    # maximum and litellm sends it as ``max_tokens`` — which OpenRouter reserves
                    # against the key's credit balance before generating anything, 402-ing a
                    # low-balance key on a request that would have cost cents. The condenser's
                    # ``model_copy`` below inherits it.
                    max_output_tokens=settings.agent_max_output_tokens,
                )
                condenser_llm = llm.model_copy(update={"usage_id": "tvashtr-condenser"})
                condenser_llm.reset_metrics()
                agent_context = AgentContext(skills=task.skills) if task.skills else None
                agent = Agent(
                    llm=llm,
                    tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
                    condenser=LLMSummarizingCondenser(
                        llm=condenser_llm,
                        keep_first=2,
                        max_size=80,
                        # M-live: fold on TOKENS too — `max_size` counts events, and a
                        # large-repo transcript overruns the window in far fewer than 80.
                        max_tokens=settings.agent_condenser_max_tokens,
                    ),
                    mcp_config=task.mcp_config or {},
                    agent_context=agent_context,
                )
                handle = _FlyNodeHandle(workspace)
                handle.sink = _on_oh_event
                conversation = Conversation(
                    agent=agent,
                    workspace=workspace,
                    callbacks=[handle.dispatch],
                    max_iteration_per_run=_MAX_ITERATIONS,
                    delete_on_close=False,
                )
                handle.conversation = conversation
                sandbox.nodes[node_id] = handle
                logger.warning(
                    "OpenHandsFlyAdapter (%s): node %s opened on %s (dir=%s)",
                    WORKSPACE_MODE,
                    node_id,
                    sandbox.machine.app_name,
                    working_dir,
                )
            else:
                # HIT — this node's next round. Continue the SAME conversation so the condenser
                # keeps folding the transcript and the agent remembers prior rounds.
                workspace = handle.workspace
                conversation = handle.conversation
                handle.sink = _on_oh_event  # repoint at THIS round's collector
                usage_before = _read_usage(conversation)
                logger.warning(
                    "OpenHandsFlyAdapter (%s): REUSED node %s's conversation (carried %d tokens)",
                    WORKSPACE_MODE,
                    node_id,
                    usage_before[0] + usage_before[1],
                )

            # Seed the node's working dir from the host (the cross-round source of truth the prior
            # round's pull wrote). Reused from the docker adapter, unchanged.
            seeded = _push_workspace(handle.workspace, host_dir, task.workspace_mode)
            if seeded:
                logger.warning(
                    "OpenHandsFlyAdapter (%s): seeded %d file(s) into %s",
                    WORKSPACE_MODE,
                    len(seeded),
                    node_id,
                )
            conversation.send_message(task.instruction)
            conversation.run()

            pa, ca, cost_a = _read_usage(conversation)
            prompt_tokens = max(0, pa - usage_before[0])
            completion_tokens = max(0, ca - usage_before[1])
            cost_usd = max(0.0, cost_a - usage_before[2])
            files_changed = _pull_workspace(
                handle.workspace, host_dir, task.workspace_mode, task.pull_paths
            )
        except Exception as exc:
            budget_hit = _is_budget_error(exc) or any(
                _text_has_budget_signature(t) for t in error_event_texts
            )
            status = "over_budget" if budget_hit else "failed"
            # Tvashtr-79 item 7: the PROVIDER analogue, on the SAME dual surface budget uses — the
            # SDK genericizes the raised exception over a remote conversation, so a hard provider
            # wall (bad key / provider down / unknown model) reaches the host only in the captured
            # ConversationErrorEvent detail. ``status`` stays ``failed``; the additive flag is what
            # the Control Plane reads to fail this node over ONCE to its ``fallback_model``.
            provider_failure = not budget_hit and (
                _is_provider_error(exc)
                or any(_text_has_provider_signature(t) for t in error_event_texts)
            )
            error = str(exc)
            # M-fail METER-ON-FAILURE: meter partial usage for ANY non-completed status, not only
            # the budget cutoff. A run that failed mid-loop still spent money (run 6fd2c911). Same
            # per-round delta, same defensive guard.
            if status != "completed" and conversation is not None:
                pa, ca, cost_a = _read_usage(conversation)
                prompt_tokens = max(0, pa - usage_before[0])
                completion_tokens = max(0, ca - usage_before[1])
                cost_usd = max(0.0, cost_a - usage_before[2])
            # M-fail PULL-ON-FAILURE: the success pull (in the try) is skipped when
            # conversation.run() raises, so a run that FAILED after landing edits lost them ALL.
            # Pull them best-effort HERE, in the EXCEPT (NOT the finally, which destroys an
            # ephemeral run's machine, and a pull after teardown reads nothing). Gated on
            # ``conversation is not None`` so a boot/handshake failure that never ran the agent
            # pulls nothing (ctor-failure tests stay green), plus ``handle`` for the workspace;
            # ``task.pull_paths`` passed UNCHANGED keeps an emitting node verdict-only (Slice-4).
            # It can NEVER mask the original error or status.
            if conversation is not None and handle is not None:
                try:
                    files_changed = _pull_workspace(
                        handle.workspace, host_dir, task.workspace_mode, task.pull_paths
                    )
                except Exception:
                    logger.warning("M-fail: best-effort failure pull failed", exc_info=True)
            logger.exception(
                "OpenHandsFlyAdapter run %s (exc=%r; error_events=%r)",
                "cut off over budget" if status == "over_budget" else "failed",
                str(exc),
                error_event_texts,
            )
        finally:
            # A run that threads a session_key keeps its microVM warm for the next node and is torn
            # down at run-end by ``close_run_sandboxes``. An ephemeral (keyless) call owns its
            # machine outright, so it must destroy it here — otherwise the app bills forever.
            if ephemeral:
                close_run_machine(run_id)

        total_tokens = prompt_tokens + completion_tokens
        if status == "completed" and any(e.kind == "error" for e in collected):
            status = "failed"

        n_action = sum(1 for e in collected if e.kind == "action")
        n_obs = sum(1 for e in collected if e.kind == "observation")
        summary = (
            f"{status}: {len(collected)} events "
            f"({n_action} actions, {n_obs} observations); files_changed={files_changed}"
        )

        return AgentRunResult(
            status=status,
            summary=summary,
            events=collected,
            files_changed=files_changed,
            error=error,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost_usd,
            provider_failure=provider_failure,
        )

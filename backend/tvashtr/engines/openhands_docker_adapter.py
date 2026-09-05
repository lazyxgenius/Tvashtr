"""The Docker-sandboxed OpenHands engine adapter — Tvashtr's containerized
``EngineAdapter`` path (P1.3a, DQ4).

Same engine-neutral contract as the local ``OpenHandsAdapter`` (status / events /
files_changed / usage), but the agent runs **inside an OpenHands Agent Server
container** driven via ``openhands.workspace.DockerWorkspace`` → a
``RemoteConversation``. This is the real containment boundary for the demonstrated
write-escape (the prompt band-aid is no longer load-bearing — see DQ3 in
``team_run``).

Why a *separate* adapter (not a mode branch in ``OpenHandsAdapter``): it leaves the
proven local ``run()`` byte-for-byte untouched (the brief: "the proven machinery is
undisturbed this step") and **isolates the ``openhands.workspace`` import to this
one module**. Like the local adapter, ``openhands.*`` is imported at module top and
the laziness is provided by the registry (which imports this module only when
``resolve_adapter("openhands-docker")`` runs) — app startup and the offline suite
never load it (enforced by the import-boundary test).

Lifecycle (DQ2), all inside the one coarse ``engineer_run_step``: reap any orphaned
agent-server container → start a fresh container (``DockerWorkspace`` ctor) → run
the agent → **pull the agent's files back to the host** (DQ1, no bind-mount) → tear
the container down (``__exit__``). On a ``kill -9`` the container is orphaned and
reaped on the next boot / next run.
"""

import logging
import os
import platform
import shlex
import threading
import time
from itertools import count

from openhands.sdk import LLM, Agent, Conversation, LLMSummarizingCondenser, Tool
from openhands.sdk.context import AgentContext
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool
from openhands.workspace import DockerWorkspace

from tvashtr.config import agent_llm_routing, get_settings
from tvashtr.engines import sandbox_cache
from tvashtr.engines.base import AgentRunResult, AgentTask, EngineEvent
from tvashtr.engines.docker_runtime import (
    enumerate_push_files,
    enumerate_push_files_git,
    reap_agent_containers,
)

# Engine-neutral helpers shared with the local adapter (single source of truth for
# the OpenHands-event -> EngineEvent mapping + the post-run usage read). Reused, not
# duplicated; the local adapter's own ``run()`` is untouched.
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

logger = logging.getLogger("tvashtr.engines.openhands_docker")

WORKSPACE_MODE = "docker-sandboxed"

# The OpenHands Agent Server persists its OWN internal state under the container's
# working dir — the bash tool's event store (``bash_events/``) and the conversation
# /event log (``conversations/``). Those are server scaffolding, NOT the agent's
# deliverable, so the DQ1 pull excludes any file under them. Confirmed live in P1.3a:
# a real run left ``greeting.txt`` alongside BOTH dirs. The in-process local adapter
# never produces them (it runs the SDK in-process, no agent server), which is the
# asymmetry this filter exists to close. (If a later SDK / a new tool adds another
# server store, extend this set — tracked as a §15 refinement.)
_SERVER_SCAFFOLDING_DIRS = frozenset({"bash_events", "conversations"})


def _detect_platform() -> str:
    """Map the host arch to a Docker ``--platform`` string. The installed SDK has
    no ``detect_platform`` helper, so we derive it from ``platform.machine()``
    (Apple Silicon -> ``linux/arm64``)."""
    machine = platform.machine().lower()
    if machine in ("arm64", "aarch64"):
        return "linux/arm64"
    return "linux/amd64"


def _pull_workspace(
    workspace,
    host_dir: str,
    mode: str = "greenfield",
    pull_paths: tuple[str, ...] | None = None,
) -> list[str]:
    """DQ1 pull-at-end (no bind-mount): copy the agent's produced files out of the
    container's working dir onto the host, preserving relative paths.

    The container workspace starts empty, so "every (non-hidden) file under the
    working dir" *is* the agent's deliverable — we enumerate them with a single
    ``find`` over the REST ``execute_command`` seam (chosen over ``git_changes``,
    which would require the container dir to be a git repo with an init commit), and
    ``file_download`` each into ``host_dir``. Returns the relative paths pulled —
    the engine-neutral ``files_changed``; the host-side ``idempotent_ship`` then
    commits ``host_dir`` exactly as in the local path.

    ``mode`` (M-brownfield Slice 1) selects the enumeration: ``"greenfield"`` excludes EVERY hidden
    path at any depth (``'*/.*'`` — the prior behavior, byte-identical); ``"brownfield"`` keeps
    dotfiles (a real repo's edited ``.github/`` / config must come back) and excludes only ``.git/``
    — relying on the host-side ``git add -A`` (which honors the repo's ``.gitignore``) as the real
    filter. BOTH modes still drop the server scaffolding (``bash_events/`` / ``conversations/``).

    ``pull_paths`` (M-brownfield Slice 4) makes the pull WORKSPACE-READ-ONLY for an outcome-emitting
    (reviewer) node: when set, the adapter does NOT enumerate the container at all — it pulls ONLY
    these exact relative paths (the verdict sidecar) and nothing else, so the node's other container
    edits NEVER reach the shippable host worktree (they can't clobber the worker's correct edit).
    ``None`` (the default) ⇒ the full enumerate-and-pull above, byte-identical for greenfield and
    for a worker node. The adapter is told WHICH files to sync (a directive), never the role."""
    working_dir = workspace.working_dir
    if pull_paths is not None:
        # Scoped pull (Slice 4): pull ONLY the listed paths — no `find`, no enumeration. A listed
        # path absent from the container simply fails its download and is skipped (warned), like
        # the per-file behavior below. ``mode`` is irrelevant here (the list IS the filter).
        rels: list[str] = list(pull_paths)
    else:
        # Greenfield: non-hidden files only (mirrors the local adapter's _snapshot). Brownfield:
        # include dotfiles, exclude only the (non-existent-in-container, but defensive) .git tree.
        # `cwd` makes the paths relative to the working dir.
        find_cmd = (
            "find . -type f -not -path './.git/*'"
            if mode == "brownfield"
            else "find . -type f -not -path '*/.*'"
        )
        listing = workspace.execute_command(find_cmd, cwd=working_dir, timeout=30.0)
        if getattr(listing, "exit_code", 0) != 0:
            # Surface an enumeration failure HERE (caught by run() -> status="failed")
            # rather than silently pulling nothing and dying later at "nothing to ship".
            raise RuntimeError(
                f"container workspace enumeration failed "
                f"(exit={getattr(listing, 'exit_code', '?')}): {getattr(listing, 'stderr', '')!r}"
            )
        rels = []
        for line in listing.stdout.splitlines():
            # Strip only the leading "./" — preserve any spaces within the filename.
            rel = line[2:] if line.startswith("./") else line
            if not rel:
                continue
            # Drop the agent server's own scaffolding (its top-level dir is server-owned,
            # not a deliverable) so it is never pulled or shipped into the user's commit.
            if rel.split("/", 1)[0] in _SERVER_SCAFFOLDING_DIRS:
                continue
            rels.append(rel)

    pulled: list[str] = []
    for rel in sorted(set(rels)):
        dest = os.path.join(host_dir, rel)
        os.makedirs(os.path.dirname(dest) or host_dir, exist_ok=True)
        src = f"{working_dir.rstrip('/')}/{rel}"
        result = workspace.file_download(src, dest)
        if getattr(result, "success", False):
            pulled.append(rel)
        else:
            logger.warning("file_download failed for %s: %s", rel, getattr(result, "error", None))
    return pulled


def _push_workspace(workspace, host_dir: str, mode: str = "greenfield") -> list[str]:
    """Seed the container's working dir from the host BEFORE the agent runs — the
    mirror of :func:`_pull_workspace` (P1.5c). The cyclic loop reworks the prior
    round's deliverable in place (Q4), but in docker mode each iteration gets a FRESH
    EMPTY container (reaped per ``run()``), so iteration > 1 would start blank and lose
    iteration N-1's work. This pushes the host workspace (the stable cross-iteration
    source of truth — the pull writes it at the end of each iteration) into the new
    container so the agent resumes on the prior round's files.

    Stateless host->container sync: enumerate the host's deliverable files and ``file_upload`` each
    to ``{working_dir}/{rel}``, mkdir -p'ing nested container dirs first (``file_upload`` may not
    create parents). ``mode`` (M-brownfield Slice 1) selects the enumeration: ``"greenfield"`` →
    ``enumerate_push_files`` (non-hidden deliverables — the prior behavior, byte-identical; the
    fresh-git-init'd iteration-1 host holds only ``.git`` → ``[]`` → a no-op). ``"brownfield"``
    → ``enumerate_push_files_git`` (the real repo's tracked + untracked-not-ignored files, incl.
    tracked dotfiles, honoring ``.gitignore``) so the container sees the real repo, not a stripped
    copy. ``file_upload(source_path, destination_path)`` takes the HOST path first, the CONTAINER
    path second (confirmed against the installed SDK). Returns the relative paths pushed (for the
    log)."""
    working_dir = workspace.working_dir
    rels = (
        enumerate_push_files_git(host_dir)
        if mode == "brownfield"
        else enumerate_push_files(host_dir)
    )
    if not rels:
        return []
    pushed: list[str] = []
    base = working_dir.rstrip("/")
    for rel in rels:
        src = os.path.join(host_dir, rel)
        dest = f"{base}/{rel}"
        parent = dest.rsplit("/", 1)[0]
        if parent and parent != base:
            # Ensure the nested container dir exists before the upload.
            workspace.execute_command(
                f"mkdir -p {shlex.quote(parent)}", cwd=working_dir, timeout=30.0
            )
        result = workspace.file_upload(src, dest)  # (host source, container dest)
        if getattr(result, "success", False):
            pushed.append(rel)
        else:
            logger.warning("file_upload failed for %s: %s", rel, getattr(result, "error", None))
    return pushed


class _DockerHandle:
    """The live docker sandbox stashed in ``sandbox_cache`` for cross-round reuse (M-unify U2): the
    running container's ``workspace`` + the live ``RemoteConversation`` bound to it, plus a
    repointable event ``sink``.

    The Conversation's callback is bound ONCE at construction to :meth:`dispatch`, which forwards to
    the CURRENT round's ``sink``. That indirection is load-bearing for reuse: each ``run()`` builds
    a fresh per-round collector closure, and a REUSED Conversation must stream its events to THIS
    round's collector — not round 1's stale closure. On a HIT the adapter just repoints ``sink``."""

    def __init__(self, workspace):
        self.workspace = workspace
        self.conversation = None
        self.sink = None

    def dispatch(self, oh_event) -> None:
        sink = self.sink
        if sink is not None:
            sink(oh_event)


class OpenHandsDockerAdapter:
    """Drive the OpenHands agent in a Docker container behind Tvashtr's
    ``EngineAdapter``. Returns the identical ``AgentRunResult`` shape as the local
    adapter; the container is the boundary."""

    name = "openhands-docker"

    def run(self, task: AgentTask, on_event=None) -> AgentRunResult:
        settings = get_settings()
        model = task.model or settings.default_model
        platform_str = settings.agent_server_platform or _detect_platform()

        # ``task.workspace_dir`` is the HOST dir (created + git-init'd by
        # engineer_setup_step) — here it is the pull-target + ship root, not the
        # agent's working dir (which lives in the container).
        host_dir = task.workspace_dir
        os.makedirs(host_dir, exist_ok=True)

        # Reap-before-start (DQ2), M-unify U2: clear orphaned agent-server containers EXCEPT the
        # live warm sandboxes the reuse cache is keeping for this run's OTHER nodes (``keep_ids``)
        # — so a HIT's warm container is never killed between rounds. Image-based otherwise
        # (correct for serial single-operator runs). The boot sweep passes the live-container
        # registry's spare-set (M-reaper), reaping only orphans — the crash backstop, intact.
        reap_agent_containers(keep_ids=sandbox_cache.live_container_ids())

        seq = count()
        collected: list[EngineEvent] = []
        lock = threading.Lock()
        # Docker-mode budget signal lives in the ConversationErrorEvent.detail (see _on_oh_event
        # + the except block): the SDK genericizes the raised exception so it is the only
        # host-side carrier of the proxy's "Budget has been exceeded!" message.
        error_event_texts: list[str] = []

        def _on_oh_event(oh_event) -> None:
            if isinstance(oh_event, ConversationErrorEvent):
                # In docker mode the SDK genericizes the raised exception to "Remote conversation
                # ended with error" (a race in RemoteConversation._get_last_error_detail); the
                # proxy's budget message reaches the host ONLY here, in this event's detail.
                # Capture it for classify BEFORE the _kind_of early-return drops the event.
                with lock:
                    error_event_texts.append(f"{oh_event.code}: {oh_event.detail}")
            # Mirrors OpenHandsAdapter's collector; reuses the shared mapping
            # helpers so the engine-neutral event shape is identical across modes.
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

        # M-unify U2: reuse this node's warm container + live Conversation across its own rounds
        # when a ``session_key`` is set. A HIT skips the ~20s container spin-up AND continues the
        # SAME Conversation (the agent remembers prior rounds; the condenser keeps folding the
        # growing transcript). ``session_key`` None ⇒ a MISS every time: build a fresh container +
        # Conversation and tear it down at run-end — byte-for-byte the prior path.
        cached = sandbox_cache.get(task.session_key)

        status = "completed"
        error: str | None = None
        provider_failure = False
        prompt_tokens = 0
        completion_tokens = 0
        cost_usd = 0.0
        files_changed: list[str] = []
        conversation = None
        workspace = None
        container_id: str | None = None  # M-reaper: set on the MISS path; read in the finally
        created_this_call = False  # M-reaper: did THIS call create a container? (finally teardown)
        cached_for_reuse = False  # M-reaper: did put() cache it for reuse? (finally teardown)
        usage_before = (0, 0, 0.0)  # per-round baseline; nonzero only on a HIT (metrics accumulate)
        try:
            if cached is None:
                # MISS (or reuse OFF): build the LLM/agent, start a fresh container, open a new
                # Conversation. P1.4a/P1.4b: route the agent's LLM — proxy master key when on,
                # per-run vkey / owner BYOK via ``task.llm_api_key`` when off; serialized into the
                # agent-server INSIDE the container (reaches the proxy at host.docker.internal).
                # None ⇒ byte-for-byte as 4a.
                llm = LLM(
                    **agent_llm_routing(
                        settings, model, "docker", api_key_override=task.llm_api_key
                    ),
                    temperature=0.0,
                    usage_id="tvashtr-agent",
                    # M-thrift: an EXPLICIT output ceiling. Unset, the SDK resolves the model's own
                    # maximum and litellm sends it as ``max_tokens`` — which OpenRouter reserves
                    # against the key's credit balance before generating anything, 402-ing a
                    # low-balance key on a request that would have cost cents. The condenser's
                    # ``model_copy`` below inherits it.
                    max_output_tokens=settings.agent_max_output_tokens,
                )
                # M-ctx0 (C1): the in-transcript summarizing condenser (keep_first=2 / max_size=80),
                # reused via a model_copy under its OWN usage_id so the serialized agent never trips
                # the LLM registry's duplicate-usage_id guard; reset_metrics gives it a fresh meter.
                # On a REUSED Conversation the condenser lives on the retained agent, so it keeps
                # folding the growing multi-round transcript (the M-unify U2 conversation-carry).
                condenser_llm = llm.model_copy(update={"usage_id": "tvashtr-condenser"})
                condenser_llm.reset_metrics()
                # M-tools C7.0: the node's inline tools + skills; both unset ⇒ agent_context=None
                # and no MCP tools, so the Agent is byte-identical to before.
                agent_context = AgentContext(skills=task.skills) if task.skills else None
                agent = Agent(
                    llm=llm,
                    tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
                    condenser=LLMSummarizingCondenser(llm=condenser_llm, keep_first=2, max_size=80),
                    mcp_config=task.mcp_config or {},
                    agent_context=agent_context,
                )
                logger.warning(
                    "OpenHandsDockerAdapter (%s): starting container image=%s platform=%s "
                    "host_port=%s (None=ephemeral: the SDK picks a fresh free port); "
                    "host pull-target=%s",
                    WORKSPACE_MODE,
                    settings.agent_server_image,
                    platform_str,
                    settings.agent_server_host_port,
                    host_dir,
                )
                # Constructing DockerWorkspace starts the container (pull/run/health). M-unify U2:
                # we no longer use ``with`` — the container may outlive this run() for the next
                # round, so it is CACHED and torn down explicitly at run-end
                # (``close_run_sandboxes``), or here in the ``finally`` when reuse is off
                # (session_key None).
                workspace = DockerWorkspace(
                    server_image=settings.agent_server_image,
                    host_port=settings.agent_server_host_port,
                    platform=platform_str,
                    extra_ports=False,
                )
                logger.warning(
                    "OpenHandsDockerAdapter (%s): container ready on host port=%s",
                    WORKSPACE_MODE,
                    workspace.host_port,
                )
                # M-reaper: register the live container the MOMENT it exists — BEFORE building the
                # Conversation (a WebSocket handshake to the agent server) — so a boot sweep
                # in ANOTHER process (e.g. ``make test``) can never reap it mid-setup while
                # THIS process is alive. ``pid`` = this process; ``run_id`` from the reuse key. De-
                # registered at teardown (reuse success/HIT: ``close_run_sandboxes``; no-reuse OR a
                # reuse-path failure before caching: the ``finally`` below). No-op on a falsy id.
                container_id = getattr(workspace, "_container_id", None)
                created_this_call = True
                sandbox_cache.register_live_container(
                    container_id,
                    run_id=sandbox_cache.run_id_from_session_key(task.session_key),
                    pid=os.getpid(),
                )
                # The callback is bound ONCE to the handle's dispatcher so a REUSED Conversation can
                # be repointed at each round's collector (a RemoteWorkspace makes Conversation()
                # return a RemoteConversation; callbacks stream over the server's WebSocket).
                handle = _DockerHandle(workspace)
                handle.sink = _on_oh_event
                conversation = Conversation(
                    agent=agent,
                    workspace=workspace,
                    callbacks=[handle.dispatch],
                    max_iteration_per_run=_MAX_ITERATIONS,
                    delete_on_close=False,
                )
                handle.conversation = conversation
                # Cache the live sandbox (reuse ON only) BEFORE the run so run-end teardown ALWAYS
                # finds it — a failed first round is torn down at run-end, never leaked.
                # ``put(None,…)`` is a no-op, so the no-reuse path caches nothing.
                sandbox_cache.put(
                    task.session_key,
                    sandbox_cache.CachedSandbox(
                        handle=handle,
                        close=workspace.cleanup,
                        container_id=container_id,
                    ),
                )
                # M-reaper: put() succeeded ⇒ close_run_sandboxes owns this container's teardown +
                # de-register (reuse path). The finally below only cleans up when this flag is False
                # (no-reuse, or a reuse-path failure that left it registered-but-uncached).
                cached_for_reuse = True
                # P1.5c loop-seeding: push the host workspace into the fresh container so a
                # docker-mode iteration > 1 resumes on iteration N-1's files. Iteration 1's host
                # holds only .git -> [] -> a clean no-op.
                seeded = _push_workspace(workspace, host_dir, task.workspace_mode)
                if seeded:
                    logger.warning(
                        "OpenHandsDockerAdapter (%s): seeded %d file(s) from the host into the "
                        "new container (loop rework continuity): %s",
                        WORKSPACE_MODE,
                        len(seeded),
                        seeded,
                    )
                conversation.send_message(task.instruction)
            else:
                # HIT (M-unify U2): reuse the warm container + its live Conversation. Re-sync the
                # host workspace into the container FIRST (the host is the cross-round source of
                # truth the prior round's pull wrote), THEN send the next goal as a FOLLOW-UP to
                # the SAME Conversation and run() again — NOT a fresh Conversation, so the
                # condenser folds the growing transcript and the agent remembers prior rounds.
                handle = cached.handle
                workspace = handle.workspace
                conversation = handle.conversation
                handle.sink = _on_oh_event  # repoint the dispatcher at THIS round's collector
                # Read the reused Conversation's cumulative usage FIRST — it is (a) this round's
                # per-round-delta baseline (metrics accumulate on a reused Conversation) AND (b) a
                # deterministic conversation-carry signal: >0 carried tokens prove the SAME
                # Conversation kept the prior round's transcript (not a fresh one).
                usage_before = _read_usage(conversation)
                logger.warning(
                    "OpenHandsDockerAdapter (%s): REUSED warm container (node reuse) on host "
                    "port=%s — NO spin-up; continuing the same Conversation (carried %d prior "
                    "tokens)",
                    WORKSPACE_MODE,
                    getattr(workspace, "host_port", "?"),
                    usage_before[0] + usage_before[1],
                )
                reseeded = _push_workspace(workspace, host_dir, task.workspace_mode)
                if reseeded:
                    logger.warning(
                        "OpenHandsDockerAdapter (%s): re-seeded %d file(s) into the reused "
                        "container: %s",
                        WORKSPACE_MODE,
                        len(reseeded),
                        reseeded,
                    )
                conversation.send_message(task.instruction)
            conversation.run()
            # Decision 2 path over the (possibly reused) remote conversation. On a HIT the metrics
            # are cumulative across rounds, so subtract the pre-run baseline to get THIS round's
            # usage.
            pa, ca, cost_a = _read_usage(conversation)
            prompt_tokens = max(0, pa - usage_before[0])
            completion_tokens = max(0, ca - usage_before[1])
            cost_usd = max(0.0, cost_a - usage_before[2])
            # DQ1: pull the agent's files to the host at the END of EVERY round (first + follow-up)
            # — the host stays the cross-round source of truth the next re-seed reads.
            # ``task.pull_paths`` (Slice 4) scopes it for an emitting (reviewer) node (None ⇒ full
            # pull).
            files_changed = _pull_workspace(
                workspace, host_dir, task.workspace_mode, task.pull_paths
            )
        except Exception as exc:
            # P1.4b: classify the proxy's mid-call budget cutoff as ``over_budget`` (else a
            # generic ``failed``). In DOCKER mode the SDK strips the budget message from the
            # raised exception (it becomes "Remote conversation ended with error"); the signal
            # survives ONLY in a ConversationErrorEvent.detail captured above — so classify on
            # the exception (chain) OR any captured error event.
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
            # M-fail METER-ON-FAILURE: read whatever partial usage accrued for ANY non-completed
            # status, not only the budget cutoff. A run that failed mid-loop still SPENT money, and
            # dropping it to $0 hides real cost (run 6fd2c911: $0.0104 recorded as $0). Same
            # per-round delta, same defensive guard.
            if status != "completed" and conversation is not None:
                pa, ca, cost_a = _read_usage(conversation)
                prompt_tokens = max(0, pa - usage_before[0])
                completion_tokens = max(0, ca - usage_before[1])
                cost_usd = max(0.0, cost_a - usage_before[2])
            # M-fail PULL-ON-FAILURE: the success pull (in the try) is skipped when
            # conversation.run() raises, so a run that FAILED after landing edits lost them ALL
            # (run 6fd2c911). Pull them best-effort HERE, in the EXCEPT (NOT the finally, which
            # tears the container down in the no-reuse / early-failure cases; a pull after teardown
            # reads nothing). Gated on ``conversation is not None`` so a container/handshake failure
            # that never ran the agent pulls nothing (ctor-failure tests stay green).
            # ``task.pull_paths`` is passed UNCHANGED so an emitting node stays verdict-only
            # (Slice-4 anti-clobber holds here too). Wrapped so it can NEVER mask the error/status.
            if conversation is not None and workspace is not None:
                try:
                    files_changed = _pull_workspace(
                        workspace, host_dir, task.workspace_mode, task.pull_paths
                    )
                except Exception:
                    logger.warning("M-fail: best-effort failure pull failed", exc_info=True)
            # Self-diagnosing: log the FULL surface we classified on, so any future miss is
            # debuggable from this log alone (this very bug required a container-log spelunk).
            logger.exception(
                "OpenHandsDockerAdapter run %s (exc=%r; error_events=%r)",
                "cut off over budget" if status == "over_budget" else "failed",
                str(exc),
                error_event_texts,
            )
        finally:
            # M-unify U2: reuse OFF (session_key None) ⇒ replicate the old ``with`` teardown — stop
            # the container now. Reuse ON ⇒ leave the warm container alive for the next round; it
            # is torn down at run-end by ``close_run_sandboxes`` (the Control Plane's run_team
            # ``finally``).
            # Tear down + de-register the container when THIS call must not leave it warm:
            #  - no-reuse (session_key None): always (replaces the old ``with`` __exit__);
            #  - reuse, but this call CREATED a container and failed BEFORE caching it (e.g. the
            #    Conversation ctor raised) — close_run_sandboxes won't see it, so tear it down +
            #    de-register here, else a registered container leaks + is wrongly spared forever.
            # A cached reuse container (success) or a HIT is left warm for close_run_sandboxes.
            if workspace is not None and (
                task.session_key is None or (created_this_call and not cached_for_reuse)
            ):
                try:
                    workspace.cleanup()
                except Exception:
                    logger.warning("container teardown failed", exc_info=True)
                sandbox_cache.deregister_live_container(container_id)

        total_tokens = prompt_tokens + completion_tokens
        # Only the success path is downgraded by error events; never clobber a classified
        # ``failed``/``over_budget`` from the except block (P1.4b: preserve the cutoff status).
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

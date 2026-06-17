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
import threading
import time
from itertools import count

from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool
from openhands.workspace import DockerWorkspace

from tvashtr.config import agent_llm_routing, get_settings
from tvashtr.engines.base import AgentRunResult, AgentTask, EngineEvent
from tvashtr.engines.docker_runtime import reap_agent_containers

# Engine-neutral helpers shared with the local adapter (single source of truth for
# the OpenHands-event -> EngineEvent mapping + the post-run usage read). Reused, not
# duplicated; the local adapter's own ``run()`` is untouched.
from tvashtr.engines.openhands_adapter import (
    _MAX_ITERATIONS,
    _is_budget_error,
    _kind_of,
    _payload_of,
    _read_usage,
    _text_has_budget_signature,
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


def _pull_workspace(workspace, host_dir: str) -> list[str]:
    """DQ1 pull-at-end (no bind-mount): copy the agent's produced files out of the
    container's working dir onto the host, preserving relative paths.

    The container workspace starts empty, so "every (non-hidden) file under the
    working dir" *is* the agent's deliverable — we enumerate them with a single
    ``find`` over the REST ``execute_command`` seam (chosen over ``git_changes``,
    which would require the container dir to be a git repo with an init commit), and
    ``file_download`` each into ``host_dir``. Returns the relative paths pulled —
    the engine-neutral ``files_changed``; the host-side ``idempotent_ship`` then
    commits ``host_dir`` exactly as in the local path.
    """
    working_dir = workspace.working_dir
    # Non-hidden files only (mirrors the local adapter's _snapshot, which skips
    # dotfiles/dirs). `cwd` makes the paths relative to the working dir.
    listing = workspace.execute_command(
        "find . -type f -not -path '*/.*'", cwd=working_dir, timeout=30.0
    )
    if getattr(listing, "exit_code", 0) != 0:
        # Surface an enumeration failure HERE (caught by run() -> status="failed")
        # rather than silently pulling nothing and dying later at "nothing to ship".
        raise RuntimeError(
            f"container workspace enumeration failed "
            f"(exit={getattr(listing, 'exit_code', '?')}): {getattr(listing, 'stderr', '')!r}"
        )
    rels: list[str] = []
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

        # Reap-before-start (DQ2): clear any orphaned agent-server container before
        # starting a fresh one. Pure orphan hygiene now — under P1.3b part-1 ephemeral
        # host ports the fresh container binds a NEW port, so reaping no longer frees a
        # port the new container needs (it only removes leftovers). Image-based, so it
        # reaps all agent-server containers — correct for serial single-operator
        # runs (see docker_runtime).
        reap_agent_containers()

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

        # P1.4a: route the agent's own LLM through the LiteLLM proxy when enabled. OFF by
        # default -> the EXACT prior direct path (bare slug + OPENROUTER_API_KEY). The LLM
        # config (incl. whichever api_key — master key when on, OPENROUTER_API_KEY when off)
        # is serialized into the agent and the calls are made by the agent-server INSIDE the
        # container — NOT the container env. So the container needs egress to its target: the
        # proxy when on, OpenRouter when off. docker mode reaches the proxy at
        # host.docker.internal (agent_llm_base_url("docker")) because the agent-server
        # container runs on Docker's DEFAULT BRIDGE (started ad-hoc by DockerWorkspace), NOT
        # the compose network — the #1 reachability risk, proven by `make proxy-smoke`.
        # P1.4b: ``task.llm_api_key`` (the per-run virtual key, minted with a max_budget) is
        # threaded in as the agent's api_key so the proxy cuts the agent off mid-call at the
        # run's budget. It is serialized into the agent-server INSIDE the container along with
        # the rest of the LLM config (the container reaches the proxy at host.docker.internal).
        # None (proxy off / no key) -> byte-for-byte as 4a.
        llm = LLM(
            **agent_llm_routing(settings, model, "docker", api_key_override=task.llm_api_key),
            temperature=0.0,
            usage_id="tvashtr-agent",
        )
        agent = Agent(
            llm=llm,
            tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
        )

        status = "completed"
        error: str | None = None
        prompt_tokens = 0
        completion_tokens = 0
        cost_usd = 0.0
        files_changed: list[str] = []
        conversation = None
        try:
            # Constructing DockerWorkspace starts the container (pull/run/health);
            # __exit__ tears it down (docker stop; the image is run with --rm).
            with DockerWorkspace(
                server_image=settings.agent_server_image,
                host_port=settings.agent_server_host_port,
                platform=platform_str,
                extra_ports=False,
            ) as workspace:
                # Read back the ACTUAL host port the SDK bound. With host_port=None
                # (ephemeral) the SDK picks a fresh free port at construction, so this
                # is the only place the real port is known (config now carries None).
                logger.warning(
                    "OpenHandsDockerAdapter (%s): container ready on host port=%s",
                    WORKSPACE_MODE,
                    workspace.host_port,
                )
                # A RemoteWorkspace makes Conversation() return a RemoteConversation
                # automatically; callbacks stream over the server's WebSocket.
                conversation = Conversation(
                    agent=agent,
                    workspace=workspace,
                    callbacks=[_on_oh_event],
                    max_iteration_per_run=_MAX_ITERATIONS,
                    delete_on_close=False,
                )
                conversation.send_message(task.instruction)
                conversation.run()
                # Decision 2 path, identical accessor over the remote conversation.
                prompt_tokens, completion_tokens, cost_usd = _read_usage(conversation)
                # DQ1: pull the agent's files to the host before teardown.
                files_changed = _pull_workspace(workspace, host_dir)
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
            error = str(exc)
            # Best-effort partial-usage read on the cutoff path (Task 0.5); in docker mode the
            # container is torn down as the ``with`` exits, so the remote conversation may no
            # longer report metrics — _read_usage then cleanly yields 0s (the proxy's server-side
            # budget is the authoritative cutoff regardless).
            if status == "over_budget" and conversation is not None:
                prompt_tokens, completion_tokens, cost_usd = _read_usage(conversation)
            # Self-diagnosing: log the FULL surface we classified on, so any future miss is
            # debuggable from this log alone (this very bug required a container-log spelunk).
            logger.exception(
                "OpenHandsDockerAdapter run %s (exc=%r; error_events=%r)",
                "cut off over budget" if status == "over_budget" else "failed",
                str(exc),
                error_event_texts,
            )

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
        )

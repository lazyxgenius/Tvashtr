"""The OpenHands engine adapter — Tvashtr's first concrete ``EngineAdapter`` (D1).

This is the ONLY module that imports ``openhands.*``. Everything else depends on
the engine-neutral contract in ``tvashtr.engines.base``, which is what lets a
second engine (e.g. the Claude Agent SDK) slot in later.

⚠️  LOCAL-UNSANDBOXED MODE. The OpenHands SDK here runs the agent against a plain
local directory, so **the agent's shell and file tools execute as your user, on
the real filesystem, with no isolation.** We confine the agent to a dedicated
throwaway workspace dir (``make_local_workspace``) and shout about it in the log,
but this mode is for trusted dev tasks only. Docker isolation (via the OpenHands
Agent Server) is deferred to a later step — see the TODO seam below.
"""

import logging
import os
import threading
import time
from itertools import count
from pathlib import Path

from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.sdk.event import (
    ActionEvent,
    AgentErrorEvent,
    Event,
    MessageEvent,
    ObservationBaseEvent,
)
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool

from tvashtr.config import agent_llm_routing, get_settings
from tvashtr.engines.base import AgentRunResult, AgentTask, EngineEvent

logger = logging.getLogger("tvashtr.engines.openhands")

# A loud, unmistakable label for the (intentionally) unsandboxed local mode.
WORKSPACE_MODE = "local-unsandboxed"

# Root for throwaway agent workspaces. Gitignored (see .gitignore).
# TODO(P0.x): add a Docker-sandboxed workspace via the OpenHands Agent Server as
# an alternative EngineAdapter / workspace mode; keep this local mode for dev.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2] / ".tvashtr_workspaces"

# Cap the agent loop — a trivial task needs very few iterations; this is a
# runaway backstop for the unsandboxed mode. Env-overridable (``TVASHTR_AGENT_MAX_ITERATIONS``)
# because a real MULTI-FILE build + a review-loop REWORK round legitimately needs more steps
# than the skeleton's trivial file-write (P1.5c capstone: 20 was too few for the rework round
# and tripped ``MaxIterationsReached``). Default 20 keeps the skeleton/smoke targets unchanged.
_MAX_ITERATIONS = int(os.environ.get("TVASHTR_AGENT_MAX_ITERATIONS", "20"))


def make_local_workspace(run_id: str) -> str:
    """Create and return a fresh, **local + unsandboxed** workspace directory.

    The agent may read/write/execute freely *inside* this dir as the current
    user. It lives under a gitignored root so agent output never pollutes the
    repo. This is NOT a security boundary — see the module docstring.
    """
    workspace = _WORKSPACE_ROOT / run_id
    workspace.mkdir(parents=True, exist_ok=True)
    return str(workspace)


def _kind_of(event: Event) -> str | None:
    """Map an OpenHands event to an engine-neutral kind, or None to skip the
    chatty non-essential events (streaming tokens, system prompt, etc.)."""
    if isinstance(event, ActionEvent):
        return "action"
    if isinstance(event, ObservationBaseEvent):
        return "observation"
    if isinstance(event, AgentErrorEvent):
        return "error"
    if isinstance(event, MessageEvent):
        return "message"
    return None


def _payload_of(event: Event, kind: str) -> dict:
    """Extract a small, JSON-able, engine-neutral payload (no OpenHands types)."""
    try:
        if kind == "action":
            return {
                "tool_name": getattr(event, "tool_name", None),
                "thought": (getattr(event, "thought", "") or "")[:1000],
                "action": str(getattr(event, "action", ""))[:2000],
            }
        if kind == "observation":
            return {
                "tool_name": getattr(event, "tool_name", None),
                "observation": str(getattr(event, "observation", ""))[:2000],
            }
        if kind == "error":
            return {"error": str(getattr(event, "error", "") or event)[:2000]}
        # message
        text = getattr(event, "llm_message", None) or getattr(event, "message", None)
        return {"source": str(getattr(event, "source", "")), "text": str(text)[:2000]}
    except Exception as exc:  # never let payload extraction break a run
        return {"unparsed": True, "error": str(exc)}


def _snapshot(root: str) -> dict[str, tuple[int, int]]:
    """Map of non-hidden files under ``root`` -> (size, mtime_ns)."""
    snap: dict[str, tuple[int, int]] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for filename in filenames:
            if filename.startswith("."):
                continue
            full = os.path.join(dirpath, filename)
            try:
                st = os.stat(full)
                snap[os.path.relpath(full, root)] = (st.st_size, st.st_mtime_ns)
            except OSError:
                pass
    return snap


def _read_usage(conversation) -> tuple[int, int, float]:
    """Post-run token/cost telemetry from OpenHands' own accumulated metrics.

    Verified accessor (openhands-sdk 1.28.1):
    ``Conversation.conversation_stats.get_combined_metrics()`` ->
    ``Metrics.accumulated_token_usage`` + ``Metrics.accumulated_cost``.
    """
    try:
        metrics = conversation.conversation_stats.get_combined_metrics()
        usage = getattr(metrics, "accumulated_token_usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        cost_usd = float(getattr(metrics, "accumulated_cost", 0.0) or 0.0)
        return prompt_tokens, completion_tokens, cost_usd
    except Exception:
        logger.warning("could not read OpenHands usage telemetry", exc_info=True)
        return 0, 0, 0.0


# P1.4b: substrings that identify the LiteLLM proxy's **per-key budget cutoff** in an
# exception's message. Pinned to litellm 1.89.0 and CAPTURED LIVE against the pinned proxy
# image: the proxy raises ``BudgetExceededError`` server-side (HTTP 429) and the agent's
# client litellm WRAPS that 429 as ``RateLimitError`` — so the exception *type* is NOT a
# reliable signal (it is ``RateLimitError``, not ``BudgetExceededError``). The budget
# *message* survives the wrap intact:
#   "litellm.RateLimitError: ... Litellm_proxyException - Budget has been exceeded! Current
#    cost: 3.15e-06, Max budget: 1e-09"
# These cover every litellm 1.89.0 budget message (key / multi-window / user / team / org /
# tag) plus the proxy error ``type`` field. Match is case-insensitive on ``str(exc)``.
_BUDGET_ERROR_SIGNATURES = (
    "budget has been exceeded",  # BudgetExceededError default (the per-key path) — CAPTURED LIVE
    "exceededbudget",  # "ExceededBudget: Key over <window> budget. ..." (multi-window/user/team)
    "exceeded budget",  # spacing variant
    "budget_exceeded",  # ProxyErrorTypes.budget_exceeded — the proxy error `type` in the body
    "over budget",  # "User=.. over budget. Spend=.." variants
)


def _text_has_budget_signature(text: str) -> bool:
    """True if any LiteLLM proxy budget-cutoff signature appears in ``text`` (case-insensitive).
    The single substring test, factored out so it can be run against ANY error surface — the
    exception string (local mode) AND the docker-mode ConversationErrorEvent detail."""
    if not text:
        return False
    lowered = text.lower()
    return any(sig in lowered for sig in _BUDGET_ERROR_SIGNATURES)


def _exception_chain_text(exc: BaseException) -> str:
    """``str()`` of ``exc`` plus its ``__cause__`` / ``__context__`` chain (deduped, bounded).
    Defensive: in some wrappings the budget message is on a nested cause rather than the top
    exception. Cycle-safe and capped so a pathological chain can't spin."""
    parts: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(parts) < 20:
        seen.add(id(current))
        try:
            parts.append(str(current))
        except Exception:
            parts.append("")  # a pathological __str__ must never make classification raise
        current = current.__cause__ or current.__context__
    return "\n".join(parts)


def _is_budget_error(exc: Exception) -> bool:
    """True ONLY for the proxy's per-run budget cutoff (P1.4b); False for every other failure.

    Matches the budget MESSAGE substring across the exception's full cause chain (robust to the
    client wrapping the proxy 429 as RateLimitError / APIError / etc.), NOT the status code
    alone (a generic 429 rate-limit must stay ``failed``). Deliberately does NOT import
    ``litellm`` — preserves the gateway's litellm monopoly + the import-boundary.

    NOTE: in DOCKER mode the budget message is stripped from this exception by the SDK's remote
    layer (it becomes "Remote conversation ended with error"); the docker adapter additionally
    classifies on the ConversationErrorEvent detail via ``_text_has_budget_signature``."""
    if _text_has_budget_signature(_exception_chain_text(exc)):
        return True
    return type(exc).__name__ == "BudgetExceededError"


class OpenHandsAdapter:
    """Drive the OpenHands Software Agent SDK behind Tvashtr's ``EngineAdapter``.

    The agent's internal LLM calls go through the SDK's *own* LiteLLM (configured
    from our ``Settings``), not ``gateway.complete()`` — that's expected for P0.3;
    our gateway remains the path for *direct* completions (e.g. the PM node).
    """

    name = "openhands"

    def run(self, task: AgentTask, on_event=None) -> AgentRunResult:
        settings = get_settings()
        model = task.model or settings.default_model

        os.makedirs(task.workspace_dir, exist_ok=True)
        logger.warning(
            "OpenHandsAdapter running in %s mode: agent shell/file tools execute "
            "as your user, confined to %s. Not for untrusted tasks.",
            WORKSPACE_MODE,
            task.workspace_dir,
        )

        seq = count()
        collected: list[EngineEvent] = []
        lock = threading.Lock()

        def _on_oh_event(oh_event: Event) -> None:
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

        # P1.4a: route the agent's own LLM through the LiteLLM proxy when enabled (the
        # physical spend chokepoint). OFF by default -> the EXACT prior direct path (bare
        # slug + OPENROUTER_API_KEY, no base_url). local mode runs in-process on the host,
        # so the proxy (when on) is reached at 127.0.0.1. The PM/gateway path is NOT routed
        # here. ``agent_llm_routing`` owns model/api_key/base_url; we add temperature/usage_id.
        # P1.4b: ``task.llm_api_key`` is the per-run virtual key (minted with a max_budget) —
        # threaded in as the agent's api_key so the proxy cuts it off mid-call at the budget;
        # None (proxy off / no key) -> byte-for-byte as 4a.
        llm = LLM(
            **agent_llm_routing(settings, model, "local", api_key_override=task.llm_api_key),
            temperature=0.0,
            usage_id="tvashtr-agent",
        )
        agent = Agent(
            llm=llm,
            tools=[Tool(name=TerminalTool.name), Tool(name=FileEditorTool.name)],
        )

        before = _snapshot(task.workspace_dir)
        status = "completed"
        error: str | None = None
        prompt_tokens = 0
        completion_tokens = 0
        cost_usd = 0.0
        conversation = None
        try:
            conversation = Conversation(
                agent=agent,
                workspace=task.workspace_dir,
                callbacks=[_on_oh_event],
                max_iteration_per_run=_MAX_ITERATIONS,
                delete_on_close=False,  # keep the workspace + produced files
            )
            conversation.send_message(task.instruction)
            conversation.run()
            # Decision 2 (primary path): read OpenHands' own accumulated usage
            # after the run — NOT a process-global litellm callback, which would
            # also capture the gateway's direct calls (one shared litellm).
            prompt_tokens, completion_tokens, cost_usd = _read_usage(conversation)
        except Exception as exc:
            # P1.4b: classify the proxy's mid-call budget cutoff as ``over_budget`` (else a
            # generic ``failed``). On the cutoff path, best-effort read whatever partial usage
            # accrued before the proxy cut it off (Task 0.5) so the run's ledger reflects it;
            # _read_usage is defensive (returns 0s if the conversation has none / isn't ready).
            status = "over_budget" if _is_budget_error(exc) else "failed"
            error = str(exc)
            if status == "over_budget" and conversation is not None:
                prompt_tokens, completion_tokens, cost_usd = _read_usage(conversation)
            logger.exception(
                "OpenHands run cut off over budget"
                if status == "over_budget"
                else "OpenHands run failed"
            )

        total_tokens = prompt_tokens + completion_tokens
        after = _snapshot(task.workspace_dir)
        files_changed = sorted(p for p in after if before.get(p) != after[p])

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

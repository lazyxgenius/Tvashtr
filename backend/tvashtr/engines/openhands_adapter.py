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

from openhands.sdk import LLM, Agent, Conversation, LLMSummarizingCondenser, Tool
from openhands.sdk.context import AgentContext
from openhands.sdk.event import (
    ActionEvent,
    AgentErrorEvent,
    Condensation,
    Event,
    MessageEvent,
    ObservationBaseEvent,
)
from openhands.sdk.llm.message import content_to_str
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.terminal import TerminalTool

from tvashtr.config import agent_llm_routing, get_settings
from tvashtr.engines import sandbox_cache
from tvashtr.engines.base import AgentRunResult, AgentTask, EngineEvent

logger = logging.getLogger("tvashtr.engines.openhands")

# A loud, unmistakable label for the (intentionally) unsandboxed local mode.
WORKSPACE_MODE = "local-unsandboxed"

# Root for throwaway agent workspaces. Gitignored (see .gitignore).
# TODO(P0.x): add a Docker-sandboxed workspace via the OpenHands Agent Server as
# an alternative EngineAdapter / workspace mode; keep this local mode for dev.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2] / ".tvashtr_workspaces"

# Cap the agent loop: a runaway BACKSTOP, not a work budget. Env-overridable
# (``TVASHTR_AGENT_MAX_ITERATIONS``) so a live gate can tighten it. Default 150: a real multi-file
# build, a review-loop rework round, and (crucially) the agent's own VERIFY pass after it believes
# it is done all legitimately need many steps. 20 was far too few: run 6fd2c911 (the first hosted
# run) tripped ``MaxIterationsReached(20)`` while verifying already-finished edits, failing a task
# the agent had actually completed. The forced-revisions gates stub the agent (this cap never
# applies to them); the real-run live gates set the env override explicitly.
_MAX_ITERATIONS = int(os.environ.get("TVASHTR_AGENT_MAX_ITERATIONS", "150"))

# How much of an agent's CLOSING words (its ``finish`` message, or a reply with no tool call) the
# event payload keeps verbatim. The 2,000-char previews above are for the feed; this copy is the
# durable record ``team_run.entry_closing_message_step`` reads when an entry node ended without
# REPORT.md and its closing message has to stand in as the spec, so it must hold a whole PRD.
_CLOSING_TEXT_CAP = 100_000


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
    # M-ctx0 (C1) DURABILITY: the in-transcript condenser's OWN event. Without this branch every
    # ``Condensation`` returned ``None`` and the collector dropped it, so "zero condensation rows in
    # ``run_events``" was STRUCTURALLY GUARANTEED rather than evidence the condenser never fired —
    # the C1 proof had to be read out of container logs. Checked LAST, and ``Condensation`` is a
    # DIRECT ``Event`` subclass (not one of the four above), so the pre-existing mappings are
    # untouched. Both remote adapters import this function, so local, docker AND fly get it.
    if isinstance(event, Condensation):
        return "condensation"
    return None


def _payload_of(event: Event, kind: str) -> dict:
    """Extract a small, JSON-able, engine-neutral payload (no OpenHands types)."""
    try:
        if kind == "action":
            # Reasoning-content models (deepseek-chat, qwen3, ...) hand the ActionEvent a
            # Sequence[TextContent] thought; stringify it (join the parts' .text) so the
            # run_events JSON column stays serializable in BOTH local and docker modes,
            # which share this _payload_of. A plain str is kept; None / "" / [] -> "".
            thought = getattr(event, "thought", "") or ""
            if not isinstance(thought, str):
                thought = "".join(
                    part.text if isinstance(getattr(part, "text", None), str) else str(part)
                    for part in thought
                )
            payload = {
                "tool_name": getattr(event, "tool_name", None),
                "thought": thought[:1000],
                "action": str(getattr(event, "action", ""))[:2000],
            }
            # The ``finish`` tool's message is the agent's closing message — keep it whole.
            message = getattr(getattr(event, "action", None), "message", None)
            if getattr(event, "tool_name", None) == "finish" and isinstance(message, str):
                payload["message"] = message[:_CLOSING_TEXT_CAP]
            return payload
        if kind == "observation":
            return {
                "tool_name": getattr(event, "tool_name", None),
                "observation": str(getattr(event, "observation", ""))[:2000],
            }
        if kind == "error":
            return {"error": str(getattr(event, "error", "") or event)[:2000]}
        if kind == "condensation":
            # ``forgotten_event_ids`` is a **set** — ``json.dumps`` raises on one exactly as it does
            # on a raw ``TextContent`` (see test_payload_thought_serialization), so it is reduced to
            # a COUNT rather than passed through to the ``run_events`` JSON column. The summary is
            # bounded like every other branch. ``llm_response_id`` is the SDK's id for the
            # completion that produced this fold — carried so a condensation can be tied back to a
            # specific provider-side call in the agent/container logs. (It is NOT a ``cost_records``
            # join key: that table keys on ``invocation_id``, and the condenser's own spend is not
            # broken out into its own row.)
            forgotten = getattr(event, "forgotten_event_ids", None) or ()
            summary = getattr(event, "summary", None)
            return {
                "forgotten_count": len(forgotten),
                "summary": str(summary)[:2000] if summary else "",
                "summary_offset": getattr(event, "summary_offset", None),
                "llm_response_id": str(getattr(event, "llm_response_id", "") or "")[:200],
            }
        # message
        text = getattr(event, "llm_message", None) or getattr(event, "message", None)
        payload = {"source": str(getattr(event, "source", "")), "text": str(text)[:2000]}
        # An agent reply with no tool call ends the loop too: keep its words whole (never the
        # user's instruction — that is not a closing message).
        llm_message = getattr(event, "llm_message", None)
        if payload["source"] == "agent" and llm_message is not None:
            payload["content"] = "".join(content_to_str(llm_message.content))[:_CLOSING_TEXT_CAP]
        return payload
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


def _content_snapshot(root: str) -> dict[str, bytes]:
    """relpath -> raw bytes for every file under ``root`` EXCEPT the ``.git`` tree.

    The pre-run capture used to RESTORE the worktree after a workspace-READ-ONLY (outcome-emitting /
    reviewer) node runs in-process in local mode — the local-adapter mirror of the docker adapter's
    scoped ``pull_paths``. Local mode edits the worktree in place (there is no container to pull
    from), so "pull only the verdict sidecar" is enforced here by snapshot-then-restore. Captures
    dotfiles (a reviewer might touch ``.eslintrc``) but never descends ``.git``."""
    snap: dict[str, bytes] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            try:
                with open(full, "rb") as fh:
                    snap[os.path.relpath(full, root)] = fh.read()
            except OSError:
                pass
    return snap


def _restore_except(root: str, snapshot: dict[str, bytes], keep: tuple[str, ...]) -> list[str]:
    """Restore ``root`` to ``snapshot`` for every path NOT in ``keep`` — undo a workspace-read-only
    node's in-place edits so its round never mutates the shippable worktree (the local mirror of
    the docker scoped pull). The ``keep`` paths (the verdict sidecar) are left exactly as the agent
    wrote them. Returns the ``keep`` paths present after the restore — the effective files_changed.

    An agent-CREATED file (absent from ``snapshot``, not in ``keep``) is removed; an agent-MODIFIED
    file is rewritten to its snapshot bytes; an agent-DELETED file (in ``snapshot``, now missing,
    not in ``keep``) is recreated. ``.git`` is never walked or touched."""
    keep_set = set(keep)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            rel = os.path.relpath(full, root)
            if rel in keep_set:
                continue
            try:
                if rel not in snapshot:
                    os.remove(full)  # agent-created -> drop it
                    continue
                with open(full, "rb") as fh:
                    current = fh.read()
                if current != snapshot[rel]:
                    with open(full, "wb") as fh:
                        fh.write(snapshot[rel])  # agent-modified -> revert
            except OSError:
                pass
    # Recreate agent-deleted files (in the snapshot, now missing), excluding the kept paths.
    for rel, data in snapshot.items():
        if rel in keep_set:
            continue
        full = os.path.join(root, rel)
        if not os.path.exists(full):
            try:
                os.makedirs(os.path.dirname(full) or root, exist_ok=True)
                with open(full, "wb") as fh:
                    fh.write(data)
            except OSError:
                pass
    return sorted(p for p in keep if os.path.exists(os.path.join(root, p)))


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


# Tvashtr-79 item 7: the PROVIDER analogue of the budget classifier above — the signal the executor
# reads to fail a node over to its ``config["fallback_model"]`` MID-RUN. Same discipline as budget:
# match by MESSAGE substring / CLASS NAME across the exception chain AND the remote-mode
# ConversationErrorEvent detail, and deliberately do NOT ``import litellm`` (the gateway keeps the
# litellm monopoly + the import boundary).
#
# HARD failures only: a bad/expired key, an unreachable or broken provider, a model that does not
# exist for this provider. Swapping models cannot help anything else.
_PROVIDER_ERROR_SIGNATURES = (
    # --- authentication / authorization: the key is wrong, expired or revoked ---
    "authenticationerror",
    "authentication_error",
    "invalid api key",
    "incorrect api key",
    "invalid_api_key",
    "no auth credentials",
    "unauthorized",
    "permission denied",
    "permissiondeniederror",
    # --- the provider itself is unreachable or broken ---
    # NOTE: deliberately only litellm's OWN typed signatures, never a bare "connection refused" /
    # "internal server error" / "bad gateway" / "503". Those phrases are produced just as readily by
    # OUR infrastructure — an unreachable docker daemon, the in-sandbox agent server's HTTP surface,
    # a Fly API hiccup — and a fallback MODEL cannot rescue any of them, so matching them would only
    # buy a second full agent run against the same broken sandbox. Nothing is lost: litellm stamps
    # the class name on both surfaces we classify (``str(exc)`` and the ConversationErrorEvent
    # detail), and ``_PROVIDER_ERROR_TYPES`` catches the exception object directly.
    "apiconnectionerror",
    "internalservererror",
    "serviceunavailableerror",
    # --- M-thrift: the key is live but its BALANCE cannot cover the request ---
    # The wall a dead paid provider actually puts up. OpenRouter answers HTTP 402 "This request
    # requires more credits, or fewer max_tokens"; DeepSeek answers 402 "Insufficient Balance".
    # Neither is transient (no amount of retrying mints credit) and neither is OUR run budget
    # (``_BUDGET_ERROR_SIGNATURES`` owns that terminal) — it is precisely the hard primary-provider
    # failure a fallback on a DIFFERENT provider rescues, which is why the flag exists.
    #
    # Matched by distinctive PHRASE, never by a bare ``"402"``: three digits appear in token counts,
    # ids and costs, and a false positive here spends a whole second agent run.
    "requires more credits",
    "insufficient credits",
    "insufficient balance",
    "insufficient_quota",
    "payment required",
    # --- the model does not exist for this provider / key ---
    "model not found",
    "model_not_found",
    "invalid model",
    "llm provider not provided",
)

# THE CRUX EXCLUSION. Everything here is owned by the agent's OWN retry envelope
# (``num_retries``/``retry_max_wait`` from :func:`tvashtr.config.agent_llm_routing`), which rides it
# out INSIDE the agent loop. Failing over on a 429 would burn the fallback's quota on a wall the
# primary was about to clear, so these must stay a plain ``failed``. The proxy's budget cutoff is
# here too: it arrives wrapped as a ``RateLimitError`` and owns its own terminal status
# (``over_budget``) — it must never be re-read as a provider failure.
_TRANSIENT_ERROR_SIGNATURES = (
    "rate limit",
    "ratelimiterror",
    "rate_limit",
    "too many requests",
    "429",
    "timeout",
    "timed out",
    "overloaded",
    "budget has been exceeded",
)

# Exception CLASS names, matched EXACTLY (never by substring): litellm raises typed errors whose
# ``str()`` can carry nothing useful, so the type is the signal. Exact matching is load-bearing —
# a substring test would read the stdlib's ``FileNotFoundError`` as litellm's ``NotFoundError``.
_PROVIDER_ERROR_TYPES = frozenset(
    {
        "authenticationerror",
        "permissiondeniederror",
        "apiconnectionerror",
        "internalservererror",
        "serviceunavailableerror",
        "notfounderror",
        "apierror",
    }
)
_TRANSIENT_ERROR_TYPES = frozenset(
    {
        "ratelimiterror",
        "timeout",
        "timeouterror",
        "apitimeouterror",
        "connecttimeout",
        "readtimeout",
        "budgetexceedederror",
    }
)


def _text_has_transient_signature(text: str) -> bool:
    """True if ``text`` carries a signature the agent's own retry envelope owns. Split out from
    :func:`_text_has_provider_signature` because the veto has to apply to the exception-TYPE path
    too — see :func:`_is_provider_error`."""
    if not text:
        return False
    lowered = text.lower()
    return any(sig in lowered for sig in _TRANSIENT_ERROR_SIGNATURES)


def _text_has_provider_signature(text: str) -> bool:
    """True if ``text`` carries a HARD provider-failure signature — and no transient one.

    The transient test runs FIRST and WINS, so a 429 / rate-limit / timeout can never be promoted to
    a failover trigger no matter what else the message happens to contain. The single substring test
    is factored out exactly like ``_text_has_budget_signature`` so it can run against ANY error
    surface: the exception string (local mode) AND the docker/fly ConversationErrorEvent detail."""
    if not text:
        return False
    if _text_has_transient_signature(text):
        return False
    return any(sig in text.lower() for sig in _PROVIDER_ERROR_SIGNATURES)


def _exception_chain_type_names(exc: BaseException) -> set[str]:
    """Lower-cased class names down ``exc``'s ``__cause__`` / ``__context__`` chain — the TYPE
    mirror of :func:`_exception_chain_text` (same cycle-safe, bounded walk). A bare
    ``AuthenticationError("")`` carries its signal only here."""
    names: set[str] = set()
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(names) < 20:
        seen.add(id(current))
        names.add(type(current).__name__.lower())
        current = current.__cause__ or current.__context__
    return names


def _is_provider_error(exc: BaseException) -> bool:
    """True ONLY for a HARD primary-provider failure the node's ``fallback_model`` could actually
    rescue; False for every transient failure and every generic one.

    Mirrors :func:`_is_budget_error`: message chain first, then the exception TYPE chain. As with
    budget, in DOCKER/FLY mode the SDK's remote layer strips the detail from this exception (it
    becomes "Remote conversation ended with error"), so the adapters additionally classify on the
    captured ConversationErrorEvent detail via :func:`_text_has_provider_signature`."""
    text = _exception_chain_text(exc)
    types = _exception_chain_type_names(exc)
    # The transient veto spans BOTH surfaces before either is allowed to say "provider". litellm's
    # own ``APIError`` / ``APIConnectionError`` / ``InternalServerError`` classes are in
    # ``_PROVIDER_ERROR_TYPES``, yet a plain 429 can arrive wearing one of them — so a veto that
    # only guarded the message path would let the type path failover on a rate limit anyway,
    # breaking the one exclusion this slice must guarantee.
    if types & _TRANSIENT_ERROR_TYPES or _text_has_transient_signature(text):
        return False
    if _text_has_provider_signature(text):
        return True
    return bool(types & _PROVIDER_ERROR_TYPES)


class _LocalHandle:
    """The live local sandbox stashed in ``sandbox_cache`` for cross-round conversation-carry
    (M-unify U2): the in-process ``Conversation`` bound to the shared per-run workspace dir, plus a
    repointable event ``sink`` (see the docker adapter's ``_DockerHandle`` for the dispatch
    rationale — a reused Conversation must stream each round's events to THAT round's collector).
    Local mode has no container to keep 'warm'; the reuse value is purely the SAME Conversation
    continuing across
    rounds so the agent remembers."""

    def __init__(self):
        self.conversation = None
        self.sink = None

    def dispatch(self, oh_event) -> None:
        sink = self.sink
        if sink is not None:
            sink(oh_event)


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

        # M-unify U2: reuse this node's live Conversation across its own rounds when a
        # ``session_key`` is set — the SAME Conversation continues (the agent remembers prior
        # rounds; the condenser folds the growing transcript). Local mode has no container to keep
        # warm and the workspace is already the shared per-run dir, so reuse == conversation-carry.
        # ``None`` ⇒ a fresh Conversation per run, byte-for-byte the prior path.
        cached = sandbox_cache.get(task.session_key)

        before = _snapshot(task.workspace_dir)
        # Slice 4: for a workspace-READ-ONLY (outcome-emitting / reviewer) node, capture file
        # CONTENT so we can restore the worktree after the in-process run — the local mirror of the
        # docker adapter's scoped ``pull_paths``. None (a worker / greenfield) ⇒ no capture/restore:
        # byte-for-byte the prior path (no extra cost on the common worker path).
        content_before = (
            _content_snapshot(task.workspace_dir) if task.pull_paths is not None else None
        )
        status = "completed"
        error: str | None = None
        provider_failure = False
        prompt_tokens = 0
        completion_tokens = 0
        cost_usd = 0.0
        conversation = None
        usage_before = (0, 0, 0.0)  # per-round baseline; nonzero only on a HIT (metrics accumulate)
        try:
            if cached is None:
                # MISS (or reuse OFF): build the LLM/agent + a fresh Conversation. P1.4a/P1.4b:
                # route the agent's LLM through the proxy when on (master key / per-run vkey /
                # owner BYOK via ``task.llm_api_key``); OFF ⇒ the EXACT prior direct path (bare
                # slug + OPENROUTER_API_KEY). ``agent_llm_routing`` owns model/api_key/base_url.
                llm = LLM(
                    **agent_llm_routing(
                        settings, model, "local", api_key_override=task.llm_api_key
                    ),
                    temperature=0.0,
                    usage_id="tvashtr-agent",
                    # M-thrift: an EXPLICIT output ceiling. Unset, the SDK resolves the model's own
                    # maximum and litellm sends it as ``max_tokens`` — which OpenRouter reserves
                    # against the key's credit balance before generating anything, 402-ing a
                    # low-balance key on a request that would have cost cents. The condenser's
                    # ``model_copy`` below inherits it.
                    max_output_tokens=settings.agent_max_output_tokens,
                    # B-NODES: the node's Images opt-in turns vision on; unset ⇒ byte-identical.
                    **({"disable_vision": False} if task.multimodal else {}),
                )
                # M-ctx0 (C1): the in-transcript summarizing condenser (keep_first=2 / max_size=80)
                # via a model_copy under its OWN usage_id (fresh meter). On a REUSED Conversation
                # it lives on the retained agent, so it keeps folding the growing multi-round
                # transcript.
                condenser_llm = llm.model_copy(update={"usage_id": "tvashtr-condenser"})
                condenser_llm.reset_metrics()
                # M-tools C7.0: the node's inline tools + skills; both unset ⇒ agent_context=None +
                # no MCP tools, so the Agent is byte-identical to before.
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
                # The callback is bound ONCE to the handle's dispatcher so a REUSED Conversation can
                # be repointed at each round's collector.
                handle = _LocalHandle()
                handle.sink = _on_oh_event
                conversation = Conversation(
                    agent=agent,
                    workspace=task.workspace_dir,
                    callbacks=[handle.dispatch],
                    max_iteration_per_run=_MAX_ITERATIONS,
                    delete_on_close=False,  # keep the workspace + produced files
                )
                handle.conversation = conversation
                # Cache the live Conversation (reuse ON only). Local ``close`` is a no-op — the
                # shared workspace dir must survive to ship; eviction drops the ref and the
                # Conversation GCs exactly as today. ``put(None,…)`` is a no-op, so the no-reuse
                # path caches nothing.
                sandbox_cache.put(
                    task.session_key,
                    sandbox_cache.CachedSandbox(handle=handle, close=lambda: None),
                )
                conversation.send_message(task.instruction)
            else:
                # HIT (M-unify U2): reuse the SAME Conversation. The local workspace is already the
                # shared per-run dir (the prior round wrote it in place), so no re-sync is needed —
                # just send the next goal as a FOLLOW-UP and run() again (NOT a fresh Conversation).
                handle = cached.handle
                conversation = handle.conversation
                handle.sink = _on_oh_event  # repoint the dispatcher at THIS round's collector
                usage_before = _read_usage(
                    conversation
                )  # cumulative-so-far → per-round delta below
                conversation.send_message(task.instruction)
            conversation.run()
            # Decision 2 (primary path): read OpenHands' own accumulated usage after the run — NOT a
            # process-global litellm callback (which would also capture the gateway's direct calls).
            # On a HIT the metrics are cumulative across rounds, so subtract the pre-run baseline.
            pa, ca, cost_a = _read_usage(conversation)
            prompt_tokens = max(0, pa - usage_before[0])
            completion_tokens = max(0, ca - usage_before[1])
            cost_usd = max(0.0, cost_a - usage_before[2])
        except Exception as exc:
            # P1.4b: classify the proxy's mid-call budget cutoff as ``over_budget`` (else a
            # generic ``failed``). On the cutoff path, best-effort read whatever partial usage
            # accrued before the proxy cut it off (per-round delta on a HIT); _read_usage is
            # defensive (returns 0s if the conversation has none / isn't ready).
            budget_hit = _is_budget_error(exc)
            status = "over_budget" if budget_hit else "failed"
            # Tvashtr-79 item 7: a HARD provider wall is still ``failed`` — the additive flag rides
            # alongside so the Control Plane can fail the node over to its ``fallback_model`` ONCE.
            # Mirrored here for consistency with the remote adapters; local mode sees the real
            # exception, so the chain classification alone suffices (no event surface to consult).
            provider_failure = not budget_hit and _is_provider_error(exc)
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
            logger.exception(
                "OpenHands run cut off over budget"
                if status == "over_budget"
                else "OpenHands run failed"
            )

        total_tokens = prompt_tokens + completion_tokens
        after = _snapshot(task.workspace_dir)
        files_changed = sorted(p for p in after if before.get(p) != after[p])
        # Slice 4: an emitting node's in-place edits must NOT mutate the shippable worktree —
        # restore everything except the allowed ``pull_paths`` (the sidecar) and report only those.
        if task.pull_paths is not None and content_before is not None:
            files_changed = _restore_except(task.workspace_dir, content_before, task.pull_paths)

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

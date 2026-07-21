"""Tvashtr's engine-adapter boundary — the uniform contract through which the
Control Plane drives ANY coding-agent engine.

Architecture decision D1: OpenHands is the default/first engine, but Tvashtr is
engine-agnostic — engines sit behind this interface so others (e.g. the Claude
Agent SDK) can be added later. **The interface is the durable asset.**

Everything here is engine-NEUTRAL: these types contain no engine-specific
structures, so the Control Plane and all callers depend only on them — never on
``openhands.*``. The concrete adapter is the single place an engine SDK is
imported (mirroring the gateway's litellm discipline).
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Protocol, runtime_checkable


@dataclass(frozen=True)
class EngineEvent:
    """A normalized, engine-neutral record of one step in the agent loop.

    ``kind`` is one of the engine-neutral values ``"action"`` / ``"observation"``
    / ``"message"`` / ``"error"`` / ``"condensation"`` (the in-transcript context
    fold, M-ctx0 C1); ``payload`` is a free-form, JSON-able dict the adapter fills
    from the engine's native event (no engine types leak through).
    """

    seq: int
    kind: str
    payload: dict
    ts: float = field(default_factory=time.time)


@dataclass(frozen=True)
class AgentTask:
    """A unit of work handed to an engine: an instruction plus the local working
    directory the agent may touch. ``model`` is an optional override; when None
    the adapter uses Tvashtr's configured default.

    ``llm_api_key`` (P1.4b) is an optional per-run credential threaded into the agent's
    LLM as its api_key — the per-run LiteLLM **virtual key** (minted with a ``max_budget``)
    when the proxy is on, so the proxy enforces the run's budget mid-call. ``None`` (the
    default) ⇒ the adapter builds the LLM exactly as before (proxy master key, or
    ``OPENROUTER_API_KEY`` when the proxy is off).

    ``workspace_mode`` (M-brownfield Slice 1) selects how the docker adapter syncs the host
    ``workspace_dir`` ↔ the container. ``"greenfield"`` (the default) ⇒ byte-for-byte the prior
    behavior (the ephemeral workspace; non-hidden deliverable files only). ``"brownfield"`` ⇒ the
    git-aware sync for a real-repo worktree (push the repo's tracked + untracked-not-ignored files
    incl. tracked dotfiles; pull everything except ``.git/`` + the server scaffolding). It is an
    ADDITIVE, defaulted field — exactly the established way ``llm_api_key`` extended this contract,
    NOT a breaking interface change; the Control Plane never learns which adapter is active.

    ``pull_paths`` (M-brownfield Slice 4) scopes the END-of-run sync back to the host to a FIXED
    list of relative paths. ``None`` (the default) ⇒ the adapter pulls EVERYTHING (today's behavior,
    byte-identical for greenfield AND for a worker node). A set tuple ⇒ the adapter writes back ONLY
    those exact paths and nothing else, so the node's other workspace edits NEVER mutate the
    shippable host worktree. The Control Plane uses this to make an outcome-emitting (reviewer) node
    workspace-READ-ONLY — it passes ``("REVIEW_VERDICT.json",)`` so only the verdict sidecar is
    harvested and a reviewer can never clobber the worker's correct edit. It is an ADDITIVE,
    defaulted field in the SAME spirit as ``workspace_mode``/``llm_api_key``: the adapter learns a
    SYNC DIRECTIVE (which files to pull), NEVER the node's role — the seam stays role-neutral.

    ``mcp_config`` + ``skills`` (M-tools C7.0) are the per-node tools/skills the adapter hands to
    ``Agent(mcp_config=…, agent_context=AgentContext(skills=…))``. Both are ADDITIVE, defaulted
    fields in the SAME spirit as ``llm_api_key``/``pull_paths``: the Control Plane resolves them via
    its own ``node_tools`` / ``node_skills`` seams and passes them through — it never learns their
    tool/skill CONTENT. ``mcp_config`` is a plain dict (an empty/``None`` one ⇒ the adapter creates
    NO MCP tools). ``skills`` is typed as an opaque ``list`` (of engine-specific Skill objects — the
    adapter knows the type; base.py stays ``openhands``-free); an empty/``None`` list ⇒ the adapter
    passes ``agent_context=None``, so with both unset the Agent is byte-identical to before.

    ``session_key`` (M-unify U2) is an OPAQUE per-node reuse key (``"{run_id}::{node_id}"``) the
    Control Plane passes so the adapter can REUSE this node's sandbox across the node's own repeated
    goals (the Engineer/Reviewer across review-loop rounds): a docker container stays warm and the
    SAME OpenHands Conversation continues, so round 2+ skip the ~20s container spin-up AND the agent
    remembers prior rounds. ``None`` (the default) ⇒ NO reuse — the adapter builds + tears down a
    fresh sandbox per run, byte-for-byte today's behavior. It is an ADDITIVE, defaulted field in the
    SAME spirit as ``llm_api_key``/``pull_paths``/``mcp_config``: the Control Plane passes a KEY,
    NEVER a live sandbox handle — the live cache lives entirely in the adapter layer
    (``engines.sandbox_cache``), OUTSIDE the DBOS durable model (a live handle can't cross a
    ``@DBOS.step`` boundary). The key is stable across a node's loop rounds (node ids are minted
    once at clone-on-launch), so ``(run_id, node_id)`` is the reuse identity."""

    instruction: str
    workspace_dir: str
    model: str | None = None
    llm_api_key: str | None = None
    workspace_mode: Literal["greenfield", "brownfield"] = "greenfield"
    pull_paths: tuple[str, ...] | None = None
    mcp_config: dict | None = None
    skills: list | None = None  # opaque list of Skill objects (the adapter knows the type)
    session_key: str | None = None  # M-unify U2: per-node sandbox-reuse key; None ⇒ no reuse


@dataclass(frozen=True)
class AgentRunResult:
    # ``over_budget`` (P1.4b): the run was cut off mid-call by the proxy enforcing the
    # per-run virtual key's budget — distinct from a generic ``failed`` (the adapter
    # classifies the proxy's budget error). The Control Plane finalizes such a run
    # ``over_budget`` (no ship), reusing P1.2's terminal status.
    status: Literal["completed", "failed", "over_budget"]
    summary: str
    events: list[EngineEvent]
    files_changed: list[str]
    error: str | None = None
    # Engine-neutral usage, populated from the engine's own post-run telemetry.
    # Defaults keep the contract backward-compatible.
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    # ``provider_failure`` (Tvashtr-79 item 7): this ``failed`` run died on a HARD primary-provider
    # wall — a bad/expired key, an unreachable provider, a model that does not exist there —
    # explicitly NOT a 429 (the agent's own retry envelope owns those). The Control Plane reads it
    # to fail the node over ONCE to its ``config["fallback_model"]``. It is an ADDITIVE,
    # default-False field riding ALONGSIDE ``status``, whose vocabulary is deliberately UNCHANGED:
    # such a run is still ``"failed"``, so the workflow finalizer and every existing status switch
    # stay byte-identical when no provider failure occurs.
    provider_failure: bool = False


@runtime_checkable
class EngineAdapter(Protocol):
    """The uniform contract the Control Plane calls.

    Implementations translate an engine's native loop into ordered
    ``EngineEvent``s — streamed live via ``on_event`` and also collected into the
    returned ``AgentRunResult``.
    """

    name: str

    def run(
        self,
        task: AgentTask,
        on_event: Callable[[EngineEvent], None] | None = None,
    ) -> AgentRunResult: ...

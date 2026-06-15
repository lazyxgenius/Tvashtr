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
    / ``"message"`` / ``"error"``; ``payload`` is a free-form, JSON-able dict the
    adapter fills from the engine's native event (no engine types leak through).
    """

    seq: int
    kind: str
    payload: dict
    ts: float = field(default_factory=time.time)


@dataclass(frozen=True)
class AgentTask:
    """A unit of work handed to an engine: an instruction plus the local working
    directory the agent may touch. ``model`` is an optional override; when None
    the adapter uses Tvashtr's configured default."""

    instruction: str
    workspace_dir: str
    model: str | None = None


@dataclass(frozen=True)
class AgentRunResult:
    status: Literal["completed", "failed"]
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

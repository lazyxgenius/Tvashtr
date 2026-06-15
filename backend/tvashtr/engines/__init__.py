"""The engine-adapter layer: Tvashtr's engine-neutral contract for driving any
coding-agent engine, plus the run-event sink.

Import the contract types and the sink from here. The concrete OpenHands adapter
lives in ``tvashtr.engines.openhands_adapter`` and is imported *only* where a
live agent run is actually needed (e.g. the agent smoke), so ``openhands.*``
never enters the app/test import path."""

from tvashtr.engines.base import (
    AgentRunResult,
    AgentTask,
    EngineAdapter,
    EngineEvent,
)

__all__ = [
    "AgentRunResult",
    "AgentTask",
    "EngineAdapter",
    "EngineEvent",
]

"""Engine-adapter contract test — no network, no live agent.

Proves the Control-Plane-facing contract independently of OpenHands: a minimal
in-test adapter emits EngineEvents through ``on_event`` (in seq order) and
returns a well-formed AgentRunResult. This is what guarantees a second engine
(e.g. the Claude Agent SDK) can slot in behind the same interface later.
"""

from tvashtr.engines.base import (
    AgentRunResult,
    AgentTask,
    EngineAdapter,
    EngineEvent,
)


class FakeEchoAdapter(EngineAdapter):
    """A canned adapter: emits two events, then reports completion."""

    name = "fake-echo"

    def run(self, task, on_event=None):
        plan = [
            ("message", {"text": task.instruction}),
            ("action", {"tool_name": "noop"}),
        ]
        events: list[EngineEvent] = []
        for i, (kind, payload) in enumerate(plan):
            event = EngineEvent(seq=i, kind=kind, payload=payload, ts=float(i))
            events.append(event)
            if on_event is not None:
                on_event(event)
        return AgentRunResult(
            status="completed",
            summary=f"echoed {len(events)} events",
            events=events,
            files_changed=[],
        )


def test_adapter_streams_events_in_seq_order_and_returns_result():
    received: list[EngineEvent] = []
    adapter = FakeEchoAdapter()
    task = AgentTask(instruction="do the thing", workspace_dir="/tmp/x")

    result = adapter.run(task, on_event=received.append)

    # Events arrive live, in monotonic seq order.
    assert [e.seq for e in received] == [0, 1]
    assert [e.kind for e in received] == ["message", "action"]
    # Result shape is the engine-neutral contract.
    assert result.status == "completed"
    assert result.events == received
    assert result.files_changed == []
    assert "echoed 2" in result.summary


def test_fake_adapter_satisfies_engine_adapter_protocol():
    adapter = FakeEchoAdapter()
    # runtime_checkable Protocol: structural conformance to name + run().
    assert isinstance(adapter, EngineAdapter)
    assert adapter.name == "fake-echo"

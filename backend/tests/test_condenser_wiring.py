"""M-ctx0 (C1): BOTH worker adapters must construct the OpenHands ``Agent`` WITH an
``LLMSummarizingCondenser`` so a long real-repo run compacts its own transcript as it
grows instead of overflowing the model context window and crashing.

This is the on-disk regression that FAILS if the condenser is removed from — or misconfigured
in — either adapter. It is deliberately offline: ``Agent`` / ``Conversation`` (+ the docker
``DockerWorkspace`` / container reap) are mocked, so there is no container, no agent, and no
network. We build the REAL condenser the adapter hands to ``Agent(...)`` and inspect it — no DB.

The two ``agent = Agent(...)`` blocks are byte-identical across the local + docker adapters, so
this asserts the SAME wiring in both via a parametrization.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from openhands.sdk import LLMSummarizingCondenser
from openhands.sdk.event import (
    ActionEvent,
    AgentErrorEvent,
    Condensation,
    CondensationRequest,
    CondensationSummaryEvent,
    MessageEvent,
    ObservationBaseEvent,
    ObservationEvent,
)

from tvashtr.engines import openhands_adapter as local_mod
from tvashtr.engines import openhands_docker_adapter as docker_mod
from tvashtr.engines.base import AgentTask

# A realistic worker slug so the real ``agent_llm_routing`` → real ``LLM`` construction path is
# exercised (LLM construction is offline; the api_key override keeps routing key-agnostic).
_MODEL = "nvidia_nim/meta/llama-3.3-70b-instruct"


def _local_agent_kwargs(tmp_path) -> dict:
    """Run the LOCAL adapter with Agent + Conversation mocked; return the kwargs it passed to
    ``Agent(...)``. The real ``LLM`` + real ``LLMSummarizingCondenser`` are built (not mocked) so
    the captured ``condenser`` is the genuine object with its genuine params."""
    with (
        patch.object(local_mod, "Agent") as Agent,
        patch.object(local_mod, "Conversation"),
    ):
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model=_MODEL,
            llm_api_key="byok-key",
        )
        local_mod.OpenHandsAdapter().run(task)
    assert Agent.call_count == 1, "the adapter must construct exactly one worker Agent"
    return Agent.call_args.kwargs


def _docker_agent_kwargs(tmp_path) -> dict:
    """Same capture for the DOCKER adapter — the container (DockerWorkspace), the reap, and the
    Conversation are mocked; the workspace enumerates to empty so ``run()`` completes cleanly and
    the ``Agent(...)`` call (made before the container block) is captured."""
    ws = MagicMock()
    ws.working_dir = "/workspace"
    ws.execute_command.return_value = MagicMock(stdout="", exit_code=0)
    with (
        patch.object(docker_mod, "reap_agent_containers"),
        # M-unify U2: the adapter no longer uses ``with`` — DockerWorkspace(...) IS the workspace.
        patch.object(docker_mod, "DockerWorkspace", return_value=ws),
        patch.object(docker_mod, "Conversation"),
        patch.object(docker_mod, "Agent") as Agent,
    ):
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model=_MODEL,
            llm_api_key="byok-key",
        )
        docker_mod.OpenHandsDockerAdapter().run(task)
    assert Agent.call_count == 1, "the adapter must construct exactly one worker Agent"
    return Agent.call_args.kwargs


@pytest.mark.parametrize("adapter", ["local", "docker"])
def test_worker_agent_is_built_with_summarizing_condenser(adapter, tmp_path):
    kwargs = _local_agent_kwargs(tmp_path) if adapter == "local" else _docker_agent_kwargs(tmp_path)

    # The condenser MUST be wired — removing ``condenser=`` from either Agent(...) fails here.
    assert "condenser" in kwargs, (
        f"the {adapter} adapter must pass condenser= to Agent() so long runs self-compact"
    )
    condenser = kwargs["condenser"]
    assert isinstance(condenser, LLMSummarizingCondenser), (
        f"the {adapter} adapter's condenser must be an LLMSummarizingCondenser, "
        f"got {type(condenser).__name__}"
    )

    # keep_first=2 pins the compiled instruction (the first messages); Tvashtr's durable
    # spec / worktree / verdict artifacts live OUTSIDE the transcript, so 2 suffices.
    assert condenser.keep_first == 2, (
        f"the {adapter} condenser must keep_first=2, got {condenser.keep_first}"
    )
    # max_size is the SDK's "condense when the view exceeds N events" threshold (Reason.EVENTS):
    # the SDK preset default of 80 — inert under ~80 events so short runs behave exactly as before.
    assert condenser.max_size == 80, (
        f"the {adapter} condenser must have the size threshold max_size=80, "
        f"got {condenser.max_size}"
    )

    # The condenser reuses the WORKER's model + key (a model_copy), under its OWN usage_id so the
    # docker-serialized agent never trips the SDK LLM registry's duplicate-usage_id guard.
    assert condenser.llm.model == _MODEL, "the condenser must reuse the worker's model"
    assert condenser.llm.usage_id == "tvashtr-condenser", (
        "the condenser LLM must carry a distinct usage_id (registry duplicate-guard safety)"
    )


# ---- Tvashtr-79 item 5: the condenser's OWN event must reach ``run_events`` ----------------------
#
# Wiring the condenser (above) was only half of M-ctx0 C1. ``_kind_of`` mapped ONLY the four
# LLM-convertible event types, and the SDK's ``Condensation`` is a DIRECT ``Event`` subclass
# (openhands/sdk/event/condenser.py) — so it returned ``None`` and ``_on_oh_event`` DROPPED it.
# "Zero condensation rows in ``run_events``" was therefore STRUCTURALLY GUARANTEED, not evidence
# the condenser never fired: the C1 proof had to be read out of container logs. These tests pin the
# fifth engine-neutral kind, ``"condensation"``. Both remote adapters import ``_kind_of`` /
# ``_payload_of`` from this module, so the one mapping covers local, docker AND fly.


def _condensation(**overrides) -> Condensation:
    """A REAL SDK ``Condensation`` — what ``LLMSummarizingCondenser`` emits when it folds the
    transcript (the runtime line "Auto Conversation Condensation Triggered / Forgetting N events").
    """
    kwargs = {
        "forgotten_event_ids": {"ev-1", "ev-2", "ev-3"},
        "summary": "The agent scaffolded the project and ran the test suite.",
        "summary_offset": 1,
        "llm_response_id": "resp-abc123",
    }
    kwargs.update(overrides)
    return Condensation(**kwargs)


def test_a_condensation_event_maps_to_the_condensation_kind():
    """THE REPRODUCE-FIRST MAPPING: RED before item 5 — ``_kind_of`` returned ``None``, so the
    collector's ``if kind is None: return`` dropped every condensation on the floor."""
    assert local_mod._kind_of(_condensation()) == "condensation"


@pytest.mark.parametrize(
    "event_cls,expected",
    [
        (ActionEvent, "action"),
        (ObservationBaseEvent, "observation"),
        (ObservationEvent, "observation"),
        # NOT a typo and NOT changed by item 5: ``AgentErrorEvent`` SUBCLASSES
        # ``ObservationBaseEvent`` in the SDK, and ``_kind_of`` tests ``ObservationBaseEvent``
        # first — so an agent error has ALWAYS mapped to ``"observation"`` and the ``"error"``
        # branch below it is unreachable. Pinned here as the pre-existing behaviour precisely so
        # item 5 can be shown to leave it byte-identical; correcting the ordering would be a
        # BEHAVIOUR change (it would start downgrading clean runs to ``failed`` via the
        # ``any(e.kind == "error")`` check) and is out of scope for this additive slice.
        (AgentErrorEvent, "observation"),
        (MessageEvent, "message"),
    ],
)
def test_the_pre_existing_kinds_map_unchanged(event_cls, expected):
    """The ADDITIVITY invariant: item 5 must not re-route any pre-existing event type.
    ``MagicMock(spec=…)`` satisfies the adapter's ``isinstance`` checks without pydantic
    ceremony."""
    assert local_mod._kind_of(MagicMock(spec=event_cls)) == expected


def test_the_condensation_siblings_are_still_dropped():
    """ONLY ``Condensation`` was added. Its two siblings in the SAME SDK module still map to
    ``None`` — so a blanket ``Event`` catch-all (which would flood ``run_events`` with system
    prompts, streaming deltas and token events) fails here."""
    assert local_mod._kind_of(CondensationRequest()) is None
    assert local_mod._kind_of(CondensationSummaryEvent(summary="a folded summary")) is None


def test_the_condensation_payload_is_bounded_and_json_serializable():
    """Mutation teeth: ``_payload_of`` has NO ``else`` — an unrecognized kind falls through to the
    MESSAGE branch and returns ``{"source": …, "text": "None"}``. Delete the ``"condensation"``
    branch and every assertion below fails. ``json.dumps`` is the real gate the ``run_events`` sink
    applies, and ``forgotten_event_ids`` is a **set** — raw, it raises."""
    payload = local_mod._payload_of(_condensation(), "condensation")
    json.dumps(payload)  # TypeError on a raw set / any non-JSON-able value
    assert payload["forgotten_count"] == 3
    assert payload["summary"].startswith("The agent scaffolded")
    assert payload["summary_offset"] == 1
    assert payload["llm_response_id"] == "resp-abc123"


def test_the_condensation_payload_truncates_a_huge_summary():
    """Bounded like every other branch — a folded transcript's summary can be arbitrarily long."""
    payload = local_mod._payload_of(_condensation(summary="x" * 5000), "condensation")
    assert payload["summary"] == "x" * 2000
    assert json.dumps(payload)


def test_a_condensation_with_no_summary_still_serializes():
    """``summary``/``summary_offset`` are Optional on the SDK event (a forget-only condensation);
    payload extraction must never raise and must stay JSON-able."""
    payload = local_mod._payload_of(
        _condensation(summary=None, summary_offset=None), "condensation"
    )
    assert payload["summary"] == ""
    assert payload["summary_offset"] is None
    assert payload["forgotten_count"] == 3
    assert json.dumps(payload)


def test_the_adapter_collector_keeps_a_condensation_event(tmp_path):
    """THE REPRODUCE-FIRST COLLECTOR CASE: the adapter must COLLECT the condensation rather than
    drop it. Offline — LLM/Agent/Conversation are mocked and the mocked ``run()`` fires ONE real
    ``Condensation`` through the callback the adapter itself bound, exactly as the SDK would."""
    convo = MagicMock()
    with (
        patch.object(local_mod, "Conversation", return_value=convo) as Conv,
        patch.object(local_mod, "LLM"),
        patch.object(local_mod, "Agent"),
        patch.object(local_mod, "LLMSummarizingCondenser"),
        patch.object(local_mod, "Tool"),
        patch.object(local_mod, "TerminalTool"),
        patch.object(local_mod, "FileEditorTool"),
    ):
        convo.run.side_effect = lambda: Conv.call_args.kwargs["callbacks"][0](_condensation())
        result = local_mod.OpenHandsAdapter().run(
            AgentTask(
                instruction="x",
                workspace_dir=str(tmp_path),
                model=_MODEL,
                llm_api_key="byok-key",
            )
        )
    assert [e.kind for e in result.events] == ["condensation"], [e.kind for e in result.events]
    assert result.events[0].payload["forgotten_count"] == 3
    json.dumps([e.payload for e in result.events])  # what the run_events sink does with them
    # A condensation is NOT an error event — it must never downgrade a clean run to ``failed``.
    assert result.status == "completed"

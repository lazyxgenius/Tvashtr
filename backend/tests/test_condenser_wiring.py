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

from unittest.mock import MagicMock, patch

import pytest
from openhands.sdk import LLMSummarizingCondenser

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
    dw_cm = MagicMock()
    dw_cm.__enter__.return_value = ws
    dw_cm.__exit__.return_value = None
    with (
        patch.object(docker_mod, "reap_agent_containers"),
        patch.object(docker_mod, "DockerWorkspace", return_value=dw_cm),
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

"""M-thrift — a demo run survives a dead paid provider and burns far fewer tokens.

Four independent levers, one milestone:

1. an explicit output ceiling on every ``LLM(...)`` the adapters build (OpenHands otherwise asks
   for the model's own maximum, and OpenRouter's pre-flight credit reservation 402s on it);
2. the free provider first in the account-default preference order;
3. a real per-node ``fallback_model`` stamped by the builders — and proven to resolve the FALLBACK
   provider's OWN key on both the agent and the gateway path;
4. the vendored ``caveman`` skill on every worker node, so a round emits far fewer tokens.

THE REGRESSION (lever 3, reproduce-first). The exact wall a dead paid provider puts up is an
OpenRouter **402** — "requires more credits, or fewer max_tokens" — and nothing in the provider
signature table matched it. In docker/fly mode the SDK genericizes the raised exception, so the
ConversationErrorEvent detail is the ONLY surface classification has: a 402 read as a plain
``failed``, ``provider_failure`` stayed False, and the executor's one-shot failover never fired.
The node's ``fallback_model`` — the whole point of authoring one — was dead on the one failure it
exists for.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id, maybe_write_entry_report
from sqlalchemy import select
from test_proxy_adapter_wiring import (
    _GENERIC_REMOTE_EXC,
    ConversationErrorEvent,
    _run_docker_result,
)

from tvashtr.db import session_scope
from tvashtr.engines.openhands_adapter import (
    _text_has_budget_signature,
    _text_has_provider_signature,
)
from tvashtr.models import AgentNode

# The verbatim shape OpenRouter returns when a key's credit balance cannot cover the request's
# reserved output tokens. Captured from the live wall this milestone exists to survive.
OPENROUTER_402_CREDIT_ERROR = (
    "litellm.APIError: OpenrouterException - "
    '{"error":{"message":"This request requires more credits, or fewer max_tokens. You '
    "requested up to 16384 tokens, but can only afford 7127. To increase, visit "
    'https://openrouter.ai/settings/credits and upgrade to a paid account.","code":402}}'
)

_FALLBACK_MODEL = "openai/gpt-4o-mini"  # a provider the conftest owner holds a dummy key for


# =================================================================================================
# THE REGRESSION — a 402 credit wall is a HARD provider failure the node's fallback can rescue
# =================================================================================================


def test_a_402_credit_error_is_classified_as_a_hard_provider_failure():
    """RED before M-thrift: no signature in ``_PROVIDER_ERROR_SIGNATURES`` matched a 402, so the
    ONE surface docker/fly classification has (the ConversationErrorEvent detail) read the wall as
    a generic failure. A credit-exhausted key is exactly what a fallback on a different provider
    rescues."""
    assert _text_has_provider_signature(OPENROUTER_402_CREDIT_ERROR) is True


def test_a_402_credit_error_is_not_read_as_the_run_budget_cutoff():
    """The discriminator that must survive the fix: Tvashtr's own per-run budget cutoff owns
    ``over_budget`` (a legitimate terminal). A provider's credit wall is somebody else's balance —
    it must never be laundered into our budget terminal, or the run stops instead of failing over.
    """
    assert _text_has_budget_signature(OPENROUTER_402_CREDIT_ERROR) is False


def _credit_error_event():
    """A ConversationErrorEvent carrying the 402 detail — the docker/fly surface.

    ``code`` is the GENERIC ``LLMError``, deliberately: the adapter classifies
    ``f"{code}: {detail}"``, so borrowing an auth-flavoured code (``LLMAuthenticationError``) would
    smuggle the answer in through the code and green the test for the wrong reason. The 402 has to
    be recognised from the message alone, which is all a credit wall actually gives you."""
    return ConversationErrorEvent.model_construct(
        code="LLMError", detail=OPENROUTER_402_CREDIT_ERROR
    )


def test_docker_flags_a_402_credit_error_via_the_error_event(tmp_path):
    """THE REPRODUCE-FIRST ADAPTER CASE. Docker is the default sandbox: the raised exception is the
    SDK's generic remote wrap and the 402 survives ONLY in the captured error event. Status stays
    ``failed``; the flag is what the executor's one-shot failover reads."""
    result = _run_docker_result(
        tmp_path, feed_events=[_credit_error_event()], raise_exc=_GENERIC_REMOTE_EXC
    )
    assert result.status == "failed"
    assert result.provider_failure is True


class _CreditWallAdapter:
    """A worker adapter that hits the 402 credit wall once, then succeeds.

    ``provider_failure`` is NOT hardcoded — it is DERIVED by running the production classifier over
    the real 402 text, exactly as the docker adapter does. So this test is red for the same reason
    the live run was: misclassify the wall and no failover happens."""

    name = "openhands"

    def __init__(self, tasks: list) -> None:
        self._tasks = tasks

    def run(self, task, on_event=None):
        from tvashtr.engines.base import AgentRunResult

        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._tasks.append(task)
        if len(self._tasks) == 1:
            return AgentRunResult(
                status="failed",
                summary="the provider refused the request",
                events=[],
                files_changed=[],
                error=OPENROUTER_402_CREDIT_ERROR,
                provider_failure=_text_has_provider_signature(OPENROUTER_402_CREDIT_ERROR),
            )
        Path(task.workspace_dir).joinpath("greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _set_config_by_role(team_graph_id: str, role_name: str, updates: dict) -> None:
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == role_name,
            )
        ).scalar_one()
        cfg = dict(node.config or {})
        cfg.update(updates)
        node.config = cfg


def _seed_run_for(run_id: str, team_graph_id: str, idea: str) -> None:
    from tvashtr.models import Run

    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status="running",
            )
        )


def _drive_run(run_id: str, idea: str) -> dict:
    from dbos import DBOS, SetWorkflowID

    from tvashtr.control_plane import team_run

    with SetWorkflowID(run_id):
        return DBOS.start_workflow(team_run.run_team, idea).get_result()


def test_the_executor_swaps_to_the_fallback_model_on_a_402_credit_wall(
    client, monkeypatch, tmp_path
):
    """THE REPRODUCE-FIRST EXECUTOR CASE, end to end: the worker's paid provider refuses with a 402,
    the step re-runs ONCE on the node's ``fallback_model`` — resolved with the FALLBACK provider's
    OWN key, not the primary's — and the run COMPLETES.

    RED before M-thrift: the 402 classified as a generic failure, so the failover branch was never
    entered and the run finalized ``failed`` after one attempt."""
    from tvashtr.control_plane import team_run
    from tvashtr.control_plane.credentials import provider_for_model
    from tvashtr.control_plane.shipping import init_workspace_repo
    from tvashtr.control_plane.teams import build_two_node_team

    # The offline owner holds the SAME dummy key string for every provider, so comparing key VALUES
    # cannot tell "resolved for the fallback's provider" from "reused the primary's". Resolve
    # through a provider-distinct sentinel instead — the assertion below then fails if the executor
    # carries the primary's key into the failover.
    monkeypatch.setattr(
        team_run, "_owner_api_key", lambda run_id, model: f"key-for-{provider_for_model(model)}"
    )
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    tasks: list = []
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _CreditWallAdapter(tasks))

    team_graph_id = build_two_node_team()
    _set_config_by_role(team_graph_id, "engineer", {"fallback_model": _FALLBACK_MODEL})
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")
    result = _drive_run(run_id, "Add a greeting.")

    assert result["status"] == "completed", result
    assert len(tasks) == 2, [t.model for t in tasks]
    primary, failover = tasks
    assert primary.model != _FALLBACK_MODEL
    assert failover.model == _FALLBACK_MODEL
    # The FALLBACK provider's own key — not the primary's. A failover that reused the primary's key
    # would authenticate against the wrong provider and fail a second time for a third reason.
    assert primary.llm_api_key == f"key-for-{provider_for_model(primary.model)}"
    assert failover.llm_api_key == "key-for-openai"
    assert failover.llm_api_key != primary.llm_api_key


# =================================================================================================
# ITEM 1 — the output ceiling reaches ``LLM(...)`` in ALL THREE adapters
# =================================================================================================


def _llm_kwargs_for_fly(settings, tmp_path):
    """Drive the FLY adapter just past the LLM construction and return the ``LLM()`` kwargs.

    The fly path builds its sandbox before the LLM, so the boot is stubbed out and the workspace's
    first post-LLM call raises to stop the run — the local/docker twins in
    ``test_proxy_adapter_wiring`` use the same trick."""
    from unittest.mock import MagicMock, patch

    from tvashtr.engines import openhands_fly_adapter as fly_mod
    from tvashtr.engines.base import AgentTask

    workspace = MagicMock()
    workspace.execute_command.return_value = MagicMock(exit_code=0, stdout="", stderr="")
    sandbox = MagicMock(app_name="tv-run-x", working_dir="/workspace")
    # A real dict, so ``sandbox.nodes.get(node_id)`` returns None and the adapter takes the MISS
    # branch that actually builds an LLM (a bare MagicMock returns a truthy mock and skips it).
    sandbox.nodes = {}
    with (
        patch.object(fly_mod, "get_settings", return_value=settings),
        patch.object(fly_mod, "_ensure_run_sandbox", return_value=(sandbox, True)),
        patch.object(fly_mod.sandbox_cache, "put"),
        patch.object(fly_mod, "RemoteWorkspace", return_value=workspace),
        patch.object(fly_mod, "LLM") as LLM,
        patch.object(fly_mod, "Agent"),
        patch.object(fly_mod, "LLMSummarizingCondenser"),
        patch.object(fly_mod, "Tool"),
        patch.object(fly_mod, "TerminalTool"),
        patch.object(fly_mod, "FileEditorTool"),
        patch.object(fly_mod, "Conversation", side_effect=RuntimeError("stop-after-llm")),
    ):
        task = AgentTask(
            instruction="x",
            workspace_dir=str(tmp_path),
            model="openrouter/m",
            llm_api_key="byok-key",
            session_key="thrift-run::n0",
        )
        fly_mod.OpenHandsFlyAdapter().run(task)
    return LLM.call_args.kwargs


def test_the_output_ceiling_reaches_the_llm_in_all_three_adapters(tmp_path):
    """ITEM 1. OpenHands leaves ``max_output_tokens`` unset, so the SDK resolves the MODEL's own
    maximum (16384 on gpt-4o-mini) and litellm sends it as ``max_tokens`` — which OpenRouter
    reserves against the key's credit balance BEFORE generating anything, refusing a low-balance key
    with a 402 on a reply that would have cost cents. Every adapter must stamp the finite ceiling;
    an adapter that forgot would keep 402-ing while the other two were fixed."""
    from test_proxy_adapter_wiring import _run_docker, _run_local

    from tvashtr.config import Settings

    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    assert settings.agent_max_output_tokens == 4096  # the safe default, not an opt-in
    for kwargs in (
        _run_local(settings, tmp_path, llm_api_key="byok-key"),
        _run_docker(settings, tmp_path, llm_api_key="byok-key"),
        _llm_kwargs_for_fly(settings, tmp_path),
    ):
        assert kwargs["max_output_tokens"] == 4096


def test_the_output_ceiling_is_env_dialable(monkeypatch, tmp_path):
    """A ceiling nobody can move is a ceiling that will be wrong for somebody."""
    from test_proxy_adapter_wiring import _run_local

    from tvashtr.config import Settings

    monkeypatch.setenv("TVASHTR_AGENT_MAX_OUTPUT_TOKENS", "1024")
    settings = Settings(_env_file=None, litellm_proxy_enabled=False)
    assert _run_local(settings, tmp_path, llm_api_key="k")["max_output_tokens"] == 1024


# =================================================================================================
# ITEM 2 + 3 — free provider first, and a real fallback stamped on every model-bearing node
# =================================================================================================


def _nodes_of(team_graph_id: str) -> list:
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .all()
        )
        return [
            {
                "role": n.role_name,
                "kind": n.kind,
                "engine": n.engine,
                "model": n.model,
                "config": dict(n.config or {}),
                "prompt": n.prompt,
                "skills": n.skills,
            }
            for n in rows
        ]


def _all_builders():
    from tvashtr.control_plane import teams as t

    return [
        t.build_two_node_team,
        t.build_review_loop_team,
        t.build_thinker_chain_team,
        t.build_plan_review_team,
        t.build_full_squad_team,
    ]


def test_a_two_provider_account_gets_nvidia_primary_and_openrouter_as_the_fallback():
    """ITEMS 2 + 3 together, on every builder: the account holds the exhausted paid provider AND the
    free one, so the free one must be what every model node RUNS on and the paid one must be what it
    falls back TO. Before M-thrift openrouter won primary and there was no fallback key at all."""
    held = {"openrouter", "nvidia_nim"}
    for builder in _all_builders():
        nodes = _nodes_of(builder(held_providers=held))
        model_bearing = [n for n in nodes if n["model"] is not None]
        assert model_bearing, builder.__name__
        for node in model_bearing:
            assert node["model"] == "nvidia_nim/meta/llama-3.3-70b-instruct", (
                builder.__name__,
                node["role"],
            )
            assert node["config"].get("fallback_model") == "openrouter/openai/gpt-4o-mini", (
                builder.__name__,
                node["role"],
            )
        # A gate or terminal carries no model, so it must never acquire a fallback either.
        for node in nodes:
            if node["model"] is None:
                assert "fallback_model" not in node["config"], (builder.__name__, node["role"])


def test_a_one_provider_account_gets_no_fallback_key_at_all():
    """The byte-identity half of item 3: with nowhere to fail over TO, the builders must write NO
    ``fallback_model`` key — not the primary again, not ``None``. An authored ``None`` would read as
    'a fallback exists' at every ``config.get`` site and a self-referential one would burn a second
    full agent run on the provider that just died."""
    for builder in _all_builders():
        for node in _nodes_of(builder(held_providers={"deepseek"})):
            assert "fallback_model" not in node["config"], (builder.__name__, node["role"])
        # …and the same for a caller that names no account at all (the legacy/direct path).
        for node in _nodes_of(builder()):
            assert "fallback_model" not in node["config"], (builder.__name__, node["role"])


def test_the_stamped_fallback_never_names_the_primary_s_own_provider():
    """The fallback is the SECOND entry of the same walk the primary's first comes from, so a
    failover always crosses a real vendor boundary — the one thing that makes it worth a second run.
    """
    from tvashtr.control_plane.credentials import provider_for_model
    from tvashtr.control_plane.teams import PROVIDER_CATALOGUE, account_fallback_model
    from tvashtr.control_plane.teams import account_default_model as primary_of

    held = set(PROVIDER_CATALOGUE)
    for _ in range(len(held)):
        assert provider_for_model(primary_of(held)) != provider_for_model(
            account_fallback_model(held)
        )
        held.discard(provider_for_model(primary_of(held)))
        if len(held) < 2:
            break
    from tvashtr.control_plane.teams import account_fallback_model as fb

    assert fb(set()) is None
    assert fb({"deepseek"}) is None


def test_the_executor_resolves_the_fallback_providers_own_key_on_the_gateway_path(client):
    """ITEM 3's other half — VERIFIED, not assumed. The host-side completion path
    (``POST /api/runs/{id}/nodes/{node}/ask`` → ``gateway.complete``) must resolve the FALLBACK's
    key from ITS provider's credential row, not hand the primary's key to a different vendor."""
    import inspect

    from tvashtr import routers

    source = inspect.getsource(routers.ask_node)
    assert "resolve_owner_api_key(owner_id, fallback_model)" in source
    assert "fallback_api_key=fallback_api_key" in source
    # …and the gateway actually PREFERS that key over the primary's when it splices the fallback in.
    gw_source = inspect.getsource(
        __import__("tvashtr.gateway.gateway", fromlist=["complete"]).complete
    )
    assert "request.fallback_api_key" in gw_source


# =================================================================================================
# ITEM 4 — caveman on every worker, no thinker, and the reviewer's literal contract intact
# =================================================================================================


def test_every_worker_carries_the_caveman_skill_and_no_thinker_does():
    """ITEM 4. ``always`` mode, on the engine-backed nodes only. A thinker is one completion with no
    tool loop — its skills are rendered INTO its prompt (``node_skills.inject_skills_into_prompt``),
    so stamping a compression style there would rewrite the PRD-writing instructions themselves."""
    from tvashtr.control_plane.teams import CAVEMAN_SKILL_MD

    seen_worker = seen_thinker = False
    for builder in _all_builders():
        for node in _nodes_of(builder(held_providers={"nvidia_nim", "openrouter"})):
            if node["kind"] == "agent":
                seen_worker = True
                assert node["engine"] is not None, node["role"]
                assert node["skills"] == [
                    {
                        "type": "inline",
                        "name": "caveman",
                        "content": CAVEMAN_SKILL_MD,
                        "mode": "always",
                    }
                ], (builder.__name__, node["role"])
            else:
                if node["kind"] == "completion":
                    seen_thinker = True
                assert node["skills"] is None, (builder.__name__, node["role"])
    assert seen_worker and seen_thinker


def test_the_caveman_skill_is_vendored_on_disk_and_never_fetched():
    """NO runtime fetch: the agent runs behind the M-h3 egress fence, so the content must already be
    on disk. It is read once at import from the package, and the module makes no network call."""
    import inspect

    from tvashtr.control_plane import teams as t

    path = Path(t.__file__).resolve().parent.parent / "skills" / "caveman" / "SKILL.md"
    assert path.is_file()
    assert t.CAVEMAN_SKILL_MD == path.read_text(encoding="utf-8")
    assert t.CAVEMAN_SKILL_MD.strip()
    source = inspect.getsource(t)
    for forbidden in ("requests.", "httpx.", "urlopen", "curl "):
        assert forbidden not in source
    # Each node gets its OWN list/dict — never one object shared across every worker in the DB.
    a, b = t.caveman_skill_sources(), t.caveman_skill_sources()
    assert a == b and a is not b and a[0] is not b[0]


def test_caveman_does_not_touch_the_reviewer_literal_contract():
    """THE INVARIANT. The reviewer's verdict contract is three literals the Control Plane matches
    EXACTLY: the ``REVIEW_VERDICT.json`` sidecar, the strings ``approved``/``changes_requested``,
    and the ``python -B -m unittest`` command. Caveman is an ADDITIVE skill — it never edits a
    prompt — so the stamped reviewer's prompt must still be the module's ``REVIEWER_PROMPT``
    verbatim, literals and all. (The live half of this proof is ``make loop-run``.)"""
    from tvashtr.control_plane.teams import CAVEMAN_SKILL_MD, REVIEWER_PROMPT

    literals = ("REVIEW_VERDICT.json", "approved", "changes_requested", "python -B -m unittest")
    for literal in literals:
        assert literal in REVIEWER_PROMPT

    reviewers = [
        n
        for builder in _all_builders()
        for n in _nodes_of(builder(held_providers={"nvidia_nim", "openrouter"}))
        if n["role"] == "reviewer"
    ]
    assert reviewers
    assert {r["prompt"] for r in reviewers} == {REVIEWER_PROMPT}

    # And the vendored text itself carves out exactly what the contract needs: code, commands and
    # error strings stay verbatim, and compression must never GROW or reword the output.
    assert "Code blocks unchanged. Errors quoted exact." in CAVEMAN_SKILL_MD
    assert "Never ADD word to sound caveman" in CAVEMAN_SKILL_MD


# =================================================================================================
# THE FROZEN SEAMS — proven, not assumed
# =================================================================================================


def test_the_gateway_complete_and_embed_signatures_are_unchanged():
    """INVARIANT: M-thrift touches the agent path and the team builders. The gateway's two public
    entry points are the completion/embedding seam every other milestone builds on — their
    signatures must be byte-stable."""
    import inspect

    from tvashtr.gateway import gateway as gw

    assert str(inspect.signature(gw.complete)) == (
        "(request: tvashtr.gateway.types.CompletionRequest)"
        " -> tvashtr.gateway.types.CompletionResult"
    )
    assert str(inspect.signature(gw.embed)) == (
        "(request: tvashtr.gateway.types.EmbeddingRequest) -> tvashtr.gateway.types.EmbeddingResult"
    )

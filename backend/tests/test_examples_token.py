"""M2: the examples run token opens only ``/mcp/examples``, only for its run while that run is
live and drafts for a model, only that run's batch, with only its node's permission (a ``review``
token can't add, a ``read`` token can't write or review); a forged, old, other-salt or other-run
token gets nothing. No key or login is ever in the token."""

import json
import time
import uuid

import pytest
from itsdangerous import URLSafeTimedSerializer
from m2_fixtures import SECRET, account, builder_id, choice_model, domain, draft

from tvashtr.config import get_settings
from tvashtr.control_plane import examples_mcp, model_examples, node_tools
from tvashtr.control_plane.connector_proxy import RUN_TOKEN_MAX_AGE_SECONDS
from tvashtr.db import session_scope
from tvashtr.models import ModelExampleBatch, Run


def _live_batch(c, owner, mid, did, status="running"):
    team = builder_id(c, mid)
    with session_scope() as s:
        run = Run(
            id=uuid.uuid4(),
            team_graph_id=uuid.UUID(team),
            owner_id=owner,
            idea="x",
            workflow_id="w",
            status=status,
        )
        s.add(run)
        s.flush()
        batch = ModelExampleBatch(
            model_id=uuid.UUID(mid),
            owner_id=owner,
            run_id=run.id,
            domain_id=uuid.UUID(did),
            domain_name="Claims handbook",
            team_id=uuid.UUID(team),
            team_name="Example builder",
            tests_wanted=2,
            training_wanted=2,
        )
        s.add(batch)
        s.flush()
        return run.id, batch.id


class _Req:
    def __init__(self, token):
        self.headers = {"authorization": f"Bearer {token}"} if token is not None else {}


class _Ctx:
    def __init__(self, token):
        self.request_context = type("R", (), {"request": _Req(token)})()


def _tool_fields(fields: dict) -> dict:
    """The tool's own parameter names: a draft's kind is ``example_type`` there."""
    out = dict(fields)
    out["example_type"] = out.pop("kind")
    return out


def _tools():
    mcp = examples_mcp.create_examples_fastmcp()
    return {t.name: t.fn for t in mcp._tool_manager.list_tools()}


def test_the_token_names_its_run_node_and_permission_and_no_key(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    run_id, batch_id = _live_batch(c, owner, mid, did)
    node = uuid.uuid4()
    token = node_tools.sign_examples_token(run_id, node, "write")
    grant = node_tools.read_examples_token(token)
    assert grant == {
        "owner_id": owner,
        "run_id": run_id,
        "node_id": node,
        "permission": "write",
        "batch_id": batch_id,
    }
    assert SECRET not in token and "password" not in token
    payload = URLSafeTimedSerializer(
        get_settings().session_secret.get_secret_value(), salt="tvashtr.examples-run"
    ).loads(token)
    assert set(payload) == {"r", "n", "p"}


def test_a_forged_old_other_salt_or_ended_run_token_gets_nothing(client, monkeypatch):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    run_id, _ = _live_batch(c, owner, mid, did)
    good = node_tools.sign_examples_token(run_id, None, "write")
    assert node_tools.read_examples_token(good[:-2] + "xx") is None  # forged
    assert node_tools.read_examples_token(node_tools.sign_domains_token(run_id, None, None)) is None
    assert (
        node_tools.read_examples_token(node_tools.sign_examples_token(run_id, None, "admin"))
        is None
    )
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() + RUN_TOKEN_MAX_AGE_SECONDS + 60)
    assert node_tools.read_examples_token(good) is None  # too old
    monkeypatch.setattr(time, "time", real_time)
    with session_scope() as s:
        s.get(Run, run_id).status = "completed"
    assert node_tools.read_examples_token(good) is None  # the run ended
    other_run, _ = _live_batch(c, owner, mid, did, status="running")
    with session_scope() as s:
        s.query(ModelExampleBatch).filter(ModelExampleBatch.run_id == other_run).delete()
    assert (
        node_tools.read_examples_token(node_tools.sign_examples_token(other_run, None, "write"))
        is None
    )  # a live run with no batch
    # A Domains token doesn't open the examples tools, nor the reverse.
    assert node_tools.read_domains_token(good) is None


def test_each_permission_opens_only_its_tools(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    run_id, batch_id = _live_batch(c, owner, mid, did)
    tools = _tools()
    fields = _tool_fields(draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md"))
    read, write, review = (
        _Ctx(node_tools.sign_examples_token(run_id, None, p)) for p in ("read", "write", "review")
    )
    assert json.loads(tools["examples_brief"](ctx=read))["tests_asked"] == 2
    with pytest.raises(examples_mcp.ExamplesToolError) as caught:
        tools["examples_add"](ctx=read, **fields)
    assert caught.value.message == examples_mcp.CANT_WRITE
    with pytest.raises(examples_mcp.ExamplesToolError):
        tools["examples_add"](ctx=review, **fields)
    assert json.loads(tools["examples_add"](ctx=write, **fields))["id"] == 1
    with pytest.raises(examples_mcp.ExamplesToolError) as caught:
        tools["examples_review"](ctx=write, id=1, verdict="ok", note="Fine.")
    assert caught.value.message == examples_mcp.CANT_REVIEW
    with pytest.raises(examples_mcp.ExamplesToolError):
        tools["examples_review"](ctx=read, id=1, verdict="ok", note="Fine.")
    assert (
        json.loads(tools["examples_review"](ctx=review, id=1, verdict="ok", note="Fine."))["review"]
        == "ok"
    )
    with pytest.raises(examples_mcp.ExamplesToolError):
        tools["examples_remove"](ctx=review, id=1)
    # A refusal is a tool error with the plain sentence.
    with pytest.raises(examples_mcp.ExamplesToolError) as caught:
        tools["examples_add"](
            ctx=write, **{**fields, "input": "other", "quote": "not in the file at all here"}
        )
    assert caught.value.message.startswith("That quote isn't in motor-rules.md.")
    with pytest.raises(examples_mcp.ExamplesToolError) as caught:
        tools["examples_brief"](ctx=_Ctx(None))
    assert caught.value.message == examples_mcp.NO_TOKEN


def test_a_token_reaches_only_its_own_runs_batch(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    run_a, batch_a = _live_batch(c, owner, mid, did)
    run_b, batch_b = _live_batch(c, owner, mid, did)
    tools = _tools()
    fields = _tool_fields(draft("test", "Truck hit my parked car.", "Motor", "motor-rules.md"))
    tools["examples_add"](ctx=_Ctx(node_tools.sign_examples_token(run_a, None, "write")), **fields)
    assert len(model_examples.agent_list(batch_a)["drafts"]) == 1
    assert model_examples.agent_list(batch_b)["drafts"] == []


def test_the_examples_server_is_given_only_on_a_drafting_run(client):
    c, owner = account("deepseek")
    mid = choice_model(c)
    did = domain(owner)
    run_id, _ = _live_batch(c, owner, mid, did)
    config = {"tvashtr": {"examples": "write", "domains": [did]}}
    built = node_tools.build_mcp_config(config, str(run_id), node_id=str(uuid.uuid4()))[
        "mcpServers"
    ]
    assert set(built) == {"tvashtr-domains", "tvashtr-examples"}
    assert built["tvashtr-examples"]["url"].endswith("/mcp/examples")
    token = built["tvashtr-examples"]["headers"]["Authorization"].removeprefix("Bearer ")
    assert node_tools.read_examples_token(token)["permission"] == "write"
    other = node_tools.build_mcp_config(config, str(uuid.uuid4()), node_id=str(uuid.uuid4()))[
        "mcpServers"
    ]
    assert "tvashtr-examples" not in other


def test_the_http_endpoint_refuses_without_a_token(client):
    resp = client.post(
        "/mcp/examples",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "examples_brief", "arguments": {}},
        },
        headers={"accept": "application/json, text/event-stream"},
    )
    assert resp.status_code < 500
    assert SECRET not in resp.text


def test_every_examples_tool_builds_as_an_agent_action():
    """An agent's SDK turns each MCP tool's input schema into a pydantic Action model; a parameter
    named like a field the Action base already has (``kind``) breaks every call. Live, attempt 1:
    "Field 'kind' of class 'MCPTvashtrExamplesExamplesListAction' overrides symbol of same name"."""
    import asyncio

    from openhands.sdk.tool.schema import Action

    mcp = examples_mcp.create_examples_fastmcp()
    tools = asyncio.run(mcp.list_tools())
    assert {t.name for t in tools} == {
        "examples_brief",
        "examples_list",
        "examples_add",
        "examples_update",
        "examples_remove",
        "examples_review",
    }
    for tool in tools:
        Action.from_mcp_schema(f"MCPTvashtrExamples{tool.name}Action", tool.inputSchema)

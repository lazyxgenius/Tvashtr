"""Per-node capability drawer fields (parallel batch, Session A) — three ADDITIVE node settings.

All three live in the EXISTING ``AgentNode.config`` JSONB (**no migration** — alembic head stays
``0030``), so each rides ``clone_team_graph``'s ``deepcopy`` onto the run snapshot for free:

* ``config["fallback_model"]`` — a slug the model call fails over to ONCE on a PRIMARY-provider
  HARD failure (provider/auth/connection), explicitly **NOT** a 429 (the Milestone-B retry envelope
  in ``agent_llm_routing`` already owns those, inside the agent loop).
* ``config["output_schema"]`` — an ADVISORY JSON-Schema check on a completion node's output. A
  mismatch records a ``RunWarning`` and the run CONTINUES (v1 never fails a run on a schema miss).
* ``config["multimodal"]`` — a bool threaded to the reachable host-side model call.

These are mutation-real: the PATCH tests re-read the persisted ``AgentNode.config`` row, and the
gateway tests drive the REAL ``complete()`` with only the litellm boundary monkeypatched.
"""

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import auth_user_id, maybe_write_entry_report
from sqlalchemy import select

from tvashtr.control_plane.teams import create_team_from_template
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionRequest, complete
from tvashtr.gateway import gateway as gw
from tvashtr.gateway.types import GatewayError
from tvashtr.models import AgentNode

# ---- Shared helpers (the ``memory_remember_enabled`` template) -----------------------------------


def _graph_nodes(client, tid: str) -> dict[str, dict]:
    return {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}


def _row(node_id: str) -> AgentNode:
    with session_scope() as session:
        return session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()


def _seed_config(node_id: str, cfg: dict) -> None:
    """Directly seed a node's config JSONB (a fresh dict so the JSONB column is flagged dirty)."""
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()
        node.config = dict(cfg)


def _canned_response(content: str, model: str) -> SimpleNamespace:
    """A stand-in for LiteLLM's ModelResponse (only the bits the gateway reads)."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=11, completion_tokens=7, total_tokens=18),
        model=model,
    )


def _no_global_fallbacks(monkeypatch) -> None:
    """Pin the gateway's STATIC config so a test sees ONLY the per-node fallback (the global
    ``model_fallbacks`` list is a separate, pre-existing feature these tests must not depend on)."""
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(model_fallbacks=[], default_max_tokens_per_call=None),
    )
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)


class _RateLimited(Exception):
    """A stand-in for a provider 429 — the shape litellm surfaces (``status_code`` 429)."""

    status_code = 429


# ---- The node PATCH round-trip: set + clear, and the BYTE-IDENTICAL guard ------------------------


def test_patch_fallback_model_merges_and_preserves_existing_config(client):
    """PATCH ``fallback_model`` MERGES the key into the EXISTING config JSONB — a pre-existing
    sub-key is preserved. Re-reads the row, so it proves persisted state, not the response echo."""
    tid = create_team_from_template("plan_review", "Fallback merge", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    _seed_config(eng["id"], {"model_config": {"worker_context_token_budget": 55_000}})

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "fallback_model": "openai/gpt-4o-mini",
        },
    )
    assert resp.status_code == 200, resp.text
    assert _row(eng["id"]).config == {
        "model_config": {"worker_context_token_budget": 55_000},
        "fallback_model": "openai/gpt-4o-mini",
    }


def test_patch_output_schema_and_multimodal_merge_on_a_thinker(client):
    """Both Feature-2 fields merge into the SAME config JSONB on a completion (thinker) node."""
    tid = create_team_from_template("plan_review", "Schema merge", auth_user_id())
    pm = _graph_nodes(client, tid)["pm"]
    assert pm["kind"] == "completion"
    schema = {"type": "object", "required": ["title"], "properties": {"title": {"type": "string"}}}

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{pm['id']}",
        json={
            "prompt": pm["prompt"],
            "model": pm["model"],
            "output_schema": schema,
            "multimodal": True,
        },
    )
    assert resp.status_code == 200, resp.text
    cfg = _row(pm["id"]).config
    assert cfg["output_schema"] == schema
    assert cfg["multimodal"] is True


def test_patch_omitting_all_three_leaves_config_byte_unchanged(client):
    """THE BYTE-IDENTICAL GUARD: a ``{prompt, model}`` save WITHOUT any of the three fields leaves
    ``node.config`` byte-unchanged (``model_fields_set`` clear-semantics: omitted ⇒ untouched). A
    node that never opts in is indistinguishable from one on pre-change main."""
    tid = create_team_from_template("plan_review", "Byte identical", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    seeded = {"model_config": {"worker_context_token_budget": 42_000}}
    _seed_config(eng["id"], seeded)

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"]},
    )
    assert resp.status_code == 200, resp.text
    # No fallback_model / output_schema / multimodal key was added.
    assert _row(eng["id"]).config == seeded


def test_patch_clears_each_field_when_sent_null(client):
    """Sending a field EXPLICITLY as null CLEARS it (the C7.A clear-semantics the docs fields use):
    present-and-null ⇒ stored None, distinct from omitted ⇒ untouched."""
    tid = create_team_from_template("plan_review", "Clear fields", auth_user_id())
    eng = _graph_nodes(client, tid)["engineer"]
    _seed_config(
        eng["id"],
        {"fallback_model": "openai/gpt-4o-mini", "output_schema": {"type": "object"}},
    )

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "fallback_model": None,
            "output_schema": None,
        },
    )
    assert resp.status_code == 200, resp.text
    cfg = _row(eng["id"]).config
    assert cfg["fallback_model"] is None
    assert cfg["output_schema"] is None


def test_patch_rejects_a_non_object_output_schema_with_422(client):
    """BE validation: a non-object ``output_schema`` is refused with 422 (never persisted)."""
    tid = create_team_from_template("plan_review", "Schema 422", auth_user_id())
    pm = _graph_nodes(client, tid)["pm"]
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{pm['id']}",
        json={"prompt": pm["prompt"], "model": pm["model"], "output_schema": "not-an-object"},
    )
    assert resp.status_code == 422, resp.text


def test_gate_output_schema_still_stores_under_the_schema_key(client):
    """REGRESSION: the M-rails C9 GATE branch is untouched — a gate's ``output_schema`` still stores
    under the config key ``schema`` (what ``output_schema_check`` reads), NOT ``output_schema``."""
    tid = create_team_from_template("plan_review", "Gate schema", auth_user_id())
    created = client.post(
        f"/api/teams/{tid}/nodes",
        json={"node_kind": "gate", "position": {"x": 10, "y": 10}},
    )
    assert created.status_code == 200, created.text
    gate_id = created.json()["id"]
    schema = {"type": "object", "required": ["ok"]}

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{gate_id}",
        json={
            "gate_kind": "output_schema_check",
            "title": "t",
            "description": "d",
            "output_file": "out.json",
            "output_schema": schema,
        },
    )
    assert resp.status_code == 200, resp.text
    cfg = _row(gate_id).config
    assert cfg["schema"] == schema
    assert "output_schema" not in cfg


# ---- The pure config resolvers (inert when absent) -----------------------------------------------


def test_resolvers_are_inert_when_the_keys_are_absent():
    """A node with NONE of the three set resolves to the no-op values — the executor behaves exactly
    as on pre-change main."""
    from tvashtr.control_plane.context_compiler import (
        resolve_fallback_model,
        resolve_multimodal,
        resolve_output_schema,
    )

    for cfg in (None, {}, {"model_config": {"model": "x"}}):
        assert resolve_fallback_model(cfg) is None
        assert resolve_output_schema(cfg) is None
        assert resolve_multimodal(cfg) is False


def test_resolvers_read_their_keys_and_reject_wrong_types():
    """Set values are honored; a wrong-typed value is treated as absent (never crashes a run)."""
    from tvashtr.control_plane.context_compiler import (
        resolve_fallback_model,
        resolve_multimodal,
        resolve_output_schema,
    )

    assert resolve_fallback_model({"fallback_model": "openai/gpt-4o-mini"}) == "openai/gpt-4o-mini"
    assert resolve_fallback_model({"fallback_model": "  "}) is None  # blank ⇒ no fallback
    assert resolve_fallback_model({"fallback_model": 7}) is None  # wrong type ⇒ inert
    assert resolve_output_schema({"output_schema": {"type": "object"}}) == {"type": "object"}
    assert resolve_output_schema({"output_schema": "nope"}) is None
    assert resolve_multimodal({"multimodal": True}) is True
    assert resolve_multimodal({"multimodal": "yes"}) is False  # only a real bool opts in


# ---- Feature 1: the gateway's per-node fallback swap ---------------------------------------------


def test_fallback_model_serves_the_request_after_a_hard_primary_failure(monkeypatch):
    """THE REPRODUCE-FIRST CASE: the PRIMARY hard-fails (a provider/connection error) and the
    per-node ``fallback_model`` serves the request — ONCE, and the result names the model that
    actually served it."""
    _no_global_fallbacks(monkeypatch)
    calls: list[str] = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        if model == "primary/down":
            raise RuntimeError("connection refused by the provider")
        return _canned_response("served by the node fallback", model)

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)

    result = complete(
        CompletionRequest(
            model="primary/down",
            messages=[{"role": "user", "content": "hi"}],
            fallback_model="backup/up",
        )
    )
    assert calls == ["primary/down", "backup/up"]
    assert result.text == "served by the node fallback"
    assert result.model_requested == "primary/down"
    assert result.model_used == "backup/up"


def test_no_fallback_set_still_raises_on_the_same_hard_failure(monkeypatch):
    """The other half of the reproduce-first pair: with NO ``fallback_model`` the SAME hard failure
    still raises exactly as today — the feature is opt-in and inert when unset."""
    _no_global_fallbacks(monkeypatch)
    calls: list[str] = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        raise RuntimeError("connection refused by the provider")

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)

    with pytest.raises(GatewayError):
        complete(
            CompletionRequest(model="primary/down", messages=[{"role": "user", "content": "hi"}])
        )
    assert calls == ["primary/down"]  # tried once, no swap


def test_a_429_on_the_primary_does_NOT_use_the_node_fallback(monkeypatch):
    """A 429 is explicitly NOT a hard failure: the Milestone-B retry envelope owns rate limits, so
    the per-node fallback must NOT burn on one."""
    _no_global_fallbacks(monkeypatch)
    calls: list[str] = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        raise _RateLimited("429 Too Many Requests")

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)

    with pytest.raises(GatewayError):
        complete(
            CompletionRequest(
                model="primary/down",
                messages=[{"role": "user", "content": "hi"}],
                fallback_model="backup/up",
            )
        )
    assert calls == ["primary/down"]  # the fallback was NOT tried


def test_the_fallback_call_uses_its_own_provider_key(monkeypatch):
    """The fallback may be a DIFFERENT provider, so the swap must carry the key the executor
    resolved for the FALLBACK's provider — not the primary's."""
    _no_global_fallbacks(monkeypatch)
    seen: list[tuple[str, str | None]] = []

    def fake_completion(*, model, messages, **kwargs):
        seen.append((model, kwargs.get("api_key")))
        if model == "primary/down":
            raise RuntimeError("invalid api key for the primary provider")
        return _canned_response("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)

    complete(
        CompletionRequest(
            model="primary/down",
            messages=[{"role": "user", "content": "hi"}],
            api_key="primary-key",
            fallback_model="backup/up",
            fallback_api_key="backup-key",
        )
    )
    assert seen == [("primary/down", "primary-key"), ("backup/up", "backup-key")]


def test_unset_fallback_leaves_the_global_fallback_ordering_byte_identical(monkeypatch):
    """The pre-existing STATIC ``model_fallbacks`` behaviour is untouched when no per-node fallback
    is set — the ordering and the every-error-falls-over semantics are exactly as before."""
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(model_fallbacks=["second/up"], default_max_tokens_per_call=None),
    )
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    calls: list[str] = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        if model == "primary/down":
            raise _RateLimited("429")  # even a 429 still uses the GLOBAL list, as today
        return _canned_response("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)
    result = complete(
        CompletionRequest(model="primary/down", messages=[{"role": "user", "content": "hi"}])
    )
    assert calls == ["primary/down", "second/up"]
    assert result.model_used == "second/up"


def test_the_node_fallback_is_tried_before_the_global_list(monkeypatch):
    """The AUTHORED per-node fallback is more specific than the deployment-wide static list, so it
    is tried FIRST after a hard primary failure."""
    monkeypatch.setattr(
        gw,
        "get_settings",
        lambda: SimpleNamespace(model_fallbacks=["global/last"], default_max_tokens_per_call=None),
    )
    monkeypatch.setattr(gw.litellm, "completion_cost", lambda **kw: 0.0)
    calls: list[str] = []

    def fake_completion(*, model, messages, **kwargs):
        calls.append(model)
        if model in ("primary/down", "node/also-down"):
            raise RuntimeError("provider error")
        return _canned_response("ok", model)

    monkeypatch.setattr(gw.litellm, "completion", fake_completion)
    complete(
        CompletionRequest(
            model="primary/down",
            messages=[{"role": "user", "content": "hi"}],
            fallback_model="node/also-down",
        )
    )
    assert calls == ["primary/down", "node/also-down", "global/last"]


# ---- Feature 1 (executor arm): the host-side key-resolution swap ---------------------------------


def test_executor_swaps_to_the_fallback_when_the_primary_provider_key_is_missing(monkeypatch):
    """The REACHABLE host-side seam on the agent path: the host resolves the node's model → provider
    → owner key BEFORE handing the AgentTask to the adapter. A missing key for the PRIMARY's
    provider is a hard auth failure the host CAN see, so it swaps to ``fallback_model`` and resolves
    THAT provider's key."""
    from tvashtr.control_plane import team_run as tr
    from tvashtr.control_plane.credentials import NoCredentialError

    def fake_owner_key(run_id: str, model: str) -> str:
        if model == "primary/down":
            raise NoCredentialError(uuid.uuid4(), "primary")
        return f"key-for-{model}"

    monkeypatch.setattr(tr, "_owner_api_key", fake_owner_key)
    monkeypatch.setattr(tr, "record_resolution_warning", lambda *a, **k: None)

    model, key = tr._resolve_model_and_key(
        str(uuid.uuid4()), "primary/down", fallback_model="backup/up"
    )
    assert model == "backup/up"
    assert key == "key-for-backup/up"


def test_executor_still_raises_when_no_fallback_is_configured(monkeypatch):
    """With NO ``fallback_model`` the same missing-credential failure propagates as today."""
    from tvashtr.control_plane import team_run as tr
    from tvashtr.control_plane.credentials import NoCredentialError

    def fake_owner_key(run_id: str, model: str) -> str:
        raise NoCredentialError(uuid.uuid4(), "primary")

    monkeypatch.setattr(tr, "_owner_api_key", fake_owner_key)

    with pytest.raises(NoCredentialError):
        tr._resolve_model_and_key(str(uuid.uuid4()), "primary/down", fallback_model=None)


def test_executor_leaves_the_happy_path_untouched(monkeypatch):
    """A resolvable primary never consults the fallback — byte-identical to pre-change main."""
    from tvashtr.control_plane import team_run as tr

    seen: list[str] = []

    def fake_owner_key(run_id: str, model: str) -> str:
        seen.append(model)
        return "the-key"

    monkeypatch.setattr(tr, "_owner_api_key", fake_owner_key)
    model, key = tr._resolve_model_and_key(str(uuid.uuid4()), "primary/up", "backup/up")
    assert (model, key) == ("primary/up", "the-key")
    assert seen == ["primary/up"]  # the fallback was never resolved


# ---- Feature 2: the ADVISORY output-schema check (a RunWarning, never a run failure) -------------


def test_output_violating_its_schema_yields_an_advisory_reason():
    """A completion node's output that violates its ``output_schema`` produces a human reason naming
    the FIRST failing key path — reusing the M-rails C9 JSON-Schema-subset validator (no second
    validator is written)."""
    from tvashtr.control_plane.team_run import _output_schema_violation

    schema = {"type": "object", "required": ["title"], "properties": {"title": {"type": "string"}}}
    assert _output_schema_violation('{"title": "ok"}', schema) is None
    # A missing required key → a reason naming it.
    reason = _output_schema_violation('{"body": "x"}', schema)
    assert reason is not None and "title" in reason
    # A wrong type → a reason naming the path.
    reason = _output_schema_violation('{"title": 5}', schema)
    assert reason is not None and "title" in reason


def test_non_json_output_against_a_schema_is_advisory_not_fatal():
    """Output that is not JSON at all is a schema MISS (advisory), never an exception."""
    from tvashtr.control_plane.team_run import _output_schema_violation

    reason = _output_schema_violation("this is prose, not JSON", {"type": "object"})
    assert reason is not None and "JSON" in reason


def test_no_schema_configured_is_a_no_op():
    """No ``output_schema`` ⇒ no check, no reason — byte-identical to pre-change main."""
    from tvashtr.control_plane.team_run import _output_schema_violation

    assert _output_schema_violation("anything at all", None) is None
    assert _output_schema_violation(None, {"type": "object"}) is None


def test_the_advisory_check_reuses_the_guardrails_validator(monkeypatch):
    """PROOF OF REUSE: the advisory path delegates to ``guardrails``' shipped JSON-Schema-subset
    validator — it does NOT carry a second copy."""
    from tvashtr.control_plane import team_run as tr

    seen: list[tuple] = []

    def spy(value, schema, path):
        seen.append((value, schema, path))
        return "title"

    monkeypatch.setattr(tr, "_schema_violation", spy)
    reason = tr._output_schema_violation('{"a": 1}', {"type": "object"})
    assert seen and seen[0][0] == {"a": 1}
    assert reason is not None and "title" in reason


def test_a_schema_miss_records_a_run_warning_and_never_fails_the_run(client):
    """END TO END (advisory): recording a schema-miss writes a ``run_warnings`` row through the
    EXISTING resolution-warning recorder — the run is NOT failed."""
    from tvashtr.control_plane.resolution_warnings import record_resolution_warning
    from tvashtr.control_plane.teams import build_two_node_team
    from tvashtr.models import Run, RunWarning

    run_id = str(uuid.uuid4())
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="x",
                workflow_id=run_id,
                status="running",
            )
        )

    record_resolution_warning(run_id, "output_schema", "pm", "output fails schema at title")

    with session_scope() as session:
        rows = (
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )
    assert len(rows) == 1
    assert rows[0].source_kind == "output_schema"
    assert "title" in rows[0].reason


# ---- Feature 2: the multimodal flag reaches the reachable host-side model call ------------------


def test_multimodal_flag_rides_the_completion_request(monkeypatch):
    """The per-node ``multimodal`` bool is carried on the gateway's own request object and is
    OFF by default (so every existing caller is byte-identical)."""
    assert CompletionRequest(model="m/x", messages=[]).multimodal is False
    assert CompletionRequest(model="m/x", messages=[], multimodal=True).multimodal is True


def test_multimodal_on_a_text_only_model_is_reported_as_unsupported(monkeypatch):
    """The flag is BOUNDED BY THE MODEL: the gateway exposes whether the chosen model can actually
    accept non-text input, so a node that opts in on a text-only model can be told (advisory) rather
    than silently doing nothing."""
    monkeypatch.setattr(gw.litellm, "supports_vision", lambda model: model == "openai/gpt-4o-mini")
    assert gw.multimodal_supported("openai/gpt-4o-mini") is True
    assert gw.multimodal_supported("nvidia_nim/meta/llama-3.3-70b-instruct") is False


def test_multimodal_support_probe_never_raises(monkeypatch):
    """An unknown slug must not crash a run — the probe is best-effort and defaults to False."""

    def boom(model):
        raise RuntimeError("unknown model")

    monkeypatch.setattr(gw.litellm, "supports_vision", boom)
    assert gw.multimodal_supported("who/knows") is False


# ---- Feature 2 END-TO-END: a real run records the advisory RunWarning and still completes --------


class _SchemaReportAdapter:
    """Fake adapter: every report-only (thinker) node writes a REPORT.md whose body is the canned
    text. No LLM, no openhands — the executor's REAL ``run_team`` drives it."""

    name = "openhands"

    def __init__(self, report: str) -> None:
        self._report = report

    def run(self, task, on_event=None):
        from tvashtr.engines.base import AgentRunResult

        ws = Path(task.workspace_dir)
        if "REPORT-ONLY NODE" in task.instruction:
            ws.joinpath("REPORT.md").write_text(self._report, encoding="utf-8")
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        ws.joinpath("greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


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


def _warnings_for(run_id: str):
    from tvashtr.models import RunWarning

    with session_scope() as session:
        return list(
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )


def _drive_run(run_id: str, idea: str) -> dict:
    from dbos import DBOS, SetWorkflowID

    from tvashtr.control_plane import team_run

    with SetWorkflowID(run_id):
        return DBOS.start_workflow(team_run.run_team, idea).get_result()


def _prepare_run(monkeypatch, tmp_path, report: str):
    from tvashtr.control_plane import team_run
    from tvashtr.control_plane.shipping import init_workspace_repo

    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _SchemaReportAdapter(report))


def test_run_records_an_advisory_warning_when_a_completion_output_violates_its_schema(
    client, monkeypatch, tmp_path
):
    """THE REPRODUCE-FIRST CASE (Feature 2): a COMPLETION node whose ``config["output_schema"]`` its
    output VIOLATES records a ``RunWarning`` — and the run still COMPLETES. Drives the REAL
    ``run_team`` with a scripted adapter (no LLM, no openhands)."""
    from tvashtr.control_plane.teams import build_thinker_chain_team

    _prepare_run(monkeypatch, tmp_path, report='{"body": "no title here"}')
    team_graph_id = build_thinker_chain_team()
    _set_config_by_role(
        team_graph_id,
        "architect",
        {"output_schema": {"type": "object", "required": ["title"]}},
    )
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")

    assert _drive_run(run_id, "Add a greeting.")["status"] == "completed"  # ADVISORY, never fatal

    hits = [w for w in _warnings_for(run_id) if w.source_kind == "output_schema"]
    assert len(hits) == 1, [(w.source_kind, w.reason) for w in _warnings_for(run_id)]
    assert "title" in hits[0].reason


def test_run_records_no_warning_when_the_output_satisfies_its_schema(client, monkeypatch, tmp_path):
    """The discriminating other half: the SAME node + schema, with a CONFORMING output, records
    nothing."""
    from tvashtr.control_plane.teams import build_thinker_chain_team

    _prepare_run(monkeypatch, tmp_path, report='{"title": "A greeting feature"}')
    team_graph_id = build_thinker_chain_team()
    _set_config_by_role(
        team_graph_id,
        "architect",
        {"output_schema": {"type": "object", "required": ["title"]}},
    )
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")

    assert _drive_run(run_id, "Add a greeting.")["status"] == "completed"
    assert [w for w in _warnings_for(run_id) if w.source_kind == "output_schema"] == []


def test_run_with_no_output_schema_records_nothing_byte_identical(client, monkeypatch, tmp_path):
    """THE BYTE-IDENTICAL GUARD at run level: the SAME team + the SAME non-JSON output, but with NO
    ``output_schema`` authored anywhere, records NO output_schema warning at all."""
    from tvashtr.control_plane.teams import build_thinker_chain_team

    _prepare_run(monkeypatch, tmp_path, report="plain prose, definitely not JSON")
    team_graph_id = build_thinker_chain_team()
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")

    assert _drive_run(run_id, "Add a greeting.")["status"] == "completed"
    assert [w for w in _warnings_for(run_id) if w.source_kind == "output_schema"] == []


# ---- The design claim: config JSONB rides clone_team_graph's deepcopy FOR FREE ------------------


def test_capability_config_survives_the_clone_on_launch_snapshot(client):
    """THE WHOLE REASON these settings live in ``config`` (JSONB) rather than new columns: the
    clone-on-launch snapshot already deep-copies ``config``, so an authored capability reaches the
    RUN with NO change to ``clone_team_graph`` and NO migration. A new column would have needed
    both."""
    from tvashtr.control_plane.teams import clone_team_graph

    tid = create_team_from_template("plan_review", "Clone caps", auth_user_id())
    pm = _graph_nodes(client, tid)["pm"]
    authored = {
        "fallback_model": "openai/gpt-4o-mini",
        "output_schema": {"type": "object", "required": ["title"]},
        "multimodal": True,
    }
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{pm['id']}",
        json={"prompt": pm["prompt"], "model": pm["model"], **authored},
    )
    assert resp.status_code == 200, resp.text

    cloned_graph_id = clone_team_graph(tid)
    with session_scope() as session:
        cloned = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(cloned_graph_id),
                AgentNode.role_name == "pm",
            )
        ).scalar_one()
        cloned_config = dict(cloned.config or {})
    for key, value in authored.items():
        assert cloned_config[key] == value, key


def test_the_authored_fallback_model_reaches_the_executor_step(client, monkeypatch, tmp_path):
    """The last link in the chain: a node's authored ``config["fallback_model"]`` is resolved by the
    workflow body and threaded into ``agent_run_step``. A node WITHOUT one omits the kwarg entirely,
    so its call stays byte-identical."""
    from tvashtr.control_plane import team_run
    from tvashtr.control_plane.teams import build_thinker_chain_team

    calls: list[str] = []
    real_step = team_run.agent_run_step

    def spy(*args, **kwargs):
        """Record the ``fallback_model`` kwarg each node's step was called with (or its ABSENCE),
        then delegate to the real step."""
        calls.append(str(kwargs.get("fallback_model", "<<omitted>>")))
        return real_step(*args, **kwargs)

    _prepare_run(monkeypatch, tmp_path, report='{"title": "ok"}')
    monkeypatch.setattr(team_run, "agent_run_step", spy)

    team_graph_id = build_thinker_chain_team()
    _set_config_by_role(team_graph_id, "architect", {"fallback_model": "backup/model"})
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")
    assert _drive_run(run_id, "Add a greeting.")["status"] == "completed"

    assert "backup/model" in calls, calls  # the authored node threaded its fallback
    assert "<<omitted>>" in calls, calls  # every other node omitted the kwarg entirely


# ---- Tvashtr-79 item 7: the MID-RUN arm of the same fallback_model field ------------------------
#
# Slice A (above) gave ``fallback_model`` a REACHABLE host-side seam: ``_resolve_model_and_key``
# swaps BEFORE any agent runs, when the host can see the primary's credential is missing. It left
# open the case the field was really asked for — the primary provider hard-failing DURING the agent
# loop, where the litellm call is made in-container and the host never saw it. Item 7 closes it:
# the adapter classifies the failure (``provider_failure``, proven in ``test_proxy_adapter_wiring``)
# and ``agent_run_step`` re-runs the step ONCE on the node's fallback. Everything below drives the
# REAL ``run_team`` with a fake adapter at the ``resolve_adapter`` seam — no LLM, no container.

_FALLBACK_MODEL = "openai/gpt-4o-mini"  # a provider the conftest owner holds a dummy key for

_PROVIDER_HARD_FAILURE = (
    "litellm.AuthenticationError: OpenrouterException - No auth credentials found"
)


class _ProviderFailoverAdapter:
    """Fails the WORKER's first ``fail_times`` attempts the way a hard provider wall does — status
    ``failed`` plus ``provider_failure`` — then succeeds. Every worker ``AgentTask`` is recorded so
    a test can prove exactly WHICH model, key and session_key each attempt used. The entry
    (report-only) node is serviced normally and never counted."""

    name = "openhands"

    def __init__(self, tasks: list, *, fail_times: int, provider_failure: bool = True) -> None:
        self._tasks = tasks
        self._fail_times = fail_times
        self._provider_failure = provider_failure

    def run(self, task, on_event=None):
        from tvashtr.engines.base import AgentRunResult, EngineEvent

        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        self._tasks.append(task)
        attempt = len(self._tasks)
        # Stream like a real adapter: ``seq`` restarts at 0 on EVERY run and each collected event
        # also goes out through ``on_event``. That is exactly what makes the retry's rows collide
        # with the first attempt's unless the executor offsets the sink.
        events = [
            EngineEvent(
                seq=i, kind="message", payload={"text": f"attempt-{attempt}-{i}"}, ts=float(i)
            )
            for i in range(2)
        ]
        if on_event is not None:
            for event in events:
                on_event(event)
        if attempt <= self._fail_times:
            return AgentRunResult(
                status="failed",
                summary="provider hard-failed",
                events=events,
                files_changed=[],
                error=_PROVIDER_HARD_FAILURE,
                provider_failure=self._provider_failure,
            )
        Path(task.workspace_dir).joinpath("greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=events, files_changed=["greeting.txt"]
        )


def _prepare_failover_run(monkeypatch, tmp_path, tasks, **adapter_kwargs):
    from tvashtr.control_plane import team_run
    from tvashtr.control_plane.shipping import init_workspace_repo

    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(
        team_run,
        "resolve_adapter",
        lambda name: _ProviderFailoverAdapter(tasks, **adapter_kwargs),
    )


def _two_node_run(monkeypatch, tmp_path, tasks, *, fallback: str | None, **adapter_kwargs):
    """Build the two-node team (optionally authoring the Engineer's ``fallback_model``), seed an
    owned run, and drive the REAL workflow. Returns ``(run_id, result)``."""
    from tvashtr.control_plane.teams import build_two_node_team

    _prepare_failover_run(monkeypatch, tmp_path, tasks, **adapter_kwargs)
    team_graph_id = build_two_node_team()
    if fallback is not None:
        _set_config_by_role(team_graph_id, "engineer", {"fallback_model": fallback})
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")
    return run_id, _drive_run(run_id, "Add a greeting.")


def test_a_mid_run_provider_failure_fails_over_once_to_the_node_fallback(
    client, monkeypatch, tmp_path
):
    """THE REPRODUCE-FIRST EXECUTOR CASE: the worker's provider hard-fails mid-loop; the step
    re-runs ONCE on the node's ``fallback_model`` and the run COMPLETES. RED before item 7 — the
    first ``failed`` result went straight out the ``status != "completed"`` return and the run
    finalized ``failed``."""
    tasks: list = []
    run_id, result = _two_node_run(
        monkeypatch, tmp_path, tasks, fallback=_FALLBACK_MODEL, fail_times=1
    )
    assert result["status"] == "completed", result

    assert len(tasks) == 2, [t.model for t in tasks]
    primary, failover = tasks
    assert primary.model != _FALLBACK_MODEL
    assert failover.model == _FALLBACK_MODEL
    # The failover task is the primary task with the model + key swapped — nothing else moves.
    assert failover.instruction == primary.instruction
    assert failover.workspace_dir == primary.workspace_dir
    assert failover.pull_paths == primary.pull_paths
    assert failover.workspace_mode == primary.workspace_mode


def test_the_failover_takes_a_distinct_sandbox_key_scoped_to_the_same_run(
    client, monkeypatch, tmp_path
):
    """The failover needs a FRESH sandbox — a reuse cache HIT skips LLM/Agent construction entirely
    and continues the EXISTING Conversation, still bound to the PRIMARY model, so a failover
    carrying the primary's ``session_key`` would silently re-run on the very provider that just
    hard-failed.

    But it must get that freshness from a DISTINCT key under the SAME run, never from ``None``.
    ``None`` is the fly adapter's ``ephemeral`` trigger (``openhands_fly_adapter.py``: no session
    key ⇒ a synthetic ``uuid4().hex`` run id ⇒ a whole new ``tv-run-<synthetic>`` app), and that
    app has NO ``runs`` row to protect it — so ``fly_reaper.sweep_orphaned_fly_apps`` reads it as an
    orphan and deletes it on the next 10-minute tick, killing the failover mid-run. A distinct key
    under the real run id gets the MISS we want AND stays reaper-protected and torn down by
    ``close_run_sandboxes(run_id)``."""
    from tvashtr.engines import sandbox_cache

    tasks: list = []
    run_id, result = _two_node_run(
        monkeypatch, tmp_path, tasks, fallback=_FALLBACK_MODEL, fail_times=1
    )
    assert result["status"] == "completed", result
    primary, failover = tasks
    assert primary.session_key is not None, "the primary attempt must still thread the reuse key"
    # A MISS (so the fallback model is actually constructed) ...
    assert failover.session_key != primary.session_key
    # ... but NOT the fly-ephemeral / unprotected path.
    assert failover.session_key is not None
    assert sandbox_cache.run_id_from_session_key(failover.session_key) == run_id


def test_a_fallback_equal_to_the_model_that_just_ran_is_not_retried(client, monkeypatch, tmp_path):
    """Reachable WITHOUT a typo: the PRE-FLIGHT swap rebinds ``model`` to ``fallback_model`` when
    the primary's credential is missing, so by the time the agent runs the two can already be the
    same slug. Re-running the identical model + key after it hard-failed is a guaranteed-useless
    second full agent run, so the retry must require that the fallback actually differs."""
    from tvashtr.control_plane.teams import build_two_node_team

    tasks: list = []
    _prepare_failover_run(monkeypatch, tmp_path, tasks, fail_times=1)
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        engineer = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == "engineer",
            )
        ).scalar_one()
        # The post-pre-flight state: the node's fallback IS the model it is about to run.
        engineer.config = {**(engineer.config or {}), "fallback_model": engineer.model}
    run_id = str(uuid.uuid4())
    _seed_run_for(run_id, team_graph_id, "Add a greeting.")

    assert _drive_run(run_id, "Add a greeting.")["status"] == "failed"
    assert len(tasks) == 1, [t.model for t in tasks]
    assert [w for w in _warnings_for(run_id) if w.source_kind == "fallback_model"] == []


def test_the_failover_records_a_resolution_warning_naming_the_fallback(
    client, monkeypatch, tmp_path
):
    """The swap is visible in the run inspector rather than being a silent model substitution —
    mirroring the pre-flight swap's warning."""
    tasks: list = []
    run_id, result = _two_node_run(
        monkeypatch, tmp_path, tasks, fallback=_FALLBACK_MODEL, fail_times=1
    )
    assert result["status"] == "completed", result
    hits = [w for w in _warnings_for(run_id) if w.source_kind == "fallback_model"]
    assert len(hits) == 1, [(w.source_kind, w.name, w.reason) for w in _warnings_for(run_id)]
    assert hits[0].name == _FALLBACK_MODEL
    assert "mid-run" in hits[0].reason


def test_the_failover_happens_at_most_once(client, monkeypatch, tmp_path):
    """A fallback that ALSO hard-fails propagates as ``failed`` through the existing
    ``!= "completed"`` path — never a third attempt, never a ping-pong."""
    tasks: list = []
    _, result = _two_node_run(monkeypatch, tmp_path, tasks, fallback=_FALLBACK_MODEL, fail_times=2)
    assert result["status"] == "failed", result
    assert len(tasks) == 2, [t.model for t in tasks]


def test_a_node_with_no_fallback_model_is_never_retried(client, monkeypatch, tmp_path):
    """THE BYTE-IDENTICAL GUARD: with no ``fallback_model`` authored, the retry branch is never
    entered — a provider failure propagates as ``failed`` exactly as it does on main."""
    tasks: list = []
    run_id, result = _two_node_run(monkeypatch, tmp_path, tasks, fallback=None, fail_times=1)
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]
    assert [w for w in _warnings_for(run_id) if w.source_kind == "fallback_model"] == []


def test_a_plain_failure_is_not_failed_over_even_with_a_fallback_configured(
    client, monkeypatch, tmp_path
):
    """THE DISCRIMINATOR: ``provider_failure`` — not merely ``failed`` — gates the retry. A generic
    engine failure with a fallback authored must still finalize ``failed`` on the first attempt,
    which is what keeps a 429 (never flagged — see ``test_byok_retry_envelope``) from failing over.
    """
    tasks: list = []
    run_id, result = _two_node_run(
        monkeypatch,
        tmp_path,
        tasks,
        fallback=_FALLBACK_MODEL,
        fail_times=1,
        provider_failure=False,
    )
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]
    assert [w for w in _warnings_for(run_id) if w.source_kind == "fallback_model"] == []


def test_provider_failure_is_an_additive_default_false_field():
    """The contract invariant: ``AgentRunResult.status`` vocabulary is UNCHANGED and the new flag
    defaults False, so every existing producer + every ``result.status`` switch is byte-identical.
    """
    from typing import get_args, get_type_hints

    from tvashtr.engines.base import AgentRunResult

    result = AgentRunResult(status="completed", summary="s", events=[], files_changed=[])
    assert result.provider_failure is False
    assert set(get_args(get_type_hints(AgentRunResult)["status"])) == {
        "completed",
        "failed",
        "over_budget",
    }


def test_an_unresolvable_fallback_leaves_the_original_failure_intact(client, monkeypatch, tmp_path):
    """A ``fallback_model`` whose provider the owner holds NO key for must never be WORSE than
    having no fallback at all. The launch pre-flight (``_missing_provider_credentials``) validates
    node MODELS only — it never looks at ``config["fallback_model"]`` — so an unresolvable fallback
    is reachable by authoring alone. The failover resolution must therefore not raise out of the
    step (which would crash the run); the run finalizes ``failed`` exactly as it does with no
    fallback, and the skip is recorded."""
    tasks: list = []
    unresolvable = "anthropic/claude-sonnet-5"  # NOT among conftest's seeded test providers
    run_id, result = _two_node_run(
        monkeypatch, tmp_path, tasks, fallback=unresolvable, fail_times=1
    )
    assert result["status"] == "failed", result
    assert len(tasks) == 1, [t.model for t in tasks]  # no second attempt was made
    hits = [w for w in _warnings_for(run_id) if w.source_kind == "fallback_model"]
    assert len(hits) == 1, [(w.source_kind, w.name, w.reason) for w in _warnings_for(run_id)]
    assert "no credential" in hits[0].reason


def test_both_attempts_events_survive_in_run_events(client, monkeypatch, tmp_path):
    """The end-to-end proof for the sink's ``seq_offset``: the failover re-runs the adapter inside
    the SAME invocation, and every adapter run restarts ``seq`` at 0 — so un-offset, the retry's
    rows collide with the first attempt's on ``(run_id, invocation_id, seq)`` and the idempotency
    probe drops them, leaving a feed that splices attempt 1's head onto attempt 2's tail.

    Mutation teeth: drop the ``len(result.events)`` argument at the executor's failover sink and
    attempt 2's rows vanish entirely."""
    from tvashtr.models import RunEvent

    tasks: list = []
    run_id, result = _two_node_run(
        monkeypatch, tmp_path, tasks, fallback=_FALLBACK_MODEL, fail_times=1
    )
    assert result["status"] == "completed", result
    with session_scope() as session:
        rows = list(
            session.execute(
                select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)
            ).scalars()
        )
    texts = [r.payload.get("text", "") for r in rows]
    assert [t for t in texts if t.startswith("attempt-")] == [
        "attempt-1-0",
        "attempt-1-1",
        "attempt-2-0",
        "attempt-2-1",
    ], texts

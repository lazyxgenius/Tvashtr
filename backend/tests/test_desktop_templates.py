"""Revamp — Desktop setup's First team step (DT-34..36, OQ-27/29).

Covers the Spec only template (``spec_only``: PM → Reviewer → Stop, no Ship), the pure
``plan_first_models`` rule, ``GET /api/templates?for=desktop`` (Desktop-only templates + each strip
node's ``model``/``runs_on`` for THIS owner; the plain answer unchanged) and ``POST /api/teams
{use_plans}`` stamping what the strip showed. Every test registers its own account."""

import uuid

import pytest
from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import (
    _TEMPLATES_BY_KEY,
    _template_dict,
    build_spec_only_team,
    plan_first_models,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    EngineSubscriptionStatus,
    ProviderCredential,
    Run,
)

_CLAUDE = "anthropic/claude-sonnet-5"
_GROK = "xai/grok-4.7"


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"dt-templates-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "teams-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _connect(owner: uuid.UUID, *plans: str, connected: bool = True) -> None:
    with session_scope() as session:
        for plan in plans:
            session.add(
                EngineSubscriptionStatus(
                    owner_id=owner,
                    provider=plan,
                    connected=connected,
                    state="connected" if connected else "disconnected",
                )
            )


def _hold(owner: uuid.UUID, provider: str) -> None:
    with session_scope() as session:
        session.add(
            ProviderCredential(
                owner_id=owner, provider=provider, secret_encrypted="x", key_last4="0000"
            )
        )


def _desktop(c: TestClient) -> dict:
    resp = c.get("/api/templates", params={"for": "desktop"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_key(body: dict) -> dict:
    return {t["template"]: t for t in body["templates"]}


def _placements(template: dict) -> list[tuple[str, str | None, str | None]]:
    return [(n["role"], n["model"], n["runs_on"]) for n in template["shape"]["nodes"]]


def _models_by_role(team_id: str) -> dict[str, str | None]:
    with session_scope() as session:
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_id)))
            .scalars()
            .all()
        )
        return {n.role_name: n.model for n in nodes if n.model is not None}


# ---- plan_first_models (pure) ------------------------------------------------------------------


def test_both_plans_reviewer_uses_the_other_vendor():
    review_loop = [("pm", "thinker"), ("engineer", "worker"), ("reviewer", "worker")]
    assert plan_first_models(review_loop, {"claude", "grok"}) == {
        "pm": _GROK,
        "engineer": _CLAUDE,
        "reviewer": _GROK,
    }
    spec_only = [("pm", "thinker"), ("reviewer", "worker")]
    assert plan_first_models(spec_only, {"claude", "grok"}) == {"pm": _GROK, "reviewer": _CLAUDE}


def test_one_plan_runs_every_model_node_and_no_plan_changes_nothing():
    seats = [("pm", "thinker"), ("engineer", "worker"), ("reviewer", "worker")]
    assert set(plan_first_models(seats, {"claude"}).values()) == {_CLAUDE}
    assert set(plan_first_models(seats, {"grok"}).values()) == {_GROK}
    assert plan_first_models(seats, set()) == {}
    # Codex is not a runner subscription — it never counts as a plan here.
    assert plan_first_models(seats, {"codex"}) == {}


# ---- GET /api/templates?for=desktop ------------------------------------------------------------


def test_plain_templates_answer_is_unchanged(client):
    c, owner = _fresh()
    _connect(owner, "claude", "grok")
    body = c.get("/api/templates").json()
    assert [t["template"] for t in body["templates"]] == [
        "two_node",
        "review_loop",
        "plan_review",
        "full_squad",
    ]
    for template in [*body["templates"], body["blank"]]:
        for node in template["shape"]["nodes"]:
            assert set(node) == {"id", "kind", "role", "label"}


def _model_nodes(template: dict) -> list[dict]:
    return [n for n in template["shape"]["nodes"] if n["role"] not in ("gate", "ship", "stop")]


def test_desktop_templates_say_where_each_node_runs_and_keep_spec_only_hidden(client):
    c, owner = _fresh()
    _connect(owner, "claude", "grok")
    body = _desktop(c)
    by_key = _by_key(body)
    # Architect ruling 5 (revamp-finish): Spec only stays hidden until its runs can finish without
    # shipping — the Desktop list never offers it (POST /api/teams still builds it; see below).
    assert list(by_key) == ["two_node", "review_loop", "plan_review", "full_squad"]
    assert _placements(by_key["two_node"]) == [
        ("pm", _GROK, "grok"),
        ("gate", None, None),
        ("engineer", _CLAUDE, "claude"),
        ("ship", None, None),
    ]
    assert _placements(by_key["review_loop"]) == [
        ("pm", _GROK, "grok"),
        ("gate", None, None),
        ("engineer", _CLAUDE, "claude"),
        ("reviewer", _GROK, "grok"),
        ("ship", None, None),
    ]
    assert _placements(body["blank"]) == [("thinker", _GROK, "grok"), ("ship", None, None)]


def test_without_a_plan_nodes_run_on_a_held_key_or_need_setup(client):
    c, owner = _fresh()
    team = _by_key(_desktop(c))["two_node"]
    assert [n["runs_on"] for n in _model_nodes(team)] == [None, None]

    _hold(owner, "deepseek")
    team = _by_key(_desktop(c))["two_node"]
    assert [(n["model"], n["runs_on"]) for n in _model_nodes(team)] == [
        ("deepseek/deepseek-chat", "api_key"),
        ("deepseek/deepseek-chat", "api_key"),
    ]


def test_a_disconnected_plan_does_not_count(client):
    c, owner = _fresh()
    _connect(owner, "claude")
    _connect(owner, "grok", connected=False)
    team = _by_key(_desktop(c))["two_node"]
    assert [(n["role"], n["model"], n["runs_on"]) for n in _model_nodes(team)] == [
        ("pm", _CLAUDE, "claude"),
        ("engineer", _CLAUDE, "claude"),
    ]


def test_placements_are_owner_scoped(client):
    other, other_owner = _fresh()
    _connect(other_owner, "claude", "grok")
    mine, _owner = _fresh()
    team = _by_key(_desktop(mine))["two_node"]
    assert [n["runs_on"] for n in _model_nodes(team)] == [None, None]
    theirs = _by_key(_desktop(other))["two_node"]
    assert [n["runs_on"] for n in _model_nodes(theirs)] == ["grok", "claude"]


def test_templates_need_a_session(unauth_client):
    assert unauth_client.get("/api/templates", params={"for": "desktop"}).status_code == 401


# ---- POST /api/teams {use_plans} ---------------------------------------------------------------


@pytest.mark.parametrize("template", ["two_node", "review_loop", "blank"])
def test_use_plans_stamps_what_the_strip_showed(client, template):
    c, owner = _fresh()
    _connect(owner, "claude", "grok")
    body = _desktop(c)
    declared = body["blank"] if template == "blank" else _by_key(body)[template]
    resp = c.post(
        "/api/teams", json={"template": template, "name": "My first team", "use_plans": True}
    )
    assert resp.status_code == 200, resp.text
    team = resp.json()
    stamped = _models_by_role(team["team_graph_id"])
    assert stamped == {n["role"]: n["model"] for n in declared["shape"]["nodes"] if n["model"]}
    assert team["name"] == "My first team"


def test_without_use_plans_the_byok_defaults_stand(client):
    c, owner = _fresh()
    _connect(owner, "claude", "grok")
    team = c.post("/api/teams", json={"template": "review_loop", "name": "Squad"}).json()
    models = set(_models_by_role(team["team_graph_id"]).values())
    assert not models & {_CLAUDE, _GROK}


def test_use_plans_with_no_plan_keeps_the_byok_defaults(client):
    c, _owner = _fresh()
    plain = c.post("/api/teams", json={"template": "review_loop", "name": "A"}).json()
    planned = c.post(
        "/api/teams", json={"template": "review_loop", "name": "B", "use_plans": True}
    ).json()
    assert _models_by_role(planned["team_graph_id"]) == _models_by_role(plain["team_graph_id"])


def test_use_plans_ignores_another_accounts_plans(client):
    _other, other_owner = _fresh()
    _connect(other_owner, "claude", "grok")
    c, _owner = _fresh()
    team = c.post(
        "/api/teams", json={"template": "spec_only", "name": "Mine", "use_plans": True}
    ).json()
    assert not set(_models_by_role(team["team_graph_id"]).values()) & {_CLAUDE, _GROK}


def test_create_still_rejects_a_blank_name_with_use_plans(client):
    c, _owner = _fresh()
    resp = c.post("/api/teams", json={"template": "spec_only", "name": "  ", "use_plans": True})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "A team name is required."


# ---- the Spec only team ------------------------------------------------------------------------


def test_spec_only_team_is_valid_and_its_strip_matches_the_declared_one(client):
    c, owner = _fresh()
    # Not listed for Desktop (ruling 5), so its strip is declared by the template itself.
    t = _TEMPLATES_BY_KEY["spec_only"]
    declared = _template_dict(t.key, t.name, t.description, t.roles, t.loops)["shape"]
    _connect(owner, "claude", "grok")
    team = c.post(
        "/api/teams", json={"template": "spec_only", "name": "Specs", "use_plans": True}
    ).json()
    assert team["template_name"] == "Spec only"
    # Plans stamp the reviewer-uses-the-other-vendor rule, as the design labels it.
    assert _models_by_role(team["team_graph_id"]) == {"pm": _GROK, "reviewer": _CLAUDE}

    def strip(shape):
        return [(n["kind"], n["role"], n["label"]) for n in shape["nodes"]], shape["loops"]

    assert strip(team["shape"]) == strip(declared)
    with session_scope() as session:
        nodes, edges = graph_dicts(session, uuid.UUID(team["team_graph_id"]))
    verdict = validate_graph(nodes, edges)
    assert verdict["runnable"] is True, verdict["errors"]
    with session_scope() as session:
        by_role = {
            n.role_name: n
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team["team_graph_id"]))
            ).scalars()
        }
    assert set(by_role) == {"pm", "reviewer", "stop"}  # no Ship node → never a PR
    assert by_role["reviewer"].edits_allowed is False
    assert by_role["stop"].config == {"terminal_kind": "stop"}


def _spec_only_run(monkeypatch, tmp_path, verdict: str) -> tuple[dict, str, list]:
    """Run the REAL ``run_team`` over a spec-only team offline: the PM is the entry fake and the
    Reviewer returns ``verdict``."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))
    calls: list[tuple[str, int, str | None]] = []

    def _fake_setup(run_id):
        return str(workspace)

    def _fake_agent_run_step(
        run_id,
        node_prompt,
        model,
        iteration,
        idea,
        prd_text,
        workspace_dir,
        vkey,
        reviewer_feedback,
        emits_outcome,
        budget,
        invocation_id=None,
        edits_allowed=True,
        **kwargs,
    ):
        if emits_outcome:
            calls.append(("reviewer", iteration, prd_text))
            return {
                **entry_report_result(idea),
                "report": None,
                "outcome": verdict,
                "reasons": f"<{verdict}>",
            }
        calls.append(("pm", iteration, prd_text))
        return entry_report_result(idea)

    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_setup)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

    team_graph_id = build_spec_only_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="a refund button",
                workflow_id=run_id,
                status="running",
            )
        )
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "a refund button")
    return handle.get_result(), run_id, calls


def _outcomes(run_id: str) -> dict[str, list[str | None]]:
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        roles = {
            n.id: n.role_name
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id)
            ).scalars()
        }
        out: dict[str, list[str | None]] = {}
        for inv in session.execute(
            select(AgentInvocation)
            .where(AgentInvocation.run_id == run_id)
            .order_by(AgentInvocation.iteration)
        ).scalars():
            out.setdefault(roles[inv.node_id], []).append(inv.outcome)
        assert run.pr_url is None and run.ship_tag is None  # never a Ship, never a PR
        assert run.pm_document_id is not None  # the spec is kept
        return out


@pytest.mark.parametrize("verdict", ["approved", "changes_requested"])
def test_spec_only_run_reviews_the_spec_and_stops_without_a_pr(
    client, monkeypatch, tmp_path, verdict
):
    result, run_id, calls = _spec_only_run(monkeypatch, tmp_path, verdict)
    # The PM wrote the spec, then the Reviewer read THAT spec and gave its verdict; the walk ended
    # at the Stop terminal either way.
    assert [(role, n) for role, n, _ in calls] == [("pm", 1), ("reviewer", 1)]
    assert calls[1][2] == "PRD: a refund button"
    assert result["document_id"] is not None
    assert _outcomes(run_id) == {
        "pm": ["prd_written"],
        "reviewer": [verdict],
        "stop": ["stopped"],
    }


@pytest.mark.xfail(
    strict=True,
    reason=(
        "run_graph's Stop terminal always finalizes 'rejected'; an approved spec-only run needs a "
        "walk change (team_run.py) to end 'completed' — flagged to the lead, out of this slice"
    ),
)
def test_spec_only_approved_run_ends_completed(client, monkeypatch, tmp_path):
    result, _run_id, _calls = _spec_only_run(monkeypatch, tmp_path, "approved")
    assert result["status"] == "completed"

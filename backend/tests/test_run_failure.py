"""Revamp P9 + G-2 — a failed run carries a readable reason, and failed / cancelled runs keep their
cost.

* ``run_failure.humanise`` / ``node_label`` / ``describe_run_failure`` (pure);
* ``mark_run_failed_step`` stores ``failure_code`` / ``failure_message`` / ``failed_node_id`` and
  ``cost_total_usd``, and still returns ``None``;
* a real ``run_team`` whose Engineer fails records the structured reason on the run;
* ``cancel_run_core`` records ``cost_total_usd``.
"""

import uuid
from decimal import Decimal

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import run_failure, team_run, teams
from tvashtr.control_plane.desktop_jobs import OFFLINE_ERROR
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, CostRecord, Run

_NO_XAI = f"owner {uuid.uuid4()} has no credential for provider 'xai'"


def _make_run(team_graph_id: str, status: str = "running", **extra) -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="build greeting.txt",
                workflow_id=run_id,
                status=status,
                **extra,
            )
        )
    return run_id


def _add_cost(run_id: str, usd: str) -> None:
    with session_scope() as session:
        session.add(
            CostRecord(
                workflow_id=run_id,
                idempotency_key=f"test-cost:{uuid.uuid4().hex}",
                model_requested="openrouter/x",
                model_used="openrouter/x",
                prompt_tokens=1,
                completion_tokens=1,
                total_tokens=2,
                cost_usd=Decimal(usd),
            )
        )


def _node_id(team_graph_id: str, role: str) -> str:
    with session_scope() as session:
        return str(
            session.execute(
                select(AgentNode.id).where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                    AgentNode.role_name == role,
                )
            ).scalar_one()
        )


# ---------------------------------------------------------------- pure humaniser


def test_missing_credential_names_the_role_provider_and_target():
    web = run_failure.humanise("agent_error", _NO_XAI, role="Engineer", desktop_target=False)
    assert web == {
        "code": "missing_credential",
        "message": "Engineer has no xai key on the website",
        "provider": "xai",
    }
    desk = run_failure.humanise("agent_error", _NO_XAI, role="Engineer", desktop_target=True)
    assert desk["message"] == "Engineer has no xai key on this computer"


def test_desktop_offline_github_and_generic_reasons():
    assert run_failure.humanise("agent_error", OFFLINE_ERROR, role="PM")["code"] == (
        "desktop_offline"
    )
    gh = run_failure.humanise(
        "github_delivery", "github delivery failed: git push failed (exit 128)\nmore"
    )
    assert gh["code"] == "github_delivery"
    assert gh["message"] == "Couldn't open the pull request: git push failed (exit 128)"
    other = run_failure.humanise("agent_error", "boom went the sandbox\ntraceback…", role="PM")
    assert other == {
        "code": "agent_error",
        "message": "PM: boom went the sandbox",
        "provider": None,
    }
    assert run_failure.humanise(None, None)["message"] == "The run stopped with an error."
    assert run_failure.humanise("no_spec", "x", role="PM")["message"] == (
        "PM finished without writing a spec"
    )
    assert run_failure.humanise("invalid_graph", "walk ended with no terminal node")["message"] == (
        "The team's graph ended without reaching Ship or Stop"
    )
    ctx = run_failure.humanise(
        "over_context", "context 90 tok exceeds budget 50 — the 'spec' part is 80 tok", role="PM"
    )
    assert ctx["code"] == "over_context" and ctx["message"].startswith("PM ran out of context: ")


def test_provider_refusals_read_as_one_sentence():
    raw = (
        "Conversation run failed for id=7d95: litellm.APIError: APIError: "
        "OpenrouterException - 403 Forbidden"
    )
    out = run_failure.humanise("agent_error", raw, role="PM")
    assert out["code"] == "agent_error"
    assert out["message"] == (
        "PM's openrouter key was refused (403 Forbidden). Check it under Engines."
    )
    rate = run_failure.humanise(
        "agent_error",
        "x: litellm.RateLimitError: RateLimitError: XaiException - 429 Too Many Requests",
        role="Engineer",
    )
    assert rate["message"] == (
        "xai is rate-limiting Engineer (429 Too Many Requests). Try again in a few minutes."
    )
    down = run_failure.humanise(
        "agent_error",
        "x: litellm.InternalServerError: InternalServerError: OpenAIException - Connection error.",
        role="Reviewer",
    )
    assert down["message"] == "Reviewer couldn't reach openai. Try again in a few minutes."
    other = run_failure.humanise(
        "agent_error",
        "x: litellm.BadRequestError: BadRequestError: AnthropicException - model not found",
        role="PM",
    )
    assert other["message"] == "PM: anthropic returned an error (model not found)."
    # Engine text that isn't a provider refusal keeps the first line, as before.
    assert run_failure.humanise("agent_error", "boom\nmore", role="PM")["message"] == "PM: boom"


def test_node_label_uses_title_gate_kind_and_role_slug():
    assert run_failure.node_label("engineer", "agent", None) == "Engineer"
    assert run_failure.node_label("pm", "completion", {"title": "Product manager"}) == (
        "Product manager"
    )
    assert run_failure.node_label("prd_gate", "gate", {"gate_kind": "prd_approval"}) == "Approval"
    assert run_failure.node_label("my_custom_role", "agent", {}) == "My custom role"


def test_describe_run_failure_falls_back_for_old_rows():
    assert (
        run_failure.describe_run_failure(
            status="completed",
            failure_code=None,
            failure_message=None,
            failed_node_id=None,
            desktop_target=False,
        )
        is None
    )
    old = run_failure.describe_run_failure(
        status="failed",
        failure_code=None,
        failure_message=None,
        failed_node_id=None,
        desktop_target=False,
        fallback_reason=_NO_XAI,
        fallback_node_id="n1",
        node_info={"n1": {"label": "Engineer", "origin_node_id": "o1"}},
    )
    assert old == {
        "code": "missing_credential",
        "message": "Engineer has no xai key on the website",
        "node_id": "n1",
        "origin_node_id": "o1",
        "node_role": "Engineer",
        "provider": "xai",
        "target": "website",
    }
    bare = run_failure.describe_run_failure(
        status="failed",
        failure_code=None,
        failure_message=None,
        failed_node_id=None,
        desktop_target=True,
    )
    assert bare["message"] == "The run stopped with an error." and bare["target"] == "desktop"


# ---------------------------------------------------------------- the step


def test_mark_run_failed_step_stores_the_reason_and_cost(client):
    team = build_two_node_team()
    run_id = _make_run(team)
    _add_cost(run_id, "0.25")
    _add_cost(run_id, "0.50")
    engineer = _node_id(team, "engineer")

    out = team_run.mark_run_failed_step(
        run_id, code="agent_error", message=_NO_XAI, node_id=engineer
    )

    assert out is None  # the recorded output shape is unchanged
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.status == "failed"
        assert run.failure_code == "missing_credential"
        assert run.failure_message == "Engineer has no xai key on the website"
        assert str(run.failed_node_id) == engineer
        assert run.cost_total_usd == Decimal("0.75")


def test_mark_run_failed_step_still_accepts_the_old_positional_call(client):
    run_id = _make_run(build_two_node_team())
    team_run.mark_run_failed_step(run_id)
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.status == "failed"
        assert run.failure_code == "unknown"
        assert run.failure_message == "The run stopped with an error."
        assert run.cost_total_usd == Decimal("0")


def test_a_failing_engineer_records_a_structured_failure(client, monkeypatch, tmp_path):
    """Real ``run_team`` over the review loop (PM stubbed, gate auto-approved): the Engineer fails
    with a missing-credential reason and the run carries the readable sentence + the node."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

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
        if not edits_allowed and not emits_outcome:
            return entry_report_result(idea)
        return {
            "status": "failed",
            "outcome": None,
            "reasons": None,
            "error": _NO_XAI,
            "files_changed": [],
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_setup)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)

    team = build_review_loop_team()
    run_id = _make_run(team)
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    assert handle.get_result()["status"] == "failed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.failure_code == "missing_credential"
        assert run.failure_message == "Engineer has no xai key on the website"
        assert str(run.failed_node_id) == _node_id(team, "engineer")


# ---------------------------------------------------------------- cancel keeps its cost


def test_cancel_run_core_records_the_cost_so_far(client, monkeypatch):
    monkeypatch.setattr(teams.DBOS, "cancel_workflow", lambda _wid: None)
    run_id = _make_run(build_two_node_team(), status="awaiting_human")
    _add_cost(run_id, "1.21")

    teams.cancel_run_core(run_id)

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
        assert run.status == "cancelled"
        assert run.cost_total_usd == Decimal("1.21")

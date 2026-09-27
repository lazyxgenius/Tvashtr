"""Revamp Domains G12 (DM-98–104): the Query domain node's pass-to-spec / no-answer settings — the
node PATCH/POST keys, the deleted-domain validity check, the v2 run steps (spec section, stop on no
answer, wait while re-reading, cost on the run) and the node history's ``domain`` block."""

import uuid

import pytest
from conftest import auth_user_id, maybe_write_entry_report
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.control_plane import domain_ask as domain_ask_mod
from tvashtr.control_plane import domain_query_node as dq
from tvashtr.control_plane import team_run
from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.graph_validity import validate_graph
from tvashtr.control_plane.teams import build_two_node_team, clone_team_graph
from tvashtr.db import session_scope
from tvashtr.documents.service import get_latest_version
from tvashtr.engines.base import AgentRunResult
from tvashtr.main import app
from tvashtr.models import AgentInvocation, AgentNode, CostRecord, Domain, Edge, Run

SOURCES = [
    {
        "number": 1,
        "filename": "refund-policy.md",
        "piece_number": 3,
        "pieces_in_file": 42,
        "page": None,
        "excerpt": "Customers may request a full refund within 30 days.",
    },
    {
        "number": 2,
        "filename": "billing-faq.pdf",
        "piece_number": 17,
        "pieces_in_file": 86,
        "page": 4,
        "excerpt": "We refund the unused whole months.",
    },
]


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-node-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "domains-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _team(c: TestClient) -> str:
    resp = c.post("/api/teams", json={"template": "blank", "name": f"dq-{uuid.uuid4().hex[:8]}"})
    assert resp.status_code == 200, resp.text
    return resp.json()["team_graph_id"]


# ---- pure helpers -------------------------------------------------------------------------------


def test_spec_section_lists_the_answer_and_its_sources():
    md = dq.spec_section_md(
        "Support docs",
        "What do our support docs say about refunds?",
        {"covered": True, "answer_text": "Refunds within 30 days [1].", "sources": SOURCES},
    )
    assert md == (
        "## What the docs say\n\n"
        "**Asked Support docs:** What do our support docs say about refunds?\n\n"
        "Refunds within 30 days [1].\n\n"
        "Sources:\n"
        "1. refund-policy.md · piece 3 of 42\n"
        "2. billing-faq.pdf · page 4 · piece 17 of 86\n"
    )


def test_spec_section_when_the_files_do_not_cover_it():
    md = dq.spec_section_md("Support docs", "Is there a refund button?", {"covered": False})
    assert (
        md
        == "## What the docs say\n\nSupport docs had no answer for: “Is there a refund button?”\n"
    )


def test_v2_is_for_nodes_with_the_new_settings_only():
    assert dq.uses_v2({"domain_id": "x", "pass_to_spec": False}) is True
    assert dq.uses_v2({"domain_id": "x"}) is False
    assert dq.uses_v2(None) is False
    assert dq.node_title({"title": " Look up support docs "}) == "Look up support docs"
    assert dq.node_title({}) == "Query domain"
    assert dq.no_answer_message("Look up support docs", "Support docs", "Refunds?") == (
        "Look up support docs stopped the run: Support docs has no answer for “Refunds?”."
    )


# ---- node PATCH / POST --------------------------------------------------------------------------


def test_a_new_node_passes_the_answer_on_and_keeps_going():
    c, _ = _fresh()
    tid = _team(c)
    node = c.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}).json()
    assert node["config"]["pass_to_spec"] is True
    assert node["config"]["on_no_answer"] == "continue"


def test_patch_sets_pass_and_no_answer_and_keeps_the_rest():
    c, _ = _fresh()
    tid = _team(c)
    did = c.post("/api/domains", json={"name": "Support docs", "template": "support"}).json()[
        "domain_id"
    ]
    node = c.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}).json()
    resp = c.patch(
        f"/api/teams/{tid}/nodes/{node['id']}",
        json={
            "domain_id": did,
            "prompt": "What do our support docs say about {idea}?",
            "pass_to_spec": False,
            "on_no_answer": "stop",
            "title": "Look up support docs",
        },
    )
    assert resp.status_code == 200, resp.text
    cfg = resp.json()["config"]
    assert cfg["domain_id"] == did
    assert cfg["pass_to_spec"] is False
    assert cfg["on_no_answer"] == "stop"
    assert cfg["title"] == "Look up support docs"
    # A later partial PATCH leaves them alone.
    cfg = c.patch(f"/api/teams/{tid}/nodes/{node['id']}", json={"prompt": "{idea}"}).json()[
        "config"
    ]
    assert (cfg["pass_to_spec"], cfg["on_no_answer"]) == (False, "stop")


def test_patch_refuses_an_unknown_no_answer_policy_and_other_accounts():
    c, _ = _fresh()
    tid = _team(c)
    node = c.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}).json()
    bad = c.patch(f"/api/teams/{tid}/nodes/{node['id']}", json={"on_no_answer": "retry"})
    assert bad.status_code == 422
    other, _ = _fresh()
    resp = other.patch(f"/api/teams/{tid}/nodes/{node['id']}", json={"pass_to_spec": False})
    assert resp.status_code == 404


# ---- validity: a deleted domain needs a domain too (DM-102) -------------------------------------


def test_validate_flags_a_domain_that_is_not_the_owners():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": "gone"}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [
        {
            "id": "e0",
            "source_node_id": "pm",
            "target_node_id": "dq",
            "edge_type": "work",
            "conditions": None,
        },
        {
            "id": "e1",
            "source_node_id": "dq",
            "target_node_id": "ship",
            "edge_type": "work",
            "conditions": None,
        },
    ]
    flagged = {e["code"] for e in validate_graph(nodes, edges, {"kept"})["errors"]}
    assert "domain_query_no_domain" in flagged
    assert validate_graph(nodes, edges, {"gone"})["runnable"] is True
    assert validate_graph(nodes, edges)["runnable"] is True  # no ids known: today's check


def test_the_validate_route_knows_the_owners_domains():
    c, _ = _fresh()
    tid = _team(c)
    graph = c.get(f"/api/teams/{tid}/graph").json()
    root = next(n for n in graph["nodes"] if n["kind"] != "terminal")
    node = c.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}).json()
    c.patch(f"/api/teams/{tid}/nodes/{node['id']}", json={"domain_id": str(uuid.uuid4())})
    resp = c.post(
        f"/api/teams/{tid}/edges",
        json={"source_node_id": root["id"], "target_node_id": node["id"], "role": "forward"},
    )
    assert resp.status_code == 200, resp.text

    def flagged() -> bool:
        errors = c.get(f"/api/teams/{tid}/validate").json()["errors"]
        return any(
            e["code"] == "domain_query_no_domain" and e["node_id"] == node["id"] for e in errors
        )

    assert flagged()
    did = c.post("/api/domains", json={"name": "Support docs", "template": "support"}).json()[
        "domain_id"
    ]
    c.patch(f"/api/teams/{tid}/nodes/{node['id']}", json={"domain_id": did})
    assert not flagged()


# ---- the v2 walk --------------------------------------------------------------------------------


class _Adapter:
    """Entry writes REPORT.md; every other agent writes a file. Records instructions."""

    name = "openhands"

    def __init__(self) -> None:
        self.instructions: list[str] = []

    def run(self, task, on_event=None):
        self.instructions.append(task.instruction)
        if maybe_write_entry_report(task):
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        from pathlib import Path

        Path(task.workspace_dir).joinpath("greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _team_with_lookup(config: dict) -> tuple[str, uuid.UUID, uuid.UUID]:
    """``build_two_node_team`` with a Query domain node right after the PM, on a domain the test
    account owns. Returns (team_graph_id, node_id, domain_id)."""
    tid = build_two_node_team()
    with session_scope() as s:
        domain = Domain(owner_id=auth_user_id(), name="Support docs", template="support", config={})
        s.add(domain)
        s.flush()
        pm = s.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(tid), AgentNode.role_name == "pm"
            )
        ).scalar_one()
        node = AgentNode(
            team_graph_id=uuid.UUID(tid),
            role_name="domain_query",
            kind="domain_query",
            prompt="What do our support docs say about {idea}?",
            position={"x": 0, "y": 0},
            edits_allowed=False,
            config={"domain_id": str(domain.id), "title": "Look up support docs", **config},
        )
        s.add(node)
        s.flush()
        out = s.execute(select(Edge).where(Edge.source_node_id == pm.id)).scalar_one()
        s.add(
            Edge(
                team_graph_id=uuid.UUID(tid),
                source_node_id=node.id,
                target_node_id=out.target_node_id,
                edge_type="work",
            )
        )
        out.target_node_id = node.id
        return tid, node.id, domain.id


def _drive(monkeypatch, tmp_path, tid: str, adapter: _Adapter) -> tuple[str, dict]:
    from dbos import DBOS, SetWorkflowID

    from tvashtr.control_plane.shipping import init_workspace_repo

    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: adapter)
    run_id = str(uuid.uuid4())
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(tid),
                owner_id=auth_user_id(),
                idea="a self-serve refund button",
                workflow_id=run_id,
                status="running",
            )
        )
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "a self-serve refund button").get_result()
    return run_id, result


def _answer(covered: bool = True) -> dict:
    return {
        "answer": "NOT_FOUND: nothing" if not covered else "Refunds within 30 days [1].",
        "answer_text": "" if not covered else "Refunds within 30 days [1].",
        "covered": covered,
        "sources": SOURCES if covered else [],
        "citations": [],
        "latency_ms": 1900,
        "cost_usd": 0.001,
        "model": "openai/gpt-4o-mini",
        "usage": {
            "prompt_tokens": 900,
            "completion_tokens": 40,
            "total_tokens": 940,
            "cost_usd": 0.0012,
        },
    }


def _round(run_id: str, node_id: uuid.UUID) -> AgentInvocation:
    with session_scope() as s:
        return s.execute(
            select(AgentInvocation)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id == run_id, AgentNode.kind == "domain_query")
        ).scalar_one()


def test_a_covered_answer_goes_into_the_spec_the_next_agents_read(client, monkeypatch, tmp_path):
    tid, node_id, domain_id = _team_with_lookup({"pass_to_spec": True, "on_no_answer": "continue"})
    asked = []

    def ask(owner, did, question, **kw):
        asked.append((did, question, kw))
        return _answer()

    monkeypatch.setattr(domain_ask_mod, "ask_domain", ask)
    adapter = _Adapter()
    run_id, result = _drive(monkeypatch, tmp_path, tid, adapter)
    assert result["status"] == "completed", result
    assert asked == [
        (
            domain_id,
            "What do our support docs say about a self-serve refund button?",
            {"persist": False, "mark_not_found": True},
        )
    ]
    with session_scope() as s:
        spec_id = s.get(Run, uuid.UUID(run_id)).pm_document_id
    spec = get_latest_version(spec_id)
    assert "## What the docs say" in spec.content
    assert "2. billing-faq.pdf · page 4 · piece 17 of 86" in spec.content
    assert spec.note == "Added by Look up support docs"
    assert any("What the docs say" in i for i in adapter.instructions[1:])
    inv = _round(run_id, node_id)
    assert (inv.status, inv.outcome) == ("done", "answered")
    assert inv.context_manifest["spec_section"] == "What the docs say"
    assert inv.context_manifest["question"].endswith("a self-serve refund button?")
    assert inv.context_manifest["sources"][1]["filename"] == "billing-faq.pdf"
    with session_scope() as s:
        cost = s.execute(
            select(CostRecord).where(CostRecord.idempotency_key.like(f"{run_id}:domain-cost:%"))
        ).scalar_one()
        assert (cost.invocation_id, float(cost.cost_usd)) == (inv.id, 0.0012)


def test_no_answer_and_keep_going_says_so_in_the_spec(client, monkeypatch, tmp_path):
    tid, node_id, _ = _team_with_lookup({"pass_to_spec": True, "on_no_answer": "continue"})
    monkeypatch.setattr(domain_ask_mod, "ask_domain", lambda *a, **k: _answer(covered=False))
    run_id, result = _drive(monkeypatch, tmp_path, tid, _Adapter())
    assert result["status"] == "completed", result
    with session_scope() as s:
        spec_id = s.get(Run, uuid.UUID(run_id)).pm_document_id
    assert "Support docs had no answer for: “What do our support docs say about a self-serve" in (
        get_latest_version(spec_id).content
    )
    assert _round(run_id, node_id).outcome == "no_answer"


def test_no_answer_and_stop_fails_the_run_with_the_reason(client, monkeypatch, tmp_path):
    tid, node_id, _ = _team_with_lookup({"pass_to_spec": True, "on_no_answer": "stop"})
    monkeypatch.setattr(domain_ask_mod, "ask_domain", lambda *a, **k: _answer(covered=False))
    run_id, result = _drive(monkeypatch, tmp_path, tid, _Adapter())
    assert result["status"] == "failed"
    with session_scope() as s:
        run = s.get(Run, uuid.UUID(run_id))
        assert run.failure_code == "domain_no_answer"
        assert run.failure_message == (
            "Look up support docs stopped the run: Support docs has no answer for “What do our "
            "support docs say about a self-serve refund button?”."
        )
        assert str(run.failed_node_id) == str(node_id)
    inv = _round(run_id, node_id)
    assert (inv.status, inv.outcome) == ("failed", "no_answer")


def test_passing_off_leaves_the_spec_alone(client, monkeypatch, tmp_path):
    tid, node_id, _ = _team_with_lookup({"pass_to_spec": False, "on_no_answer": "continue"})
    monkeypatch.setattr(domain_ask_mod, "ask_domain", lambda *a, **k: _answer())
    run_id, result = _drive(monkeypatch, tmp_path, tid, _Adapter())
    assert result["status"] == "completed", result
    with session_scope() as s:
        spec_id = s.get(Run, uuid.UUID(run_id)).pm_document_id
    assert "What the docs say" not in get_latest_version(spec_id).content
    assert _round(run_id, node_id).context_manifest["spec_section"] is None


def test_it_waits_while_the_domain_re_reads(client, monkeypatch, tmp_path):
    tid, _, _ = _team_with_lookup({"pass_to_spec": True, "on_no_answer": "continue"})
    monkeypatch.setattr(team_run, "DOMAIN_REREAD_POLL_S", 0)
    calls = []

    def ask(*a, **k):
        calls.append(1)
        if len(calls) < 3:
            raise DomainAskError("paused", "Ask is paused while Support docs re-reads its files.")
        return _answer()

    monkeypatch.setattr(domain_ask_mod, "ask_domain", ask)
    _, result = _drive(monkeypatch, tmp_path, tid, _Adapter())
    assert result["status"] == "completed", result
    assert len(calls) == 3


def test_it_gives_up_after_ten_minutes_of_re_reading(client, monkeypatch, tmp_path):
    tid, _, _ = _team_with_lookup({"pass_to_spec": True, "on_no_answer": "continue"})
    monkeypatch.setattr(team_run, "DOMAIN_REREAD_POLL_S", 0)
    monkeypatch.setattr(team_run, "DOMAIN_REREAD_WAIT_S", 0)

    def ask(*a, **k):
        raise DomainAskError("paused", "Ask is paused while Support docs re-reads its files.")

    monkeypatch.setattr(domain_ask_mod, "ask_domain", ask)
    run_id, result = _drive(monkeypatch, tmp_path, tid, _Adapter())
    assert result["status"] == "failed"
    with session_scope() as s:
        assert (
            "Support docs was still re-reading its files."
            in s.get(Run, uuid.UUID(run_id)).failure_message
        )


def test_a_node_from_before_the_settings_keeps_todays_lookup(client, monkeypatch, tmp_path):
    tid, node_id, _ = _team_with_lookup({})
    seen = []

    def ask(owner, did, question, **kw):
        seen.append(kw)
        return _answer()

    monkeypatch.setattr(domain_ask_mod, "ask_domain", ask)
    run_id, result = _drive(monkeypatch, tmp_path, tid, _Adapter())
    assert result["status"] == "completed", result
    assert seen == [{}]  # the legacy step: persisted, no NOT_FOUND rule
    with session_scope() as s:
        spec_id = s.get(Run, uuid.UUID(run_id)).pm_document_id
    assert "What the docs say" not in get_latest_version(spec_id).content
    assert "spec_section" not in _round(run_id, node_id).context_manifest


# ---- node history: the Last run tab's data (DM-103) ---------------------------------------------


def test_node_runs_carry_the_lookup_and_the_run_number():
    c, owner = _fresh()
    tid = _team(c)
    node = c.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"}).json()
    for _ in range(2):
        clone_id = clone_team_graph(tid)
        with session_scope() as s:
            clone = s.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == uuid.UUID(clone_id),
                    AgentNode.cloned_from_node_id == uuid.UUID(node["id"]),
                )
            ).scalar_one()
            run_id = uuid.uuid4()
            run = Run(
                id=run_id,
                workflow_id=str(run_id),
                team_graph_id=uuid.UUID(clone_id),
                library_team_id=uuid.UUID(tid),
                owner_id=owner,
                idea="a self-serve refund button",
                status="completed",
            )
            s.add(run)
            s.flush()
            s.add(
                AgentInvocation(
                    run_id=str(run.id),
                    node_id=clone.id,
                    iteration=1,
                    status="done",
                    outcome="answered",
                    outcome_detail="Refunds within 30 days [1].",
                    context_manifest=dq.domain_query_manifest_v2(
                        {**_answer(), "cost_usd": 0.0012},
                        str(uuid.uuid4()),
                        "What do our support docs say about a self-serve refund button?",
                        dq.SPEC_SECTION,
                    ),
                )
            )
    body = c.get(f"/api/teams/{tid}/nodes/{node['id']}/runs").json()
    assert body["run"]["number"] == 2
    domain = body["run"]["rounds"][0]["domain"]
    assert domain == {
        "question": "What do our support docs say about a self-serve refund button?",
        "answer_text": "Refunds within 30 days [1].",
        "covered": True,
        "sources": SOURCES,
        "citations": [],
        "latency_ms": 1900,
        "cost_usd": 0.0012,
        "spec_section": "What the docs say",
    }
    other, _ = _fresh()
    assert other.get(f"/api/teams/{tid}/nodes/{node['id']}/runs").status_code == 404


@pytest.mark.parametrize("outcome,covered", [("answered", True), ("no_answer", False)])
def test_a_round_from_before_v2_reads_from_its_outcome(outcome, covered):
    from tvashtr.control_plane.node_history import _domain_round

    inv = AgentInvocation(
        run_id="r",
        node_id=uuid.uuid4(),
        iteration=1,
        status="done",
        outcome=outcome,
        outcome_detail="30 days",
        context_manifest={"citations": [{"filename": "a.md"}], "latency_ms": 5},
    )
    got = _domain_round(inv)
    assert got["covered"] is covered
    assert got["answer_text"] == "30 days"
    assert got["citations"] == [{"filename": "a.md"}]
    assert got["question"] is None

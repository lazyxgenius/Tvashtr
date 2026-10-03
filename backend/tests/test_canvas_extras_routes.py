"""M11 canvas extras — the authoring routes (``docs/superpowers/plans/api/canvas-extras.md``).

The failure path (``role: "failure"`` on POST / PATCH an edge), an agent's time limit (the node
PATCH), groups (``PUT /api/teams/{id}/layout``, never a version) and Approve with my edits
(``edited_spec`` on resolve: the spec saved as the next version by the person and the gate approved,
in one call)."""

import uuid

from home_fixtures import fresh_account, library_team
from sqlalchemy import select
from test_failure_path import _harness, _invocations, _new_run, _pending_task, _start, _team

from tvashtr.db import session_scope
from tvashtr.models import Document, DocumentVersion, HumanTask, Run, TeamGraph


def _graph(c, tid: str) -> dict:
    resp = c.get(f"/api/teams/{tid}/graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _setup(prefix: str):
    c, _ = fresh_account(prefix)
    tid = library_team(c)
    graph = _graph(c, tid)
    by_role = {n["role_name"]: n["id"] for n in graph["nodes"]}
    return c, tid, by_role, graph


def _edge(c, tid, source, target, role, **extra):
    return c.post(
        f"/api/teams/{tid}/edges",
        json={"source_node_id": source, "target_node_id": target, "role": role, **extra},
    )


# ----------------------------------------------------------------------------- failure path


def test_post_an_edge_with_role_failure(client):
    c, tid, by_role, _ = _setup("fp-post")
    resp = _edge(c, tid, by_role["engineer"], by_role["escalation_gate"], "failure")
    assert resp.status_code == 200, resp.text
    assert (resp.json()["edge_type"], resp.json()["conditions"]) == ("failure", None)

    second = _edge(c, tid, by_role["engineer"], by_role["stop"], "failure")
    assert second.status_code == 409
    assert second.json()["detail"] == "The Engineer already has a failure path"

    for role in ("prd_gate", "ship", "stop"):
        refused = _edge(c, tid, by_role[role], by_role["stop"], "failure")
        assert refused.status_code == 422, (role, refused.text)
    # The thinker is an agent: it may have one.
    assert _edge(c, tid, by_role["pm"], by_role["stop"], "failure").status_code == 200
    edges = _graph(c, tid)["edges"]
    assert sum(e["edge_type"] == "failure" for e in edges) == 2


def test_a_query_domain_step_has_no_failure_path(client):
    c, tid, by_role, _ = _setup("fp-dq")
    dq = c.post(f"/api/teams/{tid}/nodes", json={"node_kind": "domain_query"})
    assert dq.status_code == 200, dq.text
    refused = _edge(c, tid, dq.json()["id"], by_role["stop"], "failure")
    assert refused.status_code == 422


def test_patch_an_edge_changes_its_use(client):
    c, tid, by_role, graph = _setup("fp-patch")
    forward = next(
        e
        for e in graph["edges"]
        if e["source_node_id"] == by_role["engineer"] and e["edge_type"] != "escalation"
    )
    url = f"/api/teams/{tid}/edges/{forward['id']}"

    as_failure = c.patch(url, json={"role": "failure"})
    assert as_failure.status_code == 200, as_failure.text
    assert as_failure.json() == {**forward, "edge_type": "failure", "conditions": None}
    assert c.patch(url, json={"role": "failure"}).status_code == 200  # itself: not a second one

    branch = c.patch(url, json={"role": "branch", "label": "approved"})
    assert branch.json()["conditions"] == {"when": "approved"}
    assert branch.json()["edge_type"] == "work"
    assert c.patch(url, json={"role": "branch"}).status_code == 400  # a branch needs its label
    loop = c.patch(url, json={"role": "loop_back", "loop_limit": 5})
    assert loop.json()["conditions"] == {"loop_limit": 5}
    back = c.patch(url, json={"role": "forward"})
    assert (back.json()["edge_type"], back.json()["conditions"]) == ("work", None)

    # A second failure path out of the same agent: 409 — the existing one stays.
    first = _edge(c, tid, by_role["engineer"], by_role["stop"], "failure").json()
    assert c.patch(url, json={"role": "failure"}).status_code == 409
    edges = {e["id"]: e for e in _graph(c, tid)["edges"]}
    assert edges[first["id"]]["edge_type"] == "failure"
    assert edges[forward["id"]]["edge_type"] == "work"

    # Out of a gate: 422.
    gate_edge = next(e for e in graph["edges"] if e["source_node_id"] == by_role["prd_gate"])
    refused = c.patch(f"/api/teams/{tid}/edges/{gate_edge['id']}", json={"role": "failure"})
    assert refused.status_code == 422


def test_patch_an_edge_that_is_not_in_the_team(client):
    c, tid, _, _ = _setup("fp-missing")
    assert c.patch(f"/api/teams/{tid}/edges/not-an-id", json={"role": "forward"}).status_code == 400
    missing = c.patch(f"/api/teams/{tid}/edges/{uuid.uuid4()}", json={"role": "forward"})
    assert missing.status_code == 404


def test_a_failure_path_team_validates(client):
    c, tid, by_role, _ = _setup("fp-valid")
    assert (
        _edge(c, tid, by_role["engineer"], by_role["escalation_gate"], "failure").status_code == 200
    )
    verdict = c.get(f"/api/teams/{tid}/validate").json()
    assert verdict["runnable"], verdict["errors"]


# ------------------------------------------------------------------------------- time limit


def test_an_agents_time_limit(client):
    c, tid, by_role, _ = _setup("fp-time")
    url = f"/api/teams/{tid}/nodes/{by_role['engineer']}"
    for seconds in (300, 600, 1200, 1800, 3600):
        resp = c.patch(url, json={"time_limit_s": seconds})
        assert resp.status_code == 200, resp.text
        assert resp.json()["config"]["time_limit_s"] == seconds
    assert resp.json()["config"]["agent_kind"] == "engineer"  # the rest of its config kept
    assert c.patch(url, json={"time_limit_s": 900}).status_code == 422
    cleared = c.patch(url, json={"time_limit_s": None})
    assert "time_limit_s" not in cleared.json()["config"]


# ----------------------------------------------------------------------------------- groups


def test_groups_persist_and_are_validated(client):
    c, tid, by_role, graph = _setup("grp")
    assert graph["layout"] == {"groups": []}
    group = {
        "id": "g1",
        "label": "Build and review",
        "node_ids": [by_role["engineer"], by_role["reviewer"], str(uuid.uuid4())],
        "folded": True,
    }
    resp = c.put(f"/api/teams/{tid}/layout", json={"groups": [group]})
    assert resp.status_code == 200, resp.text
    stored = {**group, "node_ids": group["node_ids"][:2]}  # a node not in the team is dropped
    assert resp.json() == {"groups": [stored]}
    assert _graph(c, tid)["layout"] == {"groups": [stored]}

    unfolded = c.put(
        f"/api/teams/{tid}/layout",
        json={"groups": [{"id": "g1", "label": "Build", "node_ids": [by_role["engineer"]]}]},
    )
    assert unfolded.json()["groups"][0]["folded"] is False

    twice = [
        {"id": "a", "label": "A", "node_ids": [by_role["engineer"]]},
        {"id": "b", "label": "B", "node_ids": [by_role["engineer"]]},
    ]
    assert c.put(f"/api/teams/{tid}/layout", json={"groups": twice}).status_code == 422
    for label in ("", "   ", "x" * 61):
        bad = [{"id": "a", "label": label, "node_ids": []}]
        assert c.put(f"/api/teams/{tid}/layout", json={"groups": bad}).status_code == 422, label
    same_id = [{"id": "a", "label": "A", "node_ids": []}, {"id": "a", "label": "B", "node_ids": []}]
    assert c.put(f"/api/teams/{tid}/layout", json={"groups": same_id}).status_code == 422
    assert c.put(f"/api/teams/{tid}/layout", json={"groups": []}).json() == {"groups": []}


def test_groups_are_never_a_version(client):
    c, tid, by_role, _ = _setup("grp-ver")
    before = c.get(f"/api/teams/{tid}/versions").json()
    assert before["changes"] == 0
    group = {"id": "g", "label": "Planning", "node_ids": [by_role["pm"]], "folded": True}
    assert c.put(f"/api/teams/{tid}/layout", json={"groups": [group]}).status_code == 200
    after = c.get(f"/api/teams/{tid}/versions").json()
    assert (after["changes"], after["total"], after["current"]) == (
        0,
        before["total"],
        before["current"],
    )


def test_groups_are_not_carried_into_a_run_snapshot(client):
    """The walk never reads the layout: a run's snapshot of the team has none."""
    from tvashtr.control_plane.teams import clone_team_graph

    c, tid, by_role, _ = _setup("grp-run")
    group = {"id": "g", "label": "Planning", "node_ids": [by_role["pm"]], "folded": False}
    c.put(f"/api/teams/{tid}/layout", json={"groups": [group]})
    clone = clone_team_graph(tid)
    with session_scope() as session:
        assert session.get(TeamGraph, uuid.UUID(clone)).layout is None


# ------------------------------------------------------------------ approve with my edits


def _run_at_the_spec_gate(monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "0")  # Reviewer approves round 1
    run_id = _new_run(_team(failure_to=None))
    calls = _harness(monkeypatch, tmp_path, fail_round=99)
    handle = _start(run_id)
    return run_id, calls, handle, _pending_task(run_id, "prd_gate")


def test_approve_with_my_edits_saves_the_spec_and_approves(client, monkeypatch, tmp_path):
    run_id, calls, handle, task = _run_at_the_spec_gate(monkeypatch, tmp_path)
    resp = client.post(
        f"/api/runs/{run_id}/tasks/{task}/resolve",
        json={"decision": "approve", "edited_spec": "PRD: an RSI indicator, edited at the gate"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["resolution"] == "approved" and resp.json()["edited_version"] == 2
    assert handle.get_result()["status"] == "completed"

    engineer = next(c for c in calls if c["role"] == "engineer")
    assert engineer["spec"] == "PRD: an RSI indicator, edited at the gate"
    with session_scope() as session:
        doc = session.get(Run, uuid.UUID(run_id)).pm_document_id
        versions = session.execute(
            select(DocumentVersion.version_no, DocumentVersion.created_by)
            .where(DocumentVersion.document_id == doc)
            .order_by(DocumentVersion.version_no)
        ).all()
        row = session.get(HumanTask, task)
        assert (row.status, row.resolution, row.edited_version) == ("resolved", "approved", 2)
    assert [tuple(v) for v in versions] == [(1, "agent:entry"), (2, "human")]

    tasks = client.get(f"/api/runs/{run_id}/tasks").json()["tasks"]
    assert next(t for t in tasks if t["id"] == task)["edited_version"] == 2
    act = client.get(f"/api/runs/{run_id}/activity").json()
    gate_lines = [ln for ln in act["lines"] if ln["id"] == f"task:{task}:done"]
    assert [(ln["kind"], ln["text"]) for ln in gate_lines] == [
        ("gate_approved", "Approved with your edits · spec v2")
    ]
    assert gate_lines[0]["refs"]["edited_version"] == 2
    # The version the approval saved is told by the gate's line, not a second "You edited" line.
    assert not [ln for ln in act["lines"] if ln["text"] == "You edited the spec (v2)"]
    gate = next(a for a in act["agents"] if a["label"] == "Approval")
    assert gate["activity"] == "Approved with your edits · spec v2"


def test_an_approval_without_edits_is_unchanged(client, monkeypatch, tmp_path):
    run_id, _, handle, task = _run_at_the_spec_gate(monkeypatch, tmp_path)
    resp = client.post(f"/api/runs/{run_id}/tasks/{task}/resolve", json={"decision": "approve"})
    assert resp.status_code == 200 and resp.json()["edited_version"] is None
    assert handle.get_result()["status"] == "completed"
    act = client.get(f"/api/runs/{run_id}/activity").json()
    line = next(ln for ln in act["lines"] if ln["id"] == f"task:{task}:done")
    assert line["text"] == "You approved the spec" and "edited_version" not in line["refs"]


def test_edits_go_only_with_an_approval_of_a_gate_with_a_spec(client, monkeypatch, tmp_path):
    run_id, _, handle, task = _run_at_the_spec_gate(monkeypatch, tmp_path)
    url = f"/api/runs/{run_id}/tasks/{task}/resolve"
    refused = client.post(url, json={"decision": "reject", "edited_spec": "PRD: no"})
    assert refused.status_code == 422
    blank = client.post(url, json={"decision": "approve", "edited_spec": "   "})
    assert blank.status_code == 422
    with session_scope() as session:
        assert session.get(HumanTask, task).status == "pending"  # nothing was decided
        spec = session.get(Run, uuid.UUID(run_id)).pm_document_id
        session.execute(
            Run.__table__.update().where(Run.id == uuid.UUID(run_id)).values(pm_document_id=None)
        )
    no_spec = client.post(url, json={"decision": "approve", "edited_spec": "PRD: edited"})
    assert no_spec.status_code == 422
    with session_scope() as session:
        session.execute(
            Run.__table__.update().where(Run.id == uuid.UUID(run_id)).values(pm_document_id=spec)
        )
        assert session.execute(
            select(DocumentVersion.version_no).where(DocumentVersion.document_id == spec)
        ).scalars().all() == [1]
        assert session.get(Document, spec) is not None
    assert client.post(url, json={"decision": "approve"}).status_code == 200
    assert handle.get_result()["status"] == "completed"
    assert ("engineer", 1, "done", "built") in _invocations(run_id)


def test_another_account_cannot_approve_with_edits(client, monkeypatch, tmp_path):
    run_id, _, handle, task = _run_at_the_spec_gate(monkeypatch, tmp_path)
    other, _ = fresh_account("edit-other")
    resp = other.post(
        f"/api/runs/{run_id}/tasks/{task}/resolve",
        json={"decision": "approve", "edited_spec": "PRD: hijacked"},
    )
    assert resp.status_code == 404
    with session_scope() as session:
        doc = session.get(Run, uuid.UUID(run_id)).pm_document_id
        assert session.execute(
            select(DocumentVersion.version_no).where(DocumentVersion.document_id == doc)
        ).scalars().all() == [1]
    client.post(f"/api/runs/{run_id}/tasks/{task}/resolve", json={"decision": "reject"})
    assert handle.get_result()["status"] == "rejected"

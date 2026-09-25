"""Revamp B-DOCS — version notes + authors, ``documents.updated_at``, the enriched document reads,
and the live-edit conflicts on ``POST /api/documents/{id}/versions``.

The executor tests drive the REAL ``run_team`` on a CLONE of a team (as a launched run does) with a
scripted adapter — no LLM, no openhands — so authorship is checked clone → authored node.
"""

import uuid
from datetime import datetime
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select, update

from tvashtr.control_plane import team_run
from tvashtr.control_plane.document_views import derive_note
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import (
    build_review_loop_team,
    build_thinker_chain_team,
    build_two_node_team,
    clone_team_graph,
)
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    add_version,
    create_document_with_initial_version,
    find_or_create_run_document,
    list_documents_for_run,
)
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentInvocation, AgentNode, Document, DocumentVersion, Run

# ============================ helpers =====================================================


def _seed_run(team_graph_id: str, status: str = "running", idea: str = "Add a greeting.") -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status=status,
            )
        )
    return run_id


def _set_status(run_id: str, status: str) -> None:
    with session_scope() as session:
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(status=status))


def _nodes(team_graph_id: str) -> dict[str, AgentNode]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
        ).scalars()
        return {n.role_name: n for n in rows}


def _set_config(team_graph_id: str, role_name: str, updates: dict) -> None:
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == role_name,
            )
        ).scalar_one()
        node.config = {**(node.config or {}), **updates}


def _versions(document_id) -> list[DocumentVersion]:
    with session_scope() as session:
        return list(
            session.execute(
                select(DocumentVersion)
                .where(DocumentVersion.document_id == document_id)
                .order_by(DocumentVersion.version_no)
            ).scalars()
        )


def _updated_at(document_id):
    with session_scope() as session:
        return session.get(Document, document_id).updated_at


def _spec_on(run_id: str, content: str = "PRD v1") -> Document:
    """The entry's spec document, written the way the executor writes it (legacy row: no note)."""
    doc = create_document_with_initial_version(
        "Mini-PRD",
        "prd",
        content,
        "agent:entry",
        f"{run_id}:pm-prd-v1",
        run_id=uuid.UUID(run_id),
        name="spec",
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=doc.id)
        )
    return doc


class _ChainAdapter:
    """PM writes the PRD; the Architect (it read the PRD) writes the design; the Engineer builds."""

    name = "openhands"
    PRD = "PRD_SENTINEL_BDOCS"
    DESIGN = "DESIGN_SENTINEL_BDOCS"

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        if "REPORT-ONLY NODE" in task.instruction:
            body = self.DESIGN if self.PRD in task.instruction else self.PRD
            (ws / "REPORT.md").write_text(body, encoding="utf-8")
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _run_chain(monkeypatch, tmp_path) -> tuple[str, str, str]:
    """Run PM → Architect (writes "design") → Engineer (reads spec + design) on a clone of the
    team. Returns ``(run_id, library_team_id, clone_team_id)``."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _ChainAdapter())

    library = build_thinker_chain_team()
    _set_config(library, "architect", {"writes_to": "design"})
    _set_config(library, "engineer", {"reads_from": ["spec", "design"]})
    clone = clone_team_graph(library)
    run_id = _seed_run(clone)
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "Add a greeting.").get_result()
    assert result["status"] == "completed"
    return run_id, library, clone


# ============================ change notes (pure) =========================================


def test_derive_note_prefers_the_stored_note():
    assert derive_note("Tightened scope", "r:pm-prd-v1", "agent:entry") == "Tightened scope"


def test_derive_note_from_legacy_idempotency_keys():
    assert derive_note(None, "abc:pm-prd-v1", "agent:entry") == "First draft"
    assert derive_note(None, "abc:spec:node-1:3", "agent:entry") == "Revised in round 3"
    assert derive_note(None, "abc:doc:build-notes:node-1:2", "agent:x") == "Round 2"
    assert derive_note(None, "abc:doc:a:b:node-1:4", "agent:x") == "Round 4"  # ':' in a name
    assert derive_note(None, "human-edit:doc:ff", "human") == "Edited while the run was live"
    assert derive_note(None, "wf:v1", "agent:doc_writer") is None


# ============================ updated_at ==================================================


def test_updated_at_bumps_on_every_new_version(client):
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id)
    first = _updated_at(doc.id)

    add_version(doc.id, "v2", created_by="agent:entry", idempotency_key=f"{run_id}:spec:n:2")
    second = _updated_at(doc.id)
    assert second > first

    # A replay of the same key writes nothing, so it doesn't bump either.
    add_version(doc.id, "v2", created_by="agent:entry", idempotency_key=f"{run_id}:spec:n:2")
    assert _updated_at(doc.id) == second

    named = find_or_create_run_document(
        run_id=uuid.UUID(run_id),
        name="design",
        title="Document: design",
        doc_type="design",
        content="d1",
        created_by="agent:x",
        idempotency_key=f"{run_id}:doc:design:x:1",
    )
    created = _updated_at(named.id)
    find_or_create_run_document(
        run_id=uuid.UUID(run_id),
        name="design",
        title="Document: design",
        doc_type="design",
        content="d2",
        created_by="agent:x",
        idempotency_key=f"{run_id}:doc:design:x:2",
    )
    assert _updated_at(named.id) > created


def test_human_save_bumps_updated_at(client):
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id)
    before = _updated_at(doc.id)
    resp = client.post(f"/api/documents/{doc.id}/versions", json={"content": "edited"})
    assert resp.status_code == 200, resp.text
    after = client.get(f"/api/documents/{doc.id}").json()["updated_at"]
    assert datetime.fromisoformat(after) > before
    assert after == resp.json()["created_at"]


# ============================ writers store notes + authored node ==========================


def test_entry_spec_steps_store_notes_and_the_authored_node(client):
    library = build_two_node_team()
    clone = clone_team_graph(library)
    pm_clone, pm_origin = _nodes(clone)["pm"], _nodes(library)["pm"]
    assert pm_clone.cloned_from_node_id == pm_origin.id
    run_id = _seed_run(clone)

    doc_id = team_run.record_entry_spec_step(run_id, str(pm_clone.id), 1, "draft", None)
    team_run.record_entry_spec_step(run_id, str(pm_clone.id), 2, "refined", doc_id)

    v1, v2 = _versions(uuid.UUID(doc_id))
    assert (v1.note, v1.author_node_id) == ("First draft", pm_origin.id)
    assert (v2.note, v2.author_node_id) == ("Revised in round 2", pm_origin.id)


def test_named_document_step_stores_round_note_and_the_authored_node(client):
    library = build_thinker_chain_team()
    clone = clone_team_graph(library)
    arch_clone, arch_origin = _nodes(clone)["architect"], _nodes(library)["architect"]
    run_id = _seed_run(clone)

    team_run.write_named_document_step(run_id, str(arch_clone.id), 3, "design", "design")

    (doc,) = [d for d in list_documents_for_run(uuid.UUID(run_id)) if d.name == "design"]
    (v1,) = _versions(doc.id)
    assert (v1.note, v1.author_node_id) == ("Round 3", arch_origin.id)


# ============================ GET /api/documents/{id} =====================================


def test_document_read_has_run_flags_and_version_authors(client, monkeypatch, tmp_path):
    run_id, library, _clone = _run_chain(monkeypatch, tmp_path)
    origin = _nodes(library)
    docs = {d.name: d for d in list_documents_for_run(uuid.UUID(run_id))}

    spec = client.get(f"/api/documents/{docs['spec'].id}").json()
    assert spec["run_id"] == run_id
    assert spec["is_shared_spec"] is True
    assert spec["editable"] is False  # the run finished
    (v1,) = spec["versions"]
    assert v1["note"] == "First draft"
    assert v1["author"] == {
        "kind": "agent",
        "node_id": str(origin["pm"].id),
        "role_name": "pm",
        "label": "Product manager",
    }
    assert {"id", "version_no", "content", "created_by", "created_at"} <= set(v1)

    design = client.get(f"/api/documents/{docs['design'].id}").json()
    assert design["is_shared_spec"] is False
    assert design["versions"][0]["note"] == "Round 1"
    assert design["versions"][0]["author"]["node_id"] == str(origin["architect"].id)
    assert design["versions"][0]["author"]["label"] == "Architect"


def test_legacy_versions_derive_notes_and_authors(client):
    """Rows written before 0041 have no note / author_node_id: both are derived at read time."""
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id)
    pm = _nodes(_team_of(run_id))["pm"]
    add_version(doc.id, "v2", created_by="agent:entry", idempotency_key=f"{run_id}:spec:{pm.id}:2")
    add_version(doc.id, "v3", created_by="human", idempotency_key=f"human-edit:{doc.id}:x")

    body = client.get(f"/api/documents/{doc.id}").json()
    assert body["editable"] is True  # the run is live
    notes = [(v["version_no"], v["note"], v["author"]["label"]) for v in body["versions"]]
    assert notes == [
        (1, "First draft", "Product manager"),
        (2, "Revised in round 2", "Product manager"),
        (3, "Edited while the run was live", "You"),
    ]
    assert body["versions"][0]["author"]["node_id"] == str(pm.id)
    assert body["versions"][2]["author"] == {
        "kind": "human",
        "node_id": None,
        "role_name": None,
        "label": "You",
    }


def _team_of(run_id: str) -> str:
    with session_scope() as session:
        return str(session.get(Run, uuid.UUID(run_id)).team_graph_id)


def test_agent_label_prefers_the_nodes_title(client):
    library = build_two_node_team()
    _set_config(library, "pm", {"title": "Spec writer"})
    run_id = _seed_run(library)
    doc = _spec_on(run_id)
    body = client.get(f"/api/documents/{doc.id}").json()
    assert body["versions"][0]["author"]["label"] == "Spec writer"


# ============================ GET /api/runs/{id}/documents ================================


def test_run_documents_have_latest_version_writers_and_readers(client, monkeypatch, tmp_path):
    run_id, library, _clone = _run_chain(monkeypatch, tmp_path)
    origin = _nodes(library)

    body = client.get(f"/api/runs/{run_id}/documents").json()
    assert body["run_id"] == run_id
    run = body["run"]
    assert (run["run_id"], run["idea"], run["status"], run["live"]) == (
        run_id,
        "Add a greeting.",
        "completed",
        False,
    )
    docs = {d["name"]: d for d in body["documents"]}
    assert list(docs) == ["spec", "design"]  # oldest first

    spec = docs["spec"]
    assert spec["is_shared_spec"] is True
    assert spec["version_count"] == 1
    assert spec["latest_version"]["version_no"] == 1
    assert spec["latest_version"]["note"] == "First draft"
    assert spec["latest_version"]["author"]["node_id"] == str(origin["pm"].id)
    assert [w["node_id"] for w in spec["written_by"]] == [str(origin["pm"].id)]
    # Every agent reads the spec: the entry (on refine rounds) and the architect by default, the
    # engineer because its reads_from names it.
    assert {r["role_name"] for r in spec["read_by"]} == {"pm", "architect", "engineer"}
    assert all(
        {"node_id", "clone_node_id", "role_name", "label"} <= set(r) for r in spec["read_by"]
    )

    design = docs["design"]
    assert design["is_shared_spec"] is False
    assert [w["role_name"] for w in design["written_by"]] == ["architect"]
    assert [r["role_name"] for r in design["read_by"]] == ["engineer"]
    assert design["latest_version"]["note"] == "Round 1"


def test_run_documents_readers_respect_reads_default_false(client):
    library = build_thinker_chain_team()
    _set_config(library, "architect", {"reads_default": False})
    run_id = _seed_run(library)
    _spec_on(run_id)
    spec = client.get(f"/api/runs/{run_id}/documents").json()["documents"][0]
    assert {r["role_name"] for r in spec["read_by"]} == {"pm", "engineer"}
    assert client.get(f"/api/runs/{run_id}/documents").json()["run"]["live"] is True


# ============================ POST /api/documents/{id}/versions ===========================


def test_human_save_returns_the_full_version(client):
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id)
    resp = client.post(
        f"/api/documents/{doc.id}/versions", json={"content": "edited", "base_version_no": 1}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version_no"] == 2
    assert body["document_id"] == str(doc.id)
    assert body["content"] == "edited"
    assert body["created_by"] == "human"
    assert body["note"] == "Edited while the run was live"
    assert body["author"]["kind"] == "human" and body["author"]["label"] == "You"
    assert _versions(doc.id)[-1].id == uuid.UUID(body["id"])

    custom = client.post(
        f"/api/documents/{doc.id}/versions", json={"content": "again", "note": "Narrowed scope"}
    ).json()
    assert custom["note"] == "Narrowed scope"
    assert _versions(doc.id)[-1].note == "Narrowed scope"


def test_stale_base_is_a_409_and_writes_nothing(client):
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id)
    pm = _nodes(_team_of(run_id))["pm"]
    # An agent saved v2 after the editor opened on v1.
    add_version(
        doc.id,
        "agent v2",
        created_by="agent:entry",
        idempotency_key=f"{run_id}:spec:{pm.id}:2",
        note="Revised in round 2",
        author_node_id=pm.id,
    )
    resp = client.post(
        f"/api/documents/{doc.id}/versions", json={"content": "mine", "base_version_no": 1}
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["code"] == "stale_version"
    assert detail["latest_version_no"] == 2
    assert detail["latest_author"]["node_id"] == str(pm.id)
    assert detail["latest_author"]["label"] == "Product manager"
    assert detail["message"] == (
        "Product manager saved v2 while you were editing. Compare, then save again."
    )
    assert [v.version_no for v in _versions(doc.id)] == [1, 2]  # nothing written

    ok = client.post(
        f"/api/documents/{doc.id}/versions", json={"content": "mine", "base_version_no": 2}
    )
    assert ok.status_code == 200 and ok.json()["version_no"] == 3


def test_saving_on_a_finished_run_is_a_409(client):
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id)
    for status in ("completed", "failed", "cancelled", "rejected", "over_budget"):
        _set_status(run_id, status)
        resp = client.post(f"/api/documents/{doc.id}/versions", json={"content": "late"})
        assert resp.status_code == 409, status
        assert resp.json()["detail"] == {
            "code": "run_finished",
            "message": "This run has finished — edits can’t reach its agents.",
        }
    assert len(_versions(doc.id)) == 1

    _set_status(run_id, "awaiting_human")  # paused at a gate is still live
    assert client.post(f"/api/documents/{doc.id}/versions", json={"content": "ok"}).status_code == (
        200
    )


# ============================ versions read → context manifest ============================


def _manifests(run_id: str) -> dict[tuple[str, int], dict | None]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentNode.role_name, AgentInvocation.iteration, AgentInvocation.context_manifest)
            .join(AgentNode, AgentNode.id == AgentInvocation.node_id)
            .where(AgentInvocation.run_id == run_id)
        ).all()
    return {(role, it): manifest for role, it, manifest in rows}


def test_versioned_read_steps_are_recorded_steps():
    markers = ("__wrapped__", "dbos_func_decorator_info", "dbos_function_name")
    assert all(hasattr(team_run.read_latest_prd_versioned_step, m) for m in markers)
    assert all(hasattr(team_run.read_named_documents_versioned_step, m) for m in markers)


def test_versioned_read_steps_return_content_and_version(client):
    run_id = _seed_run(build_two_node_team())
    doc = _spec_on(run_id, "PRD v1")
    add_version(doc.id, "PRD v2", created_by="human", idempotency_key=f"human-edit:{doc.id}:v")

    assert team_run.read_latest_prd_versioned_step(run_id) == {
        "content": "PRD v2",
        "document_id": str(doc.id),
        "version_no": 2,
        "name": "spec",
    }
    assert team_run.read_named_documents_versioned_step(run_id, ["ghost", "spec"]) == [
        {"name": "spec", "content": "PRD v2", "document_id": str(doc.id), "version_no": 2}
    ]
    # The old steps keep their return shape (in-flight workflows replay them).
    assert team_run.read_latest_prd_step(run_id) == "PRD v2"
    assert team_run.read_named_documents_step(run_id, ["spec"]) == [
        {"name": "spec", "content": "PRD v2"}
    ]


def test_manifest_records_the_document_versions_each_agent_read(client, monkeypatch, tmp_path):
    run_id, _library, _clone = _run_chain(monkeypatch, tmp_path)
    docs = {d.name: str(d.id) for d in list_documents_for_run(uuid.UUID(run_id))}
    manifests = _manifests(run_id)

    assert "documents" not in manifests[("pm", 1)]  # the entry's first round reads nothing
    spec_v1 = {
        "name": "spec",
        "document_id": docs["spec"],
        "version_no": 1,
        "is_shared_spec": True,
    }
    assert manifests[("architect", 1)]["documents"] == [spec_v1]
    assert manifests[("engineer", 1)]["documents"] == [
        spec_v1,
        {"name": "design", "document_id": docs["design"], "version_no": 1, "is_shared_spec": False},
    ]


class _SteeredAdapter:
    """The entry writes the PRD; the Engineer's first round is followed by a human edit (v2)."""

    name = "openhands"

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.rounds = 0

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        if "REPORT-ONLY NODE" in task.instruction:
            (ws / "REPORT.md").write_text("PRD: v1", encoding="utf-8")
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        self.rounds += 1
        if self.rounds == 1:
            with session_scope() as session:
                doc_id = session.get(Run, uuid.UUID(self.run_id)).pm_document_id
            add_version(
                doc_id, "PRD: v2", created_by="human", idempotency_key=f"human-edit:{doc_id}"
            )
        (ws / "greeting.txt").write_text(f"round {self.rounds}\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def test_manifest_shows_a_live_edit_reaching_the_next_round(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    run_id = _seed_run(clone_team_graph(build_review_loop_team()))
    adapter = _SteeredAdapter(run_id)
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: adapter)
    with SetWorkflowID(run_id):
        assert DBOS.start_workflow(team_run.run_team, "x").get_result()["status"] == "completed"

    manifests = _manifests(run_id)
    assert [d["version_no"] for d in manifests[("engineer", 1)]["documents"]] == [1]
    assert [d["version_no"] for d in manifests[("engineer", 2)]["documents"]] == [2]

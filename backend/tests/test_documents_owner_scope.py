"""Spec §3.6 — the document endpoints are owner-scoped.

``GET /api/documents``, ``GET /api/documents/{id}`` and ``POST /api/documents/{id}/versions``
used to serve ANY document to ANY signed-in account. A document is owned through its run
(``documents.run_id → runs.owner_id``, or — legacy — ``runs.pm_document_id``); another account gets
a 404 (not a 403, so existence isn't probeable) and never sees it in the list.
"""

import uuid

from conftest import auth_user_id
from fastapi.testclient import TestClient
from sqlalchemy import update

from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    create_document_with_initial_version,
    get_document_with_versions,
)
from tvashtr.main import app
from tvashtr.models import Run


def _other_account() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"docs-other-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "docs-password"})
    assert resp.status_code == 200, resp.text
    return c


def _seed_run(owner_id: uuid.UUID, status: str = "running") -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner_id,
                idea="owner scope",
                workflow_id=run_id,
                status=status,
            )
        )
    return run_id


def _run_document(run_id: str) -> str:
    """A run-scoped spec document (the shape the executor writes today)."""
    doc = create_document_with_initial_version(
        "Mini-PRD",
        "prd",
        "the spec",
        "agent:entry",
        f"{run_id}:pm-prd-v1",
        run_id=uuid.UUID(run_id),
        name="spec",
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=doc.id)
        )
    return str(doc.id)


def _legacy_document(run_id: str) -> str:
    """A pre-0028 document: no ``run_id``, reachable only through ``runs.pm_document_id``."""
    doc = create_document_with_initial_version(
        "Mini-PRD", "prd", "legacy spec", "agent:pm", f"{run_id}:pm-prd-v1"
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=doc.id)
        )
    return str(doc.id)


def test_list_is_owner_scoped(client):
    doc_id = _run_document(_seed_run(auth_user_id()))
    legacy_id = _legacy_document(_seed_run(auth_user_id()))

    mine = {d["id"] for d in client.get("/api/documents").json()["documents"]}
    assert {doc_id, legacy_id} <= mine

    other = _other_account()
    theirs = {d["id"] for d in other.get("/api/documents").json()["documents"]}
    assert doc_id not in theirs and legacy_id not in theirs


def test_other_account_cannot_read_a_document(client):
    doc_id = _run_document(_seed_run(auth_user_id()))
    assert client.get(f"/api/documents/{doc_id}").status_code == 200

    resp = _other_account().get(f"/api/documents/{doc_id}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "document not found"


def test_other_account_cannot_read_a_legacy_document(client):
    legacy_id = _legacy_document(_seed_run(auth_user_id()))
    assert client.get(f"/api/documents/{legacy_id}").status_code == 200
    assert _other_account().get(f"/api/documents/{legacy_id}").status_code == 404


def test_other_account_cannot_append_a_version(client):
    doc_id = _run_document(_seed_run(auth_user_id()))

    resp = _other_account().post(f"/api/documents/{doc_id}/versions", json={"content": "hijack"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "document not found"
    doc = get_document_with_versions(uuid.UUID(doc_id))
    assert [v.content for v in doc.versions] == ["the spec"]  # nothing appended

    # The owner still can.
    resp = client.post(f"/api/documents/{doc_id}/versions", json={"content": "mine"})
    assert resp.status_code == 200, resp.text
    doc = get_document_with_versions(uuid.UUID(doc_id))
    assert [v.content for v in doc.versions] == ["the spec", "mine"]


def test_a_document_with_no_run_is_nobodys(client):
    """The ``doc_writer`` proof workflow's documents have no run, so no account owns them."""
    doc = create_document_with_initial_version(
        "Mini-PRD", "prd", "orphan", "agent:doc_writer", f"orphan:{uuid.uuid4().hex}:v1"
    )
    assert client.get(f"/api/documents/{doc.id}").status_code == 404
    assert client.post(f"/api/documents/{doc.id}/versions", json={"content": "x"}).status_code == (
        404
    )
    assert str(doc.id) not in {d["id"] for d in client.get("/api/documents").json()["documents"]}

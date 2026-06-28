"""Shared pytest fixtures.

These are integration tests: they require a running, migrated Postgres (see the
``test`` Make target). The session-scoped client launches DBOS exactly once via
the FastAPI lifespan and tears it down at the end of the session.
"""

import os
import uuid

import pytest

# Shrink the durable sleep before the app (and its cached settings) import.
os.environ.setdefault("HELLO_SLEEP_SECONDS", "0.1")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import update  # noqa: E402

from tvashtr.db import session_scope  # noqa: E402
from tvashtr.documents.service import create_document_with_initial_version  # noqa: E402
from tvashtr.main import app  # noqa: E402
from tvashtr.models import Run  # noqa: E402


@pytest.fixture(scope="session")
def client():
    # M-accounts Slice A: every /api/* route now requires a tv_session cookie. Registering a unique
    # account here makes this shared client AUTHENTICATED — the single point that keeps the whole
    # existing endpoint suite green under login enforcement (every endpoint test takes `client`). A
    # fresh uuid email per session never collides with prior data, so the suite is re-runnable.
    with TestClient(app) as test_client:
        email = f"conftest-{uuid.uuid4().hex}@tvashtr.local"
        resp = test_client.post(
            "/api/auth/register", json={"email": email, "password": "conftest-password"}
        )
        assert resp.status_code == 200, f"auth fixture setup failed: {resp.status_code} {resp.text}"
        yield test_client


@pytest.fixture
def unauth_client(client):
    """A fresh, UNauthenticated client (empty cookie jar) for the auth-surface tests. A bare
    ``TestClient(app)`` — NOT a ``with`` block — so it never re-runs the lifespan (DBOS is launched
    exactly once by the session ``client`` it depends on); it shares that already-launched app."""
    plain = TestClient(app)
    plain.cookies.clear()
    return plain


def seed_pm_prd(run_id: str, idea: str) -> dict:
    """No-LLM stand-in for ``team_run.pm_step``'s document side-effect, shared by the offline
    ``run_team`` tests. Persists a REAL Mini-PRD document (v1) and sets ``Run.pm_document_id`` so
    the executor's live PRD re-source (``read_latest_prd_step``, P1.7a) resolves on every
    agent-node entry, then returns the same ``{"document_id", "prd_text"}`` shape the real step
    returns. Idempotent on the run's canonical ``{run_id}:pm-prd-v1`` key (a re-run never orphans
    a duplicate document)."""
    content = f"PRD: {idea}"
    document = create_document_with_initial_version(
        "Mini-PRD", "prd", content, "agent:pm", f"{run_id}:pm-prd-v1"
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=document.id)
        )
    return {"document_id": str(document.id), "prd_text": content}

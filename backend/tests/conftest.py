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
from sqlalchemy import select, update  # noqa: E402

from tvashtr.control_plane.credentials import encrypt_secret  # noqa: E402
from tvashtr.db import session_scope  # noqa: E402
from tvashtr.documents.service import create_document_with_initial_version  # noqa: E402
from tvashtr.main import app  # noqa: E402
from tvashtr.models import ProviderCredential, Run  # noqa: E402

# M-accounts Slice B: the providers the default test teams' node models use (openrouter for the
# PM/default_model; openrouter/openai for engineer_model; nvidia_nim when TVASHTR_AGENT_MODEL is the
# NIM slug; gemini/groq too). The shared `client` user gets a DUMMY encrypted credential for each,
# so every owned run's launch pre-flight + per-owner resolver pass offline — the LLM is
# mocked, so the dummy key is never used against a real provider.
_TEST_PROVIDERS = ("openrouter", "openai", "nvidia_nim", "gemini", "groq")
_DUMMY_KEY = "dummy-offline-test-key-0000"

# The shared `client` user's id, captured at register so direct-`Run(`-insert tests can OWN their
# runs by the SAME account the client's cookie authenticates as (so owner-checked endpoints reached
# via `client` pass, and the LLM-mocked executor resolver finds the seeded dummy creds).
_AUTH_USER_ID: str | None = None


def _seed_dummy_credentials(owner_id: str) -> None:
    """Give ``owner_id`` a dummy encrypted credential for every test provider (idempotent)."""
    with session_scope() as session:
        existing = set(
            session.execute(
                select(ProviderCredential.provider).where(
                    ProviderCredential.owner_id == uuid.UUID(owner_id)
                )
            ).scalars()
        )
        for provider in _TEST_PROVIDERS:
            if provider not in existing:
                session.add(
                    ProviderCredential(
                        owner_id=uuid.UUID(owner_id),
                        provider=provider,
                        secret_encrypted=encrypt_secret(_DUMMY_KEY),
                        key_last4=_DUMMY_KEY[-4:],
                    )
                )


def auth_user_id() -> uuid.UUID:
    """The shared `client` user's id (M-accounts Slice B) — the owner every direct-`Run(`-insert
    test stamps on its runs. Requires the `client` fixture to have run (it registers + captures the
    id); every Run-inserting test takes `client`, so this is always populated when called."""
    assert _AUTH_USER_ID is not None, (
        "auth_user_id() requires the `client` fixture (it sets the id)"
    )
    return uuid.UUID(_AUTH_USER_ID)


@pytest.fixture(scope="session")
def client():
    # M-accounts Slice A: every /api/* route now requires a tv_session cookie. Registering a unique
    # account here makes this shared client AUTHENTICATED — the single point that keeps the whole
    # existing endpoint suite green under login enforcement (every endpoint test takes `client`). A
    # fresh uuid email per session never collides with prior data, so the suite is re-runnable.
    # M-accounts Slice B: capture the registered user's id (every owned run is stamped with it via
    # auth_user_id()) and seed it dummy provider credentials so owned runs resolve offline.
    global _AUTH_USER_ID
    with TestClient(app) as test_client:
        email = f"conftest-{uuid.uuid4().hex}@tvashtr.local"
        resp = test_client.post(
            "/api/auth/register", json={"email": email, "password": "conftest-password"}
        )
        assert resp.status_code == 200, f"auth fixture setup failed: {resp.status_code} {resp.text}"
        _AUTH_USER_ID = resp.json()["id"]
        _seed_dummy_credentials(_AUTH_USER_ID)
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

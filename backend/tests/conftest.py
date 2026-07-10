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
# NIM slug; gemini/groq too; deepseek when TVASHTR_AGENT_MODEL is the M-robust reasoning slug
# `deepseek/deepseek-chat`). The shared `client` user gets a DUMMY encrypted credential for each, so
# every owned run's launch pre-flight + per-owner resolver pass offline — the LLM is mocked, so the
# dummy key is never used against a real provider.
_TEST_PROVIDERS = ("openrouter", "openai", "nvidia_nim", "gemini", "groq", "deepseek")
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
    """No-LLM stand-in for the old ``team_run.pm_step``'s document side-effect. Persists a REAL
    Mini-PRD document (v1) and sets ``Run.pm_document_id`` directly, then returns the
    ``{"document_id", "prd_text"}`` shape. Idempotent on the run's canonical ``{run_id}:pm-prd-v1``
    key. RETAINED for the few tests that need a spec seeded WITHOUT running the entry node (M-unify
    U1 removed ``pm_step`` — the entry now runs the agent path; see :func:`entry_report_result`)."""
    content = f"PRD: {idea}"
    document = create_document_with_initial_version(
        "Mini-PRD", "prd", content, "agent:pm", f"{run_id}:pm-prd-v1"
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=document.id)
        )
    return {"document_id": str(document.id), "prd_text": content}


def maybe_write_entry_report(task) -> bool:
    """M-unify U1: for a fake ``EngineAdapter`` (tests that patch ``resolve_adapter``). If ``task``
    is a report-only (edits-off) node — detected by the capability note the compiler appends — write
    ``REPORT.md`` to its workspace (content ``PRD: <idea>``, the idea lifted from the compiled
    instruction, so the versioned spec matches the old ``seed_pm_prd``) and return True. A fake
    adapter's ``run`` calls this FIRST to service the entry/thinker; returns False for a worker (the
    fake then runs its normal worker branch)."""
    import pathlib

    if "REPORT-ONLY NODE" not in task.instruction:
        return False
    # M-unify U3: an edits-off EMITTING node (a reviewer, edits_allowed=False on the review_loop
    # template) also carries the report-only capability note, but it delivers a VERDICT — its pull
    # scope is verdict-only (no REPORT.md), matching the real ``_resolve_pull_paths(False, True)``.
    # Only a report-writing node (REPORT.md IN its pull scope) gets the entry-report treatment here;
    # an emitting node falls through so the fake adapter runs its own verdict branch.
    pull = getattr(task, "pull_paths", None)
    if pull is not None and "REPORT.md" not in pull:
        return False
    idea = ""
    marker = "--- ORIGINAL IDEA ---\n"
    if marker in task.instruction:
        idea = task.instruction.split(marker, 1)[1].split("\n\n", 1)[0]
    (pathlib.Path(task.workspace_dir) / "REPORT.md").write_text(f"PRD: {idea}", encoding="utf-8")
    return True


def entry_report_result(idea: str) -> dict:
    """M-unify U1: the unified-path replacement for the old ``seed_pm_prd``→``pm_step`` fake. The
    ENTRY node now runs the ONE agent path (``agent_run_step``) as a report-only (edits-off) node,
    and the executor versions its returned ``report`` (``REPORT.md`` content) into the spec
    document.
    This is the fake ``agent_run_step`` return for an edits-off node: ``report = "PRD: {idea}"`` (so
    the versioned spec matches what ``seed_pm_prd`` produced) with ZERO usage — mirroring the old
    direct-completion PM, which never wrote an ``agent-cost`` row (keeps the ``:agent-cost:%``
    counts
    engineer-only). A fake ``agent_run_step`` branches on ``not edits_allowed`` to return this."""
    return {
        "status": "completed",
        "outcome": None,
        "reasons": None,
        "report": f"PRD: {idea}",
        "files_changed": [],
        "context_manifest": None,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "cost_usd": 0.0,
    }

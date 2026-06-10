"""Shared pytest fixtures.

These are integration tests: they require a running, migrated Postgres (see the
``test`` Make target). The session-scoped client launches DBOS exactly once via
the FastAPI lifespan and tears it down at the end of the session.
"""

import os

import pytest

# Shrink the durable sleep before the app (and its cached settings) import.
os.environ.setdefault("HELLO_SLEEP_SECONDS", "0.1")

from fastapi.testclient import TestClient  # noqa: E402

from tvashtr.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client

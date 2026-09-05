"""The hosted-sandbox LAUNCH PRE-FLIGHT — the fix for the ``create_app`` 403 that killed every run
at the entry (PM) node.

THE BUG THIS PINS. In ``fly`` sandbox mode the per-run microVM's app is created lazily, by the first
agent node that needs a sandbox. So a revoked ``TVASHTR_FLY_API_TOKEN`` reached the user as *the PM
node failed having written no spec* — rendered as "The product manager didn't finish the spec for
this run." — with the real HTTP 403 four layers below and nothing on screen naming the credential.
The pre-flight moves that verdict to the launch request.

⚠️ THE HARD RULE FROM ``test_fly_machines.py`` APPLIES HERE TOO: **no test may reach the real Fly
API.** The Makefile does ``include .env`` + ``export``, so the operator's live token is ambient in
every ``make test`` process. Every test below either stays out of ``fly`` mode entirely or binds a
fake token to an ``httpx.MockTransport``; no socket is ever opened.

The transport tests deliberately drive the **real** ``FlyMachines``, so what they exercise is the
production ``_request`` -> ``FlyApiError`` -> ``is_authorization_error`` chain rather than a mock's
idea of it — the message shape IS the classifier's input, so faking it would test nothing.
"""

import uuid
from unittest.mock import MagicMock, patch

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete, func, select

from tvashtr.control_plane import fly_preflight
from tvashtr.db import session_scope
from tvashtr.engines.fly_machines import FlyApiError, FlyMachines, is_authorization_error
from tvashtr.models import Run

FAKE_TOKEN = "fly-preflight-test-token-NOT-REAL-abc123"
FAKE_IMAGE = "ghcr.io/openhands/agent-server:latest-python"


# ---------------------------------------------------------------- helpers


def _settings(*, mode: str = "fly", token: str = FAKE_TOKEN):
    return MagicMock(
        agent_sandbox_mode=mode,
        fly_api_token=SecretStr(token),
        fly_org="personal",
        fly_agent_image=FAKE_IMAGE,
    )


def _fly_factory(handler):
    """A drop-in for ``fly_preflight.FlyMachines`` returning the REAL client bound to a
    MockTransport. ``timeout`` is dropped because an injected client owns its own."""

    def _make(**kwargs):
        kwargs.pop("timeout", None)
        return FlyMachines(**kwargs, client=httpx.Client(transport=httpx.MockTransport(handler)))

    return _make


def _responder(status: int, body: object = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if status == 200:
            return httpx.Response(200, json=body if body is not None else [])
        return httpx.Response(status, json=body if body is not None else {"error": "unauthorized"})

    return handler


def _blocker_with(handler, *, settings=None) -> str | None:
    with (
        patch.object(fly_preflight, "get_settings", return_value=settings or _settings()),
        patch.object(fly_preflight, "FlyMachines", _fly_factory(handler)),
    ):
        return fly_preflight.fly_launch_blocker()


# ---------------------------------------------------------------- the classifier


@pytest.mark.parametrize("status", [401, 403])
def test_is_authorization_error_matches_flys_two_refusal_statuses(status):
    assert is_authorization_error(FlyApiError(f'fly create_app failed: HTTP {status} {{"e":"x"}}'))


@pytest.mark.parametrize(
    "message",
    [
        "fly get_run_machine failed: HTTP 404 {}",  # a normal answer on the re-discovery path
        "fly create_app failed: HTTP 500 {}",  # Fly did not answer
        "fly create_machine failed: HTTP 422 insufficient_capacity",  # the region ladder's business
        "fly list_apps failed: ConnectError(...)",  # transport, no status at all
    ],
)
def test_is_authorization_error_rejects_everything_that_is_not_a_credential_verdict(message):
    """A false positive here grounds an install that works, so the predicate must stay narrow."""
    assert not is_authorization_error(FlyApiError(message))


# ---------------------------------------------------------------- the gate


def test_the_preflight_is_inert_outside_fly_mode():
    """A docker/local install has no Fly credential to be wrong about and must not pay a Fly API
    call — nor be refusable — for a feature it does not use."""
    exploding = MagicMock(side_effect=AssertionError("must not construct a Fly client"))
    with (
        patch.object(fly_preflight, "get_settings", return_value=_settings(mode="docker")),
        patch.object(fly_preflight, "FlyMachines", exploding),
    ):
        assert fly_preflight.fly_launch_blocker() is None


def test_a_missing_token_blocks_the_launch_without_calling_fly():
    """The unconfigured install: refuse off the empty value, before any client exists."""
    exploding = MagicMock(side_effect=AssertionError("must not construct a Fly client"))
    with (
        patch.object(fly_preflight, "get_settings", return_value=_settings(token="")),
        patch.object(fly_preflight, "FlyMachines", exploding),
    ):
        blocker = fly_preflight.fly_launch_blocker()
    assert blocker is not None
    assert "TVASHTR_FLY_API_TOKEN" in blocker
    assert "fly tokens create org" in blocker


# ---------------------------------------------------------------- the verdict


@pytest.mark.parametrize("status", [401, 403])
def test_a_refused_token_blocks_the_launch_and_names_the_var_and_the_scope(status):
    """THE REGRESSION. This is the exact wire answer that used to surface as "the product manager
    didn't finish the spec": the run path's first Fly call refused."""
    blocker = _blocker_with(_responder(status))
    assert blocker is not None
    assert "TVASHTR_FLY_API_TOKEN" in blocker  # the env var, named
    assert "fly tokens create org" in blocker  # the permission, named
    assert "personal" in blocker  # the org it must be scoped to
    assert f"HTTP {status}" in blocker  # what Fly actually said


def test_a_live_token_allows_the_launch():
    assert _blocker_with(_responder(200, [{"name": "tvashtr"}])) is None


@pytest.mark.parametrize("status", [500, 502, 503])
def test_fly_being_down_allows_the_launch(status):
    """THE ASYMMETRY, and the reason this pre-flight can never become an outage: "Fly did not
    answer" is not "Fly said no", so the run proceeds exactly as it does today."""
    assert _blocker_with(_responder(status)) is None


def test_a_transport_failure_allows_the_launch():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    assert _blocker_with(boom) is None


def test_an_unexpected_exception_allows_the_launch():
    """A pre-flight must never be able to fail a launch by its own bug."""
    with (
        patch.object(fly_preflight, "get_settings", return_value=_settings()),
        patch.object(fly_preflight, "FlyMachines", MagicMock(side_effect=RuntimeError("boom"))),
    ):
        assert fly_preflight.fly_launch_blocker() is None


def test_the_token_never_reaches_the_blocker_message():
    """The refusal quotes Fly's own error body into a user-facing response, so ``_scrub``'s
    guarantee is load-bearing here rather than merely tidy."""
    blocker = _blocker_with(_responder(403, {"error": f"unauthorized for {FAKE_TOKEN}"}))
    assert blocker is not None
    assert FAKE_TOKEN not in blocker
    assert "<redacted-fly-token>" in blocker


# ---------------------------------------------------------------- the endpoint


def _run_count() -> int:
    with session_scope() as session:
        return session.execute(select(func.count()).select_from(Run)).scalar_one()


def test_post_api_runs_refuses_503_and_leaves_nothing_behind(client):
    """END TO END at the seam that matters: a dead credential now costs the user one honest
    sentence instead of a Run row, a DBOS workflow, a server-side clone and a fabricated story
    about the product manager."""
    before = _run_count()
    with (
        patch.object(fly_preflight, "get_settings", return_value=_settings()),
        patch.object(fly_preflight, "FlyMachines", _fly_factory(_responder(403))),
    ):
        resp = client.post("/api/runs", json={"idea": "fly preflight regression"})

    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["code"] == "sandbox_unavailable"
    assert "TVASHTR_FLY_API_TOKEN" in detail["message"]
    assert "fly tokens create org" in detail["message"]
    # The whole point of pre-flighting at the launch: no half-started run to reap afterwards.
    assert _run_count() == before


def test_post_api_runs_is_untouched_when_the_credential_is_live(client):
    """The pre-flight must be INVISIBLE on the happy path — same 200, same run_id contract.

    The Run row is deleted again on the way out. This suite shares one Postgres across hundreds of
    tests AND across re-runs, and a launch test's row is left ``running`` forever because its
    workflow is mocked — residue that accumulates into the M-h3 fleet ceiling and starts failing
    live gates elsewhere. Proving a launch works should not also cost a permanent slot."""
    run_id = None
    try:
        with (
            patch.object(fly_preflight, "get_settings", return_value=_settings()),
            patch.object(fly_preflight, "FlyMachines", _fly_factory(_responder(200, []))),
            patch("tvashtr.routers.DBOS.start_workflow"),  # no real agent run in the offline suite
        ):
            resp = client.post("/api/runs", json={"idea": "fly preflight happy path"})

        assert resp.status_code == 200
        run_id = resp.json()["run_id"]
        uuid.UUID(run_id)  # a well-formed run id, as before
    finally:
        if run_id is not None:
            with session_scope() as session:
                session.execute(delete(Run).where(Run.id == uuid.UUID(run_id)))

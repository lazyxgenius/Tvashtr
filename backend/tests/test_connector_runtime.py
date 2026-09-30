"""Connectors at run time (stream B3.1, B3.2): the run token an agent's sandbox carries, and the
connectors block ``build_mcp_config`` adds to a node's MCP config.

Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time)."""

import uuid

import pytest
from itsdangerous import URLSafeTimedSerializer

from tvashtr.auth import make_session_cookie_value
from tvashtr.config import get_settings
from tvashtr.control_plane import connector_proxy, run_views
from tvashtr.control_plane.connector_proxy import RunGrant, read_run_token, sign_run_token
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection, Run, User


def _user() -> uuid.UUID:
    with session_scope() as s:
        u = User(email=f"conn-{uuid.uuid4().hex}@tvashtr.local", password_hash="x")
        s.add(u)
        s.flush()
        return u.id


def _run(owner_id: uuid.UUID | None, status: str = "running") -> str:
    run_id = uuid.uuid4()
    with session_scope() as s:
        s.add(
            Run(
                id=run_id,
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner_id,
                idea="x",
                workflow_id=str(run_id),
                status=status,
            )
        )
    return str(run_id)


def _connection(owner_id: uuid.UUID, **over) -> uuid.UUID:
    fields = {
        "owner_id": owner_id,
        "connector_key": "linear",
        "name": "Linear",
        "slug": "linear",
        "url": "https://mcp.linear.app/mcp",
        "auth_kind": "api_key",
        "status": "connected",
    }
    with session_scope() as s:
        row = ConnectorConnection(**{**fields, **over})
        s.add(row)
        s.flush()
        return row.id


def _set(model, row_id, **values) -> None:
    with session_scope() as s:
        row = s.get(model, row_id)
        for key, value in values.items():
            setattr(row, key, value)


# ---- B3.1: the run token ----


def test_a_run_token_reads_back_to_its_run_node_connection_and_access():
    owner = _user()
    run_id, cid, node = _run(owner), _connection(owner), uuid.uuid4()

    token = sign_run_token(run_id, node, cid, "write")
    assert read_run_token(token) == RunGrant(
        run_id=run_id, node_id=str(node), connection_id=cid, access="write"
    )
    # Ids may be given as strings or uuids; a token with no node (the probe) reads back without one.
    token = sign_run_token(uuid.UUID(run_id), None, str(cid), "read")
    assert read_run_token(token) == RunGrant(
        run_id=run_id, node_id=None, connection_id=cid, access="read"
    )
    # A sign-in that expired mid-run doesn't kill the token: the proxy answers for it.
    _set(ConnectorConnection, cid, status="needs_signin")
    assert read_run_token(token) is not None


def test_a_run_token_is_signed_with_the_session_secret_under_its_own_salt():
    owner = _user()
    run_id, cid = _run(owner), _connection(owner)
    payload = {"r": run_id, "n": None, "c": str(cid), "a": "read"}
    secret = get_settings().session_secret.get_secret_value()

    ours = URLSafeTimedSerializer(secret, salt="tvashtr.connector-run").dumps(payload)
    assert read_run_token(ours) is not None
    # The same payload under another salt (the login cookie's, say) or another secret is refused.
    assert read_run_token(URLSafeTimedSerializer(secret, salt="other").dumps(payload)) is None
    forged = URLSafeTimedSerializer("not-the-secret", salt="tvashtr.connector-run").dumps(payload)
    assert read_run_token(forged) is None
    assert read_run_token(make_session_cookie_value(str(owner))) is None


def test_a_tampered_expired_or_garbage_token_is_refused():
    owner = _user()
    token = sign_run_token(_run(owner), None, _connection(owner), "read")
    assert read_run_token(token) is not None

    body, _, signature = token.rpartition(".")
    assert read_run_token(f"{body}x.{signature}") is None
    assert read_run_token(token[:-3]) is None
    for garbage in ("", "nope", "a.b.c", None, 7):
        assert read_run_token(garbage) is None
    assert read_run_token(token, max_age=-1) is None  # the age seam, as ``read_session_cookie``
    assert connector_proxy.RUN_TOKEN_MAX_AGE_SECONDS == 14 * 24 * 3600


@pytest.mark.parametrize("status", run_views.TERMINAL_STATUSES)
def test_a_token_stops_working_when_its_run_ends(status):
    owner = _user()
    run_id = _run(owner)
    token = sign_run_token(run_id, None, _connection(owner), "read")
    assert read_run_token(token) is not None

    _set(Run, uuid.UUID(run_id), status=status)
    assert read_run_token(token) is None


def test_a_token_whose_run_belongs_to_another_account_than_the_connection_is_refused():
    owner, other = _user(), _user()
    cid = _connection(owner)
    assert read_run_token(sign_run_token(_run(other), None, cid, "read")) is None
    assert read_run_token(sign_run_token(_run(None), None, cid, "read")) is None  # an ownerless run
    assert read_run_token(sign_run_token(str(uuid.uuid4()), None, cid, "read")) is None  # no run


def test_a_token_for_a_deleted_or_pending_connection_is_refused():
    owner = _user()
    run_id = _run(owner)
    pending = _connection(owner, status="pending")
    assert read_run_token(sign_run_token(run_id, None, pending, "read")) is None

    cid = _connection(owner, connector_key="sentry", slug="sentry")
    token = sign_run_token(run_id, None, cid, "read")
    assert read_run_token(token) is not None
    with session_scope() as s:
        s.delete(s.get(ConnectorConnection, cid))
    assert read_run_token(token) is None

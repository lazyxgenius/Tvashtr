"""Connectors Phase 0: every name the streams call across module lines exists with its final
signature, each stub answers what the build plan's table says, and the shared helpers in
``control_plane/connectors.py`` (final in Phase 0) do their job.

The tests of what a STUB answers are marked "Stub test": the task that fills the stub deletes its
test in the same commit as the tests that replace it (build plan §2, "A stub's test goes with the
stub"). Everything else here stays."""

import inspect
import time
import uuid
from datetime import datetime

import pytest
from mcp.types import Tool, ToolAnnotations
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from tvashtr.config import get_settings
from tvashtr.control_plane import (
    connector_catalog,
    connector_net,
    connector_oauth,
    connector_proxy,
    connector_upstream,
    connectors,
)
from tvashtr.control_plane.connectors import ConnectorError
from tvashtr.db import get_engine, session_scope
from tvashtr.mcp import agent_transport_security
from tvashtr.mcp.connectors import get_connectors_mcp
from tvashtr.models import ConnectorConnection, User
from tvashtr.routes import connectors as connectors_routes
from tvashtr.routes import connectors_oauth as oauth_routes


def _user() -> uuid.UUID:
    with session_scope() as s:
        u = User(email=f"conn-{uuid.uuid4().hex}@tvashtr.local", password_hash="x")
        s.add(u)
        s.flush()
        return u.id


def _connection(owner_id: uuid.UUID, **over) -> uuid.UUID:
    fields = {
        "owner_id": owner_id,
        "connector_key": "supabase",
        "name": "Supabase",
        "slug": "supabase",
        "url": "https://mcp.supabase.com/mcp",
        "auth_kind": "oauth",
        "status": "connected",
    }
    with session_scope() as s:
        row = ConnectorConnection(**{**fields, **over})
        s.add(row)
        s.flush()
        return row.id


def _row(connection_id: uuid.UUID) -> ConnectorConnection:
    with session_scope() as s:
        return s.get(ConnectorConnection, connection_id)


def _params(fn) -> str:
    return str(inspect.signature(fn)).split(" -> ")[0]


# ---- the cross-stream table: names and signatures ----


def test_every_cross_stream_name_has_its_final_signature():
    assert isinstance(connector_catalog.FEATURED, dict)
    assert _params(connector_catalog.available) == "(entry: dict)"
    assert _params(connector_catalog.resolve) == "(key: object)"
    assert _params(connector_catalog.is_write) == "(entry: dict | None, tool: dict, access: str)"

    assert _params(connector_net.check_url) == "(url: str)"
    assert _params(connector_net.site) == "(host: str)"
    for make in (connector_net.client, connector_net.async_client):
        assert _params(make) == "(timeout: float = 10.0, headers: dict | None = None)"

    assert _params(connector_upstream.list_tools) == (
        "(url: str, transport: str, headers: dict | None, timeout: float = 10)"
    )
    assert _params(connector_upstream.list_tools_sync) == _params(connector_upstream.list_tools)
    assert _params(connector_upstream.call_tool) == (
        "(url: str, transport: str, headers: dict | None, name: str, arguments: dict | None, "
        "timeout: float = 120)"
    )
    for error in ("UpstreamUnauthorized", "UpstreamRefused", "UpstreamUnreachable"):
        assert issubclass(getattr(connector_upstream, error), Exception)

    for error in ("CannotRegister", "SignInRefused", "Unreachable"):
        assert issubclass(getattr(connector_oauth, error), Exception)
    assert _params(connector_oauth.discover) == "(url: str, entry: dict | None = None)"
    assert _params(connector_oauth.ensure_access_token) == (
        "(connection_id: uuid.UUID, *, rejected: str | None = None)"
    )
    assert _params(connector_oauth.revoke) == "(connection_id: uuid.UUID)"

    assert _params(connectors.get_owned) == (
        "(session: sqlalchemy.orm.session.Session, owner_id: uuid.UUID, connection_id: object, "
        "*, for_update: bool = False)"
    )
    assert _params(connectors.upstream_headers) == (
        "(row: tvashtr.models.ConnectorConnection, *, rejected: str | None = None)"
    )
    assert _params(connectors.upstream_target) == (
        "(row: tvashtr.models.ConnectorConnection, access: str)"
    )
    for name in ("read_secret", "write_secret", "serialize", "stored_tools"):
        assert callable(getattr(connectors, name))

    assert _params(connector_proxy.recent_use) == (
        "(session: sqlalchemy.orm.session.Session, owner_id: uuid.UUID, connection_id: uuid.UUID)"
    )
    assert connectors_routes.router and oauth_routes.router and oauth_routes.public_router


# ---- the stubs: what each answers until its stream fills it ----


def test_discovery_is_the_final_dataclass():
    found = connector_oauth.Discovery(
        issuer="https://api.supabase.com",
        authorization_endpoint="https://api.supabase.com/v1/oauth/authorize",
        token_endpoint="https://api.supabase.com/v1/oauth/token",
        resource="https://mcp.supabase.com/mcp",
    )
    assert found.signin_host == "api.supabase.com"
    assert (found.registration_endpoint, found.revocation_endpoint, found.scope) == (None,) * 3
    assert (found.iss_supported, found.cimd_supported, found.token_auth_methods) == (
        False,
        False,
        (),
    )
    with pytest.raises(AttributeError):
        found.issuer = "https://evil.example"  # frozen


def test_ensure_access_token_refuses_a_row_that_is_gone_or_has_no_token():
    with pytest.raises(connector_oauth.SignInRefused):
        connector_oauth.ensure_access_token(uuid.uuid4())
    with pytest.raises(connector_oauth.SignInRefused):
        connector_oauth.ensure_access_token(_connection(_user()))


def test_the_proxy_server_is_stateless_and_accepts_the_hosts_agents_use():
    mcp = get_connectors_mcp()
    assert mcp is get_connectors_mcp()
    assert mcp.name == "tvashtr-connectors"
    assert mcp.settings.stateless_http is True and mcp.settings.json_response is True
    assert mcp.settings.streamable_http_path == "/"
    # Agents reach it by the public host (or the docker host), never by localhost: the SDK's
    # localhost-only Host check would answer them 421. The check is on, with those hosts listed.
    security = mcp.settings.transport_security
    assert security.enable_dns_rebinding_protection is True
    assert security.allowed_hosts == agent_transport_security().allowed_hosts


def test_the_hosts_agents_use_are_the_public_host_the_docker_host_and_localhost(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "public_base_url", "https://tvashtr.fly.dev/")
    monkeypatch.setattr(settings, "litellm_proxy_host_docker", "host.docker.internal")
    security = agent_transport_security()
    assert security.enable_dns_rebinding_protection is True
    assert security.allowed_hosts == [
        "localhost",
        "localhost:*",
        "127.0.0.1",
        "127.0.0.1:*",
        "[::1]",
        "[::1]:*",
        "host.docker.internal",
        "host.docker.internal:*",
        "tvashtr.fly.dev",
        "tvashtr.fly.dev:*",
    ]
    assert security.allowed_origins == []  # agents send no Origin; a browser page gets 403

    # The local default names localhost once, and an unset base adds nothing.
    for base in ("http://localhost:8000", ""):
        monkeypatch.setattr(settings, "public_base_url", base)
        assert agent_transport_security().allowed_hosts == security.allowed_hosts[:8]


# ---- connectors.py: the shared helpers (final) ----


def test_get_owned_is_a_404_for_a_garbage_absent_or_foreign_id():
    owner, other = _user(), _user()
    cid = _connection(owner)
    with session_scope() as s:
        assert connectors.get_owned(s, owner, cid).id == cid
        assert connectors.get_owned(s, owner, str(cid)).id == cid
        for bad_owner, bad_id in (
            (owner, "nope"),
            (owner, None),
            (owner, uuid.uuid4()),
            (other, cid),
        ):
            with pytest.raises(ConnectorError) as err:
                connectors.get_owned(s, bad_owner, bad_id)
            assert (err.value.status_code, err.value.detail) == (404, "Connector not found.")


def test_get_owned_for_update_takes_the_row_lock():
    owner = _user()
    cid = _connection(owner)
    probe = text("SELECT 1 FROM connector_connections WHERE id = :id FOR UPDATE NOWAIT")
    with session_scope() as s:
        connectors.get_owned(s, owner, cid)  # a plain read holds no lock
        with get_engine().connect() as other:
            assert other.execute(probe, {"id": cid}).scalar() == 1
            other.rollback()

        connectors.get_owned(s, owner, cid, for_update=True)
        with get_engine().connect() as other, pytest.raises(OperationalError):
            other.execute(probe, {"id": cid})


def test_secrets_round_trip_encrypted_and_the_pending_one_is_kept_apart():
    cid = _connection(_user())
    stored = {"headers": {"Authorization": "Bearer apify_api_PLAINTEXT"}}
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        assert connectors.read_secret(row) is None
        connectors.write_secret(row, stored)
        connectors.write_secret(row, {"code_verifier": "VERIFIER"}, pending=True)

    row = _row(cid)
    assert "PLAINTEXT" not in row.secret_encrypted and "VERIFIER" not in row.pending_encrypted
    assert connectors.read_secret(row) == stored
    assert connectors.read_secret(row, pending=True) == {"code_verifier": "VERIFIER"}

    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        connectors.write_secret(row, None, pending=True)
    row = _row(cid)
    assert row.pending_encrypted is None and connectors.read_secret(row) == stored


def test_stored_tools_keeps_name_title_and_the_read_only_hint():
    schema = {"type": "object"}
    tools = [
        Tool(
            name="list_tables", inputSchema=schema, annotations=ToolAnnotations(readOnlyHint=True)
        ),
        Tool(name="run_sql", title="Run SQL", inputSchema=schema),
        Tool(
            name="drop",
            inputSchema=schema,
            annotations=ToolAnnotations(title="Drop it", readOnlyHint=False),
        ),
    ]
    assert connectors.stored_tools(tools) == [
        {"name": "list_tables", "title": None, "read_only": True},
        {"name": "run_sql", "title": "Run SQL", "read_only": False},
        {"name": "drop", "title": "Drop it", "read_only": False},
    ]


CONNECTION_KEYS = {
    "id", "connector_key", "name", "slug", "publisher", "featured", "reviewed", "category",
    "host", "auth_kind", "signin_host", "signin_host_differs", "access", "access_modes",
    "read_only_by", "scope", "scope_picker", "status", "signin_pending", "last_error", "tools",
    "used_by", "connected_at", "created_at", "updated_at",
}  # fmt: skip


def test_serialize_is_the_contracts_connection_and_carries_no_secret():
    owner = _user()
    cid = _connection(
        owner,
        scope={"value": "abcd1234", "label": "trade-mcp-prod · ap-southeast-1"},
        tools=[
            {"name": "list_tables", "title": None, "read_only": True},
            {"name": "execute_sql", "title": None, "read_only": False},
        ],
    )
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        connectors.write_secret(
            row,
            {
                "issuer": "https://api.supabase.com",
                "authorization_endpoint": "https://api.supabase.com/v1/oauth/authorize",
                "access_token": "ACCESS-TOKEN",
                "refresh_token": "REFRESH-TOKEN",
            },
        )
    users = [
        {"node_id": "n1", "team_id": "t1", "access": "read"},
        {"node_id": "n2", "team_id": "t1", "access": "read"},
    ]
    out = connectors.serialize(_row(cid), users)

    assert set(out) == CONNECTION_KEYS
    assert out | {"created_at": None, "updated_at": None} == {
        "id": str(cid),
        "connector_key": "supabase",
        "name": "Supabase",
        "slug": "supabase",
        "publisher": "Supabase",
        "featured": True,
        "reviewed": True,
        "category": "databases",
        "host": "mcp.supabase.com",
        "auth_kind": "oauth",
        "signin_host": "api.supabase.com",
        "signin_host_differs": False,
        "access": "read",
        "access_modes": ["read", "write"],
        "read_only_by": "provider",
        "scope": {"value": "abcd1234", "label": "trade-mcp-prod · ap-southeast-1"},
        "scope_picker": {"param": "project_ref", "label": "Project"},
        "status": "connected",
        "signin_pending": False,
        "last_error": None,
        # Supabase in read mode: the provider's flag makes every listed tool a read.
        "tools": [
            {"name": "list_tables", "title": None, "write": False, "on": True},
            {"name": "execute_sql", "title": None, "write": False, "on": True},
        ],
        "used_by": {"agent_count": 2, "team_count": 1},
        "connected_at": None,
        "created_at": None,
        "updated_at": None,
    }
    for stamp in ("created_at", "updated_at"):  # ISO 8601 with offset
        assert datetime.fromisoformat(out[stamp]).tzinfo is not None
    flat = repr(out)
    for secret in ("ACCESS-TOKEN", "REFRESH-TOKEN", "secret_encrypted", "pending_encrypted"):
        assert secret not in flat
    assert "state_hash" not in flat


def test_serialize_tools_follow_the_access_and_the_annotation():
    tools = [
        {"name": "list_issues", "title": "List issues", "read_only": True},
        {"name": "create_issue", "title": None, "read_only": False},
    ]
    owner = _user()
    base = {"connector_key": "linear", "slug": "linear", "url": "https://mcp.linear.app/mcp"}
    read = connectors.serialize(_row(_connection(owner, tools=tools, **base)))
    assert read["tools"] == [
        {"name": "list_issues", "title": "List issues", "write": False, "on": True},
        {"name": "create_issue", "title": None, "write": True, "on": False},
    ]
    assert read["used_by"] == {"agent_count": 0, "team_count": 0}

    write = connectors.serialize(_row(_connection(_user(), tools=tools, access="write", **base)))
    assert [(t["write"], t["on"]) for t in write["tools"]] == [(False, True), (True, True)]

    assert connectors.serialize(_row(_connection(_user(), **base)))["tools"] is None


def test_serialize_a_sign_in_in_flight_and_a_sign_in_host_on_another_site():
    cid = _connection(_user(), status="pending", state_hash=uuid.uuid4().hex)
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        connectors.write_secret(
            row,
            {
                "authorization_endpoint": "https://login.elsewhere.dev/authorize",
                "started_at": time.time() - 30,
            },
            pending=True,
        )
    out = connectors.serialize(_row(cid))
    assert (out["status"], out["signin_pending"]) == ("pending", True)
    assert (out["signin_host"], out["signin_host_differs"]) == ("login.elsewhere.dev", True)

    # Started more than ten minutes ago: no longer pending.
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        connectors.write_secret(row, {"started_at": time.time() - 601}, pending=True)
    assert connectors.serialize(_row(cid))["signin_pending"] is False

    # Discovered at connect time but not started (no state yet): the host is known, not pending.
    cid = _connection(_user(), status="pending")
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        connectors.write_secret(
            row,
            {"authorization_endpoint": "https://api.supabase.com/v1/oauth/authorize"},
            pending=True,
        )
    out = connectors.serialize(_row(cid))
    assert (out["signin_host"], out["signin_pending"]) == ("api.supabase.com", False)


def test_serialize_a_key_connection_whose_entry_is_unknown():
    cid = _connection(
        _user(),
        # Not in the registry snapshot (``com.apify/apify-mcp-server`` is, since B1.2).
        connector_key="com.apify/a-server-the-catalog-doesnt-have",
        name="Apify",
        slug="apify",
        url="https://mcp.apify.com/",
        auth_kind="api_key",
    )
    out = connectors.serialize(_row(cid))
    assert set(out) == CONNECTION_KEYS
    assert (out["publisher"], out["featured"], out["reviewed"], out["category"]) == (
        None,
        False,
        False,
        None,
    )
    assert (out["host"], out["signin_host"], out["signin_host_differs"]) == (
        "mcp.apify.com",
        None,
        False,
    )
    assert out["access_modes"] == ["read", "write"] and out["read_only_by"] == "annotations"
    assert out["scope_picker"] is None


def test_upstream_headers_by_auth_kind(monkeypatch):
    asked: list[tuple] = []

    def fake_token(connection_id, *, rejected=None):
        asked.append((connection_id, rejected))
        return "fresh-token"

    monkeypatch.setattr(connector_oauth, "ensure_access_token", fake_token)

    oauth = _connection(_user())
    assert connectors.upstream_headers(_row(oauth)) == {"Authorization": "Bearer fresh-token"}
    assert connectors.upstream_headers(_row(oauth), rejected="old") == {
        "Authorization": "Bearer fresh-token"
    }
    assert asked == [(oauth, None), (oauth, "old")]

    key = _connection(_user(), auth_kind="api_key")
    with session_scope() as s:
        connectors.write_secret(
            s.get(ConnectorConnection, key), {"headers": {"X-API-Key": "k", "X-Region": "eu"}}
        )
    assert connectors.upstream_headers(_row(key)) == {"X-API-Key": "k", "X-Region": "eu"}

    assert connectors.upstream_headers(_row(_connection(_user(), auth_kind="none"))) == {}
    assert len(asked) == 2  # only the OAuth connection asked for a token

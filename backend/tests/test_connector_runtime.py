"""Connectors at run time (stream B3.1, B3.2): the run token an agent's sandbox carries, and the
connectors block ``build_mcp_config`` adds to a node's MCP config.

Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time)."""

import uuid

import pytest
from conftest import auth_user_id
from itsdangerous import URLSafeTimedSerializer
from sqlalchemy import select

from tvashtr.auth import make_session_cookie_value
from tvashtr.config import get_settings
from tvashtr.control_plane import (
    connector_oauth,
    connector_proxy,
    connectors,
    node_library,
    run_views,
    team_run,
)
from tvashtr.control_plane.connector_proxy import RunGrant, read_run_token, sign_run_token
from tvashtr.control_plane.node_tools import build_mcp_config, connectors_mcp_url, domains_mcp_url
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    ConnectorConnection,
    Run,
    RunEvent,
    RunWarning,
    User,
)


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


# ---- B3.2: the connectors block of ``build_mcp_config`` ----

PROXY_URL = "http://127.0.0.1:8000/mcp/connectors"
SKIPPED = "we couldn’t reach it"


@pytest.fixture
def local_base(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "public_base_url", "http://127.0.0.1:8000")
    monkeypatch.setattr(settings, "agent_sandbox_mode", "local")


def _node(run_id: str) -> uuid.UUID:
    """An agent node of the run's graph."""
    with session_scope() as s:
        graph = s.get(Run, uuid.UUID(run_id)).team_graph_id
        return s.execute(
            select(AgentNode.id).where(AgentNode.team_graph_id == graph, AgentNode.kind == "agent")
        ).scalar_one()


def _invocation(run_id: str, node_id: uuid.UUID, iteration: int = 1) -> int:
    with session_scope() as s:
        inv = AgentInvocation(run_id=run_id, node_id=node_id, iteration=iteration, status="running")
        s.add(inv)
        s.flush()
        return inv.id


def _warnings(run_id: str) -> list[tuple[str, str, str]]:
    with session_scope() as s:
        rows = s.execute(
            select(RunWarning)
            .where(RunWarning.run_id == uuid.UUID(run_id))
            .order_by(RunWarning.created_at, RunWarning.id)
        ).scalars()
        return [(w.source_kind, w.name, w.reason) for w in rows]


def _events(run_id: str) -> list[RunEvent]:
    with session_scope() as s:
        return list(
            s.execute(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.id))
            .scalars()
            .all()
        )


def _grants(*ids, access: str | None = None) -> dict:
    grants = [{"id": str(i), **({"access": access} if access else {})} for i in ids]
    return {"tvashtr": {"connectors": grants}}


def test_connectors_mcp_url_is_the_proxy_address_with_no_trailing_slash(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "public_base_url", "https://tvashtr.fly.dev/")
    monkeypatch.setattr(settings, "agent_sandbox_mode", "fly")
    assert connectors_mcp_url() == "https://tvashtr.fly.dev/mcp/connectors"
    assert domains_mcp_url() == "https://tvashtr.fly.dev/mcp/domains"

    # The same helper as Domains: in docker mode a localhost base is rewritten to the docker host.
    monkeypatch.setattr(settings, "public_base_url", "http://127.0.0.1:8000")
    monkeypatch.setattr(settings, "agent_sandbox_mode", "docker")
    monkeypatch.setattr(settings, "litellm_proxy_host_docker", "host.docker.internal")
    assert connectors_mcp_url() == "http://host.docker.internal:8000/mcp/connectors"
    monkeypatch.setattr(settings, "public_base_url", "")
    assert connectors_mcp_url() == "http://host.docker.internal:8000/mcp/connectors"


def test_without_a_connectors_grant_the_config_is_what_it_was(local_base):
    owner = _user()
    run_id = _run(owner)
    _connection(owner)  # connected, but this agent has no grant for it
    inline = {"mcpServers": {"fetch": {"command": "uvx", "args": ["mcp-server-fetch"]}}}

    assert build_mcp_config(None, run_id, node_id=str(uuid.uuid4())) == {}
    assert build_mcp_config(inline, run_id, node_id=str(uuid.uuid4())) == inline
    for empty in ([], None, "nope", {}):
        config = {**inline, "tvashtr": {"connectors": empty}}
        assert build_mcp_config(config, run_id) == inline
    assert _warnings(run_id) == [] and _events(run_id) == []


def test_a_grant_becomes_one_proxy_server_with_a_run_token(local_base):
    owner = _user()
    run_id = _run(owner)
    node = _node(run_id)
    cid = _connection(owner)

    out = build_mcp_config(_grants(cid), run_id, node_id=str(node))

    assert set(out) == {"mcpServers"} and set(out["mcpServers"]) == {"linear"}
    server = out["mcpServers"]["linear"]
    assert set(server) == {"url", "headers"} and server["url"] == PROXY_URL
    assert set(server["headers"]) == {"Authorization"}
    scheme, token = server["headers"]["Authorization"].split(" ")
    assert scheme == "Bearer"
    assert read_run_token(token) == RunGrant(
        run_id=run_id, node_id=str(node), connection_id=cid, access="read"
    )
    assert _warnings(run_id) == [] and _events(run_id) == []

    # The grant's access travels in the token; anything but "write" is read.
    for access, signed in (("write", "write"), ("read", "read"), ("admin", "read")):
        out = build_mcp_config(_grants(cid, access=access), run_id, node_id=str(node))
        token = out["mcpServers"]["linear"]["headers"]["Authorization"].removeprefix("Bearer ")
        assert read_run_token(token).access == signed
    # A caller that passes no node (older call sites) still gets a token, naming no agent.
    token = build_mcp_config(_grants(cid), run_id)["mcpServers"]["linear"]["headers"][
        "Authorization"
    ].removeprefix("Bearer ")
    assert read_run_token(token).node_id is None


def test_the_provider_credential_never_enters_the_config(local_base, monkeypatch):
    owner = _user()
    run_id = _run(owner)
    key = _connection(owner)
    oauth = _connection(
        owner, connector_key="sentry", name="Sentry", slug="sentry", auth_kind="oauth"
    )
    with session_scope() as s:
        connectors.write_secret(
            s.get(ConnectorConnection, key), {"headers": {"Authorization": "Bearer KEY-PLAINTEXT"}}
        )
        connectors.write_secret(
            s.get(ConnectorConnection, oauth),
            {"access_token": "ACCESS-PLAINTEXT", "refresh_token": "REFRESH-PLAINTEXT"},
        )
    monkeypatch.setattr(
        connector_oauth, "ensure_access_token", lambda cid, **kw: "ACCESS-PLAINTEXT"
    )

    out = build_mcp_config(_grants(key, oauth), run_id)

    assert list(out["mcpServers"]) == ["linear", "sentry"]
    flat = repr(out)
    for secret in ("KEY-PLAINTEXT", "ACCESS-PLAINTEXT", "REFRESH-PLAINTEXT", "mcp.linear.app"):
        assert secret not in flat
    assert {server["url"] for server in out["mcpServers"].values()} == {PROXY_URL}


def test_connectors_come_after_inline_and_library_servers_and_before_domains(local_base):
    owner = _user()
    run_id = _run(owner)
    cid = _connection(owner)
    second = _connection(owner, connector_key="sentry", name="Sentry", slug="sentry")
    library = node_library.create_owner_tool(owner, "libfetch", {"command": "lib-cmd"})
    config = {
        "mcpServers": {"fetch": {"command": "uvx"}},
        "tvashtr": {
            "library": [str(library)],
            "domains": True,
            "connectors": [{"id": str(second)}, {"id": str(cid)}, {"id": str(second)}],
        },
    }
    out = build_mcp_config(config, run_id)
    # Grants in their own order; a connection named twice is one server.
    assert list(out["mcpServers"]) == ["libfetch", "fetch", "sentry", "linear", "tvashtr-domains"]


def test_a_slug_an_inline_or_library_server_already_has_becomes_conn_slug(local_base):
    owner = _user()
    run_id = _run(owner)
    cid = _connection(owner)
    sentry = _connection(owner, connector_key="sentry", name="Sentry", slug="sentry")
    node_library.create_owner_tool(owner, "sentry", {"command": "lib-cmd"})
    library = node_library.create_owner_tool(owner, "sentry-lib", {"command": "lib-cmd"})
    inline = {"url": "https://example.test/mcp"}
    config = {
        "mcpServers": {"linear": inline, "sentry": {"command": "x"}},
        "tvashtr": {
            "library": [str(library)],
            # Switched off for this agent: its name is still taken, so tool names stay stable.
            "servers": {"sentry": {"enabled": False}},
            "connectors": [{"id": str(cid)}, {"id": str(sentry)}],
        },
    }
    out = build_mcp_config(config, run_id)["mcpServers"]
    assert list(out) == ["sentry-lib", "linear", "conn-linear", "conn-sentry"]
    assert out["linear"] == inline  # the node's own server is untouched
    assert out["conn-linear"]["url"] == PROXY_URL and out["conn-sentry"]["url"] == PROXY_URL

    # A connection whose slug is the Domains server's name must not switch Domains off.
    domains = _connection(owner, connector_key="custom:x", name="D", slug="tvashtr-domains")
    out = build_mcp_config(
        {"tvashtr": {"domains": True, "connectors": [{"id": str(domains)}]}}, run_id
    )["mcpServers"]
    assert list(out) == ["conn-tvashtr-domains", "tvashtr-domains"]
    assert "Cookie" in out["tvashtr-domains"]["headers"]


def test_a_connector_never_takes_a_name_that_is_in_use(local_base):
    owner = _user()
    run_id = _run(owner)
    linear = _connection(owner)
    other = _connection(owner, connector_key="custom:x", name="Other", slug="conn-linear")
    mine = {"url": "https://mine.example/mcp"}
    inline = {"linear": {"url": "https://a.example/mcp"}, "conn-linear": mine}

    # The node has servers called both ``linear`` and ``conn-linear``: the prefix is added again.
    out = build_mcp_config(
        {"mcpServers": inline, "tvashtr": {"connectors": [{"id": str(linear)}]}}, run_id
    )["mcpServers"]
    assert list(out) == ["linear", "conn-linear", "conn-conn-linear"]
    assert out["conn-linear"] == mine  # the node's own server is still there
    assert out["conn-conn-linear"]["url"] == PROXY_URL

    # Two connectors: the name one was given is taken for the next.
    out = build_mcp_config(
        {
            "mcpServers": {"linear": {"url": "https://a.example/mcp"}},
            "tvashtr": {"connectors": [{"id": str(linear)}, {"id": str(other)}]},
        },
        run_id,
    )["mcpServers"]
    assert list(out) == ["linear", "conn-linear", "conn-conn-linear"]
    tokens = [
        out[name]["headers"]["Authorization"].removeprefix("Bearer ") for name in list(out)[1:]
    ]
    assert [read_run_token(token).connection_id for token in tokens] == [linear, other]
    assert _warnings(run_id) == []


def test_a_grant_that_names_no_connection_of_the_owner_is_skipped_as_disconnected(local_base):
    owner, other = _user(), _user()
    run_id = _run(owner)
    node = _node(run_id)
    invocation = _invocation(run_id, node)
    good = _connection(owner)
    foreign = _connection(other, connector_key="notion", name="Notion (theirs)", slug="notion")
    pending = _connection(
        owner, connector_key="sentry", name="Sentry", slug="sentry", status="pending"
    )
    config = {
        "tvashtr": {
            "connectors": [
                {"id": str(uuid.uuid4())},  # deleted
                {"id": str(foreign)},  # another account's
                {"id": str(pending)},  # never finished connecting
                {"id": "not-a-uuid"},
                {"access": "write"},
                "junk",
                {"id": str(good)},
            ]
        }
    }

    out = build_mcp_config(config, run_id, node_id=str(node))

    assert list(out["mcpServers"]) == ["linear"]
    # One warning (de-duplicated), naming nothing of another account's.
    assert _warnings(run_id) == [("connector", "a connector", "it was disconnected")]
    events = _events(run_id)
    assert len(events) == 6
    assert {e.kind for e in events} == {"connector_skipped"}
    assert {e.invocation_id for e in events} == {invocation}
    assert all(
        e.payload
        == {"connection_id": None, "connector": "a connector", "reason": "it was disconnected"}
        for e in events
    )
    # Their own band of ``seq``, one after another, clear of the engine's events.
    assert [e.seq for e in events] == [1_000_000_000 + n for n in range(6)]
    assert "theirs" not in repr([e.payload for e in events])


@pytest.mark.parametrize(
    ("auth_kind", "reason"),
    [("oauth", "its sign-in expired"), ("api_key", "its key stopped working")],
)
def test_a_connection_that_needs_a_sign_in_is_skipped(local_base, monkeypatch, auth_kind, reason):
    def no_token(*args, **kwargs):
        raise AssertionError("a connection that needs a sign-in is not asked for a token")

    monkeypatch.setattr(connector_oauth, "ensure_access_token", no_token)
    owner = _user()
    run_id = _run(owner)
    cid = _connection(owner, auth_kind=auth_kind, status="needs_signin", last_error="Old reason.")

    out = build_mcp_config(_grants(cid), run_id, node_id=str(_node(run_id)))

    assert out == {"mcpServers": {}}
    assert _warnings(run_id) == [("connector", "Linear", reason)]
    (event,) = _events(run_id)
    assert event.kind == "connector_skipped"
    assert event.payload == {"connection_id": str(cid), "connector": "Linear", "reason": reason}
    assert event.invocation_id is None and event.seq == 1_000_000_000  # no round is open yet
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        assert (row.status, row.last_error) == ("needs_signin", "Old reason.")


def test_a_refused_refresh_marks_the_row_and_skips_it(local_base, monkeypatch):
    asked: list = []

    def refused(connection_id, *, rejected=None):
        asked.append((connection_id, rejected))
        raise connector_oauth.SignInRefused("invalid_grant")

    monkeypatch.setattr(connector_oauth, "ensure_access_token", refused)
    owner = _user()
    run_id = _run(owner)
    cid = _connection(owner, auth_kind="oauth")
    key = _connection(owner, connector_key="sentry", name="Sentry", slug="sentry")

    out = build_mcp_config(_grants(cid, key), run_id)

    assert list(out["mcpServers"]) == ["sentry"]  # a key connection needs no token check
    assert asked == [(cid, None)]
    assert _warnings(run_id) == [("connector", "Linear", "its sign-in expired")]
    (event,) = _events(run_id)
    assert event.payload == {
        "connection_id": str(cid),
        "connector": "Linear",
        "reason": "its sign-in expired",
    }
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        assert (row.status, row.last_error) == ("needs_signin", "Its sign-in expired.")
        assert s.get(ConnectorConnection, key).status == "connected"


def test_a_token_endpoint_that_does_not_answer_skips_it_and_leaves_the_status(
    local_base, monkeypatch
):
    def unreachable(connection_id, *, rejected=None):
        raise connector_oauth.Unreachable("timeout")

    monkeypatch.setattr(connector_oauth, "ensure_access_token", unreachable)
    owner = _user()
    run_id = _run(owner)
    cid = _connection(owner, auth_kind="oauth")

    assert build_mcp_config(_grants(cid), run_id) == {"mcpServers": {}}
    assert _warnings(run_id) == [("connector", "Linear", SKIPPED)]
    (event,) = _events(run_id)
    assert event.payload == {"connection_id": str(cid), "connector": "Linear", "reason": SKIPPED}
    with session_scope() as s:
        row = s.get(ConnectorConnection, cid)
        assert (row.status, row.last_error) == ("connected", None)


def test_a_sign_in_that_cannot_even_be_read_skips_the_connector_and_the_run_goes_on(
    local_base, monkeypatch, caplog
):
    def broken(connection_id, *, rejected=None):
        raise ValueError("could not decrypt PLAINTEXT")  # a rotated secret key, say

    monkeypatch.setattr(connector_oauth, "ensure_access_token", broken)
    owner = _user()
    run_id = _run(owner)
    cid = _connection(owner, auth_kind="oauth")
    key = _connection(owner, connector_key="sentry", name="Sentry", slug="sentry")

    out = build_mcp_config(_grants(cid, key), run_id)

    assert list(out["mcpServers"]) == ["sentry"]
    assert _warnings(run_id) == [("connector", "Linear", SKIPPED)]
    (event,) = _events(run_id)
    assert event.payload == {"connection_id": str(cid), "connector": "Linear", "reason": SKIPPED}
    with session_scope() as s:
        assert s.get(ConnectorConnection, cid).status == "connected"
    assert "ValueError" in caplog.text and "PLAINTEXT" not in caplog.text  # the type only


def test_a_skip_belongs_to_the_round_that_is_running(local_base):
    owner = _user()
    run_id = _run(owner)
    node = _node(run_id)
    _invocation(run_id, node, 1)
    second = _invocation(run_id, node, 2)
    gone = _grants(uuid.uuid4())

    build_mcp_config(gone, run_id, node_id=str(node))
    build_mcp_config(gone, run_id, node_id=str(node))
    # A node id that names no round (or isn't an id at all) still records the skip.
    build_mcp_config(gone, run_id, node_id=str(uuid.uuid4()))
    build_mcp_config(gone, run_id, node_id="node-xyz")

    assert [(e.invocation_id, e.seq) for e in _events(run_id)] == [
        (second, 1_000_000_000),
        (second, 1_000_000_001),
        (None, 1_000_000_000),
        (None, 1_000_000_001),
    ]
    assert _warnings(run_id) == [("connector", "a connector", "it was disconnected")]


def test_record_skip_retries_a_seq_another_writer_took(local_base, monkeypatch):
    owner = _user()
    run_id = _run(owner)
    node = _node(run_id)
    invocation = _invocation(run_id, node)
    real = connector_proxy._next_seq
    stale = iter([1_000_000_000, 1_000_000_000])  # two writers read the same "next" number

    monkeypatch.setattr(
        connector_proxy, "_next_seq", lambda *args: next(stale, None) or real(*args)
    )
    connector_proxy.record_skip(run_id, str(node), None, "a connector", "it was disconnected")
    connector_proxy.record_skip(run_id, str(node), None, "a connector", "it was disconnected")

    assert [(e.invocation_id, e.seq) for e in _events(run_id)] == [
        (invocation, 1_000_000_000),
        (invocation, 1_000_000_001),
    ]


def test_the_desktop_plan_warning_counts_connectors():
    assert team_run._tool_names({"tvashtr": {"connectors": [{"id": "a"}, {"id": "b"}]}}) == [
        "2 connector(s)"
    ]
    assert team_run._tool_names(
        {
            "mcpServers": {"fetch": {}},
            "tvashtr": {"library": ["x"], "domains": True, "connectors": [{"id": "a"}]},
        }
    ) == ["fetch", "1 library tool(s)", "domains", "1 connector(s)"]
    for nothing in ([], None, "x"):
        assert team_run._tool_names({"tvashtr": {"connectors": nothing}}) == []


class _Recorder:
    name = "openhands"

    def __init__(self) -> None:
        self.tasks: list = []

    def run(self, task, on_event=None):
        self.tasks.append(task)
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=[])


def test_the_agent_step_hands_its_node_to_build_mcp_config(
    client, local_base, tmp_path, monkeypatch
):
    owner = auth_user_id()
    run_id = _run(owner)
    node = _node(run_id)
    cid = _connection(owner, slug=f"linear-{uuid.uuid4().hex[:8]}", connector_key=uuid.uuid4().hex)
    adapter = _Recorder()
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: adapter)
    monkeypatch.setattr(get_settings(), "litellm_proxy_enabled", False)
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)

    team_run.agent_run_step(
        run_id, "do the thing", "openai/gpt-4o-mini", 1, "idea", "spec", str(tmp_path), None,
        None, False, 100_000, 7, node_id=str(node), tool_config=_grants(cid, access="write"),
    )  # fmt: skip

    (server,) = adapter.tasks[0].mcp_config["mcpServers"].values()
    assert server["url"] == PROXY_URL
    assert read_run_token(server["headers"]["Authorization"].removeprefix("Bearer ")) == RunGrant(
        run_id=run_id, node_id=str(node), connection_id=cid, access="write"
    )

"""Connectors: the proxy core (stream B3.3). ``proxy_list_tools`` and ``proxy_call_tool`` against
an in-memory provider: the read-only rule, the credential added on the server, the one refresh a
401 gets, what is recorded, and that none of the sync work runs on the event loop.

``connectors.upstream_target`` belongs to stream B1.5 (a stub here), so these tests put in a double
that does what the contract says it does: the entry's read-only parameters at access ``read``.

Contract: ``docs/superpowers/plans/api/connectors.md`` (The proxy, ``connector_call`` events)."""

import asyncio
import logging
import threading
import uuid
from urllib.parse import urlencode

import anyio
import pytest
from mcp import McpError
from mcp.types import CallToolResult, ErrorData, TextContent, Tool, ToolAnnotations
from sqlalchemy import select

from tvashtr.control_plane import (
    connector_catalog,
    connector_oauth,
    connector_proxy,
    connector_upstream,
    connectors,
)
from tvashtr.control_plane.connector_proxy import RunGrant, proxy_call_tool, proxy_list_tools
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    ConnectorConnection,
    Run,
    RunEvent,
    RunWarning,
    User,
)

BAND = 1_000_000_000
READ_ONLY_ERROR = "Linear is read only for this agent. create_issue can change data, so it’s off."


def _tool(name: str, read_only: bool | None = None, **fields) -> Tool:
    annotations = ToolAnnotations(readOnlyHint=read_only) if read_only is not None else None
    return Tool(name=name, inputSchema={"type": "object"}, annotations=annotations, **fields)


TOOLS = [
    _tool("list_issues", True),
    _tool("get_issue", True),
    _tool("create_issue"),  # no annotation: a write
    _tool("run_sql"),
    _tool("delete_issue", False),
]
READS = ["list_issues", "get_issue"]
ALL = [tool.name for tool in TOOLS]


class FakeUpstream:
    """The provider, in memory. ``fail`` holds what the next requests raise, in order."""

    def __init__(self, tools: list[Tool] | None = None) -> None:
        self.tools = TOOLS if tools is None else tools
        self.lists: list[tuple] = []
        self.calls: list[tuple] = []
        self.fail: list[Exception] = []
        self.hang = False
        self.result = CallToolResult(content=[TextContent(type="text", text="3 issues")])

    async def list_tools(self, url, transport, headers, timeout=10):
        self.lists.append((url, transport, dict(headers or {})))
        if self.hang:
            await anyio.sleep_forever()
        if self.fail:
            raise self.fail.pop(0)
        return list(self.tools)

    async def call_tool(self, url, transport, headers, name, arguments, timeout=120):
        self.calls.append((url, transport, dict(headers or {}), name, arguments))
        if self.fail:
            raise self.fail.pop(0)
        return self.result


@pytest.fixture(autouse=True)
def _proxy_seams(monkeypatch):
    def target(row, access):
        entry = connector_catalog.resolve(row.connector_key) or {}
        params = entry.get("read_only_params") if access == "read" else None
        return (f"{row.url}?{urlencode(params)}" if params else row.url), row.transport

    monkeypatch.setattr(connectors, "upstream_target", target)
    connector_proxy._read_only_hints.clear()


def _user() -> uuid.UUID:
    with session_scope() as s:
        u = User(email=f"conn-{uuid.uuid4().hex}@tvashtr.local", password_hash="x")
        s.add(u)
        s.flush()
        return u.id


def _grant(token_access: str = "read", /, **over) -> RunGrant:
    """A key connection (Linear unless ``over`` says otherwise) of a fresh account, a running run
    of that account with one open round, and the grant a run token for them would read back to
    (``token_access`` is the token's access; ``access=`` in ``over`` is the connection's)."""
    owner = _user()
    run_id = uuid.uuid4()
    fields = {
        "owner_id": owner,
        "connector_key": "linear",
        "name": "Linear",
        "slug": "linear",
        "url": "https://mcp.linear.app/mcp",
        "auth_kind": "api_key",
        "status": "connected",
    }
    with session_scope() as s:
        graph = uuid.UUID(build_two_node_team())
        s.add(
            Run(
                id=run_id,
                team_graph_id=graph,
                owner_id=owner,
                idea="x",
                workflow_id=str(run_id),
                status="running",
            )
        )
        node = s.execute(
            select(AgentNode.id).where(AgentNode.team_graph_id == graph, AgentNode.kind == "agent")
        ).scalar_one()
        s.add(AgentInvocation(run_id=str(run_id), node_id=node, iteration=1, status="running"))
        row = ConnectorConnection(**{**fields, **over})
        if row.auth_kind == "api_key":
            connectors.write_secret(row, {"headers": {"Authorization": "Bearer KEY-PLAINTEXT"}})
        s.add(row)
        s.flush()
        return RunGrant(
            run_id=str(run_id), node_id=str(node), connection_id=row.id, access=token_access
        )


def _row(grant: RunGrant) -> ConnectorConnection:
    with session_scope() as s:
        return s.get(ConnectorConnection, grant.connection_id)


def _set(grant: RunGrant, **values) -> None:
    with session_scope() as s:
        row = s.get(ConnectorConnection, grant.connection_id)
        for key, value in values.items():
            setattr(row, key, value)


def _events(grant: RunGrant, kind: str = "connector_call") -> list[RunEvent]:
    with session_scope() as s:
        return list(
            s.execute(
                select(RunEvent)
                .where(RunEvent.run_id == grant.run_id, RunEvent.kind == kind)
                .order_by(RunEvent.seq)
            ).scalars()
        )


def _warnings(grant: RunGrant) -> list[tuple[str, str, str]]:
    with session_scope() as s:
        rows = s.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(grant.run_id)))
        return [(w.source_kind, w.name, w.reason) for w in rows.scalars()]


def _list(grant: RunGrant, upstream: FakeUpstream) -> list[str]:
    return [tool.name for tool in asyncio.run(proxy_list_tools(grant, upstream))]


def _call(grant: RunGrant, upstream: FakeUpstream, name: str, arguments: dict | None = None):
    return asyncio.run(proxy_call_tool(grant, name, arguments or {}, upstream))


def _text(result: CallToolResult) -> str:
    return "".join(block.text for block in result.content)


def _oauth(monkeypatch, tokens: dict | None = None) -> list[tuple]:
    """Patch ``ensure_access_token``: the token for each ``rejected`` value. Returns the calls."""
    asked: list[tuple] = []
    tokens = tokens or {None: "T1", "T1": "T2"}

    def fake(connection_id, *, rejected=None):
        asked.append((connection_id, rejected))
        return tokens[rejected]

    monkeypatch.setattr(connector_oauth, "ensure_access_token", fake)
    return asked


# ---- tools/list: what an agent is offered ----


def test_read_access_lists_only_the_annotated_reads_and_write_access_lists_all():
    upstream = FakeUpstream()
    read = _grant("read")
    assert _list(read, upstream) == READS
    # Gate 1 is the connection, gate 2 the grant: write needs both.
    assert _list(_grant("write"), upstream) == READS  # the connection is read only
    assert _list(_grant("read", access="write"), upstream) == READS  # the grant is
    assert _list(_grant("write", access="write"), upstream) == ALL
    # The provider got the stored key, added here; nothing was recorded for a list.
    assert upstream.lists[0] == (
        "https://mcp.linear.app/mcp",
        "streamable-http",
        {"Authorization": "Bearer KEY-PLAINTEXT"},
    )
    assert _events(read) == [] and _warnings(read) == []


def test_a_provider_flag_entry_in_read_mode_lists_everything_on_the_read_only_address():
    upstream = FakeUpstream()
    supabase = {
        "connector_key": "supabase",
        "name": "Supabase",
        "url": "https://mcp.supabase.com/mcp",
    }
    grant = _grant("read", **supabase)

    assert _list(grant, upstream) == ALL  # Supabase enforces its own flag
    result = _call(grant, upstream, "run_sql", {"query": "select 1"})

    assert not result.isError
    assert upstream.lists[0][0] == "https://mcp.supabase.com/mcp?read_only=true"
    assert upstream.calls[0][0] == "https://mcp.supabase.com/mcp?read_only=true"
    (event,) = _events(grant)
    assert (event.payload["write"], event.payload["ok"]) == (False, True)

    # In write mode the flag is gone and the annotation decides what counts as a write.
    write = _grant("write", access="write", **supabase)
    assert _list(write, upstream) == ALL
    _call(write, upstream, "run_sql", {"query": "delete from t"})
    assert upstream.calls[1][0] == "https://mcp.supabase.com/mcp"
    assert _events(write)[0].payload["write"] is True


def test_neon_in_read_mode_gets_its_flag_and_still_hides_and_blocks_an_unannotated_run_sql():
    upstream = FakeUpstream()
    grant = _grant("read", connector_key="neon", name="Neon", url="https://mcp.neon.tech/mcp")

    assert _list(grant, upstream) == READS
    assert upstream.lists[0][0] == "https://mcp.neon.tech/mcp?readonly=true"

    blocked = _call(grant, upstream, "run_sql", {"sql": "drop table t"})
    assert blocked.isError
    assert _text(blocked) == (
        "Neon is read only for this agent. run_sql can change data, so it’s off."
    )
    assert upstream.calls == []  # never forwarded

    allowed = _call(grant, upstream, "list_issues")
    assert not allowed.isError
    assert upstream.calls[0][0] == "https://mcp.neon.tech/mcp?readonly=true"


def test_descriptions_are_capped_and_output_schemas_dropped():
    schema = {"type": "object", "properties": {"rows": {"type": "array"}}}
    upstream = FakeUpstream(
        [
            _tool("long", True, description="x" * 5000, outputSchema=schema, title="Long"),
            _tool("short", True, description="Lists things."),
            _tool("bare", True),
        ]
    )
    long, short, bare = asyncio.run(proxy_list_tools(_grant(), upstream))
    assert long.description == "x" * 2000 and long.outputSchema is None
    # Everything else about a tool is the provider's.
    assert (long.title, long.inputSchema, long.annotations.readOnlyHint) == (
        "Long",
        {"type": "object"},
        True,
    )
    assert short.description == "Lists things." and bare.description is None


@pytest.mark.parametrize(
    "error",
    [
        connector_upstream.UpstreamUnreachable("connection refused"),
        connector_upstream.UpstreamRefused(403),
        McpError(ErrorData(code=-32603, message="boom")),
    ],
)
def test_a_list_the_provider_does_not_answer_is_empty_with_a_skip(error):
    upstream = FakeUpstream()
    upstream.fail = [error]
    grant = _grant()

    assert (
        _list(grant, upstream) == []
    )  # never an error: one failing server must not stop the agent
    assert _warnings(grant) == [("connector", "Linear", "we couldn’t reach it")]
    (event,) = _events(grant, "connector_skipped")
    assert event.payload == {
        "connection_id": str(grant.connection_id),
        "connector": "Linear",
        "reason": "we couldn’t reach it",
    }
    assert _row(grant).status == "connected"


def test_a_list_that_never_answers_returns_empty_within_the_cap(monkeypatch):
    monkeypatch.setattr(connector_proxy, "LIST_TIMEOUT_SECONDS", 0.05)
    upstream = FakeUpstream()
    upstream.hang = True
    grant = _grant()

    async def timed() -> list:
        with anyio.fail_after(2):
            return await proxy_list_tools(grant, upstream)

    assert asyncio.run(timed()) == []
    assert _warnings(grant) == [("connector", "Linear", "we couldn’t reach it")]
    assert len(_events(grant, "connector_skipped")) == 1


def test_a_connection_that_is_gone_or_needs_a_sign_in_lists_nothing_and_fails_calls():
    upstream = FakeUpstream()
    gone = _grant()
    with session_scope() as s:
        s.delete(s.get(ConnectorConnection, gone.connection_id))
    assert _list(gone, upstream) == []
    result = _call(gone, upstream, "list_issues")
    assert result.isError and _text(result) == "This connector isn’t available for this run."
    assert _events(gone) == [] and _warnings(gone) == []

    expired = _grant(status="needs_signin", last_error="Its key stopped working.")
    assert _list(expired, upstream) == []
    result = _call(expired, upstream, "list_issues")
    assert result.isError and _text(result) == "Linear needs you to sign in again."
    assert upstream.lists == [] and upstream.calls == []  # the provider is never asked
    assert _warnings(expired) == [("connector", "Linear", "its key stopped working")]
    (event,) = _events(expired)
    assert (event.payload["ok"], event.payload["blocked"]) == (False, False)


# ---- tools/call: the read-only rule ----


def test_a_blocked_write_returns_the_contracts_error_and_is_recorded_blocked():
    upstream = FakeUpstream()
    grant = _grant("read")
    assert _list(grant, upstream) == READS

    result = _call(grant, upstream, "create_issue", {"title": "Ship it", "team": "ENG"})

    assert result.isError and _text(result) == READ_ONLY_ERROR
    assert upstream.calls == []
    (event,) = _events(grant)
    assert event.seq == BAND and event.invocation_id is not None
    assert event.payload == {
        "connection_id": str(grant.connection_id),
        "connector": "Linear",
        "slug": "linear",
        "tool": "create_issue",
        "write": True,
        "ok": False,
        "blocked": True,
        "arg": "Ship it",
        "duration_ms": event.payload["duration_ms"],
        "result_url": None,
    }
    assert isinstance(event.payload["duration_ms"], int) and event.payload["duration_ms"] >= 0
    # A tool marked ``readOnlyHint: false`` and one the provider doesn't have are writes too.
    for name in ("delete_issue", "no_such_tool"):
        assert _call(grant, upstream, name).isError
    assert upstream.calls == []
    assert [e.payload["blocked"] for e in _events(grant)] == [True, True, True]
    assert _warnings(grant) == [] and _row(grant).status == "connected"


def test_an_allowed_call_is_forwarded_with_the_credential_and_returned_as_is():
    upstream = FakeUpstream()
    upstream.result = CallToolResult(
        content=[TextContent(type="text", text="3 issues")],
        structuredContent={"issues": [1, 2, 3]},
    )
    grant = _grant("read")
    arguments = {"limit": 3, "query": "is:open"}

    result = _call(grant, upstream, "list_issues", arguments)

    assert result is upstream.result
    assert upstream.calls == [
        (
            "https://mcp.linear.app/mcp",
            "streamable-http",
            {"Authorization": "Bearer KEY-PLAINTEXT"},
            "list_issues",
            arguments,
        )
    ]
    (event,) = _events(grant)
    assert event.payload == {
        "connection_id": str(grant.connection_id),
        "connector": "Linear",
        "slug": "linear",
        "tool": "list_issues",
        "write": False,
        "ok": True,
        "blocked": False,
        "arg": "is:open",
        "duration_ms": event.payload["duration_ms"],
        "result_url": None,
    }


def test_a_call_for_a_tool_the_proxy_has_not_seen_listed_asks_the_provider_first():
    upstream = FakeUpstream()
    grant = _grant("read")  # no tools/list on this process yet (a restart, another machine)

    assert not _call(grant, upstream, "list_issues").isError
    assert _call(grant, upstream, "create_issue").isError
    assert not _call(grant, upstream, "get_issue").isError

    assert len(upstream.lists) == 1  # one listing told it about all three
    assert [call[3] for call in upstream.calls] == ["list_issues", "get_issue"]


def test_the_rows_access_narrowed_mid_run_wins_over_the_token():
    upstream = FakeUpstream()
    grant = _grant("write", access="write")
    assert _list(grant, upstream) == ALL
    assert not _call(grant, upstream, "create_issue", {"title": "One"}).isError

    _set(grant, access="read")  # PATCH access: read, while the run is going

    assert _list(grant, upstream) == READS
    result = _call(grant, upstream, "create_issue", {"title": "Two"})
    assert result.isError and _text(result) == READ_ONLY_ERROR
    assert [call[4] for call in upstream.calls] == [{"title": "One"}]
    assert [(e.payload["ok"], e.payload["blocked"]) for e in _events(grant)] == [
        (True, False),
        (False, True),
    ]


def test_a_write_records_the_first_https_address_of_its_result():
    upstream = FakeUpstream()
    upstream.result = CallToolResult(
        content=[
            TextContent(type="text", text="Created LIN-214 (http://insecure.example/x),"),
            TextContent(type="text", text='see "https://linear.app/acme/issue/LIN-214". Also'),
            TextContent(type="text", text="https://linear.app/acme/second"),
        ]
    )
    grant = _grant("write", access="write")

    _call(grant, upstream, "create_issue", {"team": "ENG", "title": "T" * 500})
    _call(grant, upstream, "list_issues", {"limit": 5})  # a read: no address kept, no string
    upstream.result = CallToolResult(content=[TextContent(type="text", text="ok, no link")])
    _call(grant, upstream, "create_issue", {"name": "by name", "note": "n", "q": "by q"})
    upstream.result = CallToolResult(
        content=[TextContent(type="text", text="failed https://linear.app/x")], isError=True
    )
    failed = _call(grant, upstream, "create_issue", {"description": "first string"})

    assert failed is upstream.result  # a failing tool is the provider's answer, passed on
    events = _events(grant)
    assert [e.seq for e in events] == [BAND, BAND + 1, BAND + 2, BAND + 3]  # distinct, in order
    assert len({e.invocation_id for e in events}) == 1
    assert [(e.payload["write"], e.payload["ok"], e.payload["result_url"]) for e in events] == [
        (True, True, "https://linear.app/acme/issue/LIN-214"),
        (False, True, None),
        (True, True, None),
        (True, False, None),
    ]
    # ``arg``: the first of query, sql, q, title, name; else the first string; at most 200 long.
    assert [e.payload["arg"] for e in events] == ["T" * 200, None, "by q", "first string"]


# ---- the provider's answers: only a 401 means "sign in again" ----


def test_a_401_gets_one_refresh_and_one_retry(monkeypatch):
    asked = _oauth(monkeypatch)
    upstream = FakeUpstream()
    grant = _grant("read", auth_kind="oauth")
    assert _list(grant, upstream) == READS
    upstream.fail = [connector_upstream.UpstreamUnauthorized()]

    result = _call(grant, upstream, "list_issues")

    assert result is upstream.result
    assert [call[2] for call in upstream.calls] == [
        {"Authorization": "Bearer T1"},
        {"Authorization": "Bearer T2"},
    ]
    # One token for the list, one for the call, and one refresh naming the token that was refused.
    assert asked == [(grant.connection_id, None)] * 2 + [(grant.connection_id, "T1")]
    assert _row(grant).status == "connected" and _warnings(grant) == []
    assert [e.payload["ok"] for e in _events(grant)] == [True]


def test_a_401_that_survives_the_refresh_means_sign_in_again(monkeypatch):
    asked = _oauth(monkeypatch)
    upstream = FakeUpstream()
    grant = _grant("read", auth_kind="oauth")
    assert _list(grant, upstream) == READS
    upstream.fail = [connector_upstream.UpstreamUnauthorized()] * 3

    result = _call(grant, upstream, "list_issues")

    assert result.isError and _text(result) == "Linear needs you to sign in again."
    assert len(upstream.calls) == 2 and len(upstream.fail) == 1  # one retry, not two
    assert asked[-1] == (grant.connection_id, "T1")
    row = _row(grant)
    assert (row.status, row.last_error) == ("needs_signin", "Its sign-in expired.")
    assert _warnings(grant) == [("connector", "Linear", "its sign-in expired")]
    (skip,) = _events(grant, "connector_skipped")
    assert skip.payload["reason"] == "its sign-in expired"
    (event,) = _events(grant)
    assert (event.payload["ok"], event.payload["blocked"]) == (False, False)


def test_a_refresh_that_is_refused_or_unreachable(monkeypatch):
    upstream = FakeUpstream()

    def refused(connection_id, *, rejected=None):
        raise connector_oauth.SignInRefused("invalid_grant")

    monkeypatch.setattr(connector_oauth, "ensure_access_token", refused)
    grant = _grant("read", auth_kind="oauth")
    assert _list(grant, upstream) == []
    assert _row(grant).status == "needs_signin"
    assert _warnings(grant) == [("connector", "Linear", "its sign-in expired")]

    def unreachable(connection_id, *, rejected=None):
        raise connector_oauth.Unreachable("timeout")

    monkeypatch.setattr(connector_oauth, "ensure_access_token", unreachable)
    grant = _grant("read", auth_kind="oauth")
    result = _call(grant, upstream, "list_issues")
    assert result.isError and _text(result) == "We couldn’t reach Linear. Try again."
    assert _row(grant).status == "connected"  # not reaching the token endpoint changes nothing
    assert _warnings(grant) == [("connector", "Linear", "we couldn’t reach it")]
    assert upstream.lists == [] and upstream.calls == []


def test_a_key_the_provider_stops_taking_is_not_retried():
    upstream = FakeUpstream()
    grant = _grant("read")
    assert _list(grant, upstream) == READS
    upstream.fail = [connector_upstream.UpstreamUnauthorized()]

    result = _call(grant, upstream, "list_issues")

    assert result.isError and _text(result) == "Linear needs you to sign in again."
    assert len(upstream.calls) == 1  # a key can't be refreshed
    row = _row(grant)
    assert (row.status, row.last_error) == ("needs_signin", "Its key stopped working.")
    assert _warnings(grant) == [("connector", "Linear", "its key stopped working")]


def test_a_403_is_a_tool_error_and_changes_nothing(monkeypatch):
    asked = _oauth(monkeypatch)
    upstream = FakeUpstream()
    grant = _grant("read", auth_kind="oauth")
    assert _list(grant, upstream) == READS
    upstream.fail = [connector_upstream.UpstreamRefused(403)]

    result = _call(grant, upstream, "list_issues")

    assert result.isError and _text(result) == "Linear refused the request (403)."
    assert len(upstream.calls) == 1
    # No refresh: ``ensure_access_token`` was never asked about a rejected token.
    assert [rejected for _cid, rejected in asked] == [None, None]
    row = _row(grant)
    assert (row.status, row.last_error) == ("connected", None)
    assert _warnings(grant) == [] and _events(grant, "connector_skipped") == []
    (event,) = _events(grant)
    assert (event.payload["ok"], event.payload["blocked"]) == (False, False)


def test_a_call_the_provider_does_not_answer_or_answers_with_an_error():
    upstream = FakeUpstream()
    grant = _grant("read")
    assert _list(grant, upstream) == READS

    upstream.fail = [connector_upstream.UpstreamUnreachable("timed out")]
    result = _call(grant, upstream, "list_issues")
    assert result.isError and _text(result) == "We couldn’t reach Linear. Try again."
    assert _warnings(grant) == [("connector", "Linear", "we couldn’t reach it")]
    assert _row(grant).status == "connected"

    upstream.fail = [McpError(ErrorData(code=-32602, message="Unknown tool: list_issues"))]
    result = _call(grant, upstream, "list_issues")
    assert result.isError
    assert _text(result) == "Linear answered an error: Unknown tool: list_issues"
    assert [e.payload["ok"] for e in _events(grant)] == [False, False]


# ---- never on the event loop, never the credential ----


def test_token_and_record_work_runs_on_a_thread_that_is_not_the_loops(monkeypatch):
    threads: dict[str, int] = {}
    real_record = connector_proxy.record_call

    def fake_token(connection_id, *, rejected=None):
        threads["token"] = threading.get_ident()
        return "T1"

    def fake_record(*args, **kwargs):
        threads["record"] = threading.get_ident()
        real_record(*args, **kwargs)

    monkeypatch.setattr(connector_oauth, "ensure_access_token", fake_token)
    monkeypatch.setattr(connector_proxy, "record_call", fake_record)
    upstream = FakeUpstream()
    grant = _grant("read", auth_kind="oauth")

    async def on_loop() -> None:
        threads["loop"] = threading.get_ident()
        await proxy_call_tool(grant, "list_issues", {}, upstream)

    asyncio.run(on_loop())

    assert set(threads) == {"loop", "token", "record"}
    assert threads["token"] != threads["loop"] and threads["record"] != threads["loop"]
    assert len(_events(grant)) == 1


def test_a_record_that_cannot_be_written_does_not_lose_the_providers_answer(monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("database is down")

    monkeypatch.setattr(connector_proxy, "record_call", broken)
    upstream = FakeUpstream()
    assert _call(_grant("read"), upstream, "list_issues") is upstream.result


def test_the_provider_credential_is_never_returned_recorded_or_logged(monkeypatch, caplog):
    _oauth(monkeypatch, {None: "ACCESS-PLAINTEXT", "ACCESS-PLAINTEXT": "SECOND-PLAINTEXT"})
    caplog.set_level(logging.DEBUG)
    for grant in (_grant("read"), _grant("read", auth_kind="oauth")):
        upstream = FakeUpstream()
        answers = [_list(grant, upstream)]
        for error in (
            None,
            connector_upstream.UpstreamRefused(403),
            connector_upstream.UpstreamUnreachable("no route to https://mcp.linear.app/mcp"),
            connector_upstream.UpstreamUnauthorized(),
        ):
            upstream.fail = [error] if error else []
            answers.append(_call(grant, upstream, "list_issues", {"query": "q"}).model_dump())
        answers.append(_call(grant, upstream, "create_issue").model_dump())
        recorded = [
            e.payload
            for kind in ("connector_call", "connector_skipped")
            for e in _events(grant, kind)
        ]
        assert len(recorded) >= 6
        seen = repr((answers, recorded, _warnings(grant), _row(grant).last_error)) + caplog.text
        for secret in ("PLAINTEXT", "Bearer"):
            assert secret not in seen

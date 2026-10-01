"""Security S1 (A): an agent with Domains gets a run token, never the owner's login cookie.

The token names the run, the agent and the domains it may search; ``/mcp/domains`` accepts only
that token (as ``Authorization: Bearer``), refuses it once the run has ended, and takes the domains
from the token, never from a header."""

import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value
from tvashtr.control_plane import connector_proxy, domain_mcp, node_tools
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import Run


def _account() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domains-token-{uuid.uuid4().hex}@tvashtr.local"
    assert c.post(
        "/api/auth/register", json={"email": email, "password": "pw-domains-1"}
    ).is_success
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _domain(c: TestClient, name: str) -> str:
    resp = c.post("/api/domains", json={"name": name, "template": "support"})
    assert resp.status_code == 200, resp.text
    return resp.json()["domain_id"]


def _run(owner: uuid.UUID, status: str = "running") -> str:
    run_id = str(uuid.uuid4())
    with session_scope() as s:
        s.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner,
                idea="x",
                workflow_id=run_id,
                status=status,
            )
        )
    return run_id


def _end(run_id: str) -> None:
    with session_scope() as s:
        s.get(Run, uuid.UUID(run_id)).status = "completed"


def _server(run_id: str, domains) -> dict:
    out = build_mcp_config({"tvashtr": {"domains": domains}}, run_id, node_id=str(uuid.uuid4()))
    return out["mcpServers"]["tvashtr-domains"]


def _token(run_id: str, domains) -> str:
    scheme, _, token = _server(run_id, domains)["headers"]["Authorization"].partition(" ")
    assert scheme == "Bearer"
    return token


def _mcp(monkeypatch, headers: dict):
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    ctx = SimpleNamespace(
        request_context=SimpleNamespace(request=Request({"type": "http", "headers": raw}))
    )
    mcp = domain_mcp.create_domains_fastmcp()
    monkeypatch.setattr(mcp, "get_context", lambda: ctx)
    return mcp


def _ask(mcp, **ref) -> str:
    return str(asyncio.run(mcp.call_tool("domain_ask", {"question": "q", **ref})))


def test_a_domains_agent_never_gets_the_login():
    """Reproduce-first: every way of ticking Domains yields a Bearer run token and no login."""
    _, owner = _account()
    run_id = _run(owner)
    for domains in (True, {"enabled": True}, [str(uuid.uuid4())]):
        server = _server(run_id, domains)
        blob = json.dumps(server)
        assert SESSION_COOKIE_NAME not in blob
        assert "cookie" not in {k.lower() for k in server["headers"]}
        # The domains come from the token, never from a header.
        assert set(server["headers"]) == {"Authorization"}
        assert server["headers"]["Authorization"].startswith("Bearer ")


def test_the_token_names_the_agents_domains_and_keeps_the_all_domains_switch():
    _, owner = _account()
    run_id = _run(owner)
    a = str(uuid.uuid4())
    assert node_tools.read_domains_token(_token(run_id, [f" {a.upper()} "])) == (owner, {a})
    # Domains ticked with no list (``true`` or the dict form) = every domain the owner has.
    assert node_tools.read_domains_token(_token(run_id, True)) == (owner, None)
    assert node_tools.read_domains_token(_token(run_id, {"enabled": True})) == (owner, None)
    # An emptied list still gives no Domains tools at all.
    out = build_mcp_config({"tvashtr": {"domains": []}}, run_id)
    assert "tvashtr-domains" not in out["mcpServers"]


def test_an_ended_runs_token_is_refused(monkeypatch):
    c, owner = _account()
    _domain(c, "Support docs")
    run_id = _run(owner)
    token = _token(run_id, True)
    assert node_tools.read_domains_token(token) == (owner, None)
    _end(run_id)
    assert node_tools.read_domains_token(token) is None
    mcp = _mcp(monkeypatch, {"Authorization": f"Bearer {token}"})
    monkeypatch.setattr(domain_mcp, "ask_domain", lambda *a, **k: pytest.fail("searched"))
    with pytest.raises(Exception, match="authentication required"):
        _ask(mcp, domain="Support docs")
    tools = asyncio.run(mcp.list_tools())
    assert all("Domains you can search" not in t.description for t in tools)


def test_a_token_for_domain_a_cannot_search_domain_b(monkeypatch):
    c, owner = _account()
    a, b = _domain(c, "Support docs"), _domain(c, "Vendor contracts")
    token = _token(_run(owner), [a])
    # A header naming B can't widen the token.
    mcp = _mcp(monkeypatch, {"Authorization": f"Bearer {token}", "X-Tvashtr-Domains": b})
    used: list = []
    monkeypatch.setattr(
        domain_mcp,
        "ask_domain",
        lambda owner_id, did, q, **k: used.append(str(did)) or {"answer": "ok", "citations": []},
    )
    for ref in ({"domain_id": b}, {"domain": "Vendor contracts"}):
        with pytest.raises(Exception, match="Domains you can search: Support docs."):
            _ask(mcp, **ref)
    assert used == []
    _ask(mcp, domain="Support docs")
    assert used == [a]
    tools = asyncio.run(mcp.list_tools())
    assert all(t.description.endswith("Domains you can search: Support docs.") for t in tools)


def test_another_accounts_run_cannot_search_my_domains(monkeypatch):
    c, _ = _account()
    mine = _domain(c, "Support docs")
    _, stranger = _account()
    monkeypatch.setattr(domain_mcp, "ask_domain", lambda *a, **k: pytest.fail("searched"))
    for domains in ([mine], True):
        token = _token(_run(stranger), domains)
        mcp = _mcp(monkeypatch, {"Authorization": f"Bearer {token}"})
        for ref in ({"domain_id": mine}, {"domain": "Support docs"}):
            with pytest.raises(Exception, match="You can’t search any domains."):
                _ask(mcp, **ref)


def test_a_session_cookie_is_refused(monkeypatch):
    c, owner = _account()
    _domain(c, "Support docs")
    cookie = f"{SESSION_COOKIE_NAME}={make_session_cookie_value(str(owner))}"
    monkeypatch.setattr(domain_mcp, "ask_domain", lambda *a, **k: pytest.fail("searched"))
    for headers in ({"cookie": cookie}, {"Authorization": f"Bearer {cookie.split('=', 1)[1]}"}):
        mcp = _mcp(monkeypatch, headers)
        with pytest.raises(Exception, match="authentication required"):
            _ask(mcp, domain="Support docs")
        tools = asyncio.run(mcp.list_tools())
        assert all("Domains you can search" not in t.description for t in tools)


def test_connectors_and_domains_tokens_dont_cross(monkeypatch):
    _, owner = _account()
    run_id = _run(owner)
    domains_token = _token(run_id, True)
    connectors_token = connector_proxy.sign_run_token(run_id, None, uuid.uuid4(), "read")
    assert node_tools.read_domains_token(connectors_token) is None
    assert connector_proxy.read_run_token(domains_token) is None
    mcp = _mcp(monkeypatch, {"Authorization": f"Bearer {connectors_token}"})
    with pytest.raises(Exception, match="authentication required"):
        _ask(mcp, domain="anything")


_HTTP_PROBE = """
import asyncio, json, logging, os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from tvashtr.control_plane import domain_mcp
from tvashtr.mcp.domains import get_domains_mcp, mount_domains_mcp

logging.disable(logging.CRITICAL)
# The search itself is not under test: answer with the domain id it was asked for.
domain_mcp.retrieve_domain = lambda owner, did, query, top_k=None: {
    "citations": [{"domain": str(did)}], "latency_ms": 1}
domains = get_domains_mcp().streamable_http_app()


@asynccontextmanager
async def lifespan(app):
    async with domains.router.lifespan_context(domains):
        yield


app = FastAPI(lifespan=lifespan)
mount_domains_mcp(app, domains)


async def call(headers):
    http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers=headers)
    url = "http://127.0.0.1:8000/mcp/domains"
    async with http, streamable_http_client(url, http_client=http) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            res = await session.call_tool(
                "domain_retrieve", {"query": "q", "domain": os.environ["PROBE_DOMAIN"]})
            return [res.isError, " ".join(getattr(c, "text", "") for c in res.content)]


async def main():
    async with lifespan(app):
        out = {
            "cookie": await call({"cookie": os.environ["PROBE_COOKIE"]}),
            "bearer": await call({"authorization": "Bearer " + os.environ["PROBE_TOKEN"]}),
        }
    print(json.dumps(out))


asyncio.run(main())
"""


def test_the_real_mount_refuses_a_login_cookie_and_takes_the_run_token():
    """Review A1: through the real ``/mcp/domains`` mount and a real MCP client (in a subprocess,
    as tests/test_domain_mcp_http.py explains), the owner's login cookie is refused and the run's
    Bearer token reaches the owner's domain."""
    import os
    import subprocess
    import sys

    c, owner = _account()
    did = _domain(c, "Support docs")
    cookie = f"{SESSION_COOKIE_NAME}={make_session_cookie_value(str(owner))}"
    ran = subprocess.run(
        [sys.executable, "-c", _HTTP_PROBE],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        env={
            **os.environ,
            "PROBE_DOMAIN": "Support docs",
            "PROBE_COOKIE": cookie,
            "PROBE_TOKEN": _token(_run(owner), [did]),
        },
    )
    assert ran.returncode == 0, ran.stderr[-2000:]
    out = json.loads(ran.stdout.strip().splitlines()[-1])
    assert out["cookie"][0] is True and "authentication required" in out["cookie"][1]
    assert out["bearer"][0] is False and did in out["bearer"][1]

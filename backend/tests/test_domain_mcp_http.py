"""Phase 4b — /mcp/domains mount + its run-token gate (Security S1)."""

import json
import os
import subprocess
import sys
import uuid

from starlette.routing import Mount, Route

from tvashtr.auth import make_session_cookie_value
from tvashtr.control_plane.node_tools import read_domains_token
from tvashtr.main import app


def test_mcp_domains_mount_exists():
    # Assert mount registration without probing streamable HTTP (GET creates a
    # session transport and can tear down the shared TestClient/DBOS lifespan).
    assert any(getattr(r, "path", None) == "/mcp/domains" for r in app.routes)
    # Both forms of the address: the exact path agents are given (a route), and the mount for
    # everything under it. The probe below shows why both are needed.
    kinds = [type(r) for r in app.routes if getattr(r, "path", None) == "/mcp/domains"]
    assert kinds == [Route, Mount]


_PROBE = """
import asyncio, json, logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from tvashtr.mcp.domains import get_domains_mcp, mount_domains_mcp

logging.disable(logging.CRITICAL)
domains = get_domains_mcp().streamable_http_app()


@asynccontextmanager
async def lifespan(app):
    async with domains.router.lifespan_context(domains):
        yield


app = FastAPI(lifespan=lifespan)
mount_domains_mcp(app, domains)


@app.get("/{full_path:path}")  # what mount_frontend registers, last, in the hosted image
def spa(full_path: str):
    return {"spa": full_path}


INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "probe", "version": "0"},
    },
}
HEADERS = {"accept": "application/json, text/event-stream", "content-type": "application/json"}


def server_name(reply):
    # This server answers a POST with an event stream: the message is the ``data:`` line.
    for line in reply.text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:]).get("result", {}).get("serverInfo", {}).get("name")
    return None


async def main():
    out = {"posts": []}
    transport = httpx.ASGITransport(app=app)
    async with lifespan(app):
        for base in HOSTS:
            async with httpx.AsyncClient(transport=transport, base_url=base) as client:
                for path in ("/mcp/domains", "/mcp/domains/"):
                    reply = await client.post(path, json=INITIALIZE, headers=HEADERS)
                    out["posts"].append([base, path, reply.status_code, server_name(reply)])
                page = await client.get("/domains")
                out["posts"].append([base, "GET /domains", page.status_code, page.json()])
        # What it refuses: a Host that isn't one of ours, and a browser page from elsewhere.
        async with httpx.AsyncClient(transport=transport, base_url="https://other.example") as c:
            reply = await c.post("/mcp/domains", json=INITIALIZE, headers=HEADERS)
            out["other_host"] = [reply.status_code, reply.text]
        async with httpx.AsyncClient(transport=transport, base_url=HOSTS[0]) as c:
            page = {**HEADERS, "origin": "https://other.example"}
            reply = await c.post("/mcp/domains", json=INITIALIZE, headers=page)
            out["other_origin"] = [reply.status_code, reply.text]
        # A real MCP client, at the address an agent is given (no trailing slash).
        http = httpx.AsyncClient(transport=transport)
        async with http, streamable_http_client(HOSTS[0] + "/mcp/domains", http_client=http) as (
            read,
            write,
            _,
        ):
            async with ClientSession(read, write) as session:
                await session.initialize()
                out["tools"] = [tool.name for tool in (await session.list_tools()).tools]
    print(json.dumps(out))


asyncio.run(main())
"""


def _probe(hosts: list[str], **env: str) -> dict:
    """Run ``_PROBE`` against ``hosts`` (base addresses) in a subprocess: a streamable-HTTP
    session manager can be started once per process and the suite's ``client`` already started
    it, and probing the mount on the shared app tears down DBOS. It never imports
    ``tvashtr.main``."""
    ran = subprocess.run(
        [sys.executable, "-c", f"HOSTS = {hosts!r}\n{_PROBE}"],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        env={**os.environ, **env},
    )
    assert ran.returncode == 0, ran.stderr
    return json.loads(ran.stdout.strip().splitlines()[-1])


def test_domains_answers_at_its_address_behind_the_spa_catch_all():
    """The address agents are given is ``{public base}/mcp/domains``, with no trailing slash. A
    Starlette mount alone doesn't match that: it answers 307 locally and, once the SPA's GET
    catch-all is registered (the hosted image), **405** to every agent."""
    base = "http://127.0.0.1:8000"
    out = _probe([base])
    assert out["posts"] == [
        [base, "/mcp/domains", 200, "tvashtr-domains"],
        [base, "/mcp/domains/", 200, "tvashtr-domains"],
        # …and the catch-all still serves the app's own pages.
        [base, "GET /domains", 200, {"spa": "domains"}],
    ]
    assert out["tools"] == ["domain_ask", "domain_retrieve"]


def test_tool_handler_refuses_the_owners_login():
    # Security S1: the tools take their owner from a Domains run token only; the login cookie
    # that was handed to agents before is refused (tests/test_domains_run_token.py: end to end).
    uid = uuid.uuid4()
    assert read_domains_token(make_session_cookie_value(str(uid))) is None


def test_domains_answers_the_hosts_agents_come_in_by_and_no_other():
    """The SDK's default for a localhost-bound server answers **421** "Invalid Host header" to
    any other ``Host``, and agents come in by the public host (a Fly sandbox) or the docker host.
    The check stays on, with those hosts listed (``agent_transport_security``)."""
    bases = ["https://tvashtr.fly.dev", "http://host.docker.internal:8000", "http://localhost:8000"]
    out = _probe(bases, TVASHTR_PUBLIC_BASE_URL="https://tvashtr.fly.dev")
    expected = []
    for base in bases:
        expected += [
            [base, "/mcp/domains", 200, "tvashtr-domains"],
            [base, "/mcp/domains/", 200, "tvashtr-domains"],
            [base, "GET /domains", 200, {"spa": "domains"}],
        ]
    assert out["posts"] == expected
    assert out["tools"] == ["domain_ask", "domain_retrieve"]
    assert out["other_host"] == [421, "Invalid Host header"]
    assert out["other_origin"] == [403, "Invalid Origin header"]

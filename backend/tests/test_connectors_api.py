"""Connectors: the ``/api/connectors`` routes."""

import asyncio
import json
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from starlette.routing import Mount, Route
from toolkit_helpers import fresh_account

from tvashtr import main
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import ConnectorConnection


def test_list_is_empty_and_needs_a_session(unauth_client):
    c, _ = fresh_account()
    resp = c.get("/api/connectors")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"connections": []}

    assert unauth_client.get("/api/connectors").status_code == 401


def test_list_is_the_owners_connections_oldest_first_without_pending_ones():
    c, owner = fresh_account()
    _, other = fresh_account()
    start = datetime.now(UTC) - timedelta(hours=1)

    def add(owner_id, key, status, minutes) -> str:
        with session_scope() as s:
            row = ConnectorConnection(
                owner_id=owner_id,
                connector_key=key,
                name=key.title(),
                slug=key,
                url=f"https://mcp.{key}.example/mcp",
                auth_kind="oauth",
                status=status,
                created_at=start + timedelta(minutes=minutes),
            )
            s.add(row)
            s.flush()
            return str(row.id)

    # Inserted newest first, so the order asserted below is by creation time, not by insertion.
    newest = add(owner, "linear", "connected", 2)
    add(owner, "sentry", "pending", 1)
    oldest = add(owner, "notion", "needs_signin", 0)
    add(other, "linear", "connected", 0)

    listed = c.get("/api/connectors").json()["connections"]
    assert [(row["id"], row["status"]) for row in listed] == [
        (oldest, "needs_signin"),
        (newest, "connected"),
    ]


def test_the_proxy_is_mounted_next_to_domains():
    # The mount is asserted, not probed: a request to a streamable-HTTP mount through the shared
    # TestClient can tear down the DBOS lifespan (test_domain_mcp_http.py).
    paths = [getattr(r, "path", None) for r in app.routes]
    assert "/mcp/connectors" in paths
    assert paths.index("/mcp/connectors") == paths.index("/mcp/domains") + 1
    # Both forms of the address are there: the exact path agents are given (a route), and the
    # mount for everything under it. ``mount_connectors_mcp`` adds the pair; the probe below
    # shows why both are needed.
    kinds = [type(r) for r in app.routes if getattr(r, "path", None) == "/mcp/connectors"]
    assert kinds == [Route, Mount]


_PROBE = """
import asyncio, json, logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from tvashtr.mcp.connectors import get_connectors_mcp, mount_connectors_mcp

logging.disable(logging.CRITICAL)
proxy = get_connectors_mcp().streamable_http_app()


@asynccontextmanager
async def lifespan(app):
    async with proxy.router.lifespan_context(proxy):
        yield


app = FastAPI(lifespan=lifespan)
mount_connectors_mcp(app, proxy)


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


async def main():
    answers = []
    async with lifespan(app):
        for host in ("tvashtr.fly.dev", "host.docker.internal:8000"):
            base = f"https://{host}"
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url=base) as client:
                for path in ("/mcp/connectors", "/mcp/connectors/"):
                    reply = await client.post(path, json=INITIALIZE, headers=HEADERS)
                    server = None
                    if reply.headers.get("content-type", "").startswith("application/json"):
                        server = reply.json().get("result", {}).get("serverInfo", {}).get("name")
                    answers.append([host, path, reply.status_code, server])
                page = await client.get("/toolkit/connectors")
                answers.append([host, "GET /toolkit/connectors", page.status_code, page.json()])
    print(json.dumps(answers))


asyncio.run(main())
"""


def test_the_proxy_answers_at_its_address_behind_the_spa_catch_all():
    """The address agents are given is ``{public base}/mcp/connectors``, with no trailing slash.
    A Starlette mount alone doesn't match that: it answers 307 locally and, once the SPA's GET
    catch-all is registered (the hosted image), **405** to every agent. Run in a subprocess
    because the proxy's session manager can be started once per process, and the suite's
    ``client`` already started it. It never imports ``tvashtr.main``.

    Also the Host check: the SDK's default for a localhost-bound server answers 421 to any other
    ``Host``, and agents come in by the public host or the docker host."""
    ran = subprocess.run(
        [sys.executable, "-c", _PROBE], capture_output=True, text=True, timeout=60, check=False
    )
    assert ran.returncode == 0, ran.stderr
    answers = json.loads(ran.stdout.strip().splitlines()[-1])
    expected = []
    for host in ("tvashtr.fly.dev", "host.docker.internal:8000"):
        expected += [
            [host, "/mcp/connectors", 200, "tvashtr-connectors"],
            [host, "/mcp/connectors/", 200, "tvashtr-connectors"],
            # …and the catch-all still serves the app's own pages.
            [host, "GET /toolkit/connectors", 200, {"spa": "toolkit/connectors"}],
        ]
    assert answers == expected


def test_the_lifespan_starts_the_proxys_session_manager():
    """Without it every request to ``/mcp/connectors`` fails on the SDK's uninitialised task
    group. The real one can't be entered twice in a process, so both MCP lifespans are replaced
    by recorders (as ``test_workspace_gc`` replaces them) and the sweeps are patched out."""
    entered: list[object] = []

    @asynccontextmanager
    async def recording(mounted):
        entered.append(mounted)
        yield

    with (
        patch.object(main, "sweep_orphaned_workspaces"),
        patch.object(main, "sweep_orphaned_clones"),
        patch.object(main, "sweep_orphaned_agent_containers"),
        patch.object(main, "sweep_orphaned_fly_apps"),
        patch.object(main._domains_mcp_http.router, "lifespan_context", recording),
        patch.object(main._connectors_mcp_http.router, "lifespan_context", recording),
    ):

        async def drive() -> list[object]:
            async with main._lifespan(main.app):
                return list(entered)

        at_yield = asyncio.run(drive())

    assert main._connectors_mcp_http in at_yield

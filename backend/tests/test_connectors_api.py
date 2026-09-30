"""Connectors: the ``/api/connectors`` routes."""

import asyncio
import json
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from connector_helpers import add_connection, grant, key_server, remote, server
from starlette.routing import Mount, Route
from toolkit_helpers import fresh_account, make_node, make_team

from tvashtr import main
from tvashtr.control_plane import connector_proxy
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import ConnectorConnection

pytest_plugins = ["connector_fixtures"]  # the ``registry_file`` and ``local_addresses`` fixtures

NOT_FOUND = {"detail": "Connector not found."}


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
    # Right after Domains' own pair (its exact address and its mount).
    first = paths.index("/mcp/domains")
    assert paths[first : first + 4] == ["/mcp/domains"] * 2 + ["/mcp/connectors"] * 2
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


# ---- B1.3: the catalog ----

SUPABASE_CARD = {
    "key": "supabase",
    "name": "Supabase",
    "publisher": "Supabase",
    "featured": True,
    "reviewed": True,
    "category": "databases",
    "description": "Read tables, run read-only SQL and check logs in one project.",
    "website": "https://supabase.com",
    "host": "mcp.supabase.com",
    "auth": "oauth",
    "key_fields": [],
    "access_modes": ["read", "write"],
    "read_only_by": "provider",
    "scope_picker": {"param": "project_ref", "label": "Project"},
    "available": True,
    "unavailable_reason": None,
    "connection_id": None,
    "connection_status": None,
}


def _three_servers(registry_file) -> None:
    registry_file(
        server("dev.zeta/mcp", title="Zeta", remotes=[remote("https://mcp.zeta.dev/mcp")]),
        key_server(),
        server(
            "dev.alpha/mcp", title="Alpha", remotes=[remote("https://mcp.alpha.dev/sse", "sse")]
        ),
    )


def test_catalog_is_featured_first_then_the_registry_and_needs_a_session(
    registry_file, unauth_client
):
    _three_servers(registry_file)
    c, _ = fresh_account()
    resp = c.get("/api/connectors/catalog")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"items", "total", "next_offset", "categories"}
    assert (body["total"], body["next_offset"]) == (17, None)
    assert body["categories"] == ["databases", "docs", "analytics", "crm", "work"]
    assert body["items"][0] == SUPABASE_CARD
    assert [e["name"] for e in body["items"][14:]] == ["Alpha", "Apify", "Zeta"]
    assert all(set(e) == set(SUPABASE_CARD) for e in body["items"])

    apify = body["items"][15]
    assert apify == {
        "key": "com.apify/apify-mcp-server",
        "name": "Apify",
        "publisher": "apify.com",
        "featured": False,
        "reviewed": False,  # from the MCP Registry, not reviewed by Tvashtr
        "category": None,
        "description": "Acme things.",
        "website": None,
        "host": "mcp.apify.com",
        "auth": "api_key",
        "key_fields": [
            {"id": "Authorization", "label": "API key", "hint": "Apify API token", "secret": True}
        ],
        "access_modes": ["read", "write"],
        "read_only_by": "annotations",
        "scope_picker": None,
        "available": True,
        "unavailable_reason": None,
        "connection_id": None,
        "connection_status": None,
    }
    assert body["items"][14]["auth"] == "unknown"

    assert unauth_client.get("/api/connectors/catalog").status_code == 401


def test_catalog_says_which_cards_cant_be_connected_yet(monkeypatch):
    from pydantic import SecretStr

    from tvashtr.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "google_oauth_client_id", "")
    monkeypatch.setattr(settings, "google_oauth_client_secret", SecretStr(""))
    c, _ = fresh_account()
    items = {e["key"]: e for e in c.get("/api/connectors/catalog?limit=14").json()["items"]}
    off = {k for k, e in items.items() if not e["available"]}
    assert off == {"google-drive", "google-docs", "google-sheets", "hubspot"}
    assert all(items[k]["unavailable_reason"] == "coming_soon" for k in off)
    assert items["google-drive"]["access_modes"] == ["read"]
    assert items["google-drive"]["read_only_by"] == "scopes"

    monkeypatch.setattr(settings, "google_oauth_client_id", "abc.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_oauth_client_secret", SecretStr("shh"))
    drive = c.get("/api/connectors/catalog?q=google drive").json()["items"][0]
    assert (drive["key"], drive["available"], drive["unavailable_reason"]) == (
        "google-drive",
        True,
        None,
    )


def test_catalog_pages_searches_and_filters(registry_file):
    _three_servers(registry_file)
    c, _ = fresh_account()

    def get(query: str) -> dict:
        resp = c.get(f"/api/connectors/catalog?{query}")
        assert resp.status_code == 200, resp.text
        return resp.json()

    first = get("limit=5")
    assert (len(first["items"]), first["total"], first["next_offset"]) == (5, 17, 5)
    last = get("offset=15&limit=5")
    assert [e["name"] for e in last["items"]] == ["Apify", "Zeta"] and last["next_offset"] is None
    assert get("offset=12&limit=5")["next_offset"] is None  # exactly the last page
    assert get("offset=99")["items"] == []
    assert get("offset=-3&limit=2")["items"] == first["items"][:2]  # a negative offset is 0

    assert [e["key"] for e in get("q=APIFY")["items"]] == ["com.apify/apify-mcp-server"]
    assert [e["key"] for e in get("category=work")["items"]] == ["linear", "sentry", "atlassian"]
    assert get("q=jira&category=work")["total"] == 1
    assert get("category=nope") | {"categories": None} == {
        "items": [],
        "total": 0,
        "next_offset": None,
        "categories": None,
    }

    for bad in ("0", "101", "-1"):
        resp = c.get(f"/api/connectors/catalog?limit={bad}")
        assert resp.status_code == 422
        assert resp.json() == {"detail": "limit must be between 1 and 100."}
    assert len(get("limit=100")["items"]) == 17 and len(get("limit=1")["items"]) == 1


def test_catalog_marks_this_accounts_connections_and_not_another_accounts(registry_file):
    _three_servers(registry_file)
    c, owner = fresh_account()
    other_c, other = fresh_account()
    supabase = add_connection(owner, "supabase")
    add_connection(owner, "linear", status="pending")
    notion = add_connection(owner, "notion", status="needs_signin")
    apify = add_connection(owner, "com.apify/apify-mcp-server", auth_kind="api_key")
    theirs = add_connection(other, "sentry")

    def marks(client) -> dict:
        items = client.get("/api/connectors/catalog?limit=100").json()["items"]
        return {
            e["key"]: (e["connection_id"], e["connection_status"])
            for e in items
            if e["connection_id"] or e["connection_status"]
        }

    assert marks(c) == {
        "supabase": (supabase, "connected"),
        "notion": (notion, "needs_signin"),
        "com.apify/apify-mcp-server": (apify, "connected"),
    }  # the pending Linear row is reported as nothing
    assert marks(other_c) == {"sentry": (theirs, "connected")}


# ---- B1.3: the list and one connection ----

SECRETS = {
    "issuer": "https://api.supabase.com",
    "authorization_endpoint": "https://api.supabase.com/v1/oauth/authorize",
    "token_endpoint": "https://api.supabase.com/v1/oauth/token",
    "client": {"client_id": "CLIENT-ID", "client_secret": "CLIENT-SECRET"},
    "access_token": "ACCESS-TOKEN",
    "refresh_token": "REFRESH-TOKEN",
}
PENDING = {
    "code_verifier": "CODE-VERIFIER",
    "issuer": "https://api.supabase.com",
    "authorization_endpoint": "https://api.supabase.com/v1/oauth/authorize",
    "client": {"client_id": "PENDING-CLIENT", "client_secret": "PENDING-SECRET"},
    "started_at": 1,
}
NEVER = (
    "secret_encrypted",
    "pending_encrypted",
    "state_hash",
    "STATE-HASH",
    "ACCESS-TOKEN",
    "REFRESH-TOKEN",
    "CLIENT-SECRET",
    "CLIENT-ID",
    "CODE-VERIFIER",
    "PENDING-CLIENT",
    "PENDING-SECRET",
    "gAAAA",
)  # fmt: skip  ("gAAAA" is how every Fernet token starts)


def test_no_read_route_returns_a_secret_a_token_or_the_state_hash():
    c, owner = fresh_account()
    cid = add_connection(
        owner, "supabase", secret=SECRETS, pending=PENDING, state_hash="STATE-HASH-" + owner.hex
    )
    add_connection(owner, "notion", status="needs_signin", secret=SECRETS)
    for path in ("/api/connectors", f"/api/connectors/{cid}", "/api/connectors/catalog"):
        resp = c.get(path)
        assert resp.status_code == 200, resp.text
        for never in NEVER:
            assert never not in resp.text, (path, never)
    # …while the row still says where the sign-in happens.
    assert c.get(f"/api/connectors/{cid}").json()["signin_host"] == "api.supabase.com"


def test_a_sign_in_that_cant_be_decrypted_doesnt_break_the_list_or_the_connection():
    """After ``TVASHTR_SECRET_KEY`` is rotated (or a column is corrupt) the row reads as having
    no sign-in: it is still listed, and it can be renamed, signed in again or disconnected."""
    c, owner = fresh_account()
    fine = add_connection(owner, "linear", secret=SECRETS)
    broken = add_connection(
        owner,
        "supabase",
        secret_encrypted="not-a-fernet-token",
        pending_encrypted="nor-is-this",
        state_hash="STATE-HASH-" + owner.hex,
    )
    listed = c.get("/api/connectors")
    assert listed.status_code == 200, listed.text
    rows = {r["id"]: r for r in listed.json()["connections"]}
    assert set(rows) == {fine, broken}
    assert rows[fine]["signin_host"] == "api.supabase.com"
    assert (rows[broken]["signin_host"], rows[broken]["signin_pending"]) == (None, False)

    one = c.get(f"/api/connectors/{broken}")
    assert one.status_code == 200, one.text
    assert (one.json()["signin_host"], one.json()["signin_host_differs"]) == (None, False)
    renamed = c.patch(f"/api/connectors/{broken}", json={"name": "Production"})
    assert (renamed.status_code, renamed.json()["name"]) == (200, "Production")
    assert c.delete(f"/api/connectors/{broken}").status_code == 200
    assert [r["id"] for r in c.get("/api/connectors").json()["connections"]] == [fine]


def _team_with_grants(owner, connection_id, other_connection_id=None) -> dict:
    team = make_team(owner, "Indicator sprint team")
    docs = make_team(owner, "Docs team")
    clone = make_team(owner, "Run snapshot", library=False)
    return {
        "team": team,
        "docs": docs,
        "pm": make_node(team, "PM", x=0, tool_config=grant(connection_id)),
        "engineer": make_node(
            team,
            "Engineer",
            x=1,
            tool_config=grant(connection_id, "write"),
            config={"title": "Eng"},
        ),
        "reviewer": make_node(team, "Reviewer", x=2, tool_config=grant(other_connection_id)),
        "gate": make_node(team, "Approve", kind="gate", x=3, tool_config=grant(connection_id)),
        "writer": make_node(docs, "Writer", kind="completion", tool_config=grant(connection_id)),
        "clone": make_node(clone, "PM", tool_config=grant(connection_id)),
    }


def test_list_counts_who_uses_each_connection_and_names_them_only_when_it_needs_a_sign_in():
    c, owner = fresh_account()
    connected = add_connection(owner, "supabase", access="write")
    expired = add_connection(
        owner, "notion", status="needs_signin", last_error="Its sign-in expired."
    )
    unused = add_connection(owner, "linear")
    nodes = _team_with_grants(owner, connected)
    make_node(nodes["docs"], "Editor", x=5, tool_config=grant(expired, "write"))

    rows = {r["id"]: r for r in c.get("/api/connectors").json()["connections"]}
    # Library teams only, agent and completion nodes only: no gate, no run snapshot.
    assert rows[connected]["used_by"] == {"agent_count": 3, "team_count": 2}
    assert rows[connected]["used_by_agents"] is None
    assert rows[unused]["used_by"] == {"agent_count": 0, "team_count": 0}
    assert rows[unused]["used_by_agents"] is None

    assert rows[expired]["used_by"] == {"agent_count": 1, "team_count": 1}
    [editor] = rows[expired]["used_by_agents"]
    assert editor | {"node_id": None} == {
        "node_id": None,
        "role_name": "Editor",
        "title": None,
        "team_id": str(nodes["docs"]),
        "team_name": "Docs team",
        # The grant says write, the connection is read only: the agent reads.
        "access": "read",
    }
    assert rows[expired]["last_error"] == "Its sign-in expired."


def test_get_one_connection_with_who_uses_it_recent_use_and_the_revoke_hint(monkeypatch):
    c, owner = fresh_account()
    cid = add_connection(owner, "supabase", access="write")
    nodes = _team_with_grants(owner, cid)
    use = [
        {"run_id": "r1", "run_number": 42, "agent": "Reviewer", "reads": 6, "writes": 0, "at": None}
    ]
    asked = []

    def recent_use(session, owner_id, connection_id):
        asked.append((owner_id, str(connection_id)))
        return use

    monkeypatch.setattr(connector_proxy, "recent_use", recent_use)

    resp = c.get(f"/api/connectors/{cid}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    listed = c.get("/api/connectors").json()["connections"][0]
    assert {k: body[k] for k in listed if k != "used_by_agents"} == {
        k: v for k, v in listed.items() if k != "used_by_agents"
    }
    assert set(body) - set(listed) == {"recent_use", "revoke_hint"}
    assert [
        (u["node_id"], u["title"], u["team_name"], u["access"]) for u in body["used_by_agents"]
    ] == [
        (str(nodes["pm"]), None, "Indicator sprint team", "read"),  # a grant without access reads
        (str(nodes["engineer"]), "Eng", "Indicator sprint team", "write"),
        (str(nodes["writer"]), None, "Docs team", "read"),
    ]
    assert body["used_by"] == {"agent_count": 3, "team_count": 2}
    assert body["recent_use"] == use and asked == [(owner, cid)]
    assert body["revoke_hint"] == (
        "To remove Tvashtr on Supabase’s side too, revoke it in Supabase’s settings."
    )


def test_get_returns_a_pending_connection_and_names_a_custom_one_in_its_hint():
    c, owner = fresh_account()
    pending = add_connection(owner, "linear", status="pending")
    assert c.get(f"/api/connectors/{pending}").json()["status"] == "pending"
    assert c.get("/api/connectors").json() == {"connections": []}

    custom = add_connection(
        owner, "custom:mcp.acme.dev/mcp", name="Acme", slug="acme", url="https://mcp.acme.dev/mcp"
    )
    body = c.get(f"/api/connectors/{custom}").json()
    assert (body["featured"], body["reviewed"], body["publisher"]) == (False, False, None)
    assert (
        body["revoke_hint"] == "To remove Tvashtr on Acme’s side too, revoke it in Acme’s settings."
    )
    assert body["used_by_agents"] == [] and body["recent_use"] == []

    nothing = add_connection(owner, "dev.open/mcp", name="Open", slug="open", auth_kind="none")
    assert c.get(f"/api/connectors/{nothing}").json()["revoke_hint"] is None  # nothing to revoke


def test_get_is_404_for_another_accounts_connection_a_random_id_and_garbage(unauth_client):
    c, owner = fresh_account()
    other_c, _ = fresh_account()
    cid = add_connection(owner, "supabase")
    assert c.get(f"/api/connectors/{cid}").status_code == 200

    resp = other_c.get(f"/api/connectors/{cid}")
    assert (resp.status_code, resp.json()) == (404, NOT_FOUND)
    for missing in (uuid.uuid4(), "not-a-uuid"):
        resp = c.get(f"/api/connectors/{missing}")
        assert (resp.status_code, resp.json()) == (404, NOT_FOUND)
    assert unauth_client.get(f"/api/connectors/{cid}").status_code == 401

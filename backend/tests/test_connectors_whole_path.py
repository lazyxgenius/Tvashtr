"""Connectors: one connection's whole life across the three backend streams (B1 connects and
manages it, B2 signs it in, B3 serves it to a run), with nothing replaced but the settings. Every
request to the provider goes through ``connector_net`` to the fake server's own process, as in
local development and the e2e run. Each stream's own tests put doubles where the other two are.
"""

import asyncio
import uuid
from urllib.parse import parse_qsl, urlsplit

import httpx
from toolkit_helpers import fresh_account, make_node, make_team, node_row

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_proxy
from tvashtr.control_plane.node_tools import build_mcp_config
from tvashtr.db import session_scope
from tvashtr.models import Run


def test_connect_sign_in_grant_run_and_disconnect(fake_connector_url, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "connectors_allow_local", True)
    monkeypatch.setattr(settings, "hosted_mode", False)
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:8000")
    connector_proxy._read_only_hints.clear()
    c, owner = fresh_account()

    # Connect (B1): a custom address goes through sign-in discovery (B2) and is pending.
    made = c.post("/api/connectors", json={"url": fake_connector_url, "name": "acm"})
    assert made.status_code == 201, made.text
    cid = made.json()["id"]
    assert (made.json()["status"], made.json()["auth_kind"], made.json()["signin_host"]) == (
        "pending",
        "oauth",
        "127.0.0.1",
    )
    named = c.patch(f"/api/connectors/{cid}", json={"name": "Fake Things"}).json()
    assert (named["name"], named["slug"]) == ("Fake Things", "fake-things")
    assert c.get("/api/connectors").json()["connections"] == []  # not listed until it signs in

    # Sign in (B2): start, the provider's Allow, the callback in the owner's browser.
    started = c.post(f"/api/connectors/{cid}/oauth/start")
    assert started.status_code == 200, started.text
    assert c.get(f"/api/connectors/{cid}").json()["signin_pending"] is True
    allowed = httpx.post(started.json()["authorize_url"])
    assert allowed.status_code == 302, allowed.text
    back = dict(parse_qsl(urlsplit(allowed.headers["location"]).query))
    page = c.get("/api/connectors/oauth/callback", params=back)
    assert "Fake Things is connected. You can close this window." in page.text

    # The connection as the app's poll reads it (B1 over what B2 stored), then a check.
    one = c.get(f"/api/connectors/{cid}").json()
    assert (one["status"], one["signin_pending"], one["last_error"]) == ("connected", False, None)
    assert [(tool["name"], tool["write"], tool["on"]) for tool in one["tools"]] == [
        ("list_things", False, True),
        ("get_thing", False, True),
        ("create_thing", True, False),
        ("list_projects", False, True),
    ]
    checked = c.post(f"/api/connectors/{cid}/check")
    assert checked.status_code == 200, checked.text
    assert (checked.json()["status"], len(checked.json()["tools"])) == ("connected", 4)

    # Give it to an agent (B1): the grant is on the node.
    team = make_team(owner)
    node = make_node(team, "reviewer")
    saved = c.put(f"/api/connectors/{cid}/agents", json={"node_ids": [str(node)]})
    assert saved.status_code == 200, saved.text
    tool_config = node_row(node).tool_config
    assert tool_config == {"tvashtr": {"connectors": [{"id": cid, "access": "read"}]}}

    # A run (B3): the agent's config names the proxy with a run token, and the proxy lists and
    # calls the provider with the sign-in B2 stored, at the address B1 builds.
    run_id = uuid.uuid4()
    with session_scope() as session:
        session.add(
            Run(
                id=run_id,
                team_graph_id=team,
                owner_id=owner,
                idea="x",
                workflow_id=str(run_id),
                status="running",
            )
        )
    servers = build_mcp_config(tool_config, str(run_id))["mcpServers"]
    assert list(servers) == ["fake-things"]
    token = servers["fake-things"]["headers"]["Authorization"].removeprefix("Bearer ")
    grant = connector_proxy.read_run_token(token)
    assert grant is not None and str(grant.connection_id) == cid
    tools = asyncio.run(connector_proxy.proxy_list_tools(grant))
    assert [tool.name for tool in tools] == ["list_things", "get_thing", "list_projects"]
    read = asyncio.run(connector_proxy.proxy_call_tool(grant, "list_things", {}))
    assert not read.isError and "First thing" in read.content[0].text
    write = asyncio.run(connector_proxy.proxy_call_tool(grant, "create_thing", {"name": "x"}))
    assert write.isError and "is read only for this agent" in write.content[0].text
    use = c.get(f"/api/connectors/{cid}").json()["recent_use"]
    assert [(u["run_id"], u["reads"], u["writes"]) for u in use] == [(str(run_id), 1, 0)]

    # Disconnect (B1): the provider is told (B2), the agent loses it, the run's token stops (B3).
    gone = c.delete(f"/api/connectors/{cid}")
    assert gone.json() == {"removed_from_agents": 1, "revoked": True}
    assert node_row(node).tool_config is None
    assert connector_proxy.read_run_token(token) is None

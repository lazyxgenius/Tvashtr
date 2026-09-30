"""Connectors: the ``/api/connectors`` routes."""

from datetime import UTC, datetime, timedelta

from toolkit_helpers import fresh_account

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

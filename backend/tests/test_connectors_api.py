"""Connectors: the ``/api/connectors`` routes."""

from toolkit_helpers import fresh_account

from tvashtr.main import app


def test_list_is_empty_and_needs_a_session(unauth_client):
    c, _ = fresh_account()
    resp = c.get("/api/connectors")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"connections": []}

    assert unauth_client.get("/api/connectors").status_code == 401


def test_the_proxy_is_mounted_next_to_domains():
    # The mount is asserted, not probed: a request to a streamable-HTTP mount through the shared
    # TestClient can tear down the DBOS lifespan (test_domain_mcp_http.py).
    paths = [getattr(r, "path", None) for r in app.routes]
    assert "/mcp/connectors" in paths
    assert paths.index("/mcp/connectors") == paths.index("/mcp/domains") + 1

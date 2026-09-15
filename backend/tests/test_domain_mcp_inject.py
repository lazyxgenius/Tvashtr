"""Phase 4b — build_mcp_config Domains MCP injection."""

import uuid
from unittest.mock import patch

from tvashtr.auth import SESSION_COOKIE_NAME
from tvashtr.control_plane.node_tools import build_mcp_config, domains_mcp_url
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import Run, User


def _make_owned_run(owner_id: uuid.UUID) -> str:
    """Minimal owned run so build_mcp_config can resolve the owner."""
    run_id = str(uuid.uuid4())
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner_id,
                idea="x",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _seed_owner() -> tuple[uuid.UUID, str]:
    owner = uuid.uuid4()
    with session_scope() as s:
        s.add(User(id=owner, email=f"{owner.hex}@t.local", password_hash="x"))
    return owner, _make_owned_run(owner)


def test_domains_off_is_inert():
    owner, run_id = _seed_owner()
    assert build_mcp_config(None, run_id) == {}
    assert build_mcp_config({"mcpServers": {}}, run_id) == {"mcpServers": {}}
    out = build_mcp_config({"mcpServers": {}, "tvashtr": {"domains": False}}, run_id)
    assert "tvashtr-domains" not in out.get("mcpServers", {})


def test_domains_on_injects_url_and_cookie():
    owner, run_id = _seed_owner()
    with patch(
        "tvashtr.control_plane.node_tools.domains_mcp_url",
        return_value="http://host.docker.internal:8000/mcp/domains",
    ):
        out = build_mcp_config({"tvashtr": {"domains": True}}, run_id)
    server = out["mcpServers"]["tvashtr-domains"]
    assert server["url"] == "http://host.docker.internal:8000/mcp/domains"
    cookie = server["headers"]["Cookie"]
    assert cookie.startswith(SESSION_COOKIE_NAME + "=")


def test_inline_tvashtr_domains_wins():
    owner, run_id = _seed_owner()
    inline = {
        "mcpServers": {
            "tvashtr-domains": {"url": "http://example.test/mcp", "headers": {}}
        },
        "tvashtr": {"domains": True},
    }
    out = build_mcp_config(inline, run_id)
    assert out["mcpServers"]["tvashtr-domains"]["url"] == "http://example.test/mcp"


def test_domains_mcp_url_rewrites_localhost_for_docker():
    class S:
        public_base_url = "http://127.0.0.1:8000"
        agent_sandbox_mode = "docker"
        litellm_proxy_host_docker = "host.docker.internal"

    with patch("tvashtr.control_plane.node_tools.get_settings", return_value=S()):
        url = domains_mcp_url()
    assert "host.docker.internal" in url
    assert url.endswith("/mcp/domains")

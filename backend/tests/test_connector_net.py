"""Connectors: the three settings (0.2) and the outbound address guard (0.3)."""

import tomllib
from pathlib import Path

from tvashtr.config import Settings

_BACKEND = Path(__file__).resolve().parents[1]


def test_connector_settings_default_to_off():
    s = Settings(_env_file=None)
    assert s.google_oauth_client_id == ""
    assert s.google_oauth_client_secret.get_secret_value() == ""
    assert s.connectors_allow_local is False


def test_connector_settings_read_their_env_names(monkeypatch):
    monkeypatch.setenv("TVASHTR_GOOGLE_OAUTH_CLIENT_ID", "abc.apps.googleusercontent.com")
    monkeypatch.setenv("TVASHTR_GOOGLE_OAUTH_CLIENT_SECRET", "shh")
    monkeypatch.setenv("TVASHTR_CONNECTORS_ALLOW_LOCAL", "1")
    s = Settings(_env_file=None)
    assert s.google_oauth_client_id == "abc.apps.googleusercontent.com"
    assert s.google_oauth_client_secret.get_secret_value() == "shh"
    assert s.connectors_allow_local is True


def test_mcp_floor_has_the_client_pieces_connectors_need():
    """``mcp>=1.0`` allowed versions without ``streamable_http_client(http_client=…)`` and
    ``mcp.client.auth.utils``; the floor now names the first line that has both."""
    deps = tomllib.loads((_BACKEND / "pyproject.toml").read_text())["project"]["dependencies"]
    assert "mcp>=1.27" in deps

    import inspect

    import mcp.client.auth.utils  # noqa: F401
    from mcp.client.streamable_http import streamable_http_client

    assert "http_client" in inspect.signature(streamable_http_client).parameters

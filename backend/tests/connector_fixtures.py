"""Fixtures for the Connectors tests (stream B1). A test module that uses them says
``pytest_plugins = ["connector_fixtures"]``; nothing imports this module directly (pytest loads
it as a plugin, which is what lets it rewrite the asserts here)."""

import json

import pytest

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog


@pytest.fixture
def registry_file(tmp_path, monkeypatch):
    """Point the catalog at a snapshot made of the given registry items (run through the filter).
    Until it is called, the catalog reads the committed snapshot."""

    def write(*items: dict) -> None:
        # A dict that already has a ``key`` is a snapshot line as it is (a fake server's
        # ``http://127.0.0.1`` address never passes the filter).
        slim = [i if "key" in i else connector_catalog.slim_registry_entry(i) for i in items]
        lines = [json.dumps(entry) for entry in slim]
        path = tmp_path / "connector_registry.jsonl"
        path.write_text("".join(line + "\n" for line in lines))
        monkeypatch.setattr(connector_catalog, "REGISTRY_PATH", path)
        connector_catalog.registry.cache_clear()

    yield write
    monkeypatch.undo()  # the real path back before the cache is dropped
    connector_catalog.registry.cache_clear()


@pytest.fixture
def local_addresses(monkeypatch):
    """Let ``connector_net`` open ``http://127.0.0.1`` (the fake connector server)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "connectors_allow_local", True)
    monkeypatch.setattr(settings, "hosted_mode", False)

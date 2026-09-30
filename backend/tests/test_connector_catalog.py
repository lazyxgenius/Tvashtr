"""Connectors: the Featured catalog, availability and the read-or-write rule
(``connector_catalog``)."""

import pytest

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog
from tvashtr.control_plane.connector_catalog import FEATURED, available, is_write, resolve

# The contract's Featured table (docs/superpowers/plans/api/connectors.md), in its order.
CONTRACT = [
    ("supabase", "databases", "https://mcp.supabase.com/mcp", "provider"),
    ("neon", "databases", "https://mcp.neon.tech/mcp", "annotations"),
    ("notion", "docs", "https://mcp.notion.com/mcp", "annotations"),
    ("google-drive", "docs", "https://drivemcp.googleapis.com/mcp/v1", "scopes"),
    ("google-docs", "docs", "https://docsmcp.googleapis.com/mcp/v1", "scopes"),
    ("google-sheets", "docs", "https://sheetsmcp.googleapis.com/mcp/v1", "scopes"),
    ("posthog", "analytics", "https://mcp.posthog.com/mcp", "annotations"),
    ("mixpanel", "analytics", "https://mcp.mixpanel.com/mcp", "annotations"),
    ("amplitude", "analytics", "https://mcp.amplitude.com/mcp", "annotations"),
    ("hubspot", "crm", "https://mcp.hubspot.com/", "annotations"),
    ("intercom", "crm", "https://mcp.intercom.com/mcp", "annotations"),
    ("linear", "work", "https://mcp.linear.app/mcp", "annotations"),
    ("sentry", "work", "https://mcp.sentry.dev/mcp", "annotations"),
    ("atlassian", "work", "https://mcp.atlassian.com/v2/mcp", "annotations"),
]
GOOGLE = ("google-drive", "google-docs", "google-sheets")


def test_the_fourteen_featured_entries_match_the_contract_table():
    assert [
        (e["key"], e["category"], e["url"], e["read_only_by"]) for e in FEATURED.values()
    ] == CONTRACT
    assert list(FEATURED) == [row[0] for row in CONTRACT]
    assert connector_catalog.CATEGORIES == ["databases", "docs", "analytics", "crm", "work"]


def test_every_featured_entry_carries_the_fields_the_streams_read():
    for entry in FEATURED.values():
        assert entry["featured"] is True
        assert entry["auth"] == "oauth" and entry["key_fields"] == []
        assert entry["transport"] == "streamable-http"
        for field in ("name", "publisher", "description", "revoke_hint"):
            assert isinstance(entry[field], str) and entry[field], (entry["key"], field)
        assert entry["website"].startswith("https://")
        assert entry["access_modes"] in (["read"], ["read", "write"])
        assert len(entry["description"]) <= 200


def test_read_only_flags_and_scope_pickers():
    assert FEATURED["supabase"]["read_only_params"] == {"read_only": "true"}
    assert FEATURED["supabase"]["scope_picker"] == {
        "param": "project_ref",
        "label": "Project",
        "tool": "list_projects",
    }
    # Neon gets its URL flag too, but the flag isn't trusted: the annotation rule still decides.
    assert FEATURED["neon"]["read_only_params"] == {"readonly": "true"}
    assert FEATURED["neon"]["read_only_by"] == "annotations"
    assert FEATURED["neon"]["scope_picker"]["param"] == "projectId"
    others = [k for k in FEATURED if k not in ("supabase", "neon")]
    assert all("read_only_params" not in FEATURED[k] for k in others)
    assert all("scope_picker" not in FEATURED[k] for k in others)


def test_google_entries_pin_the_client_the_read_only_scope_and_the_endpoint_hosts():
    scopes = {
        "google-drive": "https://www.googleapis.com/auth/drive.readonly",
        "google-docs": "https://www.googleapis.com/auth/documents.readonly",
        "google-sheets": "https://www.googleapis.com/auth/spreadsheets.readonly",
    }
    for key in GOOGLE:
        entry = FEATURED[key]
        assert entry["client"] == "google"
        assert entry["scope"] == scopes[key]
        assert entry["oauth_hosts"] == ["accounts.google.com", "oauth2.googleapis.com"]
        assert entry["access_modes"] == ["read"]
    assert all("client" not in e for k, e in FEATURED.items() if k not in GOOGLE)


def test_google_cards_turn_available_when_both_settings_are_set(monkeypatch):
    from pydantic import SecretStr

    settings = get_settings()
    monkeypatch.setattr(settings, "google_oauth_client_id", "")
    monkeypatch.setattr(settings, "google_oauth_client_secret", SecretStr(""))
    assert [available(FEATURED[k]) for k in GOOGLE] == [False] * 3

    monkeypatch.setattr(settings, "google_oauth_client_id", "abc.apps.googleusercontent.com")
    assert [available(FEATURED[k]) for k in GOOGLE] == [False] * 3  # the id alone isn't enough

    monkeypatch.setattr(settings, "google_oauth_client_secret", SecretStr("shh"))
    assert [available(FEATURED[k]) for k in GOOGLE] == [True] * 3


def test_hubspot_is_coming_soon_and_the_rest_are_available():
    assert available(FEATURED["hubspot"]) is False
    rest = [k for k in FEATURED if k not in (*GOOGLE, "hubspot")]
    assert len(rest) == 10 and all(available(FEATURED[k]) for k in rest)


# Stub test: task B1.1 (registry and custom keys) rewrites it (build plan §2).
def test_resolve_finds_featured_keys_only_for_now():
    assert resolve("supabase") is FEATURED["supabase"]
    for unknown in ("com.apify/apify-mcp-server", "custom:mcp.acme.dev/mcp", "", None, 7):
        assert resolve(unknown) is None


READ = {"name": "list_tables", "title": None, "read_only": True}
UNMARKED = {"name": "run_sql", "title": None, "read_only": False}


@pytest.mark.parametrize(
    ("key", "tool", "access", "write"),
    [
        # Supabase's own read-only flag is trusted: in read mode every listed tool is a read.
        ("supabase", UNMARKED, "read", False),
        ("supabase", READ, "read", False),
        # Neon's flag is not: an unannotated run_sql is a write in read mode too.
        ("neon", UNMARKED, "read", True),
        ("neon", READ, "read", False),
        # An `annotations` entry: a missing annotation is a write.
        ("linear", UNMARKED, "read", True),
        ("linear", READ, "read", False),
        # Google (`scopes`) follows the annotation as well.
        ("google-drive", UNMARKED, "read", True),
        ("google-drive", READ, "read", False),
        ("google-sheets", UNMARKED, "read", True),
        # Access `write` follows the annotation everywhere.
        ("supabase", UNMARKED, "write", True),
        ("supabase", READ, "write", False),
        ("neon", UNMARKED, "write", True),
        ("linear", READ, "write", False),
    ],
)
def test_is_write(key, tool, access, write):
    assert is_write(FEATURED[key], tool, access) is write


def test_is_write_without_an_entry_or_a_flag_counts_a_write():
    """A connection whose key no longer resolves, or a stored tool with no ``read_only``."""
    assert is_write(None, UNMARKED, "read") is True
    assert is_write(None, READ, "read") is False
    assert is_write(None, {"name": "x"}, "read") is True
    assert is_write(FEATURED["linear"], {"name": "x", "read_only": "true"}, "read") is True

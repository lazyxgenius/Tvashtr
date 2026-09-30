"""Connectors: the Featured catalog, the registry snapshot, search, availability and the
read-or-write rule (``connector_catalog``)."""

import pytest
from connector_helpers import OFFICIAL
from connector_helpers import remote as _remote
from connector_helpers import server as _server

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog
from tvashtr.control_plane.connector_catalog import (
    FEATURED,
    available,
    custom_entry,
    is_write,
    resolve,
    search,
    slim_registry_entry,
)

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

pytest_plugins = ["connector_fixtures"]  # the ``registry_file`` fixture


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


def test_google_entries_ask_for_a_refresh_token():
    """Google hands out a refresh token only with ``access_type=offline``, and again on a later
    sign-in only with ``prompt=consent``. Without both, a Google connection needs a new sign-in
    about an hour after every one."""
    for key in GOOGLE:
        assert FEATURED[key]["authorize_params"] == {"access_type": "offline", "prompt": "consent"}
    assert all("authorize_params" not in e for k, e in FEATURED.items() if k not in GOOGLE)


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


def test_resolve_finds_featured_registry_and_custom_keys(registry_file):
    registry_file(
        _server("com.apify/apify-mcp-server", remotes=[_remote("https://mcp.apify.com/")])
    )
    assert resolve("supabase") is FEATURED["supabase"]
    for unknown in ("com.unknown/server", "custom:", "custom:bad host/mcp", "", None, 7):
        assert resolve(unknown) is None

    apify = resolve("com.apify/apify-mcp-server")
    assert (apify["key"], apify["url"], apify["featured"]) == (
        "com.apify/apify-mcp-server",
        "https://mcp.apify.com/",
        False,
    )
    custom = resolve("custom:mcp.acme.dev/mcp")
    assert (custom["key"], custom["url"], custom["featured"]) == (
        "custom:mcp.acme.dev/mcp",
        "https://mcp.acme.dev/mcp",
        False,
    )
    for entry in (apify, custom):
        # A registry or custom entry never carries what only a Featured entry may pin.
        assert not {"client", "scope", "oauth_hosts", "read_only_params", "scope_picker"} & set(
            entry
        )
        assert entry["read_only_by"] == "annotations" and entry["category"] is None
        assert entry["access_modes"] == ["read", "write"] and available(entry) is True


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


# ---- the registry snapshot: the filter (B1.1) ----


def test_slim_keeps_a_plain_remote_server():
    item = _server(title="Acme", websiteUrl="https://acme.dev", icons=[{"src": "https://x/i.png"}])
    assert slim_registry_entry(item) == {
        "key": "dev.acme/mcp",
        "title": "Acme",
        "description": "Acme things.",
        "website": "https://acme.dev",
        "url": "https://mcp.acme.dev/mcp",
        "transport": "streamable-http",
        "headers": [],
    }  # no icon: the UI uses letter tiles


def test_slim_cuts_the_description_and_a_missing_title_is_null():
    slim = slim_registry_entry(_server(description="x" * 500))
    assert slim["title"] is None and slim["description"] == "x" * 200
    assert slim_registry_entry(_server(description=None))["description"] == ""


@pytest.mark.parametrize(
    "item",
    [
        _server(status="deprecated"),
        _server(status="deleted"),
        _server("ai.smithery/acme"),
        _server(remotes=[]),
        _server(remotes=[_remote("https://{tenant}.acme.dev/mcp")]),  # template-only address
        _server(remotes=[_remote("http://mcp.acme.dev/mcp")]),
        _server(remotes=[_remote("https://user@mcp.acme.dev/mcp")]),
        _server(remotes=[_remote("https://mcp.acme.dev/mcp", kind="stdio")]),
        _server(remotes=[_remote(headers=[{"name": "Payment-Signature", "isRequired": True}])]),
        _server(remotes=[_remote(headers=[{"name": "payment-signature"}])]),
        _server(name=""),
        _server(name="supabase"),  # a server name always has a namespace
        _server(name="custom:mcp.acme.dev/mcp"),
        _server(name="dev.acme/a b"),
        {"server": "nope"},
        "nope",
    ],
)
def test_slim_drops_what_cant_be_a_connector(item):
    assert slim_registry_entry(item) is None


@pytest.mark.parametrize(
    "url",
    [
        "https://mcp.sup\u0430base.com/mcp",  # a Cyrillic а: it prints like mcp.supabase.com
        "https://m\u00fcnchen.example/mcp",
        "https://mcp.supabase.com./mcp",  # the Featured host with a trailing dot
        "https://mcp.acme.dev./mcp",
        "https://mcp.acme.dev.:8443/mcp",
    ],
)
def test_slim_drops_an_address_that_can_pass_for_another_host(url):
    assert slim_registry_entry(_server(remotes=[_remote(url)])) is None
    # The same address can't be reached through a ``custom:`` key either.
    assert resolve("custom:" + url.removeprefix("https://")) is None


@pytest.mark.parametrize(
    "name",
    [
        "X-PAYMENT",
        "X-Payment-Token",
        "X-Wallet-Key",
        "X-Skim-Wallet-Key",
        "X-IMBA-Agent-Private-Key",
        "x-economyos-private-key",
        "X-Private_Key",
        "X-PrivateKey",
        "skyfire-pay-id",
    ],
)
def test_slim_drops_a_server_that_asks_for_a_payment_a_wallet_or_a_private_key(name):
    """The key form must never ask for a wallet's private key or a pay-per-call token."""
    picked = _remote(headers=[{"name": name, "isSecret": True}])
    assert slim_registry_entry(_server(remotes=[picked])) is None
    # Declared on a remote that isn't the one picked: the server still takes payment per call.
    other = _remote("https://pay.acme.dev/sse", kind="sse", headers=[{"name": name}])
    assert slim_registry_entry(_server(remotes=[_remote(), other])) is None


def test_slim_keeps_a_payment_services_own_api_key():
    for name in ("TgPayCrypto-API-Token", "x-wavepay-service-key", "X-Stripe-Key"):
        slim = slim_registry_entry(_server(remotes=[_remote(headers=[{"name": name}])]))
        assert [h["name"] for h in slim["headers"]] == [name]


@pytest.mark.parametrize(
    "item",
    [
        _server(remotes=5),
        _server(remotes={"type": "streamable-http", "url": "https://mcp.acme.dev/mcp"}),
        _server() | {"_meta": [1]},
        _server() | {"_meta": {OFFICIAL: "active"}},
        _server() | {"_meta": {OFFICIAL: ["active"]}},
    ],
)
def test_slim_drops_an_item_that_breaks_the_registrys_own_shape(item):
    """One malformed item must not stop a refresh: it is dropped, never an exception."""
    assert slim_registry_entry(item) is None


def test_slim_reads_headers_that_arent_a_list_as_no_headers():
    for headers in (7, "Authorization", {"name": "Authorization"}):
        odd = _remote("https://odd.acme.dev/mcp") | {"headers": headers}
        assert slim_registry_entry(_server(remotes=[odd]))["headers"] == []
        # The same on a remote that isn't the one picked.
        kept = slim_registry_entry(_server(remotes=[_remote(), odd | {"type": "sse"}]))
        assert (kept["url"], kept["headers"]) == ("https://mcp.acme.dev/mcp", [])


def test_slim_picks_streamable_http_first_then_sse_and_skips_template_addresses():
    sse = _remote("https://mcp.acme.dev/sse", kind="sse")
    assert slim_registry_entry(_server(remotes=[sse]))["transport"] == "sse"

    both = slim_registry_entry(_server(remotes=[sse, _remote("https://mcp.acme.dev/mcp")]))
    assert (both["url"], both["transport"]) == ("https://mcp.acme.dev/mcp", "streamable-http")

    fixed = slim_registry_entry(
        _server(
            remotes=[_remote("https://{region}.acme.dev/mcp"), _remote("https://eu.acme.dev/mcp")]
        )
    )
    assert fixed["url"] == "https://eu.acme.dev/mcp"


def test_slim_keeps_header_declarations_with_their_template():
    headers = [
        {
            "name": "Authorization",
            "description": "Acme API key. " + "y" * 300,
            "isRequired": True,
            "isSecret": True,
            "value": "Bearer {api_key}",
            "variables": {"api_key": {"isSecret": True, "isRequired": True}},
        },
        # Secret only through its variable; not required.
        {"name": "X-Team", "value": "team {id}", "variables": {"id": {"isSecret": True}}},
        # A fixed value and a two-part template are not templates Tvashtr fills.
        {"name": "X-Plan", "value": "free", "isRequired": True},
        {"name": "X-Pair", "value": "{public}:{private}", "isSecret": True},
        {"name": "X-Trace"},
    ]
    slim = slim_registry_entry(_server(remotes=[_remote(headers=headers)]))
    assert slim["headers"] == [
        {
            "name": "Authorization",
            "secret": True,
            "required": True,
            "template": "Bearer {api_key}",
            "hint": ("Acme API key. " + "y" * 300)[:200],
        },
        {
            "name": "X-Team",
            "secret": True,
            "required": False,
            "template": "team {id}",
            "hint": None,
        },
        {"name": "X-Plan", "secret": False, "required": True, "template": None, "hint": None},
        {"name": "X-Pair", "secret": True, "required": False, "template": None, "hint": None},
        {"name": "X-Trace", "secret": False, "required": False, "template": None, "hint": None},
    ]


def test_slim_drops_header_declarations_a_registry_entry_must_not_set():
    headers = [{"name": n, "isRequired": True} for n in (
        "Host", "cookie", "Content-Length", "TRANSFER-ENCODING", "Accept", "Content-Type",
        "Accept-Encoding", "Connection", "", "Bad Name", "X-Bad\r\nInjected", "X-Api-Key",
    )]  # fmt: skip
    slim = slim_registry_entry(_server(remotes=[_remote(headers=headers)]))
    assert [h["name"] for h in slim["headers"]] == ["X-Api-Key"]


@pytest.mark.parametrize(
    "website", ["javascript:alert(1)", "http://acme.dev", "Https://acme.dev", "data:text/html,x", 7]
)
def test_slim_keeps_a_website_only_when_it_is_https(website):
    assert slim_registry_entry(_server(websiteUrl=website))["website"] is None


# ---- the registry snapshot: entries, search, custom (B1.1) ----


def test_registry_entries_take_a_key_when_the_registry_declares_a_secret_or_required_header(
    registry_file,
):
    registry_file(
        _server(
            "com.apify/apify-mcp-server",
            remotes=[
                _remote(
                    "https://mcp.apify.com/",
                    headers=[
                        {
                            "name": "Authorization",
                            "description": "Apify API token",
                            "isRequired": True,
                            "isSecret": True,
                        },
                        {"name": "X-Trace", "description": "Optional trace id"},
                    ],
                )
            ],
        ),
        _server("app.linear/linear", title="Linear", websiteUrl="https://linear.app"),
        _server(
            "io.github.pollinations/exa",
            title="Exa Search",
            remotes=[
                _remote(
                    "https://gen.pollinations.ai/mcp/exa",
                    kind="sse",
                    headers=[{"name": "X-API-Key", "value": "{key}", "isSecret": True}],
                )
            ],
        ),
    )
    apify = resolve("com.apify/apify-mcp-server")
    assert apify | {"headers": None, "revoke_hint": None} == {
        "key": "com.apify/apify-mcp-server",
        "name": "Apify",  # no title in the registry: read from the server name
        "publisher": "apify.com",
        "category": None,
        "description": "Acme things.",
        "website": None,
        "url": "https://mcp.apify.com/",
        "transport": "streamable-http",
        "auth": "api_key",
        # Only what the user has to give: the optional, non-secret header isn't asked for.
        "key_fields": [
            {
                "id": "Authorization",
                "label": "API key",
                "hint": "Apify API token",
                "secret": True,
                "required": True,
            }
        ],
        "headers": None,
        "read_only_by": "annotations",
        "access_modes": ["read", "write"],
        "revoke_hint": None,
        "featured": False,
    }
    assert "Apify" in apify["revoke_hint"]
    assert [h["name"] for h in apify["headers"]] == ["Authorization", "X-Trace"]

    linear = resolve("app.linear/linear")
    assert (linear["name"], linear["publisher"], linear["auth"], linear["key_fields"]) == (
        "Linear (linear.app)",  # off the Featured host, so not the Featured card: never bare
        "linear.app",
        "unknown",  # decided by discovery when you connect
        [],
    )
    exa = resolve("io.github.pollinations/exa")
    assert (exa["publisher"], exa["transport"], exa["auth"]) == (
        "github.com/pollinations",
        "sse",
        "api_key",
    )
    assert exa["key_fields"] == [
        # The registry calls it secret, not required.
        {"id": "X-API-Key", "label": "API key", "hint": "", "secret": True, "required": False}
    ]


@pytest.mark.parametrize(
    ("key", "name"),
    [
        ("com.apify/apify-mcp-server", "Apify"),
        ("io.github.getsentry/sentry-mcp", "Sentry (github.com/getsentry)"),  # a Featured name
        ("io.github.getsentry/sentry-tools", "Sentry Tools"),
        ("io.github.acme/mcp_weather_tools", "Weather Tools"),
        ("dev.acme/mcp", "Acme"),
        ("dev.acme/server", "Acme"),
    ],
)
def test_a_registry_entry_without_a_title_is_named_after_its_server_name(registry_file, key, name):
    registry_file(_server(key))
    assert resolve(key)["name"] == name


def test_search_lists_featured_first_then_the_registry_by_name(registry_file):
    registry_file(
        _server("dev.zeta/mcp", title="zeta", remotes=[_remote("https://mcp.zeta.dev/mcp")]),
        _server("dev.beta/mcp", title="Beta", remotes=[_remote("https://mcp.beta.dev/mcp")]),
        _server("dev.alpha/mcp", title="alpha", remotes=[_remote("https://mcp.alpha.dev/mcp")]),
    )
    items, total = search()
    assert total == 17 and len(items) == 17
    assert [e["key"] for e in items[:14]] == list(FEATURED)
    assert [e["name"] for e in items[14:]] == ["alpha", "Beta", "zeta"]  # case-insensitive order


def test_every_featured_entry_fits_on_the_first_page():
    """Browse reads the registry's count as ``total`` minus the Featured cards on the page it
    loaded, and asks for the default page. So the Featured list must fit on one."""
    assert len(FEATURED) <= connector_catalog.DEFAULT_LIMIT
    items, _total = search()
    assert [e["key"] for e in items if e["featured"]] == list(FEATURED)


def test_search_pages_with_offset_and_limit(registry_file):
    registry_file(
        *[
            _server(
                f"dev.n{i:02}/mcp", title=f"N{i:02}", remotes=[_remote(f"https://n{i}.dev/mcp")]
            )
            for i in range(10)
        ]
    )
    everything, total = search(limit=100)
    assert total == 24 and len(everything) == 24
    page, total = search(offset=12, limit=5)
    assert total == 24 and page == everything[12:17]  # spans Featured and the registry
    assert search(offset=24, limit=5) == ([], 24)
    assert search(offset=20)[0] == everything[20:]  # the default limit covers it


def test_search_q_matches_name_publisher_description_and_host_whatever_the_case(registry_file):
    registry_file(
        _server("dev.weather/mcp", title="Weather", description="Forecasts."),
        _server("com.rainco/mcp", title="Second", description="Nothing here."),
        _server("dev.third/mcp", title="Third", description="All about RAIN gauges."),
        _server("dev.fourth/mcp", title="Fourth", remotes=[_remote("https://rain.example/mcp")]),
        _server("dev.fifth/mcp", title="Fifth", description="Dry."),
    )
    assert [e["name"] for e in search("rain")[0]] == ["Fourth", "Second", "Third"]
    assert [e["name"] for e in search("WEATHER")[0]] == ["Weather"]
    assert search("  weather ")[1] == 1  # surrounding spaces don't count
    # Featured entries are searched the same way: name, publisher, description, host.
    assert [e["key"] for e in search("supa")[0]] == ["supabase"]
    assert [e["key"] for e in search("googleapis")[0]] == list(GOOGLE)
    assert [e["key"] for e in search("confluence")[0]] == ["atlassian"]
    assert search("no such connector anywhere") == ([], 0)


def test_search_by_category_is_featured_only(registry_file):
    registry_file(_server("dev.databases/mcp", title="databases", description="databases"))
    items, total = search(category="databases")
    assert [e["key"] for e in items] == ["supabase", "neon"] and total == 2
    assert [e["key"] for e in search("neon", category="databases")[0]] == ["neon"]
    assert search(category="nope") == ([], 0)


def test_a_registry_entry_on_a_featured_host_is_left_out(registry_file):
    registry_file(
        _server(
            "com.supabase/mcp",
            title="Supabase MCP",
            remotes=[_remote("https://mcp.supabase.com/mcp")],
        ),
        _server("dev.squat/mcp", title="Squat", remotes=[_remote("https://MCP.Linear.app/other")]),
        _server("dev.kept/mcp", title="Kept", remotes=[_remote("https://api.supabase.com/mcp")]),
    )
    items, total = search(limit=100)
    assert total == 15 and [e["key"] for e in items[14:]] == ["dev.kept/mcp"]
    assert resolve("com.supabase/mcp") is None and resolve("dev.squat/mcp") is None


def test_a_registry_entry_never_carries_a_featured_connectors_bare_name(registry_file):
    registry_file(
        _server(
            "ai.waystation/supabase",
            title="Supabase",
            remotes=[_remote("https://waystation.ai/supabase/mcp")],
        ),
        # Spelled another way: case, spacing and a zero-width space don't make it another name.
        _server(
            "dev.shout/mcp",
            title="GOOGLE  drive\u200b",
            remotes=[_remote("https://mcp.shout.dev/mcp")],
        ),
        # Named from its key, with no title.
        _server("io.github.squat/neon-mcp", remotes=[_remote("https://neon.squat.dev/mcp")]),
        _server(
            "dev.tools/mcp", title="Supabase Tools", remotes=[_remote("https://mcp.tools.dev/mcp")]
        ),
    )
    assert resolve("ai.waystation/supabase")["name"] == "Supabase (waystation.ai)"
    assert resolve("dev.shout/mcp")["name"] == "GOOGLE  drive\u200b (shout.dev)"
    assert resolve("io.github.squat/neon-mcp")["name"] == "Neon (github.com/squat)"
    assert resolve("dev.tools/mcp")["name"] == "Supabase Tools"  # only the exact name is taken
    assert [e["name"] for e in search("supabase")[0]] == [
        "Supabase",
        "Supabase (waystation.ai)",
        "Supabase Tools",
    ]
    assert FEATURED["supabase"]["name"] == "Supabase"


def test_custom_entry_is_keyed_by_host_and_path():
    entry = custom_entry("https://MCP.Acme.dev/mcp?tenant=7", "Acme")
    assert entry | {"revoke_hint": None} == {
        "key": "custom:mcp.acme.dev/mcp",
        "name": "Acme",
        "publisher": None,
        "category": None,
        "description": "",
        "website": None,
        "url": "https://MCP.Acme.dev/mcp?tenant=7",  # the address as given
        "transport": "streamable-http",
        "auth": "unknown",
        "key_fields": [],
        "headers": [],
        "read_only_by": "annotations",
        "access_modes": ["read", "write"],
        "revoke_hint": None,
        "featured": False,
    }
    assert custom_entry("https://mcp.acme.dev", " ")["key"] == "custom:mcp.acme.dev"
    assert custom_entry("https://mcp.acme.dev", " ")["name"] == "mcp.acme.dev"  # no name given
    assert custom_entry("https://mcp.acme.dev:8443/x", None)["key"] == "custom:mcp.acme.dev:8443/x"
    assert custom_entry("http://127.0.0.1:9911/mcp", "Local")["key"] == "custom:127.0.0.1:9911/mcp"

"""Connectors: the catalog. What can be connected, and what counts as a write.

``FEATURED`` is the curated list (a module constant: no database, no network), in display order.
Behind it is a snapshot of the public MCP Registry's remote servers, bundled in the repo as JSON
Lines (``data/connector_registry.jsonl``, written by ``scripts/refresh_connector_registry.py``
through :func:`slim_registry_entry`), and any custom address. ``resolve`` finds all three.

An entry is a plain dict. Every Featured entry has ``key``, ``name``, ``publisher``, ``category``,
``description``, ``website``, ``url``, ``transport``, ``auth``, ``key_fields``, ``read_only_by``,
``access_modes``, ``revoke_hint`` and ``featured: True``. Optional:

* ``read_only_params``: query parameters the proxy adds to the address when the access is
  ``read`` (the agent can't remove them).
* ``scope_picker``: ``{"param", "label", "tool"}``. ``param`` is the query parameter that scopes
  the connection to one project; ``tool`` is the provider tool that lists the choices.
* ``client``: the name of a pre-registered OAuth client (``"google"``). ``scope``: the OAuth scope
  that sign-in asks for. ``oauth_hosts``: extra hosts its sign-in endpoints may be on (the mix-up
  check otherwise keeps them on the issuer's site). Only a Featured entry can carry these.
* ``coming_soon``: shown, but can't be connected yet.

A registry or custom entry has the same required fields with ``featured: False``, ``category:
None`` and ``read_only_by: "annotations"``, never one of the optional ones above, plus
``headers``: the registry's header declarations (``{"name", "secret", "required", "template",
"hint"}``) that a key is turned into.

Contract: ``docs/superpowers/plans/api/connectors.md`` (Catalog, Read or write).
"""

import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from tvashtr.config import get_settings

CATEGORIES = ["databases", "docs", "analytics", "crm", "work"]

_PROJECT_TOOL = "list_projects"
_GOOGLE_OAUTH_HOSTS = ["accounts.google.com", "oauth2.googleapis.com"]


def _featured(
    key: str,
    name: str,
    category: str,
    url: str,
    website: str,
    description: str,
    *,
    publisher: str | None = None,
    read_only_by: str = "annotations",
    **extra: object,
) -> dict:
    publisher = publisher or name
    return {
        "key": key,
        "name": name,
        "publisher": publisher,
        "category": category,
        "description": description,
        "website": website,
        "url": url,
        "transport": "streamable-http",
        "auth": "oauth",
        "key_fields": [],
        "read_only_by": read_only_by,
        "access_modes": ["read", "write"],
        "revoke_hint": (
            f"To remove Tvashtr on {publisher}’s side too, revoke it in {publisher}’s settings."
        ),
        "featured": True,
        **extra,
    }


def _google(key: str, name: str, host: str, scope: str, description: str) -> dict:
    """A Google Workspace card: Tvashtr's own Google client, read-only scopes, read only in v1."""
    return _featured(
        key,
        name,
        "docs",
        f"https://{host}.googleapis.com/mcp/v1",
        "https://workspace.google.com",
        description,
        publisher="Google",
        read_only_by="scopes",
        client="google",
        scope=f"https://www.googleapis.com/auth/{scope}",
        oauth_hosts=_GOOGLE_OAUTH_HOSTS,
        # Google gives a refresh token only with ``offline``, and on a later sign-in only when
        # it asks for consent again.
        authorize_params={"access_type": "offline", "prompt": "consent"},
        access_modes=["read"],
        revoke_hint=(
            "To remove Tvashtr on Google’s side too, open your Google Account, "
            "then Security, then Third-party access."
        ),
    )


_ENTRIES = [
    _featured(
        "supabase",
        "Supabase",
        "databases",
        "https://mcp.supabase.com/mcp",
        "https://supabase.com",
        "Read tables, run read-only SQL and check logs in one project.",
        # Trusted on its own: under the flag, SQL runs as a read-only Postgres user.
        read_only_by="provider",
        read_only_params={"read_only": "true"},
        scope_picker={"param": "project_ref", "label": "Project", "tool": _PROJECT_TOOL},
    ),
    _featured(
        "neon",
        "Neon",
        "databases",
        "https://mcp.neon.tech/mcp",
        "https://neon.com",
        "Look at branches, schemas and query results in one Neon project.",
        # Neon gets its flag AND the annotation rule: under ``readonly=true`` it hides its write
        # tools, but ``run_sql`` can still write.
        read_only_params={"readonly": "true"},
        scope_picker={"param": "projectId", "label": "Project", "tool": _PROJECT_TOOL},
    ),
    _featured(
        "notion",
        "Notion",
        "docs",
        "https://mcp.notion.com/mcp",
        "https://www.notion.com",
        "Search and read pages and databases in your Notion workspace.",
    ),
    _google(
        "google-drive",
        "Google Drive",
        "drivemcp",
        "drive.readonly",
        "Find and read the files in your Google Drive.",
    ),
    _google(
        "google-docs",
        "Google Docs",
        "docsmcp",
        "documents.readonly",
        "Read the text of your Google Docs.",
    ),
    _google(
        "google-sheets",
        "Google Sheets",
        "sheetsmcp",
        "spreadsheets.readonly",
        "Read the rows and cells of your Google Sheets.",
    ),
    _featured(
        "posthog",
        "PostHog",
        "analytics",
        "https://mcp.posthog.com/mcp",
        "https://posthog.com",
        "Query product analytics, feature flags and error tracking.",
    ),
    _featured(
        "mixpanel",
        "Mixpanel",
        "analytics",
        "https://mcp.mixpanel.com/mcp",
        "https://mixpanel.com",
        "Run reports on events, funnels and retention.",
    ),
    _featured(
        "amplitude",
        "Amplitude",
        "analytics",
        "https://mcp.amplitude.com/mcp",
        "https://amplitude.com",
        "Look up charts, dashboards, cohorts and experiments.",
    ),
    _featured(
        "hubspot",
        "HubSpot",
        "crm",
        "https://mcp.hubspot.com/",
        "https://www.hubspot.com",
        "Look up contacts, companies, deals and tickets.",
        # HubSpot needs an app registered per portal; no dynamic registration.
        coming_soon=True,
    ),
    _featured(
        "intercom",
        "Intercom",
        "crm",
        "https://mcp.intercom.com/mcp",
        "https://www.intercom.com",
        "Search conversations and contacts from your support inbox.",
    ),
    _featured(
        "linear",
        "Linear",
        "work",
        "https://mcp.linear.app/mcp",
        "https://linear.app",
        "Find, read and update issues, projects and cycles.",
    ),
    _featured(
        "sentry",
        "Sentry",
        "work",
        "https://mcp.sentry.dev/mcp",
        "https://sentry.io",
        "Look into errors, traces and releases across your projects.",
    ),
    _featured(
        "atlassian",
        "Atlassian",
        "work",
        "https://mcp.atlassian.com/v2/mcp",
        "https://www.atlassian.com",
        "Search and read Jira issues and Confluence pages.",
    ),
]

FEATURED: dict[str, dict] = {entry["key"]: entry for entry in _ENTRIES}


def available(entry: dict) -> bool:
    """Whether the entry can be connected now. False for a ``coming_soon`` entry, and for a
    Google card until both Google client settings are set."""
    if entry.get("coming_soon"):
        return False
    if entry.get("client") == "google":
        settings = get_settings()
        return bool(
            settings.google_oauth_client_id
            and settings.google_oauth_client_secret.get_secret_value()
        )
    return True


# ---- the registry snapshot ----

REGISTRY_PATH = Path(__file__).parent / "data" / "connector_registry.jsonl"
DEFAULT_LIMIT = 48

_OFFICIAL = "io.modelcontextprotocol.registry/official"
_TEXT_LIMIT = 200
_TRANSPORTS = ("streamable-http", "sse")  # in the order a remote is picked
# Header declarations a registry entry may not make: they would change where a request goes or
# how Tvashtr's MCP client and its response limits work, not how the user is known.
_REFUSED_HEADERS = frozenset(
    {
        "host",
        "cookie",
        "content-length",
        "transfer-encoding",
        "accept",
        "accept-encoding",
        "content-type",
        "connection",
    }
)
# A header that carries money: an x402 payment, a crypto wallet or its private key, a pay-per-call
# token. A server that declares one is not a connector (the key form would ask for it, and the
# proxy would then send it on every agent call).
_PAYMENT_HEADER = re.compile(r"payment|wallet|private[-_]?key|pay[-_]?id", re.IGNORECASE)
_SERVER_NAME = re.compile(r"[A-Za-z0-9.-]+/[A-Za-z0-9._-]+")  # the registry's own rule
_HEADER_NAME = re.compile(r"[A-Za-z0-9!#$%&'*+.^_`|~-]+")
_PLACEHOLDER = re.compile(r"\{[^{}]*\}")
_UNSAFE_ADDRESS = re.compile(r"[\s\\\x00-\x1f\x7f{}]")


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _list(value: object) -> list:
    """A registry field that should be a list, or nothing when it isn't one."""
    return value if isinstance(value, list) else []


def _dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _fixed_https(url: object) -> bool:
    """A plain ``https://`` address: no ``{template}``, no user name, nothing a browser and Python
    would read differently, and nothing that prints like another host: ASCII only (a Cyrillic
    ``а`` makes ``mcp.supаbase.com``) and no trailing dot on the host (``mcp.supabase.com.`` is
    the same server under another name). (Whether it is a public address is checked when it is
    connected.)"""
    if not isinstance(url, str) or not url.isascii() or not url.startswith("https://"):
        return False
    if _UNSAFE_ADDRESS.search(url):
        return False
    try:
        parts = urlsplit(url)
        parts.port  # noqa: B018  (raises on a port that isn't a number)
    except ValueError:
        return False
    host = parts.hostname or ""
    return bool(host) and not host.endswith(".") and "@" not in parts.netloc


def _slim_header(header: object) -> dict | None:
    name = _text(header.get("name")) if isinstance(header, dict) else ""
    if not _HEADER_NAME.fullmatch(name) or name.lower() in _REFUSED_HEADERS:
        return None
    variables = header.get("variables")
    variables = variables.values() if isinstance(variables, dict) else ()
    value = header.get("value")
    # A template Tvashtr can fill has exactly one placeholder (``Bearer {api_key}``). A fixed
    # value is the publisher's example, not something to send.
    fills = isinstance(value, str) and len(_PLACEHOLDER.findall(value)) == 1
    return {
        "name": name,
        "secret": bool(
            header.get("isSecret")
            or any(isinstance(v, dict) and v.get("isSecret") for v in variables)
        ),
        "required": bool(header.get("isRequired")),
        "template": value if fills else None,
        "hint": _text(header.get("description"))[:_TEXT_LIMIT] or None,
    }


def slim_registry_entry(server_json: object) -> dict | None:
    """One item of the MCP Registry's server list (``{"server": …, "_meta": …}``) as a line of the
    snapshot, or ``None`` when it can't be a connector: not ``active``, a Smithery proxy (it needs
    a Smithery key, not the vendor's), no remote with a fixed ``https://`` address, or a server
    that takes payment per call or asks for a wallet (a header named like ``Payment-Signature``,
    ``X-PAYMENT``, ``X-Wallet-Key`` or ``…-Private-Key``, on any remote). The first
    ``streamable-http`` remote is kept, else the first ``sse`` one. No icons: the UI uses letter
    tiles. An item that breaks the registry's own shape is dropped too, never an exception (one
    bad item must not stop a refresh)."""
    if not isinstance(server_json, dict) or not isinstance(server_json.get("server"), dict):
        return None
    server = server_json["server"]
    meta = _dict(_dict(server_json.get("_meta")).get(_OFFICIAL))
    key = _text(server.get("name"))
    if meta.get("status") != "active" or not _SERVER_NAME.fullmatch(key):
        return None
    if key.startswith("ai.smithery/"):
        return None
    remotes = [r for r in _list(server.get("remotes")) if isinstance(r, dict)]
    declared = [h for r in remotes for h in _list(r.get("headers")) if isinstance(h, dict)]
    if any(_PAYMENT_HEADER.search(_text(h.get("name"))) for h in declared):
        return None
    fixed = [r for r in remotes if r.get("type") in _TRANSPORTS and _fixed_https(r.get("url"))]
    if not fixed:
        return None
    remote = min(fixed, key=lambda r: _TRANSPORTS.index(r["type"]))  # stable: the first of its kind
    website = server.get("websiteUrl")
    headers = [_slim_header(h) for h in _list(remote.get("headers"))]
    return {
        "key": key,
        "title": _text(server.get("title")) or None,
        "description": _text(server.get("description"))[:_TEXT_LIMIT],
        "website": website if _fixed_https(website) else None,
        "url": remote["url"],
        "transport": remote["type"],
        "headers": [h for h in headers if h],
    }


def _plain(name: str, **fields: object) -> dict:
    """The fields a registry entry and a custom entry share: not reviewed, no category, the
    annotation rule, and nothing only a Featured entry may pin."""
    return {
        "category": None,
        "read_only_by": "annotations",
        "access_modes": ["read", "write"],
        "revoke_hint": f"To remove Tvashtr on {name}’s side too, revoke it in {name}’s settings.",
        "featured": False,
        "name": name,
        **fields,
    }


_GENERIC_WORDS = frozenset({"mcp", "server", "remote"})


def _name_from_key(key: str) -> str:
    """A display name for a registry server that has no ``title``: its own name without the MCP
    boilerplate (``apify-mcp-server`` → ``Apify``), else its publisher's last label."""
    namespace, _, tail = key.partition("/")
    words = [w for w in re.split(r"[-_.\s]+", tail) if w and w.lower() not in _GENERIC_WORDS]
    if [w.lower() for w in words] == ["site"]:
        words = []  # "site" alone names nothing either (521 registry servers are called that)
    return " ".join(words).title() or namespace.rsplit(".", 1)[-1].title()


def _publisher(key: str) -> str:
    """Who published a registry server, from its verified namespace: ``com.apify`` is
    ``apify.com``, ``io.github.getsentry`` is ``github.com/getsentry``."""
    namespace = key.partition("/")[0]
    if namespace.startswith("io.github."):
        return "github.com/" + namespace.removeprefix("io.github.")
    return ".".join(reversed(namespace.split(".")))


def _key_label(header_name: str) -> str:
    return "API key" if header_name.lower() in ("authorization", "x-api-key") else header_name


def _name_key(name: str) -> str:
    """A name as it is compared: its letters and digits in lower case, so case, spacing,
    punctuation and zero-width characters don't make another name."""
    return "".join(ch for ch in name.casefold() if ch.isalnum())


_FEATURED_NAMES = frozenset(_name_key(entry["name"]) for entry in _ENTRIES)


def _registry_name(slim: dict) -> str:
    """The registry entry's display name. One that is a Featured connector's name is shown with
    its publisher (``Supabase (waystation.ai)``): only the Featured card is called ``Supabase``."""
    name = slim.get("title") or _name_from_key(slim["key"])
    if _name_key(name) in _FEATURED_NAMES:
        return f"{name} ({_publisher(slim['key'])})"
    return name


def _registry_entry(slim: dict) -> dict:
    headers = slim.get("headers") or []
    # The user is asked only for what the registry calls secret or required.
    fields = [
        {
            "id": h["name"],
            "label": _key_label(h["name"]),
            "hint": h.get("hint") or "",
            "secret": h["secret"],
            # An optional one may be left empty (``connectors._key_headers`` needs the required
            # ones and at least one value).
            "required": h["required"],
        }
        for h in headers
        if h["secret"] or h["required"]
    ]
    return _plain(
        _registry_name(slim),
        key=slim["key"],
        publisher=_publisher(slim["key"]),
        description=slim.get("description") or "",
        website=slim.get("website"),
        url=slim["url"],
        transport=slim["transport"],
        auth="api_key" if fields else "unknown",
        key_fields=fields,
        headers=headers,
    )


def header_value(declaration: dict, value: str) -> str:
    """The header a key is sent as: the registry's template with the key in its placeholder
    (``Bearer {api_key}``), else the key itself. A bare key for an ``Authorization`` header with
    no template gets ``Bearer `` in front; one that already reads ``<scheme> <token>`` is kept."""
    template = declaration.get("template")
    if template:
        return _PLACEHOLDER.sub(lambda _: value, template)
    if declaration["name"].lower() == "authorization" and " " not in value:
        return f"Bearer {value}"
    return value


def _host(entry: dict) -> str:
    return (urlsplit(entry["url"]).hostname or "").lower()


def _haystack(entry: dict) -> str:
    """What ``q`` is matched against: name, publisher, description and host."""
    parts = (entry["name"], entry.get("publisher") or "", entry["description"], _host(entry))
    return "\n".join(parts).lower()


_FEATURED_HOSTS = frozenset(_host(entry) for entry in _ENTRIES)


@lru_cache(maxsize=1)
def registry() -> dict[str, tuple[dict, str]]:
    """The bundled registry snapshot: ``{key: (entry, search text)}`` in name order. Read on first
    use, not at import. An entry on a Featured host is left out (the Featured card wins). No
    snapshot file is an empty registry."""
    try:
        # JSON Lines: only a line feed ends a line (``splitlines`` also cuts at U+2028 and U+0085,
        # which a description may carry).
        lines = REGISTRY_PATH.read_text(encoding="utf-8").split("\n")
    except FileNotFoundError:
        return {}
    entries = [_registry_entry(json.loads(line)) for line in lines if line.strip()]
    entries = [e for e in entries if _host(e) not in _FEATURED_HOSTS]
    # A name several servers share is shown with its publisher, as a Featured name is: a card, a
    # connection and an agent's MCP server are all named after it.
    shared = Counter(_name_key(e["name"]) for e in entries)
    for e in entries:
        if shared[_name_key(e["name"])] > 1:
            e["name"] = f"{e['name']} ({e['publisher']})"
    entries.sort(key=lambda e: (e["name"].lower(), e["key"]))
    return {e["key"]: (e, _haystack(e)) for e in entries}


def search(
    q: str | None = None, category: str | None = None, offset: int = 0, limit: int = DEFAULT_LIMIT
) -> tuple[list[dict], int]:
    """``(the page of entries, how many match)``: Featured first in catalog order, then the
    registry by name. ``q`` is a case-insensitive substring of name, publisher, description or
    host. ``category`` narrows to the Featured entries of that category."""
    needle = (q or "").strip().lower()
    found = [
        e
        for e in _ENTRIES
        if (not category or e["category"] == category) and needle in _haystack(e)
    ]
    if not category:
        found += [entry for entry, text in registry().values() if needle in text]
    return found[offset : offset + limit], len(found)


_CUSTOM = "custom:"


def custom_entry(url: str, name: str | None) -> dict:
    """The entry for a custom address. Its key is ``custom:<host><path>`` (the host in lower case,
    with its port when it has one, and no query)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if ":" in host:
        host = f"[{host}]"  # an IPv6 literal
    place = host + (f":{parts.port}" if parts.port else "")
    return _plain(
        _text(name) or place,
        key=f"{_CUSTOM}{place}{parts.path}",
        publisher=None,
        description="",
        website=None,
        url=url,
        transport="streamable-http",
        auth="unknown",
        key_fields=[],
        headers=[],
    )


def resolve(key: object) -> dict | None:
    """The catalog entry for ``key``, or ``None``: a Featured key, a registry server name, or a
    ``custom:<host><path>`` key (whose entry is rebuilt from the key, so its ``name`` is the host
    and its ``url`` has no query: a connection keeps its own). The entry is shared: don't mutate
    it."""
    if not isinstance(key, str):
        return None
    if key in FEATURED:
        return FEATURED[key]
    if key.startswith(_CUSTOM):
        url = "https://" + key.removeprefix(_CUSTOM)
        return custom_entry(url, None) if _fixed_https(url) else None
    found = registry().get(key)
    return found[0] if found else None


def card(entry: dict) -> dict:
    """The entry as ``GET /api/connectors/catalog`` returns it, before this account's connection
    is marked on it. ``reviewed`` is true only for Featured."""
    picker = entry.get("scope_picker")
    can_connect = available(entry)
    return {
        "key": entry["key"],
        "name": entry["name"],
        "publisher": entry.get("publisher"),
        "featured": entry["featured"],
        "reviewed": entry["featured"],
        "category": entry.get("category"),
        "description": entry["description"],
        "website": entry.get("website"),
        "host": _host(entry),
        "auth": entry["auth"],
        "key_fields": entry["key_fields"],
        "access_modes": entry["access_modes"],
        "read_only_by": entry["read_only_by"],
        "scope_picker": {"param": picker["param"], "label": picker["label"]} if picker else None,
        "available": can_connect,
        "unavailable_reason": None if can_connect else "coming_soon",
        "connection_id": None,
        "connection_status": None,
    }


def is_write(entry: dict | None, tool: dict, access: str) -> bool:
    """Whether Tvashtr counts ``tool`` (a stored ``{"name", "title", "read_only"}``) as a write at
    the effective ``access``. The one rule behind ``tools[].write``, the run-time filter and the
    counts.

    * A ``read_only_by: "provider"`` entry (Supabase) at access ``read``: every tool the provider
      lists under its read-only flag is a read.
    * Otherwise a tool is a read only when the server annotated it ``readOnlyHint: true``. A
      missing annotation is a write. That covers Neon in read mode too: its flag is applied, but
      it isn't trusted.

    ``entry`` may be ``None`` (a connection whose key no longer resolves): the annotation decides.
    """
    if access == "read" and (entry or {}).get("read_only_by") == "provider":
        return False
    return tool.get("read_only") is not True

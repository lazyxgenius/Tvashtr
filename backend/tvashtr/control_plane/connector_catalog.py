"""Connectors: the catalog. What can be connected, and what counts as a write.

``FEATURED`` is the curated list (a module constant: no database, no network), in display order.
Stream B1 adds the bundled MCP Registry snapshot and custom addresses behind the same ``resolve``.

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

Contract: ``docs/superpowers/plans/api/connectors.md`` (Catalog, Read or write).
"""

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


def resolve(key: object) -> dict | None:
    """The catalog entry for ``key``, or ``None``. Featured keys for now; stream B1 adds registry
    server names and ``custom:<host><path>`` keys. The entry is shared: don't mutate it."""
    return FEATURED.get(key) if isinstance(key, str) else None


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

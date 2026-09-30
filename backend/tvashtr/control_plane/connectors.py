"""Connectors: connections (the rules behind ``/api/connectors``) and the helpers every stream
shares.

Shared with the OAuth and run-time streams: :class:`ConnectorError`, :func:`get_owned`,
:func:`read_secret`, :func:`write_secret`, :func:`stored_tools`, :func:`serialize`,
:func:`upstream_headers`, :func:`upstream_target`. The rest is what the routes in
``routes/connectors.py`` call. Contract: ``docs/superpowers/plans/api/connectors.md``.

A grant is an item of an agent node's ``tool_config.tvashtr.connectors``: ``{"id", "access"?}``.
Only the owner's LIBRARY teams and their ``agent``/``completion`` nodes count, as for tools
(``tool_usage``): run-snapshot clones are run history and are never read or rewritten here.
"""

import json
import re
import time
import uuid
from datetime import UTC, datetime
from urllib.parse import urlsplit

from mcp import McpError
from mcp.types import Tool
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tvashtr.control_plane import (
    connector_catalog,
    connector_net,
    connector_oauth,
    connector_proxy,
    connector_upstream,
)
from tvashtr.control_plane.credentials import decrypt_secret, encrypt_secret
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.tool_usage import owner_agent_nodes, usage_counts, usage_row
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection

NOT_FOUND = "Connector not found."
SIGNIN_TTL_SECONDS = 600  # a started sign-in is pending for ten minutes
NAME_LIMIT = 60
SLUG_LIMIT = 40
URL_LIMIT = 2000
KEY_LIMIT = 4096  # characters of one key value


class ConnectorError(Exception):
    """A rule violation with the HTTP status and ``detail`` (a user-facing string, or a
    ``{code, message, …}`` dict) the route returns verbatim."""

    def __init__(self, status_code: int, detail: str | dict) -> None:
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


def get_owned(
    session: Session, owner_id: uuid.UUID, connection_id: object, *, for_update: bool = False
) -> ConnectorConnection:
    """The owner's connection, or a 404 :class:`ConnectorError` (an unparseable, absent or foreign
    id all answer the same). ``for_update`` takes the row lock (``SELECT … FOR UPDATE``): the one
    lock every writer of the stored sign-in holds before it reads or writes that sign-in."""
    rid = _as_uuid(connection_id)
    query = select(ConnectorConnection).where(
        ConnectorConnection.id == rid, ConnectorConnection.owner_id == owner_id
    )
    if for_update:
        query = query.with_for_update()
    row = session.execute(query).scalar_one_or_none() if rid is not None else None
    if row is None:
        raise ConnectorError(404, NOT_FOUND)
    return row


def _column(pending: bool) -> str:
    return "pending_encrypted" if pending else "secret_encrypted"


def read_secret(row: ConnectorConnection, *, pending: bool = False) -> dict | None:
    """The decrypted sign-in JSON (``secret_encrypted``), or the sign-in in flight with
    ``pending=True`` (``pending_encrypted``). ``None`` when the column is empty. Never return or
    log what this gives back."""
    ciphertext = getattr(row, _column(pending))
    return json.loads(decrypt_secret(ciphertext)) if ciphertext else None


def write_secret(row: ConnectorConnection, value: dict | None, *, pending: bool = False) -> None:
    """Encrypt ``value`` onto the row (``None`` clears the column). The caller's session commits."""
    setattr(row, _column(pending), encrypt_secret(json.dumps(value)) if value is not None else None)


def stored_tools(tools: list[Tool]) -> list[dict]:
    """A provider's tool list in the shape kept in ``tools``: ``{"name", "title", "read_only"}``.
    ``read_only`` is true only for an explicit ``readOnlyHint: true``."""
    return [
        {
            "name": tool.name,
            "title": tool.title or (tool.annotations.title if tool.annotations else None),
            "read_only": bool(tool.annotations and tool.annotations.readOnlyHint is True),
        }
        for tool in tools
    ]


def _signin(row: ConnectorConnection) -> tuple[str | None, bool]:
    """``(signin_host, signin_pending)`` for an OAuth connection, from the sign-in in flight and
    then the stored one."""
    if row.auth_kind != "oauth":
        return None, False
    pending = read_secret(row, pending=True) or {}
    stored = read_secret(row) or {}
    endpoint = (
        pending.get("authorization_endpoint")
        or stored.get("authorization_endpoint")
        or pending.get("issuer")
        or stored.get("issuer")
    )
    started = pending.get("started_at")
    in_flight = (
        row.state_hash is not None
        and isinstance(started, int | float)
        and time.time() - started < SIGNIN_TTL_SECONDS
    )
    return (urlsplit(endpoint).hostname if endpoint else None), in_flight


def serialize(row: ConnectorConnection, users: list[dict] | None = None) -> dict:
    """One connection as every connection endpoint returns it. ``users`` are the usage rows of the
    agents that have it (they become ``used_by``). Nothing encrypted and no ``state_hash`` is ever
    in the result."""
    entry = connector_catalog.resolve(row.connector_key) or {}
    host = urlsplit(row.url).hostname
    signin_host, signin_pending = _signin(row)
    picker = entry.get("scope_picker")
    agent_count, team_count = usage_counts(users or [])
    tools = None
    if row.tools is not None:
        tools = []
        for tool in row.tools:
            write = connector_catalog.is_write(entry, tool, row.access)
            tools.append(
                {
                    "name": tool.get("name"),
                    "title": tool.get("title"),
                    "write": write,
                    "on": row.access == "write" or not write,
                }
            )
    return {
        "id": str(row.id),
        "connector_key": row.connector_key,
        "name": row.name,
        "slug": row.slug,
        "publisher": entry.get("publisher"),
        "featured": bool(entry.get("featured")),
        "reviewed": bool(entry.get("featured")),
        "category": entry.get("category"),
        "host": host,
        "auth_kind": row.auth_kind,
        "signin_host": signin_host,
        "signin_host_differs": bool(
            signin_host and host and connector_net.site(signin_host) != connector_net.site(host)
        ),
        "access": row.access,
        "access_modes": list(entry.get("access_modes") or ["read", "write"]),
        "read_only_by": entry.get("read_only_by") or "annotations",
        "scope": row.scope,
        "scope_picker": {"param": picker["param"], "label": picker["label"]} if picker else None,
        "status": row.status,
        "signin_pending": signin_pending,
        "last_error": row.last_error,
        "tools": tools,
        "used_by": {"agent_count": agent_count, "team_count": team_count},
        "connected_at": row.connected_at.isoformat() if row.connected_at else None,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def upstream_headers(row: ConnectorConnection, *, rejected: str | None = None) -> dict:
    """The credential headers for a request to the provider: the key's stored headers, or
    ``Authorization: Bearer`` with a token from ``connector_oauth.ensure_access_token`` (which may
    refresh; ``rejected`` is the token the provider just answered 401 to), or nothing. Raises
    ``connector_oauth.SignInRefused`` / ``Unreachable`` for an OAuth connection. Don't call it
    while holding this row's lock: the token call takes that lock in its own session."""
    if row.auth_kind == "api_key":
        return dict((read_secret(row) or {}).get("headers") or {})
    if row.auth_kind == "oauth":
        token = connector_oauth.ensure_access_token(row.id, rejected=rejected)
        return {"Authorization": f"Bearer {token}"}
    return {}


def upstream_target(row: ConnectorConnection, access: str) -> tuple[str, str]:
    """``(url, transport)`` for a request to the provider at the effective ``access``: the row's
    address plus the scope parameter, plus the entry's read-only parameters when ``access`` is
    ``read``.

    Phase 0 stub: the row's own ``url`` and ``transport``. Stream B1.5 adds the parameters."""
    return row.url, row.transport


# ---- who uses a connection ----


def grant_access(tool_config: object, connection_id: uuid.UUID) -> str | None:
    """The access of the node's grant for this connection (``read`` when the grant names none),
    or ``None`` when the node has no grant for it."""
    meta = tool_config.get("tvashtr") if isinstance(tool_config, dict) else None
    grants = meta.get("connectors") if isinstance(meta, dict) else None
    for item in grants if isinstance(grants, list) else []:
        if isinstance(item, dict) and _as_uuid(item.get("id")) == connection_id:
            return "write" if item.get("access") == "write" else "read"
    return None


def _users(nodes: list, row: ConnectorConnection) -> list[dict]:
    """The usage rows of the agents that have ``row``. ``access`` is the agent's effective
    access: ``write`` only when the connection and the grant both say so."""
    users = []
    for node, team in nodes:
        access = grant_access(node.tool_config, row.id)
        if access is not None:
            effective = "write" if access == row.access == "write" else "read"
            users.append(usage_row(node, team) | {"access": effective})
    return users


def _revoke_hint(row: ConnectorConnection) -> str | None:
    if row.auth_kind == "none":
        return None  # nothing was handed out, so there is nothing to revoke
    entry = connector_catalog.resolve(row.connector_key) or {}
    if entry.get("featured"):
        return entry["revoke_hint"]
    return f"To remove Tvashtr on {row.name}’s side too, revoke it in {row.name}’s settings."


# ---- the read routes ----


def catalog(
    owner_id: uuid.UUID, q: str | None, category: str | None, offset: int, limit: int
) -> dict:
    """``GET /api/connectors/catalog``: one page of the catalog, each entry marked with this
    account's connection to it (a ``pending`` one is not reported)."""
    if not 1 <= limit <= 100:
        raise ConnectorError(422, "limit must be between 1 and 100.")
    offset = max(offset, 0)
    entries, total = connector_catalog.search(q, category, offset, limit)
    with session_scope() as session:
        mine = {
            key: (str(connection_id), status)
            for key, connection_id, status in session.execute(
                select(
                    ConnectorConnection.connector_key,
                    ConnectorConnection.id,
                    ConnectorConnection.status,
                ).where(
                    ConnectorConnection.owner_id == owner_id,
                    ConnectorConnection.status != "pending",
                    ConnectorConnection.connector_key.in_([e["key"] for e in entries]),
                )
            )
        }
    items = []
    for entry in entries:
        connection_id, status = mine.get(entry["key"], (None, None))
        items.append(
            connector_catalog.card(entry)
            | {"connection_id": connection_id, "connection_status": status}
        )
    return {
        "items": items,
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
        "categories": connector_catalog.CATEGORIES,
    }


def list_connections(owner_id: uuid.UUID) -> list[dict]:
    """The owner's connections, oldest first, ``pending`` rows left out
    (``GET /api/connectors``). A ``needs_signin`` row names the agents that lost it
    (``used_by_agents``); the others carry ``null`` there."""
    with session_scope() as session:
        rows = session.execute(
            select(ConnectorConnection)
            .where(
                ConnectorConnection.owner_id == owner_id, ConnectorConnection.status != "pending"
            )
            .order_by(ConnectorConnection.created_at, ConnectorConnection.id)
        ).scalars()
        nodes = owner_agent_nodes(session, owner_id)
        listed = []
        for row in rows:
            users = _users(nodes, row)
            needs = row.status == "needs_signin"
            listed.append(serialize(row, users) | {"used_by_agents": users if needs else None})
        return listed


def get_connection(owner_id: uuid.UUID, connection_id: object) -> dict:
    """``GET /api/connectors/{id}``: the connection (a ``pending`` one too) with who uses it,
    its recent use and how to revoke Tvashtr at the provider."""
    with session_scope() as session:
        row = get_owned(session, owner_id, connection_id)
        users = _users(owner_agent_nodes(session, owner_id), row)
        return serialize(row, users) | {
            "used_by_agents": users,
            "recent_use": connector_proxy.recent_use(session, owner_id, row.id),
            "revoke_hint": _revoke_hint(row),
        }


# ---- connect (``POST /api/connectors``) ----


def _refusal(status_code: int, code: str, message: str, **extra: object) -> ConnectorError:
    return ConnectorError(status_code, {"code": code, "message": message, **extra})


def _unreachable(url: str) -> ConnectorError:
    return _refusal(502, "unreachable", f"We couldn’t reach {urlsplit(url).hostname}. Try again.")


_NO_SIGNIN = (
    "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the "
    "key as a secret."
)


def _entry_for(key: object, url: object, name: object) -> dict:
    """The catalog entry a connect request names: a custom address when it gives ``url``, else
    its ``key``."""
    if url is None:
        entry = connector_catalog.resolve(key) if key else None
        if entry is None:
            raise _refusal(404, "unknown_connector", "We couldn’t find that connector.")
        return entry
    try:
        if not isinstance(url, str) or len(url) > URL_LIMIT:
            raise connector_net.UnsafeUrl("not an address")
        connector_net.check_url(url)
    except connector_net.UnsafeUrl:
        raise _refusal(
            422, "invalid_url", "Use an https:// address, like https://mcp.example.com/mcp."
        ) from None
    return connector_catalog.custom_entry(url, name if isinstance(name, str) else None)


def _check_access(entry: dict, access: object, name: str) -> None:
    if access not in ("read", "write"):
        raise _refusal(422, "invalid_access", "Access is read or write.")
    if access not in entry["access_modes"]:
        raise _refusal(422, "invalid_access", f"{name} can only be connected read only.")


def _key_headers(entry: dict, credentials: object) -> dict:
    """The headers a key connection sends, from the values the user gave for the entry's key
    fields. Refuses an id the entry doesn't declare and a value that can't be a header
    (``invalid_key``), and a missing key (``key_required``)."""
    name = entry["name"]
    declared = {h["name"]: h for h in entry.get("headers") or [] if h["secret"] or h["required"]}
    values: dict[str, str] = {}
    for field, value in (credentials if isinstance(credentials, dict) else {}).items():
        sendable = (
            field in declared
            and isinstance(value, str)
            and len(value) <= KEY_LIMIT
            # It becomes a header: printable ASCII only, so no line break can add another one.
            and value.isascii()
            and value.isprintable()
        )
        if not sendable:
            raise _refusal(
                422, "invalid_key", f"That isn’t a key {name} takes. Check it and try again."
            )
        if value.strip():
            values[field] = value.strip()
    if not values or any(h["required"] and n not in values for n, h in declared.items()):
        raise _refusal(422, "key_required", f"{name} needs a key.", fields=entry["key_fields"])
    return {
        n: connector_catalog.header_value(h, values[n]) for n, h in declared.items() if n in values
    }


def _list_tools(row: ConnectorConnection, headers: dict, wants_credentials: ConnectorError) -> list:
    """The provider's tools in the stored shape, listed with ``headers`` at the row's access. A
    401 or 403 raises ``wants_credentials``; anything else that isn't a tool list is
    ``unreachable``."""
    url, transport = upstream_target(row, row.access)
    try:
        return stored_tools(connector_upstream.list_tools_sync(url, transport, headers))
    except connector_upstream.UpstreamUnauthorized:
        raise wants_credentials from None
    except connector_upstream.UpstreamRefused as exc:
        raise (wants_credentials if exc.status == 403 else _unreachable(row.url)) from None
    except (connector_upstream.UpstreamUnreachable, McpError):
        raise _unreachable(row.url) from None


def _discover(entry: dict, url: str) -> connector_oauth.Discovery | None:
    try:
        return connector_oauth.discover(url, entry)
    except connector_oauth.CannotRegister:
        raise _refusal(
            422,
            "cannot_register",
            f"{entry['name']} needs an app registered with it before Tvashtr can sign in.",
        ) from None
    except (connector_oauth.Unreachable, connector_net.UnsafeUrl):
        raise _unreachable(url) from None


def _found_signin(found: connector_oauth.Discovery) -> dict:
    """What discovery found, as ``pending_encrypted`` holds it before a sign-in is started: no
    verifier, no client and no ``started_at`` (``oauth/start`` repeats discovery and adds them)."""
    pending = {
        "issuer": found.issuer,
        "iss_supported": found.iss_supported,
        "authorization_endpoint": found.authorization_endpoint,
        "token_endpoint": found.token_endpoint,
        "resource": found.resource,
    }
    if found.revocation_endpoint:
        pending["revocation_endpoint"] = found.revocation_endpoint
    if found.scope:
        pending["scope"] = found.scope
    return pending


def _new_slug(session: Session, owner_id: uuid.UUID, name: str) -> str:
    """The connection's MCP server name: the name in ``[a-z0-9-]``, at most 40 characters, made
    unique among the owner's connections with ``-2``, ``-3``, …"""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:SLUG_LIMIT].strip("-")
    base = base or "connector"
    taken = set(
        session.execute(
            select(ConnectorConnection.slug).where(ConnectorConnection.owner_id == owner_id)
        ).scalars()
    )
    slug, n = base, 1
    while slug in taken:
        n += 1
        slug = base[: SLUG_LIMIT - len(f"-{n}")].rstrip("-") + f"-{n}"
    return slug


def _by_key(
    session: Session, owner_id: uuid.UUID, key: str, *, for_update: bool = False
) -> ConnectorConnection | None:
    query = select(ConnectorConnection).where(
        ConnectorConnection.owner_id == owner_id, ConnectorConnection.connector_key == key
    )
    return session.execute(query.with_for_update() if for_update else query).scalar_one_or_none()


def _already_connected(row: ConnectorConnection) -> ConnectorError:
    return _refusal(
        409, "already_connected", f"{row.name} is already connected.", connection_id=str(row.id)
    )


def connect(owner_id: uuid.UUID, body: dict) -> dict:
    """``POST /api/connectors``: connect a catalog entry (``key``) or a custom address (``url``,
    ``name``). A key is checked against the server and stored; a server with a sign-in becomes a
    ``pending`` connection (``oauth/start`` is next); a catalog server with neither connects as it
    is. Nothing is stored when the request is refused."""
    entry = _entry_for(body.get("key"), body.get("url"), body.get("name"))
    name = entry["name"][:NAME_LIMIT]
    if not connector_catalog.available(entry):
        raise _refusal(409, "coming_soon", f"{name} isn’t available yet.")
    access = body.get("access", "read")
    _check_access(entry, access, name)
    with session_scope() as session:
        existing = _by_key(session, owner_id, entry["key"])
        if existing is not None and existing.status != "pending":
            raise _already_connected(existing)

    # The provider is asked outside any transaction, on a row that isn't stored yet.
    fields = {
        "url": entry["url"],
        "transport": entry["transport"],
        "access": access,
        "status": "connected",
        "tools": None,
    }
    draft = ConnectorConnection(connector_key=entry["key"], **fields)
    secret = pending = None
    if entry["auth"] == "api_key":
        headers = _key_headers(entry, body.get("credentials"))
        rejected = _refusal(422, "key_rejected", f"{name} didn’t accept the key.")
        fields |= {"auth_kind": "api_key", "tools": _list_tools(draft, headers, rejected)}
        secret = {"headers": headers}
    elif (found := _discover(entry, entry["url"])) is not None:
        fields |= {"auth_kind": "oauth", "status": "pending"}
        pending = _found_signin(found)
    elif entry["key"].startswith("custom:"):
        raise _refusal(422, "no_signin", _NO_SIGNIN)  # an open custom server is never connected
    else:
        no_signin = _refusal(422, "no_signin", _NO_SIGNIN)
        fields |= {"auth_kind": "none", "tools": _list_tools(draft, {}, no_signin)}

    with session_scope() as session:
        row = _by_key(session, owner_id, entry["key"], for_update=True)
        if row is not None and row.status != "pending":
            raise _already_connected(row)
        if row is None:  # else the pending row is reused: its name and slug stay
            row = ConnectorConnection(
                owner_id=owner_id,
                connector_key=entry["key"],
                name=name,
                slug=_new_slug(session, owner_id, name),
            )
            session.add(row)
        for field, value in fields.items():
            setattr(row, field, value)
        row.connected_at = datetime.now(UTC) if row.status == "connected" else None
        row.last_error = row.state_hash = None
        write_secret(row, secret)
        write_secret(row, pending, pending=True)
        try:
            session.flush()
        except IntegrityError:  # the same connector (or name) connected at the same moment
            raise _refusal(409, "already_connected", f"{name} is already connected.") from None
        return serialize(row)

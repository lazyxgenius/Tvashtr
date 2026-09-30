"""Shared helpers for the Connectors tests (stream B1): registry items, snapshot lines and
connection rows written straight to the database. The fixtures are in ``connector_fixtures.py``."""

import uuid

from tvashtr.control_plane import connector_catalog, connectors
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection

OFFICIAL = "io.modelcontextprotocol.registry/official"


def remote(url="https://mcp.acme.dev/mcp", kind="streamable-http", headers=None) -> dict:
    made = {"type": kind, "url": url}
    if headers is not None:
        made["headers"] = headers
    return made


def server(name="dev.acme/mcp", *, status="active", remotes=None, **fields) -> dict:
    """One item of the registry's ``servers`` list."""
    return {
        "server": {
            "name": name,
            "description": "Acme things.",
            "version": "1.0.0",
            "remotes": [remote()] if remotes is None else remotes,
            **fields,
        },
        "_meta": {OFFICIAL: {"status": status, "isLatest": True}},
    }


def key_server(name="com.apify/apify-mcp-server", url="https://mcp.apify.com/", **fields) -> dict:
    """A registry server that takes a key: one secret, required ``Authorization`` header."""
    header = {
        "name": "Authorization",
        "description": "Apify API token",
        "isRequired": True,
        "isSecret": True,
    }
    return server(name, remotes=[remote(url, headers=[header | fields])])


def add_connection(owner_id: uuid.UUID, key: str = "supabase", **over) -> str:
    """A connection row written straight to the database. ``secret`` / ``pending`` are encrypted
    onto it."""
    secret, pending = over.pop("secret", None), over.pop("pending", None)
    entry = connector_catalog.resolve(key) or {}
    fields = {
        "owner_id": owner_id,
        "connector_key": key,
        "name": entry.get("name") or key,
        "slug": key.split("/")[-1].split(":")[-1][:40],
        "url": entry.get("url") or "https://mcp.acme.dev/mcp",
        "auth_kind": "oauth",
        "status": "connected",
    }
    with session_scope() as s:
        made = ConnectorConnection(**{**fields, **over})
        if secret is not None:
            connectors.write_secret(made, secret)
        if pending is not None:
            connectors.write_secret(made, pending, pending=True)
        s.add(made)
        s.flush()
        return str(made.id)


def connection_row(connection_id: object) -> ConnectorConnection | None:
    with session_scope() as s:
        return s.get(ConnectorConnection, uuid.UUID(str(connection_id)))


def grant(connection_id: object, access: str | None = None) -> dict:
    """A ``tool_config`` that grants one connection."""
    item = {"id": str(connection_id)} | ({"access": access} if access else {})
    return {"tvashtr": {"connectors": [item]}}


def snapshot_line(key: str, url: str, *headers: dict, title: str | None = None) -> dict:
    """A snapshot line written as it is, for an address the filter would refuse."""
    return {
        "key": key,
        "title": title,
        "description": "",
        "website": None,
        "url": url,
        "transport": "streamable-http",
        "headers": list(headers),
    }


def header(name="Authorization", *, secret=True, required=True, template=None, hint=None) -> dict:
    """A header declaration in the snapshot's shape."""
    return {
        "name": name,
        "secret": secret,
        "required": required,
        "template": template,
        "hint": hint,
    }


def connections_of(owner_id: uuid.UUID) -> list[ConnectorConnection]:
    with session_scope() as s:
        return list(
            s.query(ConnectorConnection)
            .filter(ConnectorConnection.owner_id == owner_id)
            .order_by(ConnectorConnection.created_at, ConnectorConnection.id)
        )

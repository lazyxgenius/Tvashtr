"""Shared by the Connectors OAuth tests (stream B2): put the fake sign-in server behind
``connector_net`` and make rows to sign in to."""

import uuid

import httpx
from fake_connector_server import FakeConnectorServer

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_net, connectors
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection

PUBLIC_IP = "93.184.216.34"
PRIVATE_HOST = "internal.fake.test"  # the one name that resolves to a private address
TVASHTR = "https://tvashtr.test"
CALLBACK = f"{TVASHTR}/api/connectors/oauth/callback"


def wire(monkeypatch, handler, *, base_url: str = TVASHTR) -> list[str]:
    """The production posture with ``handler`` as the network: every name resolves to a public
    address (``PRIVATE_HOST`` to a private one), and ``connector_net.client()`` is a
    ``MockTransport`` over ``handler``. Returns the addresses ``check_url`` has passed, in order."""
    settings = get_settings()
    monkeypatch.setattr(settings, "connectors_allow_local", False)
    monkeypatch.setattr(settings, "hosted_mode", False)
    monkeypatch.setattr(settings, "public_base_url", base_url)

    def resolve(host, port, **_):
        return [(2, 1, 6, "", ("10.0.0.5" if host == PRIVATE_HOST else PUBLIC_IP, port))]

    monkeypatch.setattr(connector_net, "_getaddrinfo", resolve)

    def client(timeout=10.0, headers=None):
        return httpx.Client(transport=httpx.MockTransport(handler), headers=headers)

    monkeypatch.setattr(connector_net, "client", client)

    checked: list[str] = []
    real = connector_net.check_url

    def recording(url: str) -> str:
        checked.append(real(url))
        return url

    monkeypatch.setattr(connector_net, "check_url", recording)
    return checked


def paths(fake: FakeConnectorServer) -> list[str]:
    return [request.url.path for request in fake.requests]


def connection(owner_id: uuid.UUID, fake: FakeConnectorServer, **over) -> uuid.UUID:
    """An OAuth connection to the fake, ``pending`` unless told otherwise. ``secret`` and
    ``pending_secret`` are written encrypted."""
    secret, pending = over.pop("secret", None), over.pop("pending_secret", None)
    tag = uuid.uuid4().hex[:8]  # an owner has one row per key and per slug
    fields = {
        "owner_id": owner_id,
        "connector_key": f"custom:mcp.fake.test/{tag}",
        "name": "Fake",
        "slug": f"fake-{tag}",
        "url": fake.mcp_url,
        "auth_kind": "oauth",
        "status": "pending",
    }
    with session_scope() as session:
        row = ConnectorConnection(**{**fields, **over})
        if secret is not None:
            connectors.write_secret(row, secret)
        if pending is not None:
            connectors.write_secret(row, pending, pending=True)
        session.add(row)
        session.flush()
        return row.id


def load(connection_id: uuid.UUID) -> ConnectorConnection:
    with session_scope() as session:
        return session.get(ConnectorConnection, connection_id)

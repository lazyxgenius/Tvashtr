"""Connectors: MCP authorization (discovery, client registration, tokens).

Phase 0 skeleton: the exceptions and ``Discovery`` are final; ``discover``,
``ensure_access_token`` and ``revoke`` are stubs with their final signatures, filled by stream B2
(build plan B2.1 and B2.5). Contract: ``docs/superpowers/plans/api/connectors.md`` (OAuth, Tokens).
All HTTP here goes through ``connector_net.client()``.
"""

import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection


class CannotRegister(Exception):
    """A sign-in was found but Tvashtr can't use it: no pre-registered client, no client metadata
    document support and no dynamic registration; PKCE S256 isn't advertised; or a sign-in
    endpoint is on another site than its issuer (mix-up). The routes answer 422
    ``cannot_register``."""


class SignInRefused(Exception):
    """The stored sign-in no longer works: the refresh was refused (``invalid_grant``,
    ``invalid_client``), there is no refresh token and the access token expired, or the row is
    gone. The row (when there is one) is ``needs_signin`` by the time this is raised."""


class Unreachable(Exception):
    """A sign-in endpoint didn't answer (network error, timeout, 5xx). Nothing was changed."""


@dataclass(frozen=True)
class Discovery:
    """What MCP authorization discovery found for one address. Every endpoint has passed the
    contract's checks (https, issuer match, S256, resource covers the address, mix-up)."""

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    resource: str  # the protected-resource metadata's value, sent verbatim as ``resource``
    registration_endpoint: str | None = None
    revocation_endpoint: str | None = None  # None when absent or on another site
    scope: str | None = None  # the 401's ``scope``, else ``scopes_supported`` joined, else None
    iss_supported: bool = False  # ``authorization_response_iss_parameter_supported``
    cimd_supported: bool = False  # ``client_id_metadata_document_supported``
    token_auth_methods: tuple[str, ...] = ()  # ``token_endpoint_auth_methods_supported``

    @property
    def signin_host(self) -> str:
        """The host the browser is sent to."""
        return urlsplit(self.authorization_endpoint).hostname or ""


def discover(url: str, entry: dict | None = None) -> Discovery | None:
    """Run MCP authorization discovery on ``url``. ``None`` when the server offers no sign-in.
    ``entry`` is the catalog entry (a Featured one may pin ``oauth_hosts``). Raises
    :class:`CannotRegister` when a sign-in is there but fails a check, :class:`Unreachable` when
    the server doesn't answer.

    Phase 0 stub: finds nothing. Stream B2.1 fills it."""
    return None


def ensure_access_token(connection_id: uuid.UUID, *, rejected: str | None = None) -> str:
    """A provider access token that should work now. Returns the stored one while it has more
    than five minutes left and isn't ``rejected`` (the token a provider just answered 401 to);
    otherwise refreshes under the row lock. Opens its own session and takes ``FOR UPDATE`` on the
    row, so never call it while holding that row's lock in another session. Raises
    :class:`SignInRefused` or :class:`Unreachable`.

    Phase 0 stub: returns the stored access token and never refreshes. Stream B2.5 fills it."""
    from tvashtr.control_plane import connectors

    with session_scope() as session:
        row = session.get(ConnectorConnection, connection_id)
        token = (connectors.read_secret(row) or {}).get("access_token") if row else None
    if not token:
        raise SignInRefused("no stored sign-in")
    return token


def revoke(connection_id: uuid.UUID) -> bool:
    """Best-effort RFC 7009 revoke of the stored sign-in at the provider. ``True`` when the
    provider answered 2xx. Never raises.

    Phase 0 stub: revokes nothing. Stream B2.5 fills it."""
    return False

"""Connectors: the run-time proxy's rules (run tokens, the read-only filter, call records).

Stream B3 (build plan B3.1, B3.3, B3.5); the MCP mount that calls it is
``tvashtr/mcp/connectors.py``. Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time,
What a run shows).
"""

import functools
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import anyio
from itsdangerous import BadData, URLSafeTimedSerializer
from mcp import McpError
from mcp.types import CallToolResult, TextContent, Tool
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog, connector_oauth, connector_upstream, connectors
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.run_views import TERMINAL_STATUSES
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, ConnectorConnection, Run, RunEvent

logger = logging.getLogger(__name__)

# ---- The run token: the only credential an agent's sandbox gets for a connector ----

RUN_TOKEN_MAX_AGE_SECONDS = 14 * 24 * 3600
_RUN_TOKEN_SALT = "tvashtr.connector-run"


@dataclass(frozen=True)
class RunGrant:
    """What a good run token names. ``access`` is the grant's access when the token was signed;
    the proxy applies the lower of it and the connection's current access on every request."""

    run_id: str
    node_id: str | None
    connection_id: uuid.UUID
    access: str  # "read" | "write"


def _signer() -> URLSafeTimedSerializer:
    # The secret is read at call time, like the session cookie's serializer.
    return URLSafeTimedSerializer(
        get_settings().session_secret.get_secret_value(), salt=_RUN_TOKEN_SALT
    )


def sign_run_token(
    run_id: object, node_id: object | None, connection_id: object, access: str
) -> str:
    """The token for one run, one agent (``node_id``, or ``None``) and one connection."""
    return _signer().dumps(
        {
            "r": str(run_id),
            "n": str(node_id) if node_id is not None else None,
            "c": str(connection_id),
            "a": "write" if access == "write" else "read",
        }
    )


def read_run_token(value: object, max_age: int = RUN_TOKEN_MAX_AGE_SECONDS) -> RunGrant | None:
    """The grant a token names, or ``None`` when it must not be honoured: a bad signature, over
    ``max_age`` old, a run that is gone, ended or another account's than the connection, or a
    connection that is gone or still ``pending``. Reads the database: call it off the event loop.
    """
    if not isinstance(value, str):
        return None
    try:
        data = _signer().loads(value, max_age=max_age)
        run_id, connection_id = uuid.UUID(data["r"]), uuid.UUID(data["c"])
        node_id, access = data["n"], data["a"]
    except (BadData, KeyError, TypeError, ValueError, AttributeError):
        return None
    with session_scope() as session:
        run = session.get(Run, run_id)
        row = session.get(ConnectorConnection, connection_id)
        if (
            run is None
            or row is None
            or row.status == "pending"
            or run.owner_id != row.owner_id
            or run.status in TERMINAL_STATUSES
        ):
            return None
    return RunGrant(
        run_id=str(run_id),
        node_id=str(node_id) if node_id is not None else None,
        connection_id=connection_id,
        access="write" if access == "write" else "read",
    )


# ---- What a run records: ``connector_skipped`` (and, below, ``connector_call``) events ----

# Why a run went without a connector (the contract's Warnings table).
DISCONNECTED = "it was disconnected"
SIGNIN_EXPIRED = "its sign-in expired"
KEY_STOPPED = "its key stopped working"
UNREACHABLE = "we couldn’t reach it"

# ponytail: the proxy's events share the int ``seq`` column with the engine's own (from 0) and
# the Desktop runner's (from ``desktop_jobs.RUNNER_SEQ_OFFSET`` = 100), in a band of their own per
# invocation. The three never meet below a billion events; give the kinds their own column if
# they ever need to.
EVENT_SEQ_BAND = 1_000_000_000
_SEQ_ATTEMPTS = 5


def _latest_invocation(session: Session, run_id: str, node_id: object) -> int | None:
    """The round that is running: the latest ``agent_invocations`` row for the run and node.
    ``None`` without a node, or before its first round opened."""
    nid = _as_uuid(node_id)
    if nid is None:
        return None
    return session.execute(
        select(AgentInvocation.id)
        .where(AgentInvocation.run_id == run_id, AgentInvocation.node_id == nid)
        .order_by(AgentInvocation.iteration.desc())
        .limit(1)
    ).scalar_one_or_none()


def _next_seq(session: Session, run_id: str, invocation_id: int | None) -> int:
    last = session.execute(
        select(func.max(RunEvent.seq)).where(
            RunEvent.run_id == run_id,
            RunEvent.invocation_id.is_not_distinct_from(invocation_id),
            RunEvent.seq >= EVENT_SEQ_BAND,
        )
    ).scalar_one()
    return EVENT_SEQ_BAND if last is None else last + 1


def _write_event(run_id: str, node_id: object, kind: str, payload: dict) -> None:
    """One ``run_events`` row in the proxy's band. Two writers can read the same next ``seq``; the
    loser of ``(run_id, invocation_id, seq)`` reads again."""
    for _ in range(_SEQ_ATTEMPTS):
        try:
            with session_scope() as session:
                invocation_id = _latest_invocation(session, run_id, node_id)
                session.add(
                    RunEvent(
                        run_id=run_id,
                        invocation_id=invocation_id,
                        seq=_next_seq(session, run_id, invocation_id),
                        kind=kind,
                        payload=payload,
                    )
                )
            return
        except IntegrityError:
            continue
    logger.warning("connectors: gave up recording a %s event for run %s", kind, run_id)


def record_skip(
    run_id: str, node_id: object, connection_id: object | None, name: str, reason: str
) -> None:
    """A run went without a connector: the ``run_warnings`` row and the ``connector_skipped``
    event, always together. ``connection_id`` is ``None`` (and ``name`` "a connector") when the
    grant names nothing of the owner's. Sync database work: call it off the event loop."""
    record_resolution_warning(run_id, "connector", name, reason)
    _write_event(
        run_id,
        node_id,
        "connector_skipped",
        {
            "connection_id": str(connection_id) if connection_id is not None else None,
            "connector": name,
            "reason": reason,
        },
    )


def sign_in_expired(run_id: str, node_id: object, row: ConnectorConnection) -> None:
    """The provider no longer takes ``row``'s sign-in (or key): the row becomes ``needs_signin``
    (a row that already is keeps its own ``last_error``) and the run records the skip. Takes the
    row lock in its own session, like every writer of the sign-in."""
    reason = KEY_STOPPED if row.auth_kind == "api_key" else SIGNIN_EXPIRED
    with session_scope() as session:
        live = session.get(ConnectorConnection, row.id, with_for_update=True)
        if live is not None and live.status == "connected":
            live.status = "needs_signin"
            live.last_error = f"{reason[0].upper()}{reason[1:]}."
    record_skip(run_id, node_id, row.id, row.name, reason)


_ARG_KEYS = ("query", "sql", "q", "title", "name")
_ARG_LIMIT = 200
_HTTPS_ADDRESS = re.compile(r"https://[^\s\"'<>()\[\]{}]+")


def _short_arg(arguments: object) -> str | None:
    """The one argument a call is shown with: the first string, preferring the usual names."""
    if not isinstance(arguments, dict):
        return None
    strings = [arguments.get(key) for key in _ARG_KEYS] + list(arguments.values())
    return next((value[:_ARG_LIMIT] for value in strings if isinstance(value, str)), None)


def _result_url(result: CallToolResult) -> str | None:
    """The first ``https://`` address in a result's text (what a write made, LIN-214 say)."""
    text = "\n".join(block.text for block in result.content if isinstance(block, TextContent))
    found = _HTTPS_ADDRESS.search(text)
    return found.group().rstrip(".,;:") if found else None


def record_call(
    grant: RunGrant,
    row: ConnectorConnection,
    tool: str,
    *,
    write: bool,
    blocked: bool = False,
    arguments: object = None,
    duration_ms: int = 0,
    result: CallToolResult | None = None,
) -> None:
    """One ``connector_call`` event for one ``tools/call``: allowed, refused (``blocked``) or
    failed (``result`` is ``None``, or a result with ``isError``). Full arguments and results are
    not stored. Sync database work: call it off the event loop."""
    ok = result is not None and not result.isError
    _write_event(
        grant.run_id,
        grant.node_id,
        "connector_call",
        {
            "connection_id": str(row.id),
            "connector": row.name,
            "slug": row.slug,
            "tool": tool,
            "write": write,
            "ok": ok,
            "blocked": blocked,
            "arg": _short_arg(arguments),
            "duration_ms": duration_ms,
            "result_url": _result_url(result) if ok and write else None,
        },
    )


# ---- The proxy core: what ``tools/list`` and ``tools/call`` answer for one run token ----
#
# FastMCP awaits these on the server's event loop, so every piece of sync work (the row load, the
# token refresh and its row lock, the records) goes through ``_thread``: one slow refresh must not
# stall every other agent's calls. The provider credential is added here and goes nowhere else:
# not into an answer, an event or a log line.

LIST_TIMEOUT_SECONDS = 10.0
CALL_TIMEOUT_SECONDS = 120.0
DESCRIPTION_LIMIT = 2000
UNAVAILABLE = "This connector isn’t available for this run."

# ponytail: each connection's ``{tool: readOnlyHint}`` as the provider last listed it, kept per
# process and refreshed by every listing; a call for a tool that isn't in it lists first. Keep it
# on the row if an extra listing after a restart (or on a second machine) ever costs too much.
_read_only_hints: dict[uuid.UUID, dict[str, bool]] = {}


class _Failed(Exception):
    """A request that got no usable answer. Its text is what the agent is told."""


async def _thread[T](func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await anyio.to_thread.run_sync(functools.partial(func, *args, **kwargs))


def _connection(grant: RunGrant) -> tuple[ConnectorConnection, dict | None, str] | None:
    """``(row, catalog entry, effective access)`` as they are now, or ``None`` when the connection
    is gone. The effective access is the lower of the token's and the row's."""
    with session_scope() as session:
        row = session.get(ConnectorConnection, grant.connection_id)
    if row is None or row.status == "pending":
        return None
    access = "write" if grant.access == "write" and row.access == "write" else "read"
    return row, connector_catalog.resolve(row.connector_key), access


async def _provider[T](
    grant: RunGrant,
    row: ConnectorConnection,
    access: str,
    request: Callable[[str, str, dict], Awaitable[T]],
) -> T:
    """``request(url, transport, headers)`` against the provider, the credential added here. Only
    a 401 means the sign-in expired: one refresh and one retry, then ``needs_signin``. Anything
    else changes nothing. Raises :class:`_Failed`."""
    unauthorized = connector_upstream.UpstreamUnauthorized
    try:
        if row.status != "connected":
            raise connector_oauth.SignInRefused
        url, transport = await _thread(connectors.upstream_target, row, access)
        headers = await _thread(connectors.upstream_headers, row)
        try:
            return await request(url, transport, headers)
        except unauthorized:
            if row.auth_kind != "oauth":
                raise connector_oauth.SignInRefused from None  # a key can't be refreshed
            rejected = headers.get("Authorization", "").removeprefix("Bearer ")
            headers = await _thread(connectors.upstream_headers, row, rejected=rejected)
            try:
                return await request(url, transport, headers)
            except unauthorized:
                raise connector_oauth.SignInRefused from None
    except connector_oauth.SignInRefused:
        await _thread(sign_in_expired, grant.run_id, grant.node_id, row)
        raise _Failed(f"{row.name} needs you to sign in again.") from None
    except (connector_oauth.Unreachable, connector_upstream.UpstreamUnreachable, TimeoutError):
        await _thread(record_skip, grant.run_id, grant.node_id, row.id, row.name, UNREACHABLE)
        raise _Failed(f"We couldn’t reach {row.name}. Try again.") from None
    except connector_upstream.UpstreamRefused as exc:
        raise _Failed(f"{row.name} refused the request ({exc.status}).") from None
    except McpError as exc:
        raise _Failed(f"{row.name} answered an error: {exc.error.message}") from None


async def _listed(grant: RunGrant, row: ConnectorConnection, access: str, upstream: Any) -> list:
    """The provider's own tool list, within ``LIST_TIMEOUT_SECONDS``."""

    async def request(url: str, transport: str, headers: dict) -> list[Tool]:
        try:
            with anyio.fail_after(LIST_TIMEOUT_SECONDS):
                return await upstream.list_tools(
                    url, transport, headers, timeout=LIST_TIMEOUT_SECONDS
                )
        except (connector_upstream.UpstreamRefused, McpError) as exc:
            # A list has no tool error to carry a refusal: the agent gets no tools, so the run
            # went without the connector all the same.
            raise connector_upstream.UpstreamUnreachable(type(exc).__name__) from None

    tools = await _provider(grant, row, access, request)
    _read_only_hints.setdefault(row.id, {}).update(
        {tool["name"]: tool["read_only"] for tool in connectors.stored_tools(tools)}
    )
    return tools


async def proxy_list_tools(grant: RunGrant, upstream: Any = connector_upstream) -> list[Tool]:
    """``tools/list``: the provider's tools that are reads at the token's effective access (all of
    them when it is ``write``). Never an error: a failing server would stop the agent from
    starting, so a provider that can't be asked is an empty list (and a skip on the round)."""
    found = await _thread(_connection, grant)
    if found is None:
        return []
    row, entry, access = found
    try:
        tools = await _listed(grant, row, access, upstream)
    except _Failed:
        return []
    return [
        tool.model_copy(
            update={
                "description": tool.description[:DESCRIPTION_LIMIT] if tool.description else None,
                "outputSchema": None,
            }
        )
        for tool, stored in zip(tools, connectors.stored_tools(tools), strict=True)
        if access == "write" or not connector_catalog.is_write(entry, stored, access)
    ]


async def _is_write(
    grant: RunGrant,
    row: ConnectorConnection,
    entry: dict | None,
    access: str,
    name: str,
    upstream: Any,
) -> bool:
    """``connector_catalog.is_write`` for a tool known only by name. The provider is asked for
    its list when this process hasn't seen the tool listed; one it doesn't list is a write."""
    if not connector_catalog.is_write(entry, {"name": name, "read_only": False}, access):
        return False  # a read whatever its annotation (the provider's own flag is on)
    if name not in _read_only_hints.get(row.id, {}):
        await _listed(grant, row, access, upstream)
    read_only = _read_only_hints.get(row.id, {}).get(name, False)
    return connector_catalog.is_write(entry, {"name": name, "read_only": read_only}, access)


def _tool_error(message: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=message)], isError=True)


async def proxy_call_tool(
    grant: RunGrant, name: str, arguments: dict | None, upstream: Any = connector_upstream
) -> CallToolResult:
    """``tools/call``: a tool the read-only rule doesn't allow is refused here; any other call is
    forwarded with the provider credential and its result returned as-is. Every call writes one
    ``connector_call`` event. Never raises: what went wrong is a tool error for the agent."""
    started = time.monotonic()
    found = await _thread(_connection, grant)
    if found is None:
        return _tool_error(UNAVAILABLE)
    row, entry, access = found
    write, blocked, result = True, False, None  # a tool nothing is known about is a write
    try:
        write = await _is_write(grant, row, entry, access, name, upstream)
        if write and access != "write":
            blocked = True
            raise _Failed(
                f"{row.name} is read only for this agent. {name} can change data, so it’s off."
            )

        async def request(url: str, transport: str, headers: dict) -> CallToolResult:
            return await upstream.call_tool(
                url, transport, headers, name, arguments, timeout=CALL_TIMEOUT_SECONDS
            )

        result = await _provider(grant, row, access, request)
        answer = result
    except _Failed as exc:
        answer = _tool_error(str(exc))
    try:
        await _thread(
            record_call,
            grant,
            row,
            name,
            write=write,
            blocked=blocked,
            arguments=arguments,
            duration_ms=int((time.monotonic() - started) * 1000),
            result=result,
        )
    except Exception as exc:  # the provider already answered: don't turn that into a failure
        logger.warning("connectors: couldn’t record a %s call (%s)", row.slug, type(exc).__name__)
    return answer


def recent_use(session: Session, owner_id: uuid.UUID, connection_id: uuid.UUID) -> list:
    """Up to 10 rows, newest first, one per run and agent, read from the ``connector_call`` events
    of the owner's last 30 runs: ``{"run_id", "run_number", "agent", "reads", "writes", "at"}``.

    Phase 0 stub: nothing has been used yet. Stream B3.5 fills it."""
    return []

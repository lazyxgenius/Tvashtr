"""Connectors: the run-time proxy's rules (run tokens, the read-only filter, call records).

Stream B3 (build plan B3.1, B3.3, B3.5); the MCP mount that calls it is
``tvashtr/mcp/connectors.py``. Contract: ``docs/superpowers/plans/api/connectors.md`` (Run time,
What a run shows).
"""

import functools
import json
import logging
import re
import time
import uuid
import weakref
import zlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import anyio
from anyio.lowlevel import RunVar
from itsdangerous import BadData, URLSafeTimedSerializer
from mcp import McpError
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tvashtr.config import get_settings
from tvashtr.control_plane import connector_catalog, connector_oauth, connector_upstream, connectors
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.run_views import TERMINAL_STATUSES
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, ConnectorConnection, Run, RunEvent

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
ASKS_SIGN_IN = "it now asks for a sign-in"  # a connection that never signed in got a 401
UNREACHABLE = "we couldn’t reach it"
# Why a provider's 401 took a connector out of a run, by what the connection signs in with.
_SIGN_IN_GONE = {"oauth": SIGNIN_EXPIRED, "api_key": KEY_STOPPED, "none": ASKS_SIGN_IN}

# ponytail: the proxy's events share the int ``seq`` column with the engine's own (from 0) and
# the Desktop runner's (from ``desktop_jobs.RUNNER_SEQ_OFFSET`` = 100), in a band of their own per
# invocation. The three never meet below a billion events; give the kinds their own column if
# they ever need to.
EVENT_SEQ_BAND = 1_000_000_000
_SEQ_ATTEMPTS = 5
_LOCK_NAMESPACE = 0x434E  # advisory-lock namespace ("CN"), next to ``domain_read``'s "DM"


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
    """One ``run_events`` row in the proxy's band. Writers of one band take their ``seq`` one at a
    time, under a transaction lock on ``(run_id, invocation_id)``: calls made at the same moment
    are all recorded, and the band with no round (where the unique constraint sees only NULLs)
    gets no ``seq`` twice. The retry on ``(run_id, invocation_id, seq)`` stays as a backstop."""
    for _ in range(_SEQ_ATTEMPTS):
        try:
            with session_scope() as session:
                invocation_id = _latest_invocation(session, run_id, node_id)
                session.execute(
                    text("SELECT pg_advisory_xact_lock(:ns, :k)"),
                    {
                        "ns": _LOCK_NAMESPACE,
                        # a signed int4, like ``domain_read._lock``
                        "k": zlib.crc32(f"{run_id}:{invocation_id}".encode()) - 2**31,
                    },
                )
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
    """The provider no longer takes ``row``'s sign-in (or key, or now asks one of a connection
    that never signed in): the row becomes ``needs_signin``
    (a row that already is keeps its own ``last_error``) and the run records the skip. Takes the
    row lock in its own session, like every writer of the sign-in. ``row`` is what the caller
    read, with no lock held. The row is only marked when that is still the sign-in it holds: a
    key replaced since is not the one that was refused, a sign-in finished since (it stamps
    ``connected_at``) was never tried, and a row read as already not connected told the caller
    nothing new. Otherwise a call that read the row a moment before "Sign in again" finished
    would undo it."""
    reason = _SIGN_IN_GONE[row.auth_kind]
    with session_scope() as session:
        live = session.get(ConnectorConnection, row.id, with_for_update=True)
        replaced = live is not None and (
            live.connected_at != row.connected_at
            or (row.auth_kind == "api_key" and live.secret_encrypted != row.secret_encrypted)
        )
        if (
            live is not None
            and row.status == "connected"
            and live.status == "connected"
            and not replaced
        ):
            live.status = "needs_signin"
            live.last_error = connectors.SIGN_IN_GONE[row.auth_kind]
    record_skip(run_id, node_id, row.id, row.name, reason)


_ARG_KEYS = ("query", "sql", "q", "title", "name")
NAME_LIMIT = 200  # a tool's name and title, and the one argument a call is shown with
RESULT_URL_LIMIT = 2000
_HTTPS_ADDRESS = re.compile(r"https://[^\s\"'<>()\[\]{}]+")


def _storable(value: str) -> str:
    """``value`` as Postgres can keep it in JSON: no NUL, no half of a surrogate pair. An event
    that can't be written is a call (a write, even) the run never shows."""
    return value.replace("\x00", "").encode("utf-8", "replace").decode()


def _short_arg(arguments: object) -> str | None:
    """The one argument a call is shown with: the first string, preferring the usual names."""
    if not isinstance(arguments, dict):
        return None
    strings = [arguments.get(key) for key in _ARG_KEYS] + list(arguments.values())
    return next(
        (_storable(value[:NAME_LIMIT]) for value in strings if isinstance(value, str)), None
    )


def _result_url(result: CallToolResult) -> str | None:
    """The first ``https://`` address in a result's text (what a write made, LIN-214 say). One
    over ``RESULT_URL_LIMIT`` is left out: half an address is no link, and the round's calls are
    sent whole with every read of the run."""
    text = "\n".join(block.text for block in result.content if isinstance(block, TextContent))
    found = _HTTPS_ADDRESS.search(text)
    url = found.group().rstrip(".,;:") if found else ""
    return _storable(url) if 0 < len(url) <= RESULT_URL_LIMIT else None


def record_call(
    grant: RunGrant,
    row: ConnectorConnection,
    tool: str,
    *,
    write: bool,
    blocked: bool = False,
    forwarded: bool = False,
    arguments: object = None,
    duration_ms: int = 0,
    result: CallToolResult | None = None,
) -> None:
    """One ``connector_call`` event for one ``tools/call``: allowed, refused (``blocked``) or
    failed (``result`` is ``None``, or a result with ``isError``). ``forwarded`` says the provider
    took the call (a result says so too): it was sent and not turned away, whatever became of the
    answer. Full arguments and results are not stored. Sync database work: call it off the event
    loop."""
    ok = result is not None and not result.isError
    _write_event(
        grant.run_id,
        grant.node_id,
        "connector_call",
        {
            "connection_id": str(row.id),
            "connector": row.name,
            "slug": row.slug,
            "tool": _storable(tool[:NAME_LIMIT]),
            "write": write,
            "ok": ok,
            "blocked": blocked,
            "forwarded": forwarded or result is not None,
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
SCHEMA_LIMIT = 32_000  # a tool's input schema, as JSON
TOOLS_LIMIT = 200
_HINTS = ("readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint")
UNAVAILABLE = "This connector isn’t available for this run."

# ponytail: ``{(connection, effective access): (when, {tool: readOnlyHint})}``, the provider's
# last listing in that mode (a provider can annotate a tool differently under its read-only
# flag), kept per process and replaced by every listing. A call lists first when there is none
# or it is over ``HINTS_MAX_AGE_SECONDS`` old. Keep it on the row if an extra listing after a
# restart (or on a second machine) ever costs too much.
HINTS_MAX_AGE_SECONDS = 60.0
_read_only_hints: dict[tuple[uuid.UUID, str], tuple[float, dict[str, bool]]] = {}


class _Failed(Exception):
    """A request that got no usable answer. Its text is what the agent is told."""


class _Unanswered(_Failed):
    """No answer at all: the token endpoint or the provider couldn't be reached, or was too slow.
    A request that was sent may still have been carried out."""


# The proxy's own worker threads, fewer than the database pool has connections (5 + 10). Its sync
# work can wait on a row lock that a refresh holds across a 10 s token request; on anyio's default
# limiter (40, shared with the API's sync routes) a burst of calls would take every route's
# threads and pooled connections with it.
PROXY_THREADS = 8
_limiter: RunVar[anyio.CapacityLimiter] = RunVar("tvashtr_connector_proxy_threads")
_token_locks: weakref.WeakValueDictionary[uuid.UUID, anyio.Lock] = weakref.WeakValueDictionary()


async def _thread[T](func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    limiter = _limiter.get(None)
    if limiter is None:  # one per event loop, like anyio's default
        limiter = anyio.CapacityLimiter(PROXY_THREADS)
        _limiter.set(limiter)
    return await anyio.to_thread.run_sync(functools.partial(func, *args, **kwargs), limiter=limiter)


async def _headers(row: ConnectorConnection, *, rejected: str | None = None) -> dict:
    """``connectors.upstream_headers`` in a worker thread, one call at a time per connection. A
    refresh holds the row lock, so the calls behind it wait here on the event loop, not each in
    a thread with a database connection: one connection's slow token endpoint costs one thread.
    ponytail: each waiter still asks in its turn, so N calls behind a token endpoint that is down
    take N timeouts. Remember the failure for a few seconds if that ever matters."""
    async with _token_locks.setdefault(row.id, anyio.Lock()):
        return await _thread(connectors.upstream_headers, row, rejected=rejected)


def _connection(grant: RunGrant) -> tuple[ConnectorConnection, dict | None, str] | None:
    """``(row, catalog entry, effective access)`` as they are now, or ``None`` when the connection
    is gone. The effective access is the lower of the token's and the row's."""
    with session_scope() as session:
        row = session.get(ConnectorConnection, grant.connection_id)
    if row is None or row.status == "pending":
        for access in ("read", "write"):
            _read_only_hints.pop((grant.connection_id, access), None)
        return None
    access = "write" if grant.access == "write" and row.access == "write" else "read"
    return row, connector_catalog.resolve(row.connector_key), access


async def _provider[T](
    grant: RunGrant,
    row: ConnectorConnection,
    access: str,
    request: Callable[[str, str, dict], Awaitable[T]],
    *,
    quiet: bool = False,
) -> T:
    """``request(url, transport, headers)`` against the provider, the credential added here. Only
    a 401 means the sign-in expired: one refresh (for a key: one look at whether it was replaced
    meanwhile) and one retry, then ``needs_signin``. Anything else changes nothing. Raises
    :class:`_Failed`. ``quiet`` is for a request the agent's call doesn't depend on: its failure
    marks and records nothing."""
    unauthorized = connector_upstream.UpstreamUnauthorized
    try:
        if row.status != "connected":
            raise connector_oauth.SignInRefused
        url, transport = await _thread(connectors.upstream_target, row, access)
        headers = await _headers(row)
        try:
            return await request(url, transport, headers)
        except unauthorized:
            if row.auth_kind == "oauth":
                rejected = headers.get("Authorization", "").removeprefix("Bearer ")
                headers = await _headers(row, rejected=rejected)
            else:
                # A key can't be refreshed, but it can have been replaced while the call was
                # out: the 401 was for the old one, and the stored one hasn't been tried.
                live = await _thread(_connection, grant)
                if live is None or live[0].secret_encrypted == row.secret_encrypted:
                    raise connector_oauth.SignInRefused from None
                row = live[0]
                headers = await _headers(row)
            try:
                return await request(url, transport, headers)
            except unauthorized:
                raise connector_oauth.SignInRefused from None
    except connector_oauth.SignInRefused:
        if not quiet:
            await _thread(sign_in_expired, grant.run_id, grant.node_id, row)
        raise _Failed(f"{row.name} needs you to sign in again.") from None
    except (connector_oauth.Unreachable, connector_upstream.UpstreamUnreachable, TimeoutError):
        if not quiet:
            await _thread(record_skip, grant.run_id, grant.node_id, row.id, row.name, UNREACHABLE)
        raise _Unanswered(f"We couldn’t reach {row.name}. Try again.") from None
    except connector_upstream.UpstreamRefused as exc:
        raise _Failed(f"{row.name} refused the request ({exc.status}).") from None
    except McpError as exc:
        raise _Failed(f"{row.name} answered an error: {exc.error.message}") from None


def _bounded(tools: list[Tool]) -> list[Tool]:
    """A provider's tools as an agent may see them: the first ``TOOLS_LIMIT``, each with only the
    fields below and a ceiling on every one, so an unreviewed server can't pour text into an
    agent's context (or into what this process keeps). A tool whose name or input schema is over
    its ceiling is left out: cut, it would be another tool. So is one named like a tool of the
    engine's own, or like one already kept: one connector must not fail the round."""
    kept: list[Tool] = []
    names: set[str] = set(connectors.ENGINE_TOOL_NAMES)
    for tool in tools:
        if len(kept) == TOOLS_LIMIT:
            break
        if len(tool.name) > NAME_LIMIT or len(json.dumps(tool.inputSchema)) > SCHEMA_LIMIT:
            continue
        if tool.name in names:
            continue
        names.add(tool.name)
        notes = tool.annotations
        kept.append(
            Tool(
                name=tool.name,
                title=tool.title[:NAME_LIMIT] if tool.title else None,
                description=tool.description[:DESCRIPTION_LIMIT] if tool.description else None,
                inputSchema=tool.inputSchema,
                annotations=notes
                and ToolAnnotations(
                    title=notes.title[:NAME_LIMIT] if notes.title else None,
                    **{hint: getattr(notes, hint) for hint in _HINTS},
                ),
            )
        )
    return kept


async def _listed(
    grant: RunGrant, row: ConnectorConnection, access: str, upstream: Any, *, quiet: bool = False
) -> list[Tool]:
    """The provider's own tool list (``_bounded``), within ``LIST_TIMEOUT_SECONDS``."""

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

    tools = _bounded(await _provider(grant, row, access, request, quiet=quiet))
    _read_only_hints[row.id, access] = (
        time.monotonic(),
        {tool.name: _read_only(tool) for tool in tools},
    )
    return tools


def _read_only(tool: Tool) -> bool:
    """Whether the provider marks ``tool`` as a read, as ``connectors.stored_tools`` reads it.
    One tool at a time: that list has ceilings of its own, so it isn't paired with this one by
    position."""
    return connectors.stored_tools([tool])[0]["read_only"]


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
        tool
        for tool in tools
        if access == "write"
        or not connector_catalog.is_write(
            entry, {"name": tool.name, "read_only": _read_only(tool)}, access
        )
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
    its list when this process has no recent one for this access; a tool that list doesn't have
    is a write."""
    if not connector_catalog.is_write(entry, {"name": name, "read_only": False}, access):
        return False  # a read whatever its annotation (the provider's own flag is on)
    seen = _read_only_hints.get((row.id, access))
    if seen is None or time.monotonic() - seen[0] > HINTS_MAX_AGE_SECONDS:
        try:
            await _listed(grant, row, access, upstream, quiet=access == "write")
        except _Failed:
            if access != "write":
                raise
            # With write access the rule allows the call whatever the list says; the list only
            # tells the record a read from a write. The call goes on (as a write when nothing
            # is known), and the provider isn't asked to list again for a while.
            _read_only_hints[row.id, access] = (time.monotonic(), seen[1] if seen else {})
        seen = _read_only_hints.get((row.id, access))
    read_only = seen is not None and seen[1].get(name, False)
    return connector_catalog.is_write(entry, {"name": name, "read_only": read_only}, access)


def _tool_error(message: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=message)], isError=True)


async def proxy_call_tool(
    grant: RunGrant, name: str, arguments: dict | None, upstream: Any = connector_upstream
) -> CallToolResult:
    """``tools/call``: a tool the read-only rule doesn't allow is refused here; any other call is
    forwarded with the provider credential and its result returned as-is. Every call writes one
    ``connector_call`` event. What went wrong at the provider is a tool error for the agent, not
    an exception."""
    started = time.monotonic()
    found = await _thread(_connection, grant)
    if found is None:
        return _tool_error(UNAVAILABLE)
    row, entry, access = found
    write, blocked, result = True, False, None  # a tool nothing is known about is a write
    forwarded = False  # the provider took the call: sent, and not turned away with a 4xx
    try:
        write = await _is_write(grant, row, entry, access, name, upstream)
        if write and access != "write":
            blocked = True
            raise _Failed(
                f"{row.name} is read only for this agent. {name} can change data, so it’s off."
            )

        async def request(url: str, transport: str, headers: dict) -> CallToolResult:
            nonlocal forwarded
            forwarded = True
            try:
                return await upstream.call_tool(
                    url, transport, headers, name, arguments, timeout=CALL_TIMEOUT_SECONDS
                )
            except (connector_upstream.UpstreamUnauthorized, connector_upstream.UpstreamRefused):
                forwarded = False
                raise

        result = await _provider(grant, row, access, request)
        answer = result
    except _Failed as exc:
        # A write that was sent and never answered may have been carried out: "try again" is how
        # an issue gets made twice.
        lost = write and forwarded and isinstance(exc, _Unanswered)
        answer = _tool_error(
            f"{row.name} didn’t answer. {name} may have gone through, so check before you retry."
            if lost
            else str(exc)
        )
    try:
        await _thread(
            record_call,
            grant,
            row,
            name,
            write=write,
            blocked=blocked,
            forwarded=forwarded,
            arguments=arguments,
            duration_ms=int((time.monotonic() - started) * 1000),
            result=result,
        )
    except Exception as exc:  # the provider already answered: don't turn that into a failure
        logger.warning("connectors: couldn’t record a %s call (%s)", row.slug, type(exc).__name__)
    return answer


# ---- What a run shows: a round's ``connectors`` block, and a connection's recent use ----

CALLS_LIMIT = 50
RECENT_USE_RUNS = 30
RECENT_USE_ROWS = 10
EVENT_KINDS = ("connector_call", "connector_skipped")


def _count(use: dict, payload: dict) -> None:
    """``reads`` are the reads that worked. ``writes`` are the writes the provider took
    (``forwarded``): one whose answer was lost, or was an error, may still have changed data."""
    if payload.get("write"):
        use["writes"] += bool(payload.get("forwarded", payload.get("ok")))
    else:
        use["reads"] += bool(payload.get("ok"))


def connector_use(session: Session, run_id: object, invocation_ids: list[int]) -> dict[int, dict]:
    """``{invocation_id: connectors}`` for the rounds of ``run_id`` that called or skipped a
    connector; a round that did neither has no key (its ``connectors`` is ``null``).

    ``used`` is ordered by first call and counts as ``_count`` does (never a blocked call);
    ``calls`` lists writes first, then by time, at most ``CALLS_LIMIT`` of ``total_calls``;
    ``skipped`` has one entry per connection and reason."""
    if not invocation_ids:
        return {}
    events = session.execute(
        select(RunEvent)
        .where(
            RunEvent.run_id == str(run_id),
            RunEvent.invocation_id.in_(invocation_ids),
            # The proxy's own band: a range on the (run, round, seq) index. Without it every
            # event of the run is read to look at its kind, on each poll of the run view.
            RunEvent.seq >= EVENT_SEQ_BAND,
            RunEvent.kind.in_(EVENT_KINDS),
        )
        .order_by(RunEvent.seq)
    ).scalars()
    rounds: dict[int, dict] = {}
    for event in events:
        block = rounds.setdefault(event.invocation_id, {"used": {}, "calls": [], "skipped": {}})
        payload = event.payload
        connection_id, name = payload.get("connection_id"), payload.get("connector")
        if event.kind == "connector_skipped":
            block["skipped"].setdefault(
                (connection_id, payload.get("reason")),
                {"connection_id": connection_id, "name": name, "reason": payload.get("reason")},
            )
            continue
        used = block["used"].setdefault(
            connection_id,
            {
                "connection_id": connection_id,
                "name": name,
                "slug": payload.get("slug"),
                "reads": 0,
                "writes": 0,
            },
        )
        _count(used, payload)
        block["calls"].append(
            {
                "connection_id": connection_id,
                "name": name,
                "tool": payload.get("tool"),
                "write": bool(payload.get("write")),
                "ok": bool(payload.get("ok")),
                "blocked": bool(payload.get("blocked")),
                # The provider took the call (what ``writes`` counts). An event from before the
                # field existed took it when it worked.
                "forwarded": bool(payload.get("forwarded", payload.get("ok"))),
                "arg": payload.get("arg"),
                "at": event.created_at.isoformat(),
                "duration_ms": payload.get("duration_ms"),
                "result_url": payload.get("result_url"),
            }
        )
    return {
        invocation_id: {
            "used": list(block["used"].values()),
            # A stable sort: writes first, each half still in the order the calls were made.
            "calls": sorted(block["calls"], key=lambda call: not call["write"])[:CALLS_LIMIT],
            "total_calls": len(block["calls"]),
            "skipped": list(block["skipped"].values()),
        }
        for invocation_id, block in rounds.items()
    }


def recent_use(session: Session, owner_id: uuid.UUID, connection_id: uuid.UUID) -> list:
    """Up to 10 rows, newest first, one per run and agent, read from the ``connector_call`` events
    of the owner's last 30 runs: ``{"run_id", "run_number", "agent", "reads", "writes", "at"}``.
    The counts are ``_count``'s, as on a round."""
    # ``node_history`` imports ``team_run``, which imports ``node_tools``, which imports this.
    from tvashtr.control_plane.node_history import _run_number

    runs = {
        str(run.id): run
        for run in session.execute(
            select(Run)
            .where(Run.owner_id == owner_id)
            .order_by(Run.created_at.desc(), Run.id)
            .limit(RECENT_USE_RUNS)
        ).scalars()
    }
    if not runs:
        return []
    events = session.execute(
        select(RunEvent, AgentNode)
        .outerjoin(AgentInvocation, AgentInvocation.id == RunEvent.invocation_id)
        .outerjoin(AgentNode, AgentNode.id == AgentInvocation.node_id)
        .where(
            RunEvent.run_id.in_(runs),
            RunEvent.seq >= EVENT_SEQ_BAND,  # as in ``connector_use``
            RunEvent.kind == "connector_call",
            RunEvent.payload["connection_id"].astext == str(connection_id),
        )
        .order_by(RunEvent.id)
    ).all()
    uses: dict[tuple, dict] = {}
    for event, node in events:
        key = (event.run_id, node.id if node is not None else None)
        use = uses.get(key)
        if use is None:  # built once per run and agent: the run's number is a query of its own
            use = uses[key] = {
                "run_id": event.run_id,
                "run_number": _run_number(session, runs[event.run_id]),
                "agent": node_label(node.role_name, node.kind, node.config) if node else None,
                "reads": 0,
                "writes": 0,
            }
        _count(use, event.payload)
        use["at"] = event.created_at.isoformat()  # the latest call: events come oldest first
    # Python's sort is stable and ``uses`` is in order of first call, so reversing puts the row
    # whose last call is newest first even when two stamps are equal.
    newest_first = sorted(reversed(uses.values()), key=lambda use: use["at"], reverse=True)
    return newest_first[:RECENT_USE_ROWS]

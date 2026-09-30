#!/usr/bin/env python
"""Connectors proxy probe (plan §10 T.1): the mounted ``/mcp/connectors`` of a RUNNING backend,
reached the way an agent's sandbox reaches it. No model and no provider key.

The unit tests drive the proxy's core and a subprocess with its own little app; this is the one
check that the real app's mount answers a real MCP client over HTTP. ``scripts/connectors_e2e.sh``
starts what it needs: the fake provider (``backend/tests/fake_connector_server.py``) and a backend
on the same database with ``TVASHTR_CONNECTORS_ALLOW_LOCAL=1`` and ``TVASHTR_HOSTED_MODE=false``.

It writes its own rows (an account, a key connection to the fake that is READ ONLY, a running run)
and signs a run token that asks for WRITE, then asserts:
  1. ``tools/list`` offers the fake's reads and not ``create_thing`` (the row's access wins);
  2. ``list_things`` works and ``create_thing`` is refused with the read-only tool error;
  3. exactly two ``connector_call`` events are recorded for the run, one ok and one blocked;
  4. after ``DELETE /api/connectors/{id}`` (over HTTP, as that account) ``tools/list`` is empty
     and a call says the connector isn't available, with nothing more recorded.

It never imports ``tvashtr.main``: a second process that imports the app starts DBOS recovery on
the same database. Run from ``backend/``: ``uv run python ../scripts/connectors_proxy_probe.py``.
"""

import argparse
import asyncio
import sys
import uuid

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import select

from tvashtr.auth import SESSION_COOKIE_NAME, make_session_cookie_value
from tvashtr.control_plane import connector_proxy
from tvashtr.control_plane.connectors import write_secret
from tvashtr.db import session_scope
from tvashtr.models import ConnectorConnection, Run, RunEvent, TeamGraph, User

STATIC_TOKEN = "fake-static-token"  # the bearer the fake server always takes
READS = {"list_things", "get_thing", "list_projects"}


def _check(ok: bool, what: str) -> None:
    print(("PASS: " if ok else "FAIL: ") + what)
    if not ok:
        sys.exit(1)


def _seed(fake: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """An account, its read-only key connection to the fake, and a running run of that account."""
    tag = uuid.uuid4().hex[:12]
    with session_scope() as s:
        user = User(email=f"conn-probe-{tag}@tvashtr.local", password_hash="x")
        graph = TeamGraph(name=f"connectors probe {tag}")
        s.add_all([user, graph])
        s.flush()
        row = ConnectorConnection(
            owner_id=user.id,
            connector_key=f"custom:{fake.split('://', 1)[1]}/mcp",
            name="Fake",
            slug="fake",
            url=f"{fake}/mcp",
            auth_kind="api_key",
            access="read",
            status="connected",
        )
        write_secret(row, {"headers": {"Authorization": f"Bearer {STATIC_TOKEN}"}})
        run_id = uuid.uuid4()
        run = Run(
            id=run_id,
            team_graph_id=graph.id,
            owner_id=user.id,
            idea="connectors proxy probe",
            workflow_id=str(run_id),
            status="running",
        )
        s.add_all([row, run])
        s.flush()
        return user.id, row.id, run_id


def _calls(run_id: uuid.UUID) -> list[tuple[str, bool, bool]]:
    with session_scope() as s:
        events = s.execute(
            select(RunEvent)
            .where(RunEvent.run_id == str(run_id), RunEvent.kind == "connector_call")
            .order_by(RunEvent.seq)
        ).scalars()
        return [(e.payload["tool"], e.payload["ok"], e.payload["blocked"]) for e in events]


async def _probe(backend: str, user_id: uuid.UUID, connection_id: uuid.UUID, run_id: uuid.UUID):
    token = connector_proxy.sign_run_token(run_id, None, connection_id, "write")
    address = backend + "/mcp/connectors"  # as an agent is given it: no trailing slash
    http = httpx.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30)
    seen = ""
    async with http, streamable_http_client(address, http_client=http) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            names = [t.name for t in (await session.list_tools()).tools]
            _check(set(names) == READS, f"tools/list offers only the reads: {names}")

            listed = await session.call_tool("list_things", {})
            text = "".join(b.text for b in listed.content)
            seen += text
            _check(not listed.isError and '"t1"' in text, "list_things is forwarded and answers")

            blocked = await session.call_tool("create_thing", {"name": "probe"})
            text = "".join(b.text for b in blocked.content)
            seen += text
            refusal = "Fake is read only for this agent. create_thing can change data, so it’s off."
            _check(blocked.isError and text == refusal, f"create_thing is refused: {text!r}")

            calls = _calls(run_id)
            _check(
                calls == [("list_things", True, False), ("create_thing", False, True)],
                f"two connector_call events, one ok and one blocked: {calls}",
            )

            gone = httpx.delete(
                f"{backend}/api/connectors/{connection_id}",
                cookies={SESSION_COOKIE_NAME: make_session_cookie_value(str(user_id))},
                timeout=30,
            )
            _check(gone.status_code == 200, f"DELETE /api/connectors/{{id}} -> {gone.status_code}")

            names = [t.name for t in (await session.list_tools()).tools]
            _check(names == [], f"tools/list is empty once it is disconnected: {names}")

            after = await session.call_tool("list_things", {})
            text = "".join(b.text for b in after.content)
            seen += text
            _check(
                after.isError and text == connector_proxy.UNAVAILABLE,
                f"a call after the disconnect is refused: {text!r}",
            )
            _check(len(_calls(run_id)) == 2, "nothing more is recorded after the disconnect")
    _check(STATIC_TOKEN not in seen, "no answer carries the provider credential")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--backend", default="http://localhost:8043", help="the running backend")
    parser.add_argument("--fake", default="http://127.0.0.1:9911", help="the fake provider")
    args = parser.parse_args()
    user_id, connection_id, run_id = _seed(args.fake.rstrip("/"))
    try:
        asyncio.run(_probe(args.backend.rstrip("/"), user_id, connection_id, run_id))
    finally:
        # Leave no run behind that looks like it is still going.
        with session_scope() as s:
            s.get(Run, run_id).status = "cancelled"
    print("connectors-proxy-probe: PASSED")


if __name__ == "__main__":
    main()

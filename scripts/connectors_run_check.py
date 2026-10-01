#!/usr/bin/env python
"""Connectors run-time check (plan §10 T.2): a REAL agent reaches a connector through the proxy.

Operator-run. It needs ``make seed`` (the operator and one provider key), a RUNNING backend
(LOCAL sandbox, ``TVASHTR_CONNECTORS_ALLOW_LOCAL=1``, ``TVASHTR_HOSTED_MODE=false``,
``TVASHTR_PUBLIC_BASE_URL`` the same address as ``--backend``) and the fake provider
(``backend/tests/fake_connector_server.py``).

As the seeded operator, over HTTP: connect the fake (its sign-in included), set it to Read & write,
give it to the one agent of a Blank team with a write grant, and run with an instruction to call
``list_things`` and then ``create_thing``. A read-only agent is never offered ``create_thing``, so
the write is refused the way the contract says a run that is going is narrowed: the connection is
set to read only the moment the read is recorded, and the agent still holds the tool. Then it
polls to the DBOS workflow terminal and asserts:
  1. a ``connector_call`` for ``list_things`` that is ok;
  2. a ``connector_call`` for ``create_thing`` that is blocked, and none that reached the provider;
  3. ``connectors.used`` on the agent's round names the connection (reads >= 1, writes 0);
  4. neither the provider's tokens nor the fake's fixed bearer is anywhere in the run's
     ``run_events``.
The run's own outcome is printed and not asserted: the path is proven once both calls are
recorded, whatever the model does afterwards.

``--domains`` (Security S1) runs the Domains leg instead: a domain holding one file, given to the
one agent of a Blank team, and a run that searches it with ``domain_retrieve``. It asserts the
search went through the agent's Domains run token (the tool answered with the file's fact, not
"authentication required") and that the owner's login (``tv_session``, and the operator's cookie
value) is nowhere in the run's ``run_events`` or in the round's saved ``context_manifest``. Needs a
key that embeds (OpenAI by default).

It never imports ``tvashtr.main`` (a second process that imports the app starts DBOS recovery on
the same database). Run from ``backend/``: ``uv run python ../scripts/connectors_run_check.py``.
"""

import argparse
import json
import os
import sys
import time
import uuid
from urllib.parse import parse_qsl, urlsplit

import httpx
from sqlalchemy import select

from tvashtr import seed
from tvashtr.control_plane.connectors import read_secret
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, ConnectorConnection, RunEvent

TERMINAL_WF = {"SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"}
STATIC_TOKEN = "fake-static-token"
PROMPT = "You carry out the task exactly as written, one tool call at a time."
IDEA = (
    "Use the Fake connector's tools. Step 1: call the tool list_things and read its answer. "
    "Step 2: only after you have that answer, call the tool create_thing once, with `name` set to "
    "the id of the first thing in the answer. If a tool call is refused, do not retry it. "
    "Step 3: write a file REPORT.md with one line saying what each call answered, then finish."
)


def _check(ok: bool, what: str) -> None:
    print(("PASS: " if ok else "FAIL: ") + what)
    if not ok:
        sys.exit(1)


def _ok(resp: httpx.Response, what: str) -> dict:
    ok = resp.status_code < 300  # the body only when it failed: a good one can carry a state
    _check(ok, f"{what} -> {resp.status_code}" + ("" if ok else f" {resp.text[:300]}"))
    return resp.json()


def _calls(run_id: str) -> list[dict]:
    with session_scope() as s:
        rows = s.execute(
            select(RunEvent.payload)
            .where(RunEvent.run_id == run_id, RunEvent.kind == "connector_call")
            .order_by(RunEvent.id)
        ).scalars()
        return list(rows)


def _tokens(connection_id: str) -> set[str]:
    """The provider tokens stored for the connection. Never printed."""
    with session_scope() as s:
        secret = read_secret(s.get(ConnectorConnection, uuid.UUID(connection_id))) or {}
    return {secret[k] for k in ("access_token", "refresh_token") if secret.get(k)}


FACT = "The run-check refund window is 47 days."


def _wait_for(c: httpx.Client, run_id: str, timeout: int) -> dict:
    final, deadline = None, time.time() + timeout
    while time.time() < deadline:
        state = c.get(f"/api/runs/{run_id}").json()
        if state["workflow_status"] in TERMINAL_WF:
            final = state
            break
        time.sleep(3)
    _check(final is not None, f"the run's workflow ended within {timeout}s")
    run = final.get("run") or {}
    print(f"workflow={final['workflow_status']} run={run.get('status')} {run.get('error')}")
    return final


def domains_check(c: httpx.Client, model: str, timeout: int) -> None:
    """The Domains leg (Security S1): a real agent searches a domain through its run token."""
    login = c.cookies.get("tv_session")
    _check(bool(login), "the operator's login cookie is there to look for")
    name = f"Run check docs {uuid.uuid4().hex[:6]}"
    did = _ok(c.post("/api/domains", json={"name": name, "template": "support"}), "domain")[
        "domain_id"
    ]
    try:
        upload = {"file": ("refunds.txt", FACT.encode(), "text/plain")}
        _ok(c.post(f"/api/domains/{did}/documents", files=upload), "upload a file")
        counts, deadline = {}, time.time() + 300
        while time.time() < deadline:
            counts = c.get(f"/api/domains/{did}/documents").json().get("counts") or {}
            if counts.get("ready") or counts.get("needs_attention"):
                break
            time.sleep(2)
        _check(counts.get("ready") == 1, f"the file is read ({counts})")

        team = _ok(
            c.post("/api/teams", json={"template": "blank", "name": "domains run check"}), "team"
        )
        tid = team["team_graph_id"]
        nodes = _ok(c.get(f"/api/teams/{tid}/graph"), "the team's graph")["nodes"]
        agent = next(n for n in nodes if n["kind"] in ("agent", "completion"))
        body = {"prompt": PROMPT, "model": model, "tool_config": {"tvashtr": {"domains": [did]}}}
        _ok(c.patch(f"/api/teams/{tid}/nodes/{agent['id']}", json=body), "Domains on the agent")
        idea = (
            f'Call the tool domain_retrieve once, with domain "{name}" and query "refund window". '
            "Then write a file REPORT.md with one line saying what it found, then finish."
        )
        run_id = _ok(c.post("/api/runs", json={"team_graph_id": tid, "idea": idea}), "run")[
            "run_id"
        ]
        print(f"run {run_id} on {model}; polling")
        _wait_for(c, run_id, timeout)

        with session_scope() as s:
            events = s.execute(
                select(RunEvent.kind, RunEvent.payload).where(RunEvent.run_id == run_id)
            ).all()
            manifests = s.execute(
                select(AgentInvocation.context_manifest).where(AgentInvocation.run_id == run_id)
            ).scalars()
            saved = "\n".join(json.dumps(m) for m in manifests)
        searches = [
            p
            for k, p in events
            if k == "observation" and "domain_retrieve" in str(p.get("tool_name"))
        ]
        print(
            f"domain_retrieve observations: {[str(p.get('observation'))[:160] for p in searches]}"
        )
        _check(
            any("47 days" in str(p.get("observation")) for p in searches),
            "the agent searched the domain through its run token and got the file's fact",
        )
        text = "\n".join(json.dumps(p) for _, p in events) + "\n" + saved
        _check(
            "tv_session" not in text and login not in text,
            f"no login cookie in run_events or context_manifest ({len(text)} characters read)",
        )
    finally:
        c.delete(f"/api/domains/{did}")
    print("domains-run-check: PASSED")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--backend", default="http://localhost:8043", help="the running backend")
    parser.add_argument("--fake", default="http://127.0.0.1:9911", help="the fake provider")
    parser.add_argument("--timeout", type=int, default=600, help="seconds to wait for the run")
    parser.add_argument("--domains", action="store_true", help="run the Domains leg instead")
    args = parser.parse_args()
    backend, fake = args.backend.rstrip("/"), args.fake.rstrip("/")
    model = os.environ.get("TVASHTR_AGENT_MODEL") or "deepseek/deepseek-chat"

    c = httpx.Client(base_url=backend, timeout=60)
    login = {
        "email": os.environ.get("TVASHTR_SEED_EMAIL", seed.DEFAULT_SEED_EMAIL),
        "password": os.environ.get("TVASHTR_SEED_PASSWORD", seed.DEFAULT_SEED_PASSWORD),
    }
    _ok(c.post("/api/auth/login", json=login), "log in as the operator")
    if args.domains:
        domains_check(c, model, args.timeout)
        return

    # Connect the fake and sign in: its Allow, then the callback in the owner's browser.
    cid = _ok(c.post("/api/connectors", json={"url": f"{fake}/mcp", "name": "Fake"}), "connect")[
        "id"
    ]
    try:
        started = _ok(c.post(f"/api/connectors/{cid}/oauth/start"), "oauth/start")
        allowed = httpx.post(started["authorize_url"])
        back = dict(parse_qsl(urlsplit(allowed.headers.get("location", "")).query))
        page = c.get("/api/connectors/oauth/callback", params=back)
        _check("is connected" in page.text, "the sign-in finishes in the owner's browser")
        wide = _ok(c.patch(f"/api/connectors/{cid}", json={"access": "write"}), "Read & write")
        name = wide["name"]

        team = _ok(
            c.post("/api/teams", json={"template": "blank", "name": "connectors run check"}), "team"
        )
        tid = team["team_graph_id"]
        nodes = _ok(c.get(f"/api/teams/{tid}/graph"), "the team's graph")["nodes"]
        agent = next(n for n in nodes if n["kind"] in ("agent", "completion"))
        grant = {"tvashtr": {"connectors": [{"id": cid, "access": "write"}]}}
        body = {"prompt": PROMPT, "model": model, "tool_config": grant}
        _ok(c.patch(f"/api/teams/{tid}/nodes/{agent['id']}", json=body), "grant on the agent")

        tokens = _tokens(cid)
        _check(bool(tokens), "the connection holds a provider token to look for")
        run_id = _ok(c.post("/api/runs", json={"team_graph_id": tid, "idea": IDEA}), "run")[
            "run_id"
        ]
        print(f"run {run_id} on {model}; polling")

        narrowed, final, deadline = False, None, time.time() + args.timeout
        while time.time() < deadline:
            if not narrowed and any(call["tool"] == "list_things" for call in _calls(run_id)):
                _ok(c.patch(f"/api/connectors/{cid}", json={"access": "read"}), "narrow to read")
                narrowed = True
            state = c.get(f"/api/runs/{run_id}").json()
            if state["workflow_status"] in TERMINAL_WF:
                final = state
                break
            time.sleep(0.3 if not narrowed else 3)
        _check(final is not None, f"the run's workflow ended within {args.timeout}s")
        run = final.get("run") or {}
        print(f"workflow={final['workflow_status']} run={run.get('status')} {run.get('error')}")

        calls = _calls(run_id)
        seen = [(call["tool"], call["ok"], call["blocked"], call["forwarded"]) for call in calls]
        print(f"connector_call (tool, ok, blocked, forwarded): {seen}")
        _check(
            any(call["tool"] == "list_things" and call["ok"] for call in calls),
            "a connector_call for list_things that is ok",
        )
        writes = [call for call in calls if call["tool"] == "create_thing"]
        _check(
            bool(writes) and all(w["blocked"] and not w["forwarded"] for w in writes),
            "create_thing is recorded as blocked and never reached the provider",
        )

        graph = _ok(c.get(f"/api/runs/{run_id}/graph"), "the run's graph")
        used = [
            u
            for node in graph["nodes"]
            for invocation in node.get("invocations") or []
            for u in (invocation.get("connectors") or {}).get("used", [])
        ]
        print(f"connectors.used: {used}")
        _check(
            any(u["connection_id"] == cid and u["reads"] >= 1 and u["writes"] == 0 for u in used),
            f"connectors.used on the round names {name} with a read and no write",
        )

        with session_scope() as s:
            events = s.execute(select(RunEvent.payload).where(RunEvent.run_id == run_id)).scalars()
            text = "\n".join(json.dumps(payload) for payload in events)
        secrets_ = tokens | _tokens(cid) | {STATIC_TOKEN}
        _check(
            not any(secret in text for secret in secrets_),
            f"no provider token in the run's run_events ({len(text)} characters read)",
        )
    finally:
        c.delete(f"/api/connectors/{cid}")
    print("connectors-run-check: PASSED")


if __name__ == "__main__":
    main()

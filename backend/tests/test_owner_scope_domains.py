"""Security S1-C — owner-scoping sweep, the Domains family.

Two fresh accounts per test: A owns a domain (a file with pieces, a chat message, a test question,
a test run) and a library team whose writer can search the domain; B owns its own domain and team.
Every route that takes A's id answers B 404 with none of A's data, A's own identical call is not
404 (so B's 404 is the owner check), and A's rows are unchanged after B's writes. No network, no
LLM: workflows, search and ask are faked.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from toolkit_helpers import fresh_account, make_node, make_team

from tvashtr.config import get_settings
from tvashtr.control_plane import domain_eval, domain_read
from tvashtr.control_plane.domain_files import absolute_path
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentNode,
    Domain,
    DomainChunk,
    DomainDocument,
    DomainEvalCase,
    DomainEvalRun,
    DomainMessage,
    Edge,
)

_KEYS = {"openai", "openrouter", "groq", "gemini", "nvidia_nim", "deepseek"}


def _edge(team: uuid.UUID, source: uuid.UUID, target: uuid.UUID) -> None:
    with session_scope() as s:
        s.add(
            Edge(team_graph_id=team, source_node_id=source, target_node_id=target, edge_type="work")
        )


def _team(owner: uuid.UUID, name: str, domain_id: str | None = None) -> SimpleNamespace:
    """PM → Writer → Ship; the writer can search ``domain_id``."""
    t = make_team(owner, name)
    pm = make_node(t, "pm", kind="completion", x=0)
    tool = {"tvashtr": {"domains": [domain_id]}} if domain_id else None
    writer = make_node(t, "worker", x=260, tool_config=tool, config={"title": f"{name} writer"})
    ship = make_node(t, "ship", kind="terminal", x=520, config={"terminal_kind": "ship"})
    _edge(t, pm, writer)
    _edge(t, writer, ship)
    return SimpleNamespace(team=t, pm=pm, writer=writer, ship=ship)


@pytest.fixture
def w(client, monkeypatch, tmp_path):
    """A's world and B's world (``client`` only launches the app's lifespan)."""
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()
    started: list = []

    def _start(*args, **kwargs):
        started.append(args)
        return MagicMock(workflow_id="wf-owner-scope")

    monkeypatch.setattr(domain_read.DBOS, "start_workflow", _start)
    monkeypatch.setattr(
        domain_eval,
        "retrieve_domain",
        lambda owner_id, domain_id, question: {"citations": [], "latency_ms": 1},
    )

    tag = uuid.uuid4().hex  # every piece of A's data carries it; B must never see it
    a, a_id = fresh_account()
    b, b_id = fresh_account()

    r = a.post("/api/domains", json={"template": "support", "name": f"A secret {tag}"})
    assert r.status_code == 200, r.text
    a_did = r.json()["domain_id"]
    r = a.post(
        f"/api/domains/{a_did}/documents",
        files={"file": (f"a-{tag}.txt", f"A file body {tag}".encode(), "text/plain")},
    )
    assert r.status_code == 200, r.text
    a_doc = r.json()["document_id"]
    with session_scope() as s:
        s.add(
            DomainChunk(
                domain_id=uuid.UUID(a_did),
                document_id=uuid.UUID(a_doc),
                ordinal=0,
                text=f"A piece {tag}",
                meta={"filename": f"a-{tag}.txt"},
            )
        )
        s.add(DomainMessage(domain_id=uuid.UUID(a_did), role="user", content=f"A asked {tag}"))
    r = a.post(
        f"/api/domains/{a_did}/eval/cases",
        json={
            "question": f"A question {tag}?",
            "expected_citation_doc_ids": [a_doc],
            "expected_keywords": ["refund"],
        },
    )
    assert r.status_code == 200, r.text
    a_case = r.json()["case_id"]
    r = a.post(f"/api/domains/{a_did}/eval")
    assert r.status_code == 200, r.text
    a_run = r.json()["run_id"]
    a_team = _team(a_id, f"A team {tag}", a_did)

    r = b.post("/api/domains", json={"template": "support", "name": "B own domain"})
    assert r.status_code == 200, r.text
    b_did = r.json()["domain_id"]
    r = b.post(
        f"/api/domains/{b_did}/documents",
        files={"file": ("b.txt", b"B file body", "text/plain")},
    )
    assert r.status_code == 200, r.text
    b_doc = r.json()["document_id"]
    r = b.post(
        f"/api/domains/{b_did}/eval/cases", json={"question": "B q?", "expected_keywords": ["x"]}
    )
    assert r.status_code == 200, r.text
    b_case = r.json()["case_id"]
    b_team = _team(b_id, "B team")

    yield SimpleNamespace(
        a=a,
        a_id=a_id,
        b=b,
        b_id=b_id,
        tag=tag,
        started=started,
        a_did=a_did,
        a_doc=a_doc,
        a_case=a_case,
        a_run=a_run,
        a_team=a_team,
        b_did=b_did,
        b_doc=b_doc,
        b_case=b_case,
        b_team=b_team,
    )
    get_settings.cache_clear()


def _rows(s, model, did: uuid.UUID, *cols) -> list[tuple]:
    out = s.execute(select(model).where(model.domain_id == did)).scalars()
    return sorted((tuple(str(getattr(r, c)) for c in ("id", *cols)) for r in out), key=str)


def _team_rows(s, team: uuid.UUID) -> dict:
    nodes = s.execute(select(AgentNode).where(AgentNode.team_graph_id == team)).scalars()
    edges = s.execute(select(Edge).where(Edge.team_graph_id == team)).scalars()
    return {
        "nodes": sorted(
            (str(n.id), n.kind, str(n.config), str(n.tool_config), str(n.position)) for n in nodes
        ),
        "edges": sorted((str(e.id), str(e.source_node_id), str(e.target_node_id)) for e in edges),
    }


def _snapshot(w) -> dict:
    """Everything of A's (plus B's own rows, so a write B aimed at A can't land on B either)."""
    did = uuid.UUID(w.a_did)
    with session_scope() as s:
        d = s.get(Domain, did)
        docs = s.execute(select(DomainDocument).where(DomainDocument.domain_id == did)).scalars()
        return {
            "domain": None if d is None else (d.owner_id, d.name, d.template, str(d.config)),
            "docs": sorted(
                (
                    str(x.id),
                    x.filename,
                    x.ingest_status,
                    x.version,
                    x.error_message,
                    absolute_path(x.storage_path).is_file(),
                )
                for x in docs
            ),
            "chunks": _rows(s, DomainChunk, did, "text"),
            "messages": _rows(s, DomainMessage, did, "content"),
            "cases": _rows(
                s, DomainEvalCase, did, "question", "expected_citation_doc_ids", "expected_keywords"
            ),
            "runs": _rows(s, DomainEvalRun, did, "status"),
            "a_team": _team_rows(s, w.a_team.team),
            "b_team": _team_rows(s, w.b_team.team),
            "a_domains": sorted(
                str(x)
                for x in s.execute(select(Domain.id).where(Domain.owner_id == w.a_id)).scalars()
            ),
            "b_domains": sorted(
                str(x)
                for x in s.execute(select(Domain.id).where(Domain.owner_id == w.b_id)).scalars()
            ),
            "b_cases": _rows(
                s, DomainEvalCase, uuid.UUID(w.b_did), "question", "expected_citation_doc_ids"
            ),
        }


def _without(snap: dict, key: str) -> dict:
    return {k: v for k, v in snap.items() if k != key}


def _refused(resp, w) -> None:
    """B's attempt: 404, and nothing of A's in the answer."""
    assert resp.status_code == 404, f"B got {resp.status_code}: {resp.text}"
    assert w.tag not in resp.text, f"B's 404 leaks A's data: {resp.text}"


# ---- list / own ----


def test_list_domains_shows_a_only_to_a(w):
    a_list = w.a.get("/api/domains")
    assert a_list.status_code == 200
    assert w.a_did in a_list.text and w.tag in a_list.text
    b_list = w.b.get("/api/domains")
    assert b_list.status_code == 200
    assert w.a_did not in b_list.text and w.tag not in b_list.text
    assert [d["domain_id"] for d in b_list.json()["domains"]] == [w.b_did]


def test_domain_templates_carry_no_account_data(w):
    a, b = w.a.get("/api/domain-templates"), w.b.get("/api/domain-templates")
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert w.tag not in b.text and w.a_did not in b.text


def test_create_domain_is_per_account(w):
    """The name rule is per account: B may take A's exact name (a 409 would reveal A's domain)."""
    before = _snapshot(w)
    r = w.b.post("/api/domains", json={"template": "support", "name": f"A secret {w.tag}"})
    assert r.status_code == 200, r.text
    new = r.json()["domain_id"]
    with session_scope() as s:
        assert s.get(Domain, uuid.UUID(new)).owner_id == w.b_id
    after = _snapshot(w)
    assert after["b_domains"] == sorted([*before["b_domains"], new])
    after["b_domains"] = before["b_domains"]
    assert after == before


# ---- one domain: reads ----


@pytest.mark.parametrize(
    ("suffix", "a_sees"),
    [
        ("", "tag"),
        ("/documents", "tag"),
        ("/messages", "tag"),
        ("/eval/cases", "tag"),
        ("/eval/runs", "a_run"),
        ("/eval/runs/latest", "a_run"),
        ("/usage", "tag"),
        ("/step-places", "tag"),
        ("/agents", "tag"),
    ],
)
def test_reads_of_a_domain_are_404_for_b(w, suffix, a_sees):
    url = f"/api/domains/{w.a_did}{suffix}"
    _refused(w.b.get(url), w)
    mine = w.a.get(url)
    assert mine.status_code == 200, mine.text
    assert getattr(w, a_sees) in mine.text


@pytest.mark.parametrize("what", ["pieces", "file"])
@pytest.mark.parametrize("via", ["a_domain", "b_domain"])
def test_document_reads_are_404_for_b(w, what, via):
    did = w.a_did if via == "a_domain" else w.b_did
    _refused(w.b.get(f"/api/domains/{did}/documents/{w.a_doc}/{what}"), w)
    mine = w.a.get(f"/api/domains/{w.a_did}/documents/{w.a_doc}/{what}")
    assert mine.status_code == 200, mine.text
    assert w.tag in mine.text
    # B's own domain and file answer B: the 404 above is A's file id, not B's path.
    assert w.b.get(f"/api/domains/{w.b_did}/documents/{w.b_doc}/{what}").status_code == 200


def test_eval_run_is_404_for_b(w):
    _refused(w.b.get(f"/api/domains/{w.a_did}/eval/runs/{w.a_run}"), w)
    _refused(w.b.get(f"/api/domains/{w.b_did}/eval/runs/{w.a_run}"), w)
    mine = w.a.get(f"/api/domains/{w.a_did}/eval/runs/{w.a_run}")
    assert mine.status_code == 200, mine.text
    assert w.tag in mine.text


# ---- one domain: writes ----


def test_patch_domain_is_404_for_b(w):
    """A new reading model would put every one of A's files back to waiting."""
    with session_scope() as s:
        config = dict(s.get(Domain, uuid.UUID(w.a_did)).config)
    config["embedding"] = {"model": "huggingface/BAAI/bge-small-en-v1.5"}
    body = {"name": "Hijacked", "template": "legal", "config": config}
    before = _snapshot(w)
    _refused(w.b.patch(f"/api/domains/{w.a_did}", json=body), w)
    assert _snapshot(w) == before
    mine = w.a.patch(f"/api/domains/{w.a_did}", json=body)
    assert mine.status_code == 200, mine.text
    assert mine.json()["reread"]["needed"] == "required"


def test_duplicate_domain_is_404_for_b(w):
    before = _snapshot(w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/duplicate", json={}), w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/duplicate", json={"name": "Copy of A"}), w)
    assert _snapshot(w) == before
    mine = w.a.post(f"/api/domains/{w.a_did}/duplicate", json={})
    assert mine.status_code == 201, mine.text


def test_upload_document_is_404_for_b(w):
    before = _snapshot(w)
    r = w.b.post(
        f"/api/domains/{w.a_did}/documents",
        files={"file": ("b.txt", b"B planted this", "text/plain")},
    )
    _refused(r, w)
    assert _snapshot(w) == before
    mine = w.a.post(
        f"/api/domains/{w.a_did}/documents", files={"file": ("a2.txt", b"more", "text/plain")}
    )
    assert mine.status_code == 200, mine.text


def test_reread_is_404_for_b(w):
    before = _snapshot(w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/reread"), w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/reread", json={"document_ids": [w.a_doc]}), w)
    # B's own domain, A's file in the body.
    _refused(w.b.post(f"/api/domains/{w.b_did}/reread", json={"document_ids": [w.a_doc]}), w)
    assert _snapshot(w) == before
    mine = w.a.post(f"/api/domains/{w.a_did}/reread", json={"document_ids": [w.a_doc]})
    assert mine.status_code == 202, mine.text
    # B's own domain and file: 202, so B's 404 above is A's file id.
    own = w.b.post(f"/api/domains/{w.b_did}/reread", json={"document_ids": [w.b_doc]})
    assert own.status_code == 202, own.text


def test_ingest_is_404_for_b(w, monkeypatch):
    monkeypatch.setattr("tvashtr.routers.held_provider_slugs", lambda owner_id: _KEYS)
    with session_scope() as s:  # a failed file: an ingest would put it back to waiting
        s.get(DomainDocument, uuid.UUID(w.a_doc)).ingest_status = "error"
    before = _snapshot(w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/ingest"), w)
    assert _snapshot(w) == before
    mine = w.a.post(f"/api/domains/{w.a_did}/ingest")
    assert mine.status_code == 200, mine.text


@pytest.mark.parametrize(
    ("route", "body", "fake"),
    [
        ("ask", {"question": "What is in A's files?"}, "ask_domain"),
        ("retrieve", {"query": "What is in A's files?"}, "retrieve_domain"),
    ],
)
def test_ask_and_retrieve_are_404_for_b(w, monkeypatch, route, body, fake):
    calls: list = []

    def _fake(owner_id, domain_id, *args, **kwargs):
        calls.append(owner_id)
        return {"answer": "ok", "citations": [], "latency_ms": 1}

    monkeypatch.setattr(f"tvashtr.routers.{fake}", _fake)
    before = _snapshot(w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/{route}", json=body), w)
    assert calls == []
    assert _snapshot(w) == before
    mine = w.a.post(f"/api/domains/{w.a_did}/{route}", json=body)
    assert mine.status_code == 200, mine.text
    assert calls == [w.a_id]


def test_clear_messages_is_404_for_b(w):
    before = _snapshot(w)
    assert before["messages"]
    _refused(w.b.delete(f"/api/domains/{w.a_did}/messages"), w)
    assert _snapshot(w) == before
    assert w.a.delete(f"/api/domains/{w.a_did}/messages").status_code == 204


@pytest.mark.parametrize("via", ["a_domain", "b_domain"])
def test_delete_document_is_404_for_b(w, via):
    did = w.a_did if via == "a_domain" else w.b_did
    before = _snapshot(w)
    _refused(w.b.delete(f"/api/domains/{did}/documents/{w.a_doc}"), w)
    assert _snapshot(w) == before
    mine = w.a.delete(f"/api/domains/{w.a_did}/documents/{w.a_doc}")
    assert mine.status_code == 200, mine.text
    assert w.b.delete(f"/api/domains/{w.b_did}/documents/{w.b_doc}").status_code == 200


def test_delete_domain_is_404_for_b(w):
    before = _snapshot(w)
    _refused(w.b.delete(f"/api/domains/{w.a_did}"), w)
    assert _snapshot(w) == before
    mine = w.a.delete(f"/api/domains/{w.a_did}")
    assert mine.status_code == 200, mine.text


# ---- Quality: test questions and runs ----


def test_create_eval_case_on_a_domain_is_404_for_b(w):
    before = _snapshot(w)
    body = {"question": "B's question?", "expected_keywords": ["x"]}
    _refused(w.b.post(f"/api/domains/{w.a_did}/eval/cases", json=body), w)
    assert _snapshot(w) == before
    assert w.a.post(f"/api/domains/{w.a_did}/eval/cases", json=body).status_code == 200


def test_create_eval_case_with_a_file_id_is_refused_for_b(w):
    """B's own domain, A's file id in the body."""
    before = _snapshot(w)
    r = w.b.post(
        f"/api/domains/{w.b_did}/eval/cases",
        json={"question": "B's question?", "expected_citation_doc_ids": [w.a_doc]},
    )
    after = _snapshot(w)
    assert _without(after, "b_cases") == _without(before, "b_cases")  # A's rows untouched
    mine = w.a.post(
        f"/api/domains/{w.a_did}/eval/cases",
        json={"question": "A again?", "expected_citation_doc_ids": [w.a_doc]},
    )
    assert mine.status_code == 200, mine.text
    _refused(r, w)
    assert after == before


@pytest.mark.parametrize("via", ["a_domain", "b_domain"])
def test_patch_eval_case_is_404_for_b(w, via):
    did = w.a_did if via == "a_domain" else w.b_did
    before = _snapshot(w)
    _refused(w.b.patch(f"/api/domains/{did}/eval/cases/{w.a_case}", json={"question": "B?"}), w)
    assert _snapshot(w) == before
    mine = w.a.patch(f"/api/domains/{w.a_did}/eval/cases/{w.a_case}", json={"question": "A2?"})
    assert mine.status_code == 200, mine.text
    own = w.b.patch(f"/api/domains/{w.b_did}/eval/cases/{w.b_case}", json={"question": "B?"})
    assert own.status_code == 200, own.text


def test_patch_eval_case_with_a_file_id_is_refused_for_b(w):
    """B's own domain and case, A's file id in the body."""
    before = _snapshot(w)
    r = w.b.patch(
        f"/api/domains/{w.b_did}/eval/cases/{w.b_case}",
        json={"expected_citation_doc_ids": [w.a_doc]},
    )
    after = _snapshot(w)
    assert _without(after, "b_cases") == _without(before, "b_cases")  # A's rows untouched
    mine = w.a.patch(
        f"/api/domains/{w.a_did}/eval/cases/{w.a_case}",
        json={"expected_citation_doc_ids": [w.a_doc]},
    )
    assert mine.status_code == 200, mine.text
    _refused(r, w)
    assert after == before


@pytest.mark.parametrize("via", ["a_domain", "b_domain"])
def test_delete_eval_case_is_404_for_b(w, via):
    did = w.a_did if via == "a_domain" else w.b_did
    before = _snapshot(w)
    _refused(w.b.delete(f"/api/domains/{did}/eval/cases/{w.a_case}"), w)
    assert _snapshot(w) == before
    assert w.a.delete(f"/api/domains/{w.a_did}/eval/cases/{w.a_case}").status_code == 204
    assert w.b.delete(f"/api/domains/{w.b_did}/eval/cases/{w.b_case}").status_code == 204


def test_start_eval_run_is_404_for_b(w):
    before = _snapshot(w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/eval/runs"), w)
    assert w.started == []
    assert _snapshot(w) == before
    mine = w.a.post(f"/api/domains/{w.a_did}/eval/runs")
    assert mine.status_code == 202, mine.text
    assert len(w.started) == 1


def test_sync_eval_is_404_for_b(w):
    before = _snapshot(w)
    _refused(w.b.post(f"/api/domains/{w.a_did}/eval"), w)
    assert _snapshot(w) == before
    assert w.a.post(f"/api/domains/{w.a_did}/eval").status_code == 200


# ---- Use in teams: steps and agents ----


def test_add_step_is_404_for_b(w):
    before = _snapshot(w)
    own = {"team_id": str(w.b_team.team), "after_node_id": str(w.b_team.pm), "prompt": "q"}
    # A's domain, B's own team.
    _refused(w.b.post(f"/api/domains/{w.a_did}/steps", json=own), w)
    # B's own domain, A's team and node.
    theirs = {"team_id": str(w.a_team.team), "after_node_id": str(w.a_team.pm), "prompt": "q"}
    _refused(w.b.post(f"/api/domains/{w.b_did}/steps", json=theirs), w)
    # B's own domain and team, A's node as the place.
    mixed = {"team_id": str(w.b_team.team), "after_node_id": str(w.a_team.pm), "prompt": "q"}
    _refused(w.b.post(f"/api/domains/{w.b_did}/steps", json=mixed), w)
    assert _snapshot(w) == before
    mine = w.a.post(
        f"/api/domains/{w.a_did}/steps",
        json={"team_id": str(w.a_team.team), "after_node_id": str(w.a_team.pm), "prompt": "q"},
    )
    assert mine.status_code == 201, mine.text
    # B's own domain, team and node: 201, so each 404 above is A's id.
    a_team = _snapshot(w)["a_team"]
    assert w.b.post(f"/api/domains/{w.b_did}/steps", json=own).status_code == 201
    assert _snapshot(w)["a_team"] == a_team


def test_set_domain_agents_is_404_for_b(w):
    before = _snapshot(w)
    # A's domain: B tries to take A's writer's access away, or give it to B's own agent.
    _refused(w.b.put(f"/api/domains/{w.a_did}/agents", json={"node_ids": []}), w)
    _refused(
        w.b.put(f"/api/domains/{w.a_did}/agents", json={"node_ids": [str(w.b_team.writer)]}), w
    )
    # B's own domain, A's agents in the body.
    _refused(
        w.b.put(
            f"/api/domains/{w.b_did}/agents",
            json={"node_ids": [str(w.a_team.writer), str(w.a_team.pm)]},
        ),
        w,
    )
    assert _snapshot(w) == before
    mine = w.a.put(f"/api/domains/{w.a_did}/agents", json={"node_ids": [str(w.a_team.pm)]})
    assert mine.status_code == 200, mine.text
    # B's own domain and agent: 200, so the 404 above is A's node ids; A's agents untouched.
    a_team = _snapshot(w)["a_team"]
    own = w.b.put(f"/api/domains/{w.b_did}/agents", json={"node_ids": [str(w.b_team.writer)]})
    assert own.status_code == 200, own.text
    assert _snapshot(w)["a_team"] == a_team

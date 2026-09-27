"""Domains revamp G6 — the Ask tab's chat: follow-ups, NOT_FOUND, numbered sources, answer meta,
agent asks kept out of the chat, and Clear chat."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.control_plane import domain_ask
from tvashtr.control_plane.domain_answers import answer_view, plain_answer
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.main import app
from tvashtr.models import Domain, DomainChunk, DomainDocument, DomainMessage


def _fresh() -> tuple[TestClient, uuid.UUID, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"askchat-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "pw-askchat"}).status_code
        == 200
    )
    did = uuid.UUID(
        c.post("/api/domains", json={"template": "support", "name": "Support docs"}).json()[
            "domain_id"
        ]
    )
    with session_scope() as session:
        owner_id = session.get(Domain, did).owner_id
    return c, owner_id, did


def _seed(did: uuid.UUID) -> dict[str, str]:
    """refund-policy.md (3 pieces) and billing-faq.pdf (2 pieces, page numbers), all ready."""
    ids = {}
    with session_scope() as session:
        for name, texts, pages in (
            (
                "refund-policy.md",
                ["Intro.", "Scope.", "Customers may request a full refund within 30 days."],
                None,
            ),
            (
                "billing-faq.pdf",
                ["Invoices.", "We refund the unused whole months on a prorated basis."],
                [2, 4],
            ),
        ):
            doc = DomainDocument(
                domain_id=did,
                filename=name,
                content_type="text/plain",
                storage_path=f"x/{did}/{name}",
                byte_size=12,
                ingest_status="ready",
            )
            session.add(doc)
            session.flush()
            ids[name] = str(doc.id)
            for i, text in enumerate(texts):
                session.add(
                    DomainChunk(
                        domain_id=did,
                        document_id=doc.id,
                        ordinal=i,
                        text=text,
                        embedding=[0.0] * 1536,
                        meta={"page": pages[i]} if pages else None,
                    )
                )
    return ids


class _Gateway:
    """Records embed inputs and completion messages; answers with the next queued text."""

    def __init__(self, monkeypatch, answers: list[str]):
        self.answers = answers
        self.embedded: list[list[str]] = []
        self.prompts: list[list[dict]] = []
        monkeypatch.setattr(domain_ask, "held_provider_slugs", lambda oid: {"openai"})
        monkeypatch.setattr(domain_ask, "resolve_owner_api_key", lambda oid, model: "sk-test")
        monkeypatch.setattr(domain_ask, "embed", self.embed)
        monkeypatch.setattr(domain_ask, "complete", self.complete)

    def embed(self, req):
        self.embedded.append(list(req.input))
        return EmbeddingResult(
            vectors=[[0.0] * 1536],
            model="openai/text-embedding-3-small",
            prompt_tokens=1,
            total_tokens=1,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=1.0,
        )

    def complete(self, req):
        self.prompts.append(list(req.messages))
        return CompletionResult(
            text=self.answers.pop(0),
            model_requested=req.model,
            model_used=req.model,
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            cost_usd=0.001,
            raw_provider="openai",
            latency_ms=1800.0,
        )


# ---- answer_view / plain_answer (pure) ----


def test_answer_view_renumbers_cited_passages_in_order_of_first_mention():
    cites = [{"filename": f"f{i}"} for i in range(1, 5)]
    view = answer_view("A [3]. B [1, 3]. C [9]. D [2][3].", cites)
    assert view["covered"] is True
    assert view["answer_text"] == "A [1]. B [2, 1]. C. D [3][1]."
    assert [(s["number"], s["citation_index"], s["filename"]) for s in view["sources"]] == [
        (1, 3, "f3"),
        (2, 1, "f1"),
        (3, 2, "f2"),
    ]


def test_answer_view_not_found_strips_the_marker_and_offers_the_two_closest():
    cites = [{"filename": f"f{i}"} for i in range(1, 5)]
    view = answer_view("NOT_FOUND: The closest passages talk about pricing [1].", cites)
    assert view["covered"] is False
    assert view["answer_text"] == "The closest passages talk about pricing."
    assert [s["filename"] for s in view["sources"]] == ["f1", "f2"]


def test_answer_view_without_markers_is_covered_with_the_top_two():
    view = answer_view(
        "Refunds take 30 days.", [{"filename": "a"}, {"filename": "b"}, {"filename": "c"}]
    )
    assert view["covered"] is True
    assert [s["number"] for s in view["sources"]] == [1, 2]


def test_plain_answer_drops_markers():
    assert plain_answer("NOT_FOUND: nothing [1].") == "nothing."
    assert plain_answer("Within 30 days [1], prorated [2, 3].") == "Within 30 days, prorated."


# ---- ask ----


def test_chat_ask_numbers_sources_with_pieces_pages_and_meta(monkeypatch):
    c, _owner, did = _fresh()
    ids = _seed(did)
    gw = _Gateway(monkeypatch, ["Within 30 days [3], prorated after [5]."])
    # Deterministic rank: the five pieces in the order the model sees them.
    monkeypatch.setattr(domain_ask, "retrieve_for_query", _rank(did))

    r = c.post(f"/api/domains/{did}/ask", json={"question": "How long for a refund?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert domain_ask.NOT_FOUND_RULE in gw.prompts[0][0]["content"]
    assert body["covered"] is True
    assert body["answer_text"] == "Within 30 days [1], prorated after [2]."
    assert body["used_history"] is False
    # The account default here: the design's label for a known slug, "<vendor> <name>" otherwise.
    assert body["model_label"] == "OpenAI gpt-4.1-mini"
    assert [s["filename"] for s in body["searched"]] == [
        "refund-policy.md",
        "refund-policy.md",
        "refund-policy.md",
        "billing-faq.pdf",
        "billing-faq.pdf",
    ]
    one, two = body["sources"]
    assert (one["number"], one["citation_index"], one["document_id"]) == (
        1,
        3,
        ids["refund-policy.md"],
    )
    assert (one["piece_number"], one["pieces_in_file"], one["page"]) == (3, 3, None)
    assert (
        two["number"],
        two["filename"],
        two["piece_number"],
        two["pieces_in_file"],
        two["page"],
    ) == (
        2,
        "billing-faq.pdf",
        2,
        2,
        4,
    )
    # Original keys stay.
    assert body["answer"] == "Within 30 days [3], prorated after [5]."
    assert len(body["citations"]) == 5
    assert body["message_id"] and body["user_message_id"]

    with session_scope() as session:
        rows = (
            session.query(DomainMessage)
            .filter_by(domain_id=did)
            .order_by(DomainMessage.created_at)
            .all()
        )
        assert [r.meta for r in rows] == [
            {"source": "chat"},
            {"model": "openai/gpt-4.1-mini", "used_history": False, "source": "chat"},
        ]

    msgs = c.get(f"/api/domains/{did}/messages").json()["messages"]
    assert msgs[0]["role"] == "user" and "sources" not in msgs[0]
    ans = msgs[1]
    assert ans["answer_text"] == "Within 30 days [1], prorated after [2]."
    assert [s["number"] for s in ans["sources"]] == [1, 2]
    assert ans["sources"][1]["page"] == 4
    assert len(ans["searched"]) == 5
    assert (ans["used_history"], ans["model_label"]) == (False, "OpenAI gpt-4.1-mini")


def _rank(did):
    def retrieve(domain_id, query, **_):
        with session_scope() as session:
            rows = (
                session.query(DomainChunk, DomainDocument.filename)
                .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
                .filter(DomainChunk.domain_id == did)
                .order_by(DomainDocument.filename.desc(), DomainChunk.ordinal)
                .all()
            )
            return [
                {
                    "document_id": str(ch.document_id),
                    "filename": fn,
                    "chunk_id": str(ch.id),
                    "ordinal": ch.ordinal,
                    "text": ch.text,
                }
                for ch, fn in rows
            ]

    return retrieve


def test_follow_up_sends_earlier_turns_and_searches_with_the_previous_question(monkeypatch):
    c, _owner, did = _fresh()
    _seed(did)
    gw = _Gateway(monkeypatch, ["Within 30 days [1].", "Yes, prorated [2]."])
    c.post(f"/api/domains/{did}/ask", json={"question": "How long for a refund?"})

    r = c.post(
        f"/api/domains/{did}/ask",
        json={"question": "And annual plans?", "use_history": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["used_history"] is True
    assert gw.embedded[1] == ["How long for a refund? And annual plans?"]
    turns = [(m["role"], m["content"]) for m in gw.prompts[1][1:]]
    assert turns == [
        ("user", "How long for a refund?"),
        ("assistant", "Within 30 days."),
        ("user", "And annual plans?"),
    ]
    assert c.get(f"/api/domains/{did}/messages").json()["messages"][-1]["used_history"] is True


def test_history_off_or_empty_chat_asks_alone(monkeypatch):
    c, _owner, did = _fresh()
    _seed(did)
    gw = _Gateway(monkeypatch, ["A [1].", "B [1]."])
    first = c.post(f"/api/domains/{did}/ask", json={"question": "Q1?", "use_history": True}).json()
    assert first["used_history"] is False
    c.post(f"/api/domains/{did}/ask", json={"question": "Q2?"})
    assert gw.embedded[1] == ["Q2?"]
    assert [m["role"] for m in gw.prompts[1]] == ["system", "user"]


def test_not_found_answer_is_not_covered(monkeypatch):
    c, _owner, did = _fresh()
    _seed(did)
    _Gateway(monkeypatch, ["NOT_FOUND: The closest passages talk about invoices."])
    body = c.post(f"/api/domains/{did}/ask", json={"question": "Non-profit discount?"}).json()
    assert body["covered"] is False
    assert body["answer_text"] == "The closest passages talk about invoices."
    assert [s["number"] for s in body["sources"]] == [1, 2]


def test_agent_and_node_asks_stay_out_of_the_chat(monkeypatch):
    _c, owner_id, did = _fresh()
    _seed(did)
    gw = _Gateway(monkeypatch, ["Within 30 days [1]."])
    out = domain_ask.ask_domain(owner_id, did, "How long?", persist=False)
    assert out["message_id"] is None and out["answer_text"] == "Within 30 days [1]."
    # The legacy prompt (no NOT_FOUND rule) unless asked for.
    assert domain_ask.NOT_FOUND_RULE not in gw.prompts[0][0]["content"]
    with session_scope() as session:
        assert session.query(DomainMessage).filter_by(domain_id=did).count() == 0


def test_ask_domain_writes_no_chat_message_by_default(monkeypatch):
    """Only the chat endpoint keeps the thread: ask_domain's default (what the legacy Query domain
    step calls, with no ``persist``) writes no DomainMessage; POST /ask still writes both turns."""
    c, owner_id, did = _fresh()
    _seed(did)
    _Gateway(monkeypatch, ["Within 30 days [1].", "Within 30 days [1]."])
    out = domain_ask.ask_domain(owner_id, did, "How long?")
    assert out["message_id"] is None and out["answer_text"] == "Within 30 days [1]."
    with session_scope() as session:
        assert session.query(DomainMessage).filter_by(domain_id=did).count() == 0
    assert c.post(f"/api/domains/{did}/ask", json={"question": "How long?"}).status_code == 200
    with session_scope() as session:
        roles = [m.role for m in session.query(DomainMessage).filter_by(domain_id=did)]
    assert sorted(roles) == ["assistant", "user"]


def test_mcp_ask_tool_does_not_write_the_chat(monkeypatch):
    from tvashtr.control_plane import domain_mcp

    seen = {}

    def fake(owner_id, did, question, **kw):
        seen.update(kw)
        return {"answer": "x", "citations": []}

    monkeypatch.setattr(domain_mcp, "ask_domain", fake)
    domain_mcp.run_domain_ask_tool(uuid.uuid4(), str(uuid.uuid4()), "q")
    assert seen == {"persist": False}


# ---- Clear chat ----


def test_clear_chat_deletes_every_message(monkeypatch):
    c, _owner, did = _fresh()
    _seed(did)
    _Gateway(monkeypatch, ["A [1]."])
    c.post(f"/api/domains/{did}/ask", json={"question": "Q?"})
    assert len(c.get(f"/api/domains/{did}/messages").json()["messages"]) == 2

    r = c.delete(f"/api/domains/{did}/messages")
    assert r.status_code == 204
    assert c.get(f"/api/domains/{did}/messages").json()["messages"] == []
    # Idempotent.
    assert c.delete(f"/api/domains/{did}/messages").status_code == 204


def test_clear_chat_is_owner_scoped(monkeypatch):
    a, _owner, did = _fresh()
    _seed(did)
    _Gateway(monkeypatch, ["A [1]."])
    a.post(f"/api/domains/{did}/ask", json={"question": "Q?"})
    b, _o2, _d2 = _fresh()
    r = b.delete(f"/api/domains/{did}/messages")
    assert r.status_code == 404
    assert r.json()["detail"] == "domain not found"
    assert len(a.get(f"/api/domains/{did}/messages").json()["messages"]) == 2
    assert b.delete(f"/api/domains/{uuid.uuid4()}/messages").status_code == 404


def test_answer_model_labels():
    from tvashtr.control_plane.domain_views import answer_model_label

    assert answer_model_label("openai/gpt-4o-mini") == "OpenAI gpt-4o-mini"
    assert answer_model_label("groq/openai/gpt-oss-120b") == "Groq gpt-oss-120b"
    assert answer_model_label("anthropic/claude-x") == "anthropic claude-x"
    assert answer_model_label(None) is None

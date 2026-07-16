"""M-docs — per-node document routing (``config["writes_to"]`` / ``config["reads_from"]``) + the
run-scoped, NAMED documents (migration 0028).

Layers, most-pure first:

* **resolvers** — ``resolve_writes_to`` / ``resolve_reads_from`` (pure, None-safe, trimming).
* **compiler** — ``read_documents`` renders each named doc + is INERT by default (byte-identity at
  the unit level; the exact golden string is pinned by ``test_context_compiler.py``).
* **service** — ``find_or_create_run_document`` (create→append, idempotent) + the ``run_id`` FK
  ``ondelete=CASCADE`` (the orphaned-documents leak closed).
* **executor** — the MERGE-BLOCKING byte-identity of a default team; the PM→Architect→Engineer
  journey (TWO documents + provable context flow); the emitting-node ``writes_to`` FENCE.
* **API** — the PATCH persists writes_to/reads_from; ``GET /api/runs/{id}/documents`` lists them.

Every executor test drives the REAL ``run_team`` with a scripted adapter (no LLM, no openhands).
"""

import uuid
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import delete, select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.context_compiler import (
    compile_context,
    resolve_reads_from,
    resolve_writes_to,
)
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import (
    build_review_loop_team,
    build_thinker_chain_team,
    build_two_node_team,
    create_team_from_template,
)
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    find_or_create_run_document,
    get_latest_version,
    latest_content_by_name,
    list_documents_for_run,
)
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentNode, Document, Run, RunWarning

_BIG_BUDGET = 1_000_000


# ============================ resolvers (pure) ============================================


def test_resolve_writes_to_none_blank_and_nonstr_are_none():
    assert resolve_writes_to(None) is None
    assert resolve_writes_to({}) is None
    assert resolve_writes_to({"writes_to": ""}) is None
    assert resolve_writes_to({"writes_to": "   "}) is None
    assert resolve_writes_to({"writes_to": 3}) is None
    assert resolve_writes_to({"writes_to": ["design"]}) is None
    assert resolve_writes_to({"memory_remember_enabled": True}) is None  # unrelated key


def test_resolve_writes_to_trims_and_roundtrips_the_name():
    assert resolve_writes_to({"writes_to": "design"}) == "design"
    assert resolve_writes_to({"writes_to": "  design  "}) == "design"
    # Coexists with the other config sub-objects in the same JSONB.
    both = {"writes_to": "design", "model_config": {"worker_context_token_budget": 60_000}}
    assert resolve_writes_to(both) == "design"


def test_resolve_reads_from_none_nonlist_and_empty_are_empty_list():
    assert resolve_reads_from(None) == []
    assert resolve_reads_from({}) == []
    assert resolve_reads_from({"reads_from": None}) == []
    assert resolve_reads_from({"reads_from": "spec"}) == []  # a bare str is NOT a list
    assert resolve_reads_from({"reads_from": []}) == []


def test_resolve_reads_from_filters_blanks_nonstr_and_preserves_order_and_dupes():
    got = resolve_reads_from({"reads_from": [" spec ", "", 3, None, "design", "spec"]})
    assert got == ["spec", "design", "spec"]


# ============================ compiler: read_documents (byte-identity + render) ============


def _compile(**overrides):
    kwargs = dict(
        node_prompt="You are the Engineer.",
        idea="Add a greeting.",
        spec="PRD: build greeting",
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=_BIG_BUDGET,
    )
    kwargs.update(overrides)
    return compile_context(**kwargs)


def test_read_documents_none_is_byte_identical_to_omitting_it():
    """The new ``read_documents`` param is INERT by default: omitting it, ``None``, and ``[]`` all
    produce the SAME instruction + parts as before — the unit-level half of the merge-blocking
    byte-identity of the no-reads_from path (the exact string is pinned by the golden test)."""
    base = _compile()  # omits read_documents entirely
    assert _compile(read_documents=None).instruction == base.instruction
    assert _compile(read_documents=[]).instruction == base.instruction
    assert [p.name for p in _compile(read_documents=None).parts] == [p.name for p in base.parts]
    assert not any(p.name == "read_documents" for p in base.parts)


def test_read_documents_replace_spec_and_render_each_named_doc_in_order():
    """A node that declared reads_from reads exactly those docs: the executor passes ``spec=None`` +
    ``read_documents=[…]``, and the compiler renders ONE ``read_documents`` part with each doc under
    its own ``--- DOCUMENT: {name} ---`` header, in order, carrying BOTH bodies. The default
    ``--- PRD ---`` header is REPLACED."""
    c = compile_context(
        node_prompt="You are the Engineer.",
        idea="Add a greeting.",
        spec=None,
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=_BIG_BUDGET,
        read_documents=[
            {"name": "spec", "content": "PRD_BODY"},
            {"name": "design", "content": "DESIGN_BODY"},
        ],
    )
    assert "--- DOCUMENT: spec ---\nPRD_BODY" in c.instruction
    assert "--- DOCUMENT: design ---\nDESIGN_BODY" in c.instruction
    assert "--- PRD ---" not in c.instruction  # replaced
    assert any(p.name == "read_documents" for p in c.parts)
    assert c.instruction.index("PRD_BODY") < c.instruction.index("DESIGN_BODY")  # order kept
    assert c.over_budget is False


def test_read_documents_over_budget_still_names_fattest_read_doc():
    """The pre-call budget ceiling still holds with reads_from — a giant read doc breaches and is
    named the fattest part (no silent overflow)."""
    c = compile_context(
        node_prompt="p",
        idea="i",
        spec=None,
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=1_000,
        read_documents=[{"name": "design", "content": "D" * 40_000}],
    )
    assert c.over_budget is True
    assert c.fattest.name == "read_documents"


# ============================ service: find-or-create + CASCADE ===========================


def _seed_run(run_id: str, team_graph_id: str, idea: str) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status="running",
            )
        )


def test_find_or_create_run_document_creates_then_appends_and_is_idempotent(client):
    run_id = str(uuid.uuid4())
    _seed_run(run_id, build_two_node_team(), "idea")
    rid = uuid.UUID(run_id)

    def foc(content, key):
        return find_or_create_run_document(
            run_id=rid,
            name="design",
            title="Document: design",
            doc_type="design",
            content=content,
            created_by="agent:architect",
            idempotency_key=key,
        )

    d1 = foc("v1", f"{run_id}:doc:design:architect:1")
    assert d1.run_id == rid and d1.name == "design"
    # A NEW key APPENDS v2 to the SAME (run_id, name) document (find, not create).
    d2 = foc("v2", f"{run_id}:doc:design:architect:2")
    assert d2.id == d1.id
    assert get_latest_version(d1.id).content == "v2"
    assert latest_content_by_name(rid, "design") == "v2"
    # A REPLAY of key :1 returns the same doc with NO new version (idempotent).
    d3 = foc("ignored-on-replay", f"{run_id}:doc:design:architect:1")
    assert d3.id == d1.id
    assert latest_content_by_name(rid, "design") == "v2"  # still v2 — no duplicate
    # A DIFFERENT name is a SEPARATE document.
    other = find_or_create_run_document(
        run_id=rid,
        name="notes",
        title="Document: notes",
        doc_type="notes",
        content="n",
        created_by="x",
        idempotency_key=f"{run_id}:doc:notes:x:1",
    )
    assert other.id != d1.id
    assert {d.name for d in list_documents_for_run(rid)} == {"design", "notes"}


def test_deleting_a_run_cascade_deletes_its_documents(client):
    """Migration 0028's ``run_id`` FK ``ondelete=CASCADE`` closes the orphaned-documents leak:
    deleting the run row deletes every document it produced. FAILS without the CASCADE (the document
    would survive as an orphan)."""
    run_id = str(uuid.uuid4())
    _seed_run(run_id, build_two_node_team(), "idea")
    rid = uuid.UUID(run_id)
    doc = find_or_create_run_document(
        run_id=rid,
        name="design",
        title="t",
        doc_type="design",
        content="c",
        created_by="x",
        idempotency_key=f"{run_id}:doc:design:x:1",
    )
    doc_id = doc.id
    with session_scope() as session:
        assert session.get(Document, doc_id) is not None
        session.execute(delete(Run).where(Run.id == rid))
    with session_scope() as session:
        assert session.get(Document, doc_id) is None  # CASCADE removed it


# ============================ executor harness ============================================


def _set_config_by_role(team_graph_id: str, role_name: str, updates: dict) -> None:
    """Merge ``updates`` into the ``role_name`` node's config JSONB (a fresh dict, like the PATCH
    endpoint) — seeds a per-node writes_to/reads_from before the run."""
    with session_scope() as session:
        node = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == role_name,
            )
        ).scalar_one()
        cfg = dict(node.config or {})
        cfg.update(updates)
        node.config = cfg


def _docs_for_run(run_id: str) -> dict[str, Document]:
    return {d.name: d for d in list_documents_for_run(uuid.UUID(run_id))}


def _warnings(run_id: str) -> list[RunWarning]:
    with session_scope() as session:
        return list(
            session.execute(select(RunWarning).where(RunWarning.run_id == uuid.UUID(run_id)))
            .scalars()
            .all()
        )


class _JourneyAdapter:
    """Fake adapter for the PM→Architect→Engineer journey. Distinguishes nodes by their compiled
    instruction + writes distinct ``REPORT.md`` content so the versioned documents are attributable:

    * PM (report-only, spec=None → no PRD sentinel in its instruction) → REPORT.md = the PRD body.
    * Architect (report-only, its instruction CONTAINS the PM PRD it read) → capture; REPORT.md =
      the design body.
    * Engineer (worker) → capture; write ``greeting.txt``.
    """

    name = "openhands"
    PRD = "PRD_SENTINEL_MDOCS: build a greeting"
    DESIGN = "DESIGN_SENTINEL_MDOCS: write greeting.txt"

    def __init__(self, captured: dict) -> None:
        self._c = captured

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        instr = task.instruction
        if "REPORT-ONLY NODE" in instr:  # a thinker (PM or Architect)
            if self.PRD in instr:  # the Architect — it READ the PM's PRD (via its spec part)
                self._c["architect_instruction"] = instr
                (ws / "REPORT.md").write_text(self.DESIGN, encoding="utf-8")
            else:  # the PM (entry, no spec yet)
                (ws / "REPORT.md").write_text(self.PRD, encoding="utf-8")
            return AgentRunResult(
                status="completed", summary="report", events=[], files_changed=["REPORT.md"]
            )
        # the Engineer (worker; reads_from=[spec, design])
        self._c["engineer_instruction"] = instr
        (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


class _MiniAdapter:
    """Minimal fake: an entry/thinker writes REPORT.md, a worker writes a deliverable. (The emitting
    reviewer is short-circuited by ``TVASHTR_FORCE_REVISIONS`` — never reaches the adapter.)"""

    name = "openhands"

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        if "REPORT-ONLY NODE" in task.instruction:
            (ws / "REPORT.md").write_text("PRD: built", encoding="utf-8")
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def _run(run_id: str, idea: str) -> dict:
    with SetWorkflowID(run_id):
        return DBOS.start_workflow(team_run.run_team, idea).get_result()


# ============================ executor: MERGE-BLOCKING byte-identity =======================


def test_default_team_is_byte_identical_one_spec_document(client, monkeypatch, tmp_path):
    """MERGE-BLOCKING INVARIANT — with NO writes_to and NO reads_from set anywhere, a default team
    behaves exactly as before: the run produces EXACTLY ONE document, named ``"spec"`` (doc_type
    ``prd``), that ``pm_document_id`` points at; the Engineer's compiled instruction carries the
    ``--- PRD ---`` spec part and NO ``--- DOCUMENT:`` read-docs part; it ships; and NO document
    warning is recorded. FAILS if the default read/write path changed."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _JourneyAdapter(captured))

    run_id = str(uuid.uuid4())
    _seed_run(run_id, build_two_node_team(), "Add a greeting.")
    result = _run(run_id, "Add a greeting.")
    assert result["status"] == "completed"

    docs = list_documents_for_run(uuid.UUID(run_id))
    assert len(docs) == 1
    assert docs[0].name == "spec" and docs[0].doc_type == "prd"
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        assert run.pm_document_id == docs[0].id

    instr = captured["engineer_instruction"]
    assert "\n\n--- PRD ---\n" in instr  # the default spec part, unchanged
    assert "--- DOCUMENT:" not in instr  # no reads_from part
    assert _warnings(run_id) == []  # no spurious document-routing warning


# ============================ executor: the PM→Architect→Engineer journey ==================


def test_pm_architect_engineer_journey_two_docs_and_context_flow(client, monkeypatch, tmp_path):
    """THE HEADLINE JOURNEY — PM writes the PRD → Architect READS it + authors its OWN ``"design"``
    document (``writes_to``) → Engineer READS BOTH (``reads_from``). Proves (1) TWO distinct
    documents (``spec`` + ``design``) with the right bodies, (2) the Architect's compiled context
    PROVABLY contained the PM's PRD, and (3) the Engineer's compiled context contained BOTH docs.
    Mutation-real: FAILS if writes_to authors no second doc, or reads_from doesn't feed it in."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _JourneyAdapter(captured))

    team_graph_id = build_thinker_chain_team()
    # The NEW capabilities: the Architect AUTHORS a "design" doc; the Engineer READS both docs.
    _set_config_by_role(team_graph_id, "architect", {"writes_to": "design"})
    _set_config_by_role(team_graph_id, "engineer", {"reads_from": ["spec", "design"]})

    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.")
    result = _run(run_id, "Add a greeting.")
    assert result["status"] == "completed"

    # (1) TWO distinct documents with the right bodies.
    docs = _docs_for_run(run_id)
    assert set(docs) == {"spec", "design"}
    assert _JourneyAdapter.PRD in get_latest_version(docs["spec"].id).content
    assert _JourneyAdapter.DESIGN in get_latest_version(docs["design"].id).content

    # (2) The Architect's compiled context PROVABLY contained the PM's PRD.
    assert _JourneyAdapter.PRD in captured["architect_instruction"]

    # (3) The Engineer's compiled context contained BOTH documents (reads_from=[spec, design]).
    eng = captured["engineer_instruction"]
    assert _JourneyAdapter.PRD in eng and _JourneyAdapter.DESIGN in eng
    assert "--- DOCUMENT: spec ---" in eng and "--- DOCUMENT: design ---" in eng

    assert _warnings(run_id) == []  # non-emitting writes_to/reads_from are honored, not warned


# ============================ executor: the emitting-node writes_to FENCE ==================


def test_emitting_node_with_writes_to_warns_and_writes_nothing(client, monkeypatch, tmp_path):
    """FENCE — an EMITTING node (the Reviewer: verdict-only pull, Slice-4) with ``writes_to`` set
    is a misconfiguration: honoring it would need widening its pull scope (breaking the anti-clobber
    invariant). The executor records a RunWarning (source_kind ``"document"``) and writes NOTHING.
    Mutation-real: FAILS if the fence is missing (a ``"design"`` doc would appear / no warning)."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _MiniAdapter())

    team_graph_id = build_review_loop_team()
    _set_config_by_role(team_graph_id, "reviewer", {"writes_to": "design"})  # the emitting node

    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    result = _run(run_id, "build it")
    assert result["status"] == "completed"

    assert "design" not in _docs_for_run(run_id)  # the emitting reviewer authored NOTHING
    warnings = _warnings(run_id)
    assert any(
        w.source_kind == "document" and w.name == "design" and "emitting node" in w.reason
        for w in warnings
    )


# ============================ API: the PATCH + the run-documents endpoint ==================


def _row(node_id: str) -> AgentNode:
    with session_scope() as session:
        return session.execute(
            select(AgentNode).where(AgentNode.id == uuid.UUID(node_id))
        ).scalar_one()


def test_patch_node_persists_writes_to_and_reads_from_and_omitted_is_unchanged(client):
    """PATCH ``writes_to`` + ``reads_from`` MERGES them into the node's EXISTING config JSONB
    (re-reads the ROW, not the response echo); a ``{prompt, model}``-only save leaves config
    byte-unchanged (the ``model_fields_set`` omitted-semantics)."""
    tid = create_team_from_template("plan_review", "docs routing patch", auth_user_id())
    nodes = {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}
    eng = nodes["engineer"]

    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "writes_to": "design",
            "reads_from": ["spec", "design"],
        },
    )
    assert resp.status_code == 200, resp.text
    row = _row(eng["id"])
    assert row.config.get("writes_to") == "design"
    assert row.config.get("reads_from") == ["spec", "design"]

    before = _row(eng["id"]).config
    resp2 = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"]},
    )
    assert resp2.status_code == 200, resp2.text
    assert _row(eng["id"]).config == before  # omitted ⇒ byte-unchanged


def test_get_run_documents_endpoint_lists_named_docs_owner_scoped(client):
    """``GET /api/runs/{id}/documents`` returns every document the run produced (id/title/doc_type/
    name meta), owner-scoped like ``get_run``."""
    run_id = str(uuid.uuid4())
    _seed_run(run_id, build_two_node_team(), "idea")
    rid = uuid.UUID(run_id)
    find_or_create_run_document(
        run_id=rid,
        name="spec",
        title="Mini-PRD",
        doc_type="prd",
        content="prd",
        created_by="agent:entry",
        idempotency_key=f"{run_id}:pm-prd-v1",
    )
    find_or_create_run_document(
        run_id=rid,
        name="design",
        title="Document: design",
        doc_type="design",
        content="design",
        created_by="agent:architect",
        idempotency_key=f"{run_id}:doc:design:architect:1",
    )
    resp = client.get(f"/api/runs/{run_id}/documents")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {d["name"] for d in body["documents"]} == {"spec", "design"}
    assert all({"id", "name", "doc_type", "title"} <= set(d) for d in body["documents"])


# ============================ more coverage ================================================


def test_resolve_writes_to_and_reads_from_coexist_in_one_config():
    cfg = {"writes_to": "design", "reads_from": ["spec"], "memory_remember_enabled": True}
    assert resolve_writes_to(cfg) == "design"
    assert resolve_reads_from(cfg) == ["spec"]


def test_resolve_reads_from_all_blank_entries_is_empty_list():
    assert resolve_reads_from({"reads_from": ["", "   ", None, 7]}) == []


def test_read_documents_single_named_doc_renders_one_block():
    c = _compile(spec=None, read_documents=[{"name": "design", "content": "BODY"}])
    assert c.instruction.count("--- DOCUMENT:") == 1
    assert "--- DOCUMENT: design ---\nBODY" in c.instruction
    assert "--- PRD ---" not in c.instruction


def test_compile_no_spec_and_no_read_documents_has_neither_part():
    """The entry's first invocation shape (spec=None, no reads_from) renders NO PRD and NO read-docs
    part — byte-identical to today's entry compile."""
    c = _compile(spec=None, read_documents=None)
    assert "--- PRD ---" not in c.instruction
    assert "--- DOCUMENT:" not in c.instruction
    assert not any(p.name in ("spec", "read_documents") for p in c.parts)


def test_latest_content_by_name_missing_is_none(client):
    run_id = str(uuid.uuid4())
    _seed_run(run_id, build_two_node_team(), "idea")
    assert latest_content_by_name(uuid.UUID(run_id), "nope") is None


class _ArchitectSilentAdapter:
    """PM writes its spec REPORT.md; the Architect produces NOTHING (clears stale REPORT.md so no
    report is available); the Engineer ships. Exercises the non-entry writes_to missing-REPORT.md
    branch."""

    name = "openhands"

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        instr = task.instruction
        if "REPORT-ONLY NODE" in instr:
            if "--- PRD ---" in instr:  # the Architect — produce nothing
                (ws / "REPORT.md").unlink(missing_ok=True)
                return AgentRunResult(
                    status="completed", summary="silent", events=[], files_changed=[]
                )
            (ws / "REPORT.md").write_text("PRD: built", encoding="utf-8")  # the PM
            return AgentRunResult(
                status="completed", summary="r", events=[], files_changed=["REPORT.md"]
            )
        (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")  # the Engineer
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


def test_entry_custom_writes_to_names_the_spec_document(client, monkeypatch, tmp_path):
    """The ENTRY node's ``config["writes_to"]`` overrides the default "spec" NAME: its document is
    named "prd" and ``pm_document_id`` still points at it (exactly one document, byte-compatible
    otherwise)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _JourneyAdapter({}))

    team_graph_id = build_two_node_team()
    _set_config_by_role(team_graph_id, "pm", {"writes_to": "prd"})
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.")
    assert _run(run_id, "Add a greeting.")["status"] == "completed"

    docs = list_documents_for_run(uuid.UUID(run_id))
    assert len(docs) == 1 and docs[0].name == "prd"
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        assert run.pm_document_id == docs[0].id


def test_non_entry_writes_to_missing_report_warns_and_skips(client, monkeypatch, tmp_path):
    """A NON-entry writes_to node that produces no REPORT.md records a RunWarning (non-fatal) and
    authors NO document — the run still completes."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _ArchitectSilentAdapter())

    team_graph_id = build_thinker_chain_team()
    _set_config_by_role(team_graph_id, "architect", {"writes_to": "design"})
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.")
    assert _run(run_id, "Add a greeting.")["status"] == "completed"

    assert "design" not in _docs_for_run(run_id)  # nothing versioned
    assert any(
        w.source_kind == "document" and w.name == "design" and "no REPORT.md" in w.reason
        for w in _warnings(run_id)
    )


def test_reads_from_missing_document_is_skipped(client, monkeypatch, tmp_path):
    """A ``reads_from`` name with no matching doc is SKIPPED — the node still reads the docs that
    DO exist and the run proceeds (no fatal error)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _JourneyAdapter(captured))

    team_graph_id = build_thinker_chain_team()
    _set_config_by_role(team_graph_id, "engineer", {"reads_from": ["spec", "ghost"]})
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.")
    assert _run(run_id, "Add a greeting.")["status"] == "completed"

    eng = captured["engineer_instruction"]
    assert "--- DOCUMENT: spec ---" in eng
    assert "ghost" not in eng  # the missing name rendered nothing


def test_get_run_documents_empty_for_run_with_no_docs(client):
    run_id = str(uuid.uuid4())
    _seed_run(run_id, build_two_node_team(), "idea")
    resp = client.get(f"/api/runs/{run_id}/documents")
    assert resp.status_code == 200, resp.text
    assert resp.json()["documents"] == []


def test_patch_clearing_writes_to_and_reads_from_stores_empty(client):
    """Clearing the fields (empty string / empty list) persists the cleared values — the executor's
    resolvers then treat them as unset (inert)."""
    tid = create_team_from_template("plan_review", "docs routing clear", auth_user_id())
    eng = {n["role_name"]: n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"]}[
        "engineer"
    ]
    client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={
            "prompt": eng["prompt"],
            "model": eng["model"],
            "writes_to": "d",
            "reads_from": ["s"],
        },
    )
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{eng['id']}",
        json={"prompt": eng["prompt"], "model": eng["model"], "writes_to": "", "reads_from": []},
    )
    assert resp.status_code == 200, resp.text
    row = _row(eng["id"])
    assert row.config.get("writes_to") == ""
    assert row.config.get("reads_from") == []
    assert resolve_writes_to(row.config) is None  # "" is inert at runtime
    assert resolve_reads_from(row.config) == []

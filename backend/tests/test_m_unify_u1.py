"""M-unify U1 — the executor unification core. The 7 mutation-real acceptance tests + the backfill
mapping proof. Every executor test drives the REAL ``run_team`` with a scripted adapter (no LLM, no
openhands): the entry runs the ONE agent path as an edits-off node whose REPORT.md becomes the spec.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import team_run
from tvashtr.control_plane.context_compiler import _capability_note_text, compile_context
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.team_run import _resolve_pull_paths
from tvashtr.control_plane.teams import (
    build_review_loop_team,
    build_two_node_team,
    clone_team_graph,
    engineer_model,
)
from tvashtr.db import session_scope
from tvashtr.documents.service import get_document_with_versions
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentInvocation, AgentNode, Edge, Run, TeamGraph

_REPORT = "REPORT.md"
_VERDICT = "REVIEW_VERDICT.json"


def _seed_run(run_id: str, team_graph_id: str, idea: str, **extra) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status="running",
                **extra,
            )
        )


class _ScriptedAdapter:
    """Scripted fake adapter for the unified path. It FAITHFULLY mirrors the real adapter's scoped
    pull: it writes each node's files, then — when ``task.pull_paths`` is set — DROPS every
    workspace
    file not in that scope (the local mirror of ``_restore_except`` / the docker selective pull), so
    the bouncer is exercised end to end. Per node (by the instruction it compiled):

    * edits-off (report-only) → writes ``REPORT.md`` (content = the caller's ``report``) + any
      ``stray`` files; records its pull scope.
    * an emitting node → writes ``REVIEW_VERDICT.json`` with ``verdict`` (routes the walk).
    * a worker → writes a deliverable.
    """

    name = "openhands"

    def __init__(self, captured, *, report="PRD: built by the entry", stray=(), verdict=None):
        self._c = captured
        self._report = report
        self._stray = stray
        self._verdict = verdict

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        before = {p.name for p in ws.iterdir() if p.is_file()}  # pre-existing (kept by the pull)
        report_only = "REPORT-ONLY NODE" in task.instruction
        emitting = task.pull_paths is not None and _VERDICT in task.pull_paths and not report_only
        # A report-only node writes its deliverable + (for the leak test) a stray workspace file.
        if report_only:
            self._c.setdefault("entry_pull_paths", task.pull_paths)
            (ws / _REPORT).write_text(self._report, encoding="utf-8")
            for name in self._stray:
                (ws / name).write_text("STRAY — must not leave the sandbox\n", encoding="utf-8")
        if self._verdict is not None and (emitting or report_only):
            (ws / _VERDICT).write_text(f'{{"verdict": "{self._verdict}"}}', encoding="utf-8")
        if not report_only and not emitting:
            self._c["worker_pull_paths"] = task.pull_paths
            (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        # Faithfully mirror the real scoped pull (``_restore_except``): a file this run CREATED
        # that is
        # NOT in the pull scope never leaves the sandbox; pre-existing files are kept (restored).
        if task.pull_paths is not None:
            keep = set(task.pull_paths)
            for p in list(ws.iterdir()):
                if p.is_file() and p.name not in keep and p.name not in before:
                    p.unlink()
        return AgentRunResult(status="completed", summary="ok", events=[], files_changed=[])


# ============================ 1. routing equivalence + spec-version-per-entry ====================


def test_routing_equivalence_and_spec_version_per_entry_invocation(client, monkeypatch, tmp_path):
    """Drive the REAL ``run_team`` over the template-shaped ``review_loop`` (entry → worker ⇄
    reviewer) with a scripted adapter. The outcome-label sequence over the same edges matches the
    pre-unification semantics EXACTLY, and the spec document gains one version per completed ENTRY
    invocation — here the entry runs once → v1, written by the unified entry path (replacing the old
    pm_step completion text). Each entry invocation keys its version on ``{run_id}:pm-prd-v1`` /
    ``{run_id}:spec:{node}:{iter}``, so a re-entered entry adds exactly one version per round."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _ScriptedAdapter({}))

    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "build it").get_result()
    assert result["status"] == "completed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        by_role = {
            n.role_name: n
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id)
            ).scalars()
        }

        def outcomes(role):
            return [
                r[0]
                for r in session.execute(
                    select(AgentInvocation.outcome)
                    .where(
                        AgentInvocation.run_id == run_id,
                        AgentInvocation.node_id == by_role[role].id,
                    )
                    .order_by(AgentInvocation.iteration)
                ).all()
            ]

        versions = get_document_with_versions(run.pm_document_id).versions

    # The SAME outcome-label sequence over the same edges as pre-unification (a forced
    # one-loop-back).
    assert outcomes("pm") == ["prd_written"]
    assert outcomes("prd_gate") == ["approved"]
    assert outcomes("engineer") == ["built", "built"]  # round 1 + the revision round
    assert outcomes("reviewer") == ["changes_requested", "approved"]  # exactly one loop-back
    assert outcomes("ship") == ["shipped"]
    # The spec gained one version per completed entry invocation (the entry ran once → v1), written
    # by
    # the unified entry path — NOT the old pm_step completion text.
    assert [v.version_no for v in versions] == [1]
    assert versions[0].created_by == "agent:entry"


# ============================ 2. leak / bouncer =================================================


def test_edits_off_leak_bouncer_stray_absent_from_host_and_pull(client, monkeypatch, tmp_path):
    """An edits-off entry writes ``REPORT.md`` PLUS a stray file. ``REPORT.md`` is pulled + becomes
    the spec version; the stray is ABSENT from the host worktree AND from everything pulled — the
    control plane scoped the pull to EXACTLY ``REPORT.md`` + the verdict, and a faithful adapter
    dropped the rest."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    captured: dict = {}
    monkeypatch.setattr(
        team_run,
        "resolve_adapter",
        lambda name: _ScriptedAdapter(
            captured, report="PRD: the deliverable", stray=("leaked.py", "secret.env")
        ),
    )

    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "build it").get_result()
    assert result["status"] == "completed"

    # The control plane scoped the edits-off pull to EXACTLY REPORT.md + the verdict (the bouncer).
    assert set(captured["entry_pull_paths"]) == {_REPORT, _VERDICT}
    # REPORT.md became the spec version; the stray is in NEITHER the spec NOR the host worktree.
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
    doc = get_document_with_versions(run.pm_document_id)
    assert doc.versions[0].content == "PRD: the deliverable"
    assert "STRAY" not in doc.versions[0].content
    assert not (ws / "leaked.py").exists()
    assert not (ws / "secret.env").exists()


# ============================ 3. Slice-4 survival + union of restrictions =======================


def test_slice4_survives_and_pull_scope_is_union_of_restrictions():
    """The Slice-4 emitting-node verdict-only rule survives INDEPENDENTLY of the toggle (the pure
    ``_resolve_pull_paths`` — the union of restrictions). The existing
    ``test_brownfield_executor.py`` reviewer-cannot-clobber regression proves it end-to-end,
    UNMODIFIED; this pins every case."""
    # edits-on worker → unscoped (byte-identical to a worker today).
    assert _resolve_pull_paths(edits_allowed=True, emits_outcome=False) is None
    # edits-on emitting (a reviewer) → verdict-only, the EXACT Slice-4 tuple (must not regress).
    assert _resolve_pull_paths(edits_allowed=True, emits_outcome=True) == (_VERDICT,)
    # edits-off non-emitting (entry/thinker) → REPORT.md + verdict, nothing else.
    assert set(_resolve_pull_paths(edits_allowed=False, emits_outcome=False)) == {_REPORT, _VERDICT}
    # edits-off AND emitting → the intersection: verdict-only survives the toggle.
    assert _resolve_pull_paths(edits_allowed=False, emits_outcome=True) == (_VERDICT,)


# ============================ 4. edits-off verdict routing via Edge.conditions ===================


def _build_edits_off_reviewer_graph() -> str:
    """entry(thinker) → reviewer(edits-off, EMITS): ``approved`` → ship, else → stop."""
    with session_scope() as session:
        g = TeamGraph(name="edits-off-reviewer")
        session.add(g)
        session.flush()
        entry = AgentNode(
            team_graph_id=g.id,
            role_name="pm",
            kind="completion",
            model=get_settings().default_model,
            prompt="You are the PM.",
            position={"x": 0, "y": 0},
        )
        eng = AgentNode(
            team_graph_id=g.id,
            role_name="engineer",
            kind="agent",
            model=engineer_model(),
            engine="openhands",
            prompt="You are the Engineer.",
            position={"x": 1, "y": 0},
        )
        rev = AgentNode(
            team_graph_id=g.id,
            role_name="reviewer",
            kind="completion",
            model=get_settings().default_model,
            prompt="You are the Reviewer.",
            position={"x": 2, "y": 0},
            edits_allowed=False,
        )
        ship = AgentNode(
            team_graph_id=g.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 3, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=g.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 2, "y": 1},
            config={"terminal_kind": "stop"},
        )
        session.add_all([entry, eng, rev, ship, stop])
        session.flush()
        session.add_all(
            [
                Edge(
                    team_graph_id=g.id,
                    source_node_id=entry.id,
                    target_node_id=eng.id,
                    edge_type="work",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=g.id,
                    source_node_id=eng.id,
                    target_node_id=rev.id,
                    edge_type="work",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=g.id,
                    source_node_id=rev.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=g.id,
                    source_node_id=rev.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "changes_requested"},
                ),
            ]
        )
        return str(g.id)


def test_edits_off_emitting_node_routes_per_edge_conditions(client, monkeypatch, tmp_path):
    """An edits-off node that emits ``REVIEW_VERDICT.json`` with a label routes on
    ``Edge.conditions``
    exactly like an edits-on reviewer — the verdict is in its (verdict-only) pull scope. Here it
    APPROVES → the walk takes the ``{when: approved}`` edge to ship."""
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(
        team_run, "resolve_adapter", lambda name: _ScriptedAdapter({}, verdict="approved")
    )

    team_graph_id = _build_edits_off_reviewer_graph()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "review it")
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "review it").get_result()
    # Routed on the verdict label → shipped (NOT stopped).
    assert result["status"] == "completed"
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        rev = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == run.team_graph_id, AgentNode.role_name == "reviewer"
            )
        ).scalar_one()
        rev_outcome = session.execute(
            select(AgentInvocation.outcome).where(AgentInvocation.node_id == rev.id)
        ).scalar_one()
    assert rev_outcome == "approved"


# ============================ 5. capability note present iff edits-off ==========================


def test_capability_note_present_iff_edits_off_and_edits_on_byte_identical():
    """The typed capability-note part is appended for an edits-OFF node ONLY; an edits-ON worker's
    compiled instruction (+ manifest) is BYTE-IDENTICAL to main (no new part)."""
    kw = dict(
        node_prompt="You are the Engineer.",
        idea="Add a greeting.",
        spec="PRD: x",
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=False,
        subpath=None,
        budget=1_000_000,
    )
    on = compile_context(**kw, edits_allowed=True)
    off = compile_context(**kw, edits_allowed=False)
    note = _capability_note_text()
    # edits-ON: no note, byte-identical to the default (main) call; manifest carries no note part.
    assert compile_context(**kw).instruction == on.instruction
    assert note not in on.instruction
    assert all(p["name"] != "capability_note" for p in on.manifest()["parts"])
    # edits-OFF: the note IS present as a typed manifest part, and the ONLY delta is the note.
    assert note in off.instruction
    assert any(p["name"] == "capability_note" for p in off.manifest()["parts"])
    assert off.instruction == on.instruction + note


# ============================ 6. entry missing REPORT.md fails the invocation ====================


class _NoReportAdapter:
    """An entry adapter that COMPLETES but writes NO REPORT.md (and drops everything, honoring the
    scoped pull) — the entry invocation must FAIL with a recorded reason, not crash the workflow."""

    name = "openhands"

    def run(self, task, on_event=None):
        if task.pull_paths is not None:
            for p in Path(task.workspace_dir).iterdir():
                if p.is_file() and p.name not in set(task.pull_paths) and p.name != ".gitignore":
                    p.unlink()
        return AgentRunResult(status="completed", summary="no report", events=[], files_changed=[])


def test_entry_missing_report_fails_invocation_with_reason_no_crash(client, monkeypatch, tmp_path):
    """An entry invocation ending with no REPORT.md fails with a recorded reason (event/warning
    naming the missing report) — the run finalizes ``failed``, the invocation is closed ``failed``,
    and the workflow does NOT crash (no unhandled exception)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _NoReportAdapter())

    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "build it")
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "build it").get_result()  # no raise
    assert result["status"] == "failed"
    assert "REPORT.md" in result["error"]
    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        pm = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == run.team_graph_id, AgentNode.role_name == "pm"
            )
        ).scalar_one()
        inv = session.execute(
            select(AgentInvocation).where(AgentInvocation.node_id == pm.id)
        ).scalar_one()
    assert run.status == "failed"
    assert inv.status == "failed"
    assert inv.outcome_detail and "REPORT.md" in inv.outcome_detail
    assert run.pm_document_id is None  # no silent empty spec version


# ============================ 7. PATCH sync + clone carries edits_allowed ========================


def _library_team(c) -> str:
    c.post("/api/teams", json={"template": "two_node", "name": f"u1-{uuid.uuid4().hex}"})
    r = c.get("/api/teams").json()
    teams = r["teams"] if isinstance(r, dict) else r
    return teams[-1]["team_graph_id"] if isinstance(teams[-1], dict) else teams[-1]["id"]


def test_patch_syncs_edits_allowed_explicit_wins_and_clone_carries_it(client):
    """A kind-change (``capability``) PATCH SYNCS ``edits_allowed`` to ``kind == 'agent'`` UNLESS an
    explicit value is sent (which WINS); a clone carries the stored value faithfully."""
    tid = _library_team(client)
    graph = client.get(f"/api/teams/{tid}/graph").json()
    nodes = {n["role_name"]: n for n in graph["nodes"]}
    engineer = nodes["engineer"]  # kind=agent → edits_allowed True by construction
    assert engineer["edits_allowed"] is True

    # (a) capability→thinker WITHOUT edits_allowed → syncs to (kind=='agent') == False.
    r = client.patch(
        f"/api/teams/{tid}/nodes/{engineer['id']}",
        json={"prompt": engineer["prompt"], "model": engineer["model"], "capability": "thinker"},
    )
    assert (
        r.status_code == 200
        and r.json()["edits_allowed"] is False
        and r.json()["kind"] == "completion"
    )

    # (b) capability→worker but EXPLICIT edits_allowed=False WINS over the kind sync.
    r = client.patch(
        f"/api/teams/{tid}/nodes/{engineer['id']}",
        json={
            "prompt": engineer["prompt"],
            "model": engineer["model"],
            "capability": "worker",
            "edits_allowed": False,
        },
    )
    assert (
        r.status_code == 200 and r.json()["kind"] == "agent" and r.json()["edits_allowed"] is False
    )

    # (c) explicit edits_allowed=True with NO capability change also wins.
    r = client.patch(
        f"/api/teams/{tid}/nodes/{engineer['id']}",
        json={"prompt": engineer["prompt"], "model": engineer["model"], "edits_allowed": True},
    )
    assert r.status_code == 200 and r.json()["edits_allowed"] is True

    # clone carries the stored edits_allowed (here an edits-OFF worker — an off-kind toggle).
    client.patch(
        f"/api/teams/{tid}/nodes/{engineer['id']}",
        json={"prompt": engineer["prompt"], "model": engineer["model"], "edits_allowed": False},
    )
    clone_id = clone_team_graph(tid)
    with session_scope() as session:
        clone_eng = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == uuid.UUID(clone_id), AgentNode.role_name == "engineer"
            )
        ).scalar_one()
    assert clone_eng.edits_allowed is False  # the off-kind toggle survived the clone


# ============================ backfill mapping (create path maps kind) ==========================


def test_backfill_mapping_agent_true_others_false(client):
    """The 0024 backfill mapping — ``edits_allowed = (kind == 'agent')`` — as realized by the
    ORM kind-mapped default on a builder node that does NOT set it explicitly: a worker
    (``agent``) is edits-ON; the PM (``completion``) + the gate/terminal control primitives are
    edits-OFF. Uses ``build_two_node_team`` because it carries NO explicit ``edits_allowed``
    override anywhere, so it isolates the pure kind-mapped default. (The ``review_loop`` Reviewer
    now sets ``edits_allowed=False`` EXPLICITLY — M-unify U3 — an override of this default,
    asserted in ``test_teams.py``.)"""
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        nodes = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .all()
        )
    by_kind = {}
    for n in nodes:
        by_kind.setdefault(n.kind, set()).add(n.edits_allowed)
    assert by_kind["agent"] == {True}  # the Engineer (the sole agent; no explicit override)
    assert by_kind["completion"] == {False}  # the PM
    assert by_kind["gate"] == {False}
    assert by_kind["terminal"] == {False}
    # every node has a concrete boolean (NOT NULL held).
    assert all(isinstance(n.edits_allowed, bool) for n in nodes)

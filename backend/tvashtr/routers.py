"""HTTP surface for the model gateway + document layer (P0.2).

Kept in its own router module so ``main.py`` stays focused on app/DBOS wiring.
GET endpoints return plain dicts (matching the P0.1 style) to avoid coupling the
API to ORM/gateway types.
"""

import os
import uuid
from decimal import Decimal
from typing import Literal

from dbos import DBOS, SetWorkflowID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane.doc_writer import generate_doc
from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import (
    ARCHITECT_PROMPT,
    ENGINEER_PROMPT,
    PM_PROMPT,
    REVIEWER_PROMPT,
    build_review_loop_team,
    build_two_node_team,
    clone_team_graph,
    create_blank_team,
    create_team_from_template,
    engineer_model,
    get_team_summary,
    list_library_teams,
    list_templates,
    reviewer_model,
    seed_library_if_empty,
)
from tvashtr.documents.service import add_version, get_document_with_versions, list_documents
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Document,
    DocumentVersion,
    Edge,
    HumanTask,
    Run,
    RunEvent,
    TeamGraph,
)

# Run statuses that are already terminal: a kill switch must not clobber them.
_TERMINAL_RUN_STATUSES = ("completed", "failed", "rejected", "over_budget")
# Map the resolve API's decision verb to the durable resolution recorded on the task.
_DECISION_TO_RESOLUTION = {"approve": "approved", "reject": "rejected"}

router = APIRouter()


class GenerateDocRequest(BaseModel):
    topic: str


class StartResponse(BaseModel):
    workflow_id: str


class CreateRunRequest(BaseModel):
    idea: str | None = None
    # Per-run dollar cap (P1.2). When omitted, falls back to
    # ``Settings.default_run_budget_usd`` (itself ``None`` = no cap by default).
    budget_cap_usd: Decimal | None = None
    # Which hardcoded team the run builds (P1.5a). Default ``two_node`` keeps
    # skeleton-run/skeleton-crash (which POST neither field) byte-for-byte unchanged;
    # ``review_loop`` builds the 3-node PM -> Engineer <-> Reviewer cyclic team that
    # ``make loop-run`` requests.
    team_shape: Literal["two_node", "review_loop"] = "two_node"
    # Clone-on-launch (P1.8b): when set to the persistent authored team's id, the run is launched
    # on a fresh deep-clone of THAT team (the user's edited prompts/models), not a throwaway
    # builder graph — so the run is driven by what the user authored. When omitted (the legacy
    # smokes + the A/B path), the ``team_shape`` branch above is taken byte-for-byte unchanged.
    team_graph_id: str | None = None


class ABRunRequest(BaseModel):
    """The team A/B launch (P1.5c §14.2): ONE idea through the two v1 configs. The configs
    are fixed in v1 (A=``two_node`` / B=``review_loop``), so the body carries only the shared
    inputs — the idea (same seeding rule as a single run) and an optional budget cap applied
    identically to both sides (a fair comparison). Arbitrary-config A/B is Phase-2."""

    idea: str | None = None
    budget_cap_usd: Decimal | None = None


class ResolveTaskRequest(BaseModel):
    decision: Literal["approve", "reject"]
    note: str | None = None


class AddDocumentVersionRequest(BaseModel):
    """A human edit to a document (P1.7a live-document steering): the new full content,
    appended as the next version that the running agents pick up on their next read."""

    content: str


class UpdateTeamNodeRequest(BaseModel):
    """A human edit to a persistent-team agent node: its ``prompt`` (the node's whole
    identity/behavior), its ``model``, and (P1.8c) optionally its ``capability`` — ``"thinker"``
    (a direct LLM completion, like the PM) or ``"worker"`` (an engine-backed sandboxed run, like
    the Engineer). ``prompt``/``model`` are sent on every Save (the FE is dirty-aware but posts the
    full values). ``capability`` is OPTIONAL — omitted leaves ``kind``/``engine`` unchanged
    (back-compat with the prior ``{prompt, model}`` saves). Topology + the control primitives
    (gate/terminal) remain non-editable (later slices)."""

    prompt: str
    model: str
    capability: Literal["thinker", "worker"] | None = None


class CreateTeamRequest(BaseModel):
    """Create a library team from a starter template (P1.8b team library): the ``template`` key
    (one of ``GET /api/templates``) + a user-chosen ``name``. The team is materialized from the
    code-resident builder and flipped to a library team — a drop-and-edit preset. P1.8d: the
    sentinel ``template == "blank"`` seeds the minimal valid skeleton (root thinker → Ship) instead
    of a catalog builder — a from-scratch starting point the user wires up."""

    template: str
    name: str


class CreateNodeRequest(BaseModel):
    """Add a node to a library team's canvas (P1.8d topology editing). ``node_kind`` is the canvas
    vocabulary the palette offers: ``thinker`` (a ``completion`` node) / ``worker`` (an ``agent``
    node, ``openhands`` engine) — the P1.8c capability pair — plus the control primitives ``gate``
    and ``terminal``. ``preset`` (optional, thinker/worker only) seeds a pre-filled-but-editable
    role node from the ``teams.py`` prompt constants (PM / Architect / Engineer / Reviewer); without
    it a blank primitive is dropped (empty ``prompt``). ``terminal_kind`` is REQUIRED for a terminal
    (ship vs stop is a real choice); ``title``/``description`` configure a gate. ``position`` is the
    canvas drop point (defaults to the origin, then auto-layout/drag persists real coords)."""

    node_kind: Literal["thinker", "worker", "gate", "terminal"]
    preset: Literal["pm", "architect", "engineer", "reviewer"] | None = None
    prompt: str | None = None
    model: str | None = None
    position: dict | None = None
    title: str | None = None
    description: str | None = None
    terminal_kind: Literal["ship", "stop"] | None = None


class CreateEdgeRequest(BaseModel):
    """Wire two nodes on a library team's canvas (P1.8d). ``role`` is the plain-language edge role
    the canvas authoring offers — it maps server-side to the ``(edge_type, conditions)`` the
    executor routes on (the four roles verified in ``team_run``): ``forward`` → unconditional
    (``conditions: null``); ``branch`` → ``{"when": label}`` (a gate's approved/rejected, or a
    worker's verdict label — ``label`` REQUIRED); ``loop_back`` → ``{"loop_limit": N}`` (the bounded
    catch-all rework edge — ``loop_limit`` defaults to 3); ``escalation`` → ``edge_type=
    "escalation"`` (the cap-exhaustion exit out of a looping worker)."""

    source_node_id: str
    target_node_id: str
    role: Literal["forward", "branch", "loop_back", "escalation"]
    label: str | None = None
    loop_limit: int | None = None


class PositionsRequest(BaseModel):
    """Persist canvas layout after a drag (P1.8d): a ``{node_id: {"x": .., "y": ..}}`` map. Batch —
    one round-trip after a drag settles. Unknown / off-team node ids are ignored (best-effort
    layout, never a hard error)."""

    positions: dict[str, dict]


# Pinned, deterministically-checkable deliverable (env-overridable). Keeping the
# target fixed is what makes skeleton-run (and P0.4b) deterministic despite LLM
# variance: the PM restates this exact path + line, the Engineer creates it.
DEFAULT_IDEA = os.environ.get(
    "TVASHTR_SKELETON_IDEA",
    "Add a file named greeting.txt at the repository root, containing exactly this "
    "single line and nothing else:\nShipped by the Tvashtr PM->Engineer team",
)


def resolve_run_idea(body_idea: str | None) -> str:
    """The canonical ``Run.idea`` seeding rule (pure, unit-tested): an explicit idea from the
    request body wins; otherwise fall back to the pinned ``DEFAULT_IDEA`` skeleton. The
    capstone feature run (``make loop-feature-docker``) POSTs ``config.TASK_LIST_IDEA`` as
    ``body_idea``, so the same one rule seeds either the skeleton or the real feature into
    ``Run.idea`` — no migration (``Run.idea`` is already the canonical-idea seat)."""
    return body_idea or DEFAULT_IDEA


def _cost_to_dict(row: CostRecord) -> dict:
    return {
        "id": row.id,
        "workflow_id": row.workflow_id,
        "idempotency_key": row.idempotency_key,
        "model_requested": row.model_requested,
        "model_used": row.model_used,
        "prompt_tokens": row.prompt_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "cost_usd": float(row.cost_usd),
        "created_at": row.created_at.isoformat(),
    }


def _document_meta(doc: Document) -> dict:
    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }


def _node_base_dict(n: AgentNode) -> dict:
    """The canvas-facing node fields shared by the run-graph read and the team-graph read
    (P1.8b): identity (``id``/``role_name``/``kind``), the editable ``prompt`` + ``model``, the
    ``engine``, the layout ``position``, and the gate/terminal ``config`` (NULL for
    completion/agent). ``prompt`` is NEW on the run endpoint too — additive; the canvas ignores
    unknown keys. The run-graph endpoint extends this with live ``status``/``iteration``/
    ``invocations``; the team-graph endpoint returns it as-is (the authored team is not running)."""
    return {
        "id": str(n.id),
        "role_name": n.role_name,
        "kind": n.kind,
        "model": n.model,
        "engine": n.engine,
        # P1.8b: the node's behavior text — its whole identity in the prompt-driven model. NULL for
        # gate/terminal nodes (control primitives, no LLM). The side panel edits this for agents.
        "prompt": n.prompt,
        "position": n.position,
        "config": n.config,
    }


def _edge_to_dict(e: Edge) -> dict:
    """One graph edge in the canvas's shape (shared by both graph reads): endpoints + the
    routing ``edge_type``/``conditions`` (NULL = unconditional)."""
    return {
        "id": str(e.id),
        "source_node_id": str(e.source_node_id),
        "target_node_id": str(e.target_node_id),
        "edge_type": e.edge_type,
        "conditions": e.conditions,
    }


def _version_to_dict(version: DocumentVersion) -> dict:
    return {
        "id": str(version.id),
        "version_no": version.version_no,
        "content": version.content,
        "created_by": version.created_by,
        "created_at": version.created_at.isoformat(),
    }


@router.post("/api/spike/generate-doc", response_model=StartResponse)
def start_generate_doc(body: GenerateDocRequest) -> StartResponse:
    """Start the generate_doc workflow in the background; return its id."""
    handle = DBOS.start_workflow(generate_doc, body.topic)
    return StartResponse(workflow_id=handle.workflow_id)


@router.get("/api/spike/generate-doc/{workflow_id}")
def get_generate_doc(workflow_id: str) -> dict:
    """Return DBOS status, the workflow result (if finished), and its cost rows."""
    status = DBOS.get_workflow_status(workflow_id)
    state = status.status if status is not None else "NOT_FOUND"
    result = status.output if status is not None and state == "SUCCESS" else None

    with db.session_scope() as session:
        rows = (
            session.execute(
                select(CostRecord)
                .where(CostRecord.workflow_id == workflow_id)
                .order_by(CostRecord.id)
            )
            .scalars()
            .all()
        )
        costs = [_cost_to_dict(r) for r in rows]

    return {
        "workflow_id": workflow_id,
        "status": state,
        "result": result,
        "costs": costs,
    }


@router.get("/api/documents")
def get_documents() -> dict:
    return {"documents": [_document_meta(d) for d in list_documents()]}


@router.get("/api/documents/{document_id}")
def get_document(document_id: str) -> dict:
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid document id") from exc

    doc = get_document_with_versions(doc_uuid)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")

    payload = _document_meta(doc)
    payload["versions"] = [_version_to_dict(v) for v in doc.versions]
    return payload


@router.post("/api/documents/{document_id}/versions")
def add_document_version(document_id: str, body: AddDocumentVersionRequest) -> dict:
    """Append a human-edited version to an existing document (P1.7a live-document steering):
    the saved edit becomes a fresh ``DocumentVersion`` that the running agents re-source on
    their next read (the document, not agent memory, is the source of truth — J3).

    Mirrors ``GET /api/documents/{id}``: 400 on a malformed id, 404 if the document doesn't
    exist. A fresh ``idempotency_key`` per request -> every POST is a NEW version (no dedup
    across distinct human saves). Returns the new version row."""
    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid document id") from exc

    if get_document_with_versions(doc_uuid) is None:
        raise HTTPException(status_code=404, detail="document not found")

    version = add_version(
        doc_uuid,
        body.content,
        created_by="human",
        idempotency_key=f"human-edit:{doc_uuid}:{uuid.uuid4().hex}",
    )
    return {
        "document_id": str(version.document_id),
        "version_no": version.version_no,
        "content": version.content,
        "created_at": version.created_at.isoformat(),
    }


@router.get("/api/costs")
def get_costs(workflow_id: str | None = None) -> dict:
    """Return cost rows — all of them, or just those for ``workflow_id``."""
    with db.session_scope() as session:
        stmt = select(CostRecord).order_by(CostRecord.id)
        if workflow_id is not None:
            stmt = stmt.where(CostRecord.workflow_id == workflow_id)
        rows = session.execute(stmt).scalars().all()
        return {"costs": [_cost_to_dict(r) for r in rows]}


@router.get("/api/spike/run-events/{run_id}")
def get_run_events(run_id: str) -> dict:
    """Return the persisted, ordered engine events for a run (P0.3)."""
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)
            )
            .scalars()
            .all()
        )
        return {
            "run_id": run_id,
            "events": [
                {
                    "seq": r.seq,
                    "kind": r.kind,
                    "payload": r.payload,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows
            ],
        }


def _run_to_dict(run: Run) -> dict:
    return {
        "id": str(run.id),
        "team_graph_id": str(run.team_graph_id),
        "idea": run.idea,
        "status": run.status,
        "pm_document_id": str(run.pm_document_id) if run.pm_document_id else None,
        "ship_commit_sha": run.ship_commit_sha,
        "ship_tag": run.ship_tag,
        "cost_total_usd": float(run.cost_total_usd) if run.cost_total_usd is not None else None,
        # A/B pairing (P1.5c §14.2): additive, NULL for an ordinary standalone run. Two runs
        # sharing ``pair_id`` are the A/B; ``pair_label`` is the config side. The §14.3
        # comparison view + the FE read these (existing keys/shapes unchanged).
        "pair_id": str(run.pair_id) if run.pair_id else None,
        "pair_label": run.pair_label,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
    }


@router.post("/api/runs")
def create_run(body: CreateRunRequest) -> dict:
    """Build the requested team (default the 2-node team; ``review_loop`` the 3-node
    cyclic team), create the run row, and start ``run_team`` with an explicit workflow
    id == run_id, so ``DBOS.workflow_id`` keys every write."""
    idea = resolve_run_idea(body.idea)
    if body.team_graph_id is not None:
        # Clone-on-launch (P1.8b): deep-clone the authored team into a fresh run-scoped snapshot and
        # run THAT, so the user's edited prompts/models drive the run. The run owns the immutable
        # clone — editing the authored team afterward can't perturb this in-flight run.
        try:
            gid = uuid.UUID(body.team_graph_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="unknown team_graph_id") from exc
        # Run-start validity guard (P1.8d): the source authored graph is server-authoritatively
        # re-validated — a broken graph is REFUSED with its structured errors, so you can't launch
        # an un-runnable team even via the API (the FE greys Run on the same verdict). Validated
        # before cloning so a rejected launch leaves no orphan snapshot.
        with db.session_scope() as session:
            if session.get(TeamGraph, gid) is None:
                raise HTTPException(status_code=400, detail="unknown team_graph_id")
            nodes, edges = graph_dicts(session, gid)
        verdict = validate_graph(nodes, edges)
        if not verdict["runnable"]:
            raise HTTPException(
                status_code=422,
                detail={"message": "team graph is not runnable", "errors": verdict["errors"]},
            )
        team_graph_id = clone_team_graph(body.team_graph_id)
    elif body.team_shape == "review_loop":
        team_graph_id = build_review_loop_team()
    else:
        team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())

    # Per-run cap: the request body wins, else the configured default (P1.2 DP-A).
    cap = body.budget_cap_usd
    if cap is None:
        cap = get_settings().default_run_budget_usd

    with db.session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea=idea,
                workflow_id=run_id,
                status="running",
                budget_cap_usd=cap,
            )
        )

    with SetWorkflowID(run_id):
        DBOS.start_workflow(run_team, idea)

    return {"run_id": run_id}


# The two fixed v1 A/B configs (§14.2), in launch order: A = the no-review ``two_node`` team,
# B = the ``review_loop`` team (the agent-Reviewer). The delta between them IS the §1 question
# — does adding the review gate change what ships, or is it theatre? Each maps to the existing
# hardcoded builder; arbitrary-config A/B is Phase-2 composability, not v1.
_AB_CONFIGS: tuple[tuple[str, str], ...] = (("A", "two_node"), ("B", "review_loop"))
_TEAM_BUILDERS = {"two_node": build_two_node_team, "review_loop": build_review_loop_team}


@router.post("/api/ab-runs")
def create_ab_runs(body: ABRunRequest) -> dict:
    """Launch an A/B pair: ONE idea through TWO team configs that share a ``pair_id``, so the
    §14.3 comparison view can attribute the measurable delta (the team A/B "which config ships
    better" instrument, §14). Each side is an ordinary run — its own team graph, its own DBOS
    workflow keyed on its run_id (exactly like :func:`create_run`) — with the SAME idea and the
    SAME budget cap on both (a fair comparison); the only added state is the shared ``pair_id``
    + the ``pair_label`` ("A"/"B"). No executor change: this just seeds two runs and starts two
    standard ``run_team`` workflows."""
    idea = resolve_run_idea(body.idea)
    # Same cap-resolution as a single run (P1.2 DP-A), applied identically to both sides.
    cap = body.budget_cap_usd
    if cap is None:
        cap = get_settings().default_run_budget_usd
    pair_id = uuid.uuid4()

    runs: list[dict] = []
    for label, team_shape in _AB_CONFIGS:
        team_graph_id = _TEAM_BUILDERS[team_shape]()
        run_id = str(uuid.uuid4())
        with db.session_scope() as session:
            session.add(
                Run(
                    id=uuid.UUID(run_id),
                    team_graph_id=uuid.UUID(team_graph_id),
                    idea=idea,
                    workflow_id=run_id,
                    status="running",
                    budget_cap_usd=cap,
                    pair_id=pair_id,
                    pair_label=label,
                )
            )
        with SetWorkflowID(run_id):
            DBOS.start_workflow(run_team, idea)
        runs.append({"run_id": run_id, "pair_label": label, "team_shape": team_shape})

    return {"pair_id": str(pair_id), "runs": runs}


@router.get("/api/ab-runs/{pair_id}")
def get_ab_comparison(pair_id: str) -> dict:
    """Read an A/B pair back for the §14.3 comparison view: given the ``pair_id`` from
    :func:`create_ab_runs`, return one ``side`` per run sharing it — terminal status, what
    shipped, cost, the idea, and (for the ``review_loop`` side) the Reviewer's per-round
    verdict labels + the persisted REASONS (``outcome_detail``). The measurable A-vs-B delta
    the operator reads is derived FE-side from these facts (terminal outcome + review effort +
    cost) — deliberately NOT from the ship sha: two separate runs always ship distinct commits,
    so a sha compare can't answer "did the review change what shipped".

    READ-only — no migration, no executor change; it just reflects the pairing + the already-
    persisted invocation rows. **Tolerates a ``<2``-run pair** (the §15 caveat: the A/B launch
    is not atomic, and a side can also fail at runtime, so a ``pair_id`` may carry one row):
    returns whatever rows share the ``pair_id``; 404 ONLY when *zero* rows do."""
    try:
        pid = uuid.UUID(pair_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid pair id") from exc

    with db.session_scope() as session:
        runs = (
            session.execute(select(Run).where(Run.pair_id == pid).order_by(Run.pair_label))
            .scalars()
            .all()
        )
        if not runs:
            raise HTTPException(status_code=404, detail="pair not found")

        sides: list[dict] = []
        for run in runs:
            # Find the run's reviewer node from its OWN graph (the A/two_node side has none).
            # team_shape is DERIVED from this — not read off pair_label — so the shape can't
            # disagree with the actual graph the run drove.
            reviewer_node = session.execute(
                select(AgentNode).where(
                    AgentNode.team_graph_id == run.team_graph_id,
                    AgentNode.role_name == "reviewer",
                )
            ).scalar_one_or_none()

            review_rounds: list[dict] = []
            if reviewer_node is not None:
                rounds = (
                    session.execute(
                        select(AgentInvocation)
                        .where(
                            AgentInvocation.run_id == run.workflow_id,
                            AgentInvocation.node_id == reviewer_node.id,
                        )
                        .order_by(AgentInvocation.iteration)
                    )
                    .scalars()
                    .all()
                )
                review_rounds = [
                    {
                        "iteration": inv.iteration,
                        "outcome": inv.outcome,
                        "outcome_detail": inv.outcome_detail,
                    }
                    for inv in rounds
                ]

            sides.append(
                {
                    "pair_label": run.pair_label,
                    "team_shape": "review_loop" if reviewer_node is not None else "two_node",
                    "run_id": str(run.id),
                    # workflow_id == str(run.id); carried only to look up the DBOS workflow
                    # status AFTER the ORM session closes (the get_run/cancel_run separation).
                    "workflow_id": run.workflow_id,
                    "status": run.status,
                    "ship_tag": run.ship_tag,
                    "ship_commit_sha": run.ship_commit_sha,
                    "cost_total_usd": (
                        float(run.cost_total_usd) if run.cost_total_usd is not None else None
                    ),
                    "idea": run.idea,
                    "review_rounds": review_rounds,
                }
            )

    # The live workflow status is read outside the ORM session (matches get_run): pop the temp
    # workflow_id and replace it with the DBOS status (else "NOT_FOUND" — e.g. a seeded row).
    for side in sides:
        ws = DBOS.get_workflow_status(side.pop("workflow_id"))
        side["workflow_status"] = ws.status if ws is not None else "NOT_FOUND"

    # Echo the canonical UUID form (str(pid)), matching what POST /api/ab-runs returns — not the
    # raw path string, which could be a non-canonical-but-valid spelling.
    return {"pair_id": str(pid), "sides": sides}


@router.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    """Return the DBOS workflow status, the run row, and the run's cost rows."""
    status = DBOS.get_workflow_status(run_id)
    workflow_status = status.status if status is not None else "NOT_FOUND"

    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        cost_rows = (
            session.execute(
                select(CostRecord).where(CostRecord.workflow_id == run_id).order_by(CostRecord.id)
            )
            .scalars()
            .all()
        )
        costs = [_cost_to_dict(r) for r in cost_rows]
        run_dict = _run_to_dict(run) if run is not None else None

    return {
        "run_id": run_id,
        "workflow_status": workflow_status,
        "run": run_dict,
        "costs": costs,
    }


@router.get("/api/runs/{run_id}/graph")
def get_run_graph(run_id: str) -> dict:
    """Read-only team graph (nodes + edges) for a run — what the canvas draws.

    Additive P1.5a fields (existing field names/shapes unchanged — the current
    frontend ignores unknown keys): each node carries its live ``status`` +
    ``iteration`` from its latest ``AgentInvocation`` (the backend now owns per-node
    truth; default ``"idle"``/``0`` when the executor has not reached it), and each
    edge carries its routing ``conditions``."""
    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")

        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        edges = (
            session.execute(select(Edge).where(Edge.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        invocations = (
            session.execute(select(AgentInvocation).where(AgentInvocation.run_id == run_id))
            .scalars()
            .all()
        )
        # The node's live state = its latest invocation (max iteration for that node).
        latest_by_node: dict[str, AgentInvocation] = {}
        # The node's full per-round history, ascending by iteration — the verdict-view
        # (P1.5c §14.1) reads this to surface the Reviewer's round-by-round outcomes.
        invs_by_node: dict[str, list[AgentInvocation]] = {}
        for inv in invocations:
            key = str(inv.node_id)
            if key not in latest_by_node or inv.iteration > latest_by_node[key].iteration:
                latest_by_node[key] = inv
            invs_by_node.setdefault(key, []).append(inv)
        for invs in invs_by_node.values():
            invs.sort(key=lambda i: i.iteration)

        # Deterministic left-to-right order (PM at x=0 before Engineer/Reviewer).
        nodes = sorted(nodes, key=lambda n: (n.position.get("x", 0), str(n.id)))

        return {
            "run_id": run_id,
            "team_graph_id": str(run.team_graph_id),
            "nodes": [
                {
                    # Shared canvas fields (now incl. the additive P1.8b ``prompt``)...
                    **_node_base_dict(n),
                    # ...plus the run-only live state: each node's ``status`` + ``iteration`` from
                    # its latest ``AgentInvocation`` (default ``"idle"``/``0`` until reached).
                    "status": (
                        latest_by_node[str(n.id)].status if str(n.id) in latest_by_node else "idle"
                    ),
                    "iteration": (
                        latest_by_node[str(n.id)].iteration if str(n.id) in latest_by_node else 0
                    ),
                    # P1.5c (§14.1): the node's per-round invocation history, ascending by
                    # iteration — additive read of the already-persisted rows ([] before the
                    # node is reached). The Reviewer panel renders each round's `outcome`
                    # (approved / changes_requested); §14.3's `outcome_detail` carries the verdict
                    # REASONS (NULL unless a `changes_requested` close supplied them).
                    "invocations": [
                        {
                            "iteration": inv.iteration,
                            "status": inv.status,
                            "outcome": inv.outcome,
                            "outcome_detail": inv.outcome_detail,
                            "started_at": inv.started_at.isoformat(),
                            "ended_at": inv.ended_at.isoformat() if inv.ended_at else None,
                        }
                        for inv in invs_by_node.get(str(n.id), [])
                    ],
                }
                for n in nodes
            ],
            "edges": [_edge_to_dict(e) for e in edges],
        }


# ---- The team library (P1.8b): first-class, multiple persistent teams + a template library ----


def _capability_to_columns(capability: str) -> tuple[str, str | None]:
    """Map the user-facing capability vocabulary to the ``(kind, engine)`` columns (P1.8c): a
    ``"thinker"`` is a direct-LLM ``completion`` node with no engine; a ``"worker"`` is an
    ``agent`` node backed by ``openhands``. The executor dispatches on ``kind`` and ignores
    ``engine``, but the data model + the canvas convention require ``engine`` honest — workers carry
    ``openhands``, thinkers ``null``, matching the builders. Pure + unit-tested."""
    return ("completion", None) if capability == "thinker" else ("agent", "openhands")


def _team_root_node_id(session, graph_id: uuid.UUID) -> uuid.UUID | None:
    """The team's root node — the unique node NOT targeted by any of the team's edges — within
    ``session``, else ``None`` (mirrors ``load_graph_step``'s start-node rule exactly). Used to lock
    the start node to a thinker (it writes the spec the rest of the team reads), P1.8c."""
    node_ids = (
        session.execute(select(AgentNode.id).where(AgentNode.team_graph_id == graph_id))
        .scalars()
        .all()
    )
    target_ids = set(
        session.execute(select(Edge.target_node_id).where(Edge.team_graph_id == graph_id))
        .scalars()
        .all()
    )
    roots = sorted((nid for nid in node_ids if nid not in target_ids), key=str)
    return roots[0] if roots else None


def _require_library_team(session, team_id: str) -> TeamGraph:
    """Resolve a library ``TeamGraph`` by id within ``session`` or raise: 400 on a malformed id,
    404 if the id is unknown OR not a library team — so a run-snapshot clone / A-B graph / smoke
    graph (``is_library = false``) is never readable, editable, or deletable via the team API."""
    try:
        tid = uuid.UUID(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid team id") from exc
    graph = session.execute(select(TeamGraph).where(TeamGraph.id == tid)).scalar_one_or_none()
    if graph is None or not graph.is_library:
        raise HTTPException(status_code=404, detail="library team not found")
    return graph


@router.get("/api/templates")
def get_templates() -> dict:
    """The curated starter templates the New-team picker offers (``{template, name, description}``);
    the FE renders the picker from this, never a hardcoded list."""
    return {"templates": list_templates()}


@router.get("/api/teams")
def get_teams() -> dict:
    """The user's library teams as summaries (id / name / created_at / node_count), oldest first.
    Seeds one team if the library is empty so the list is NEVER empty (the canvas
    always has a team — the §13 S2 anti-dead-zone posture). Library teams ONLY: run-snapshot clones,
    A/B graphs, and smoke graphs (``is_library = false``) never appear."""
    seed_library_if_empty()
    return {"teams": list_library_teams()}


@router.post("/api/teams")
def create_team(body: CreateTeamRequest) -> dict:
    """Create a new library team — from a starter template (drop-and-edit), or, when
    ``template == "blank"`` (P1.8d), from the minimal valid skeleton (root thinker → Ship) the user
    wires up from scratch. 400 on an unknown ``template`` key. Returns the new team's summary; the
    FE then loads its graph + makes it current."""
    if body.template == "blank":
        return get_team_summary(create_blank_team(body.name))
    try:
        team_graph_id = create_team_from_template(body.template, body.name)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="unknown template") from exc
    return get_team_summary(team_graph_id)


def _latest_invocation_by_origin(
    session, origin_node_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict]:
    """M2: map each AUTHORED node id -> its "last run" brief — the latest invocation across ALL
    clones of it (the run-snapshot ``agent_nodes`` rows that carry ``cloned_from_node_id``), as
    ``{outcome, outcome_detail, run_id, iteration, started_at}``. ONE ``DISTINCT ON`` read joins
    ``agent_invocations`` -> the clone node -> the origin id, ordered ``started_at DESC`` so the
    FIRST row per origin is the most recent execution (survives a later run that skipped the node).
    A node that never ran is simply absent from the map (-> ``last_run = None`` upstream)."""
    if not origin_node_ids:
        return {}
    rows = session.execute(
        select(
            AgentNode.cloned_from_node_id,
            AgentInvocation.outcome,
            AgentInvocation.outcome_detail,
            AgentInvocation.run_id,
            AgentInvocation.iteration,
            AgentInvocation.started_at,
        )
        .select_from(AgentInvocation)
        .join(AgentNode, AgentInvocation.node_id == AgentNode.id)
        .where(AgentNode.cloned_from_node_id.in_(origin_node_ids))
        .distinct(AgentNode.cloned_from_node_id)
        .order_by(AgentNode.cloned_from_node_id, AgentInvocation.started_at.desc())
    ).all()
    return {
        origin_id: {
            "outcome": outcome,
            "outcome_detail": outcome_detail,
            "run_id": run_id,
            "iteration": iteration,
            "started_at": started_at.isoformat(),
        }
        for origin_id, outcome, outcome_detail, run_id, iteration, started_at in rows
    }


@router.get("/api/teams/{team_id}/graph")
def get_team_graph(team_id: str) -> dict:
    """A library team's nodes + edges in the canvas's node/edge shape and INCLUDING each node's
    editable ``prompt`` — but with NO run state (the authored team is not running). 400 on a
    malformed id; 404 if the id is not a library team. Shares the node/edge serialization with
    ``GET /api/runs/{run_id}/graph`` (``_node_base_dict`` / ``_edge_to_dict``).

    M2: each node also carries a ``last_run`` brief — the latest invocation of any CLONE of that
    authored node, across all the team's runs (or ``None`` if it never ran). This is the AUTHORING
    endpoint ONLY; the run-view endpoint ``get_run_graph`` is unchanged."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph.id))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == graph.id)).scalars().all()
        # Deterministic left-to-right order (PM at x=0 first), matching the run-graph read.
        nodes = sorted(nodes, key=lambda n: (n.position.get("x", 0), str(n.id)))
        last_run_by_origin = _latest_invocation_by_origin(session, [n.id for n in nodes])
        return {
            "team_graph_id": str(graph.id),
            "nodes": [
                {**_node_base_dict(n), "last_run": last_run_by_origin.get(n.id)} for n in nodes
            ],
            "edges": [_edge_to_dict(e) for e in edges],
        }


@router.patch("/api/teams/{team_id}/nodes/{node_id}")
def update_team_node(team_id: str, node_id: str, body: UpdateTeamNodeRequest) -> dict:
    """Persist an edited library-team node's ``prompt`` + ``model``, and (P1.8c) optionally its
    ``capability`` (``"thinker"`` -> ``kind=completion``/``engine=null``; ``"worker"`` ->
    ``kind=agent``/``engine=openhands``). Validates the node belongs to ``team_id`` AND that
    ``team_id`` is a library team, and REJECTS gate/terminal nodes (control primitives). 400 on a
    malformed id; 404 if the team is not a library team or the node is not one of its nodes; 409 if
    the node is a gate/terminal, OR if ``capability="worker"`` is asked of the ROOT node (the first
    node scopes the work — it must stay a thinker, the one executor invariant). Returns the updated
    node."""
    try:
        nid = uuid.UUID(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid node id") from exc
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        node = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one_or_none()
        if node is None or node.team_graph_id != graph.id:
            raise HTTPException(status_code=404, detail="node not found in the team")
        if node.kind in ("gate", "terminal"):
            raise HTTPException(
                status_code=409,
                detail="gate/terminal nodes are control primitives — no prompt/model to edit",
            )
        # P1.8c: an optional capability flip (thinker <-> worker) is a paired kind+engine write.
        # The ONLY invariant the executor needs is that the root stays a thinker (it writes the
        # shared spec the rest of the team reads); making the root a worker would leave no spec for
        # ``read_latest_prd_step`` to read. Holistic graph validity is the M2 topology slice.
        if body.capability is not None:
            if body.capability == "worker" and node.id == _team_root_node_id(session, graph.id):
                raise HTTPException(
                    status_code=409,
                    detail="the first node scopes the work — it must stay a thinker",
                )
            node.kind, node.engine = _capability_to_columns(body.capability)
        node.prompt = body.prompt
        node.model = body.model
        session.flush()
        return _node_base_dict(node)


@router.delete("/api/teams/{team_id}")
def delete_team(team_id: str) -> dict:
    """Delete a library team (the FK cascade drops its nodes/edges). 400 on a malformed id; 404 if
    the id is not a library team (so a run-snapshot clone / A-B graph cannot be deleted here). Safe:
    a ``Run`` points at its immutable clone snapshot, never at a library team, so no run is
    orphaned."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        session.delete(graph)
    return {"team_graph_id": team_id, "deleted": True}


# ---- Topology editing (P1.8d): node/edge CRUD + position persistence + the validity verdict ----

# The pre-filled role presets the canvas palette drops (thinker/worker only) — seeded from the
# byte-intact ``teams.py`` prompt constants. Node-granularity drop-and-edit (the team-granularity
# version shipped as the P1.8b rail picker); the §13-S2 anti-dead-zone answer at node level.
_NODE_PRESETS: dict[str, dict] = {
    "pm": {"node_kind": "thinker", "role_name": "pm", "prompt": PM_PROMPT},
    "architect": {"node_kind": "thinker", "role_name": "architect", "prompt": ARCHITECT_PROMPT},
    "engineer": {"node_kind": "worker", "role_name": "engineer", "prompt": ENGINEER_PROMPT},
    "reviewer": {"node_kind": "worker", "role_name": "reviewer", "prompt": REVIEWER_PROMPT},
}

# The four edge roles (FE plain-language) -> the executor's ``(edge_type, conditions)`` — the exact
# shapes ``team_run``'s routers distinguish (forward = catch-all, branch = ``{when}``, loop-back =
# the bounded ``{loop_limit}`` catch-all, escalation = the cap-exhaustion exit).
_DEFAULT_LOOP_LIMIT = 3


def _build_node(graph_id: uuid.UUID, body: CreateNodeRequest) -> AgentNode:
    """Construct (unpersisted) the ``AgentNode`` for a create-node request — map the canvas
    vocabulary (thinker/worker/gate/terminal + an optional role preset) onto the columns. A
    thinker -> ``completion``/no engine; a worker -> ``agent``/``openhands`` (the P1.8c capability
    pair). Raises 400 on a malformed request (a preset that contradicts ``node_kind``; a terminal
    with no ``terminal_kind``)."""
    position = body.position or {}
    preset = None
    if body.preset is not None:
        preset = _NODE_PRESETS.get(body.preset)
        if preset is None or preset["node_kind"] != body.node_kind:
            raise HTTPException(status_code=400, detail="preset does not match node_kind")

    if body.node_kind == "thinker":
        return AgentNode(
            team_graph_id=graph_id,
            role_name=preset["role_name"] if preset else "thinker",
            kind="completion",
            model=body.model or get_settings().default_model,
            engine=None,
            prompt=preset["prompt"] if preset else (body.prompt if body.prompt is not None else ""),
            position=position,
        )
    if body.node_kind == "worker":
        default_model = reviewer_model() if body.preset == "reviewer" else engineer_model()
        return AgentNode(
            team_graph_id=graph_id,
            role_name=preset["role_name"] if preset else "worker",
            kind="agent",
            model=body.model or default_model,
            engine="openhands",
            prompt=preset["prompt"] if preset else (body.prompt if body.prompt is not None else ""),
            position=position,
        )
    if body.node_kind == "gate":
        return AgentNode(
            team_graph_id=graph_id,
            role_name="gate",
            kind="gate",
            model=None,
            engine=None,
            prompt=None,
            position=position,
            config={
                "gate_kind": "approval",
                "title": body.title or "Approve before continuing?",
                "description": body.description or "Approve to continue; reject to stop the run.",
            },
        )
    # terminal
    if body.terminal_kind is None:
        raise HTTPException(status_code=400, detail="terminal_kind is required for a terminal node")
    return AgentNode(
        team_graph_id=graph_id,
        role_name=body.terminal_kind,
        kind="terminal",
        model=None,
        engine=None,
        prompt=None,
        position=position,
        config={"terminal_kind": body.terminal_kind},
    )


def _edge_columns(body: CreateEdgeRequest) -> tuple[str, dict | None]:
    """Map an edge ``role`` to ``(edge_type, conditions)``. 400 if a branch carries no label."""
    if body.role == "forward":
        return "work", None
    if body.role == "branch":
        if not body.label:
            raise HTTPException(status_code=400, detail="a branch edge requires a label")
        return "work", {"when": body.label}
    if body.role == "loop_back":
        return "work", {"loop_limit": body.loop_limit or _DEFAULT_LOOP_LIMIT}
    return "escalation", None


@router.post("/api/teams/{team_id}/nodes")
def create_team_node(team_id: str, body: CreateNodeRequest) -> dict:
    """Add a node to a library team's canvas (P1.8d). 400 on a malformed id / request; 404 if
    ``team_id`` is not a library team (a run snapshot / A-B graph is never editable). Returns the
    created node in the canvas shape."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        node = _build_node(graph.id, body)
        session.add(node)
        session.flush()
        return _node_base_dict(node)


@router.delete("/api/teams/{team_id}/nodes/{node_id}")
def delete_team_node(team_id: str, node_id: str) -> dict:
    """Delete a library-team node; its edges cascade (FK ``ondelete=CASCADE``). 400 on a malformed
    id; 404 if the team is not a library team or the node is not one of its nodes. Safe: runs use
    immutable clone snapshots, so deleting a library node never touches a past run's rows."""
    try:
        nid = uuid.UUID(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid node id") from exc
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        node = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one_or_none()
        if node is None or node.team_graph_id != graph.id:
            raise HTTPException(status_code=404, detail="node not found in the team")
        session.delete(node)
    return {"node_id": node_id, "deleted": True}


@router.post("/api/teams/{team_id}/edges")
def create_team_edge(team_id: str, body: CreateEdgeRequest) -> dict:
    """Wire two of a library team's nodes (P1.8d). The ``role`` maps to ``(edge_type, conditions)``
    (:func:`_edge_columns`). 400 on a malformed id / a label-less branch; 404 if the team is not a
    library team OR either endpoint is not one of its nodes. Returns the created edge."""
    try:
        source = uuid.UUID(body.source_node_id)
        target = uuid.UUID(body.target_node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid node id") from exc
    edge_type, conditions = _edge_columns(body)
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        on_team = set(
            session.execute(
                select(AgentNode.id).where(AgentNode.team_graph_id == graph.id)
            ).scalars()
        )
        if source not in on_team or target not in on_team:
            raise HTTPException(status_code=404, detail="edge endpoint not in the team")
        edge = Edge(
            team_graph_id=graph.id,
            source_node_id=source,
            target_node_id=target,
            edge_type=edge_type,
            conditions=conditions,
        )
        session.add(edge)
        session.flush()
        return _edge_to_dict(edge)


@router.delete("/api/teams/{team_id}/edges/{edge_id}")
def delete_team_edge(team_id: str, edge_id: str) -> dict:
    """Delete a library-team edge. 400 on a malformed id; 404 if the team is not a library team or
    the edge is not one of its edges."""
    try:
        eid = uuid.UUID(edge_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid edge id") from exc
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        edge = session.execute(select(Edge).where(Edge.id == eid)).scalar_one_or_none()
        if edge is None or edge.team_graph_id != graph.id:
            raise HTTPException(status_code=404, detail="edge not found in the team")
        session.delete(edge)
    return {"edge_id": edge_id, "deleted": True}


@router.post("/api/teams/{team_id}/positions")
def update_team_positions(team_id: str, body: PositionsRequest) -> dict:
    """Persist canvas layout after a drag (P1.8d): a ``{node_id: {x, y}}`` batch. 400 on a malformed
    id; 404 if the team is not a library team. Off-team / malformed entries are ignored (layout is
    best-effort, never a hard error). Returns the ids actually updated."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        by_id = {
            str(n.id): n
            for n in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == graph.id)
            ).scalars()
        }
        updated: list[str] = []
        for nid, pos in body.positions.items():
            node = by_id.get(nid)
            if node is not None and isinstance(pos, dict) and "x" in pos and "y" in pos:
                node.position = {"x": pos["x"], "y": pos["y"]}
                updated.append(nid)
    return {"updated": updated}


@router.get("/api/teams/{team_id}/validate")
def validate_team(team_id: str) -> dict:
    """The holistic graph-validity verdict for a library team (P1.8d) — the SAME pure
    :func:`validate_graph` the ``create_run`` guard refuses an invalid launch with, so the canvas's
    Run-disabled UX never disagrees with the server. 400 on a malformed id; 404 if not a library
    team. Returns ``{errors, warnings, runnable}``."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id)
        nodes, edges = graph_dicts(session, graph.id)
    return validate_graph(nodes, edges)


def _humantask_to_dict(task: HumanTask) -> dict:
    return {
        "id": task.id,
        "run_id": task.run_id,
        "kind": task.kind,
        "priority": task.priority,
        "blocking": task.blocking,
        "topic": task.topic,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "resolution": task.resolution,
        "resolution_note": task.resolution_note,
        "created_at": task.created_at.isoformat(),
        "resolved_at": task.resolved_at.isoformat() if task.resolved_at else None,
    }


@router.get("/api/runs/{run_id}/tasks")
def get_run_tasks(run_id: str) -> dict:
    """Tasks-for-Human items for a run, oldest first (what the P1.1b panel draws)."""
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(HumanTask).where(HumanTask.run_id == run_id).order_by(HumanTask.id)
            )
            .scalars()
            .all()
        )
        return {"run_id": run_id, "tasks": [_humantask_to_dict(t) for t in rows]}


@router.post("/api/runs/{run_id}/tasks/{task_id}/resolve")
def resolve_task(run_id: str, task_id: int, body: ResolveTaskRequest) -> dict:
    """Resolve a pending gate task by **signaling** the waiting workflow.

    This endpoint is a pure signal: it validates the task is pending and calls
    ``DBOS.send``. The workflow's ``close_gate_step`` is the single writer that
    marks the ``HumanTask`` resolved, so the table can't disagree with the run.
    """
    with db.session_scope() as session:
        task = session.execute(
            select(HumanTask).where(HumanTask.id == task_id, HumanTask.run_id == run_id)
        ).scalar_one_or_none()
        if task is None:
            raise HTTPException(status_code=404, detail="task not found")
        if task.status != "pending":
            raise HTTPException(status_code=409, detail=f"task already {task.status}")
        if task.topic is None:
            raise HTTPException(status_code=409, detail="task has no gate topic to signal")
        topic = task.topic

    resolution = _DECISION_TO_RESOLUTION[body.decision]
    DBOS.send(run_id, {"resolution": resolution, "note": body.note}, topic=topic)
    return {
        "run_id": run_id,
        "task_id": task_id,
        "decision": body.decision,
        "resolution": resolution,
        "signaled": True,
    }


@router.post("/api/runs/{run_id}/tasks/{task_id}/acknowledge")
def acknowledge_task(run_id: str, task_id: int) -> dict:
    """Acknowledge (dismiss) a non-blocking, topic-less ``low_nudge`` task — the drawer's
    Low/nudges side (P1.5b, e.g. the 80%-of-cap ``budget_threshold`` nudge).

    Unlike a gate task, **nothing waits** on a nudge, so this marks it resolved DIRECTLY
    (NO ``DBOS.send``). 404 if no such task for the run; 409 if the task is a gate (it is
    ``blocking`` OR carries a ``topic`` — those must go through ``/resolve``, which signals
    the workflow); 409 if already resolved."""
    with db.session_scope() as session:
        task = session.execute(
            select(HumanTask).where(HumanTask.id == task_id, HumanTask.run_id == run_id)
        ).scalar_one_or_none()
        if task is None:
            raise HTTPException(status_code=404, detail="task not found")
        if task.blocking or task.topic is not None:
            raise HTTPException(
                status_code=409, detail="gate task: resolve via /resolve, not /acknowledge"
            )
        if task.status != "pending":
            raise HTTPException(status_code=409, detail=f"task already {task.status}")
        session.execute(
            update(HumanTask)
            .where(HumanTask.id == task_id)
            .values(status="resolved", resolution="acknowledged", resolved_at=func.now())
        )
    return {"run_id": run_id, "task_id": task_id, "resolution": "acknowledged"}


@router.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict:
    """Kill switch: cancel the run's workflow and mark the run ``cancelled``.

    ``DBOS.cancel_workflow`` flips the workflow to ``CANCELLED`` (so recovery's
    PENDING-only scan never resurrects it, and its next step/recv boundary aborts)
    but does NOT interrupt a blocked ``recv``; the workflow may run no further step
    to record the status, so we set ``Run.status`` here directly, and we close the
    run's pending gate tasks (``resolution="cancelled"``) so a dead run leaves no
    actionable task. An **already-terminal** run is left fully untouched — no
    cancel, no status write — so cancelling a just-completed run can't flip a
    ``completed`` run's workflow to ``CANCELLED``.
    """
    blocked = (*_TERMINAL_RUN_STATUSES, "cancelled")
    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        already_terminal = run is not None and run.status in blocked

    if not already_terminal:
        DBOS.cancel_workflow(run_id)
        with db.session_scope() as session:
            session.execute(
                update(Run)
                .where(Run.workflow_id == run_id, Run.status.notin_(blocked))
                .values(status="cancelled")
            )
            session.execute(
                update(HumanTask)
                .where(HumanTask.run_id == run_id, HumanTask.status == "pending")
                .values(status="resolved", resolution="cancelled", resolved_at=func.now())
            )

    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        run_status = run.status if run is not None else None

    workflow_status = DBOS.get_workflow_status(run_id)
    return {
        "run_id": run_id,
        "status": run_status,
        "workflow_status": workflow_status.status if workflow_status is not None else "NOT_FOUND",
    }

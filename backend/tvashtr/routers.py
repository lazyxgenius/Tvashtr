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
from sqlalchemy.exc import NoResultFound

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane.doc_writer import generate_doc
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import (
    build_review_loop_team,
    build_two_node_team,
    clone_team_graph,
    get_or_create_persistent_team,
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
    """A human edit to a persistent-team agent node (P1.8b authoring): its ``prompt`` (the node's
    whole identity/behavior) and ``model``. ONLY these two fields are editable this slice —
    topology, capability (``kind``), and the control primitives (gate/terminal) are later slices /
    not editable. Both are sent on every Save (the FE is dirty-aware but posts the full values)."""

    prompt: str
    model: str


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
            team_graph_id = clone_team_graph(body.team_graph_id)
        except (ValueError, NoResultFound) as exc:
            raise HTTPException(status_code=400, detail="unknown team_graph_id") from exc
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


# ---- The persistent authored team (P1.8b: the first authoring vertical) ----


@router.get("/api/team/graph")
def get_team_graph() -> dict:
    """The single persistent authored team's nodes + edges, in the canvas's node/edge shape and
    INCLUDING each node's editable ``prompt`` — but with NO run state (no ``status``/``iteration``/
    ``invocations``: the authored team is not running). Get-or-creates the team on first open
    (seeded from the review-loop template) so the canvas always has a team to render and edit.
    Shares the node/edge serialization with ``GET /api/runs/{run_id}/graph``."""
    team_graph_id = get_or_create_persistent_team()
    tgid = uuid.UUID(team_graph_id)
    with db.session_scope() as session:
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == tgid))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == tgid)).scalars().all()
        # Deterministic left-to-right order (PM at x=0 first), matching the run-graph read.
        nodes = sorted(nodes, key=lambda n: (n.position.get("x", 0), str(n.id)))
        return {
            "team_graph_id": team_graph_id,
            "nodes": [_node_base_dict(n) for n in nodes],
            "edges": [_edge_to_dict(e) for e in edges],
        }


@router.patch("/api/team/nodes/{node_id}")
def update_team_node(node_id: str, body: UpdateTeamNodeRequest) -> dict:
    """Persist an edited persistent-team node's ``prompt`` + ``model`` (ONLY those two fields this
    slice). Validates the node belongs to the persistent team and REJECTS gate/terminal nodes
    (control primitives — they carry no prompt/model). 400 on a malformed id; 404 if the node is
    not a node of the persistent team; 409 if it is a gate/terminal. Returns the updated node."""
    try:
        nid = uuid.UUID(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid node id") from exc

    persistent_team_id = uuid.UUID(get_or_create_persistent_team())
    with db.session_scope() as session:
        node = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one_or_none()
        if node is None or node.team_graph_id != persistent_team_id:
            raise HTTPException(status_code=404, detail="node not found in the persistent team")
        if node.kind in ("gate", "terminal"):
            raise HTTPException(
                status_code=409,
                detail="gate/terminal nodes are control primitives — no prompt/model to edit",
            )
        node.prompt = body.prompt
        node.model = body.model
        session.flush()
        return _node_base_dict(node)


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

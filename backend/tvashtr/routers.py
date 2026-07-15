"""HTTP surface for the model gateway + document layer (P0.2).

Kept in its own router module so ``main.py`` stays focused on app/DBOS wiring.
GET endpoints return plain dicts (matching the P0.1 style) to avoid coupling the
API to ORM/gateway types.
"""

import os
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from dbos import DBOS, SetWorkflowID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func, select, update

from tvashtr import db
from tvashtr.auth import UserOut, get_current_user
from tvashtr.config import get_settings
from tvashtr.control_plane import memory, memory_distill, memory_review
from tvashtr.control_plane.credentials import (
    NoCredentialError,
    encrypt_secret,
    provider_for_model,
    resolve_owner_api_key,
)
from tvashtr.control_plane.doc_writer import generate_doc
from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.mcp_secrets import (
    delete_owner_mcp_secret,
    list_owner_mcp_secret_names,
    set_owner_mcp_secret,
)
from tvashtr.control_plane.node_library import (
    create_owner_skill,
    create_owner_tool,
    delete_owner_skill,
    delete_owner_tool,
    list_owner_skills,
    list_owner_tools,
    update_owner_skill,
    update_owner_tool,
)
from tvashtr.control_plane.run_diff import compute_run_diff
from tvashtr.control_plane.run_explain import build_system_prompt
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import (
    ARCHITECT_PROMPT,
    ENGINEER_PROMPT,
    PM_PROMPT,
    REVIEWER_PROMPT,
    account_default_model,
    build_review_loop_team,
    build_two_node_team,
    cancel_run_core,
    clone_team_graph,
    create_blank_team,
    create_team_from_template,
    delete_library_team_and_runs,
    engineer_model,
    get_team_summary,
    list_library_teams,
    list_templates,
    reviewer_model,
    seed_library_if_empty,
)
from tvashtr.control_plane.worktree import repo_inspect, repo_subpaths, subpath_is_tracked_dir
from tvashtr.documents.service import add_version, get_document_with_versions, list_documents
from tvashtr.gateway import CompletionRequest, GatewayError, complete
from tvashtr.metering import record_cost
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Document,
    DocumentVersion,
    Edge,
    HumanTask,
    ProviderCredential,
    Run,
    RunEvent,
    RunWarning,
    TeamGraph,
    User,
)

# Map the resolve API's decision verb to the durable resolution recorded on the task.
_DECISION_TO_RESOLUTION = {"approve": "approved", "reject": "rejected"}

# Mode A ("Ask the node"): the max chat turns the stateless ask endpoint accepts per request (the
# client holds + sends the whole history each turn, so this bounds a single request's growth).
_ASK_MAX_MESSAGES = 24

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
    # M-brownfield Slice 1: the "work on a real local folder" run mode. ``repo_path`` is the user's
    # real local git repo; when set, the run works on an isolated ``git worktree`` of it and ships
    # to a real branch ``tvashtr/<run_id>``. ``base_ref`` is the branch the worktree is cut from
    # (defaulted to the repo's current branch when omitted). BOTH omitted (every legacy caller) ⇒
    # the greenfield create is byte-for-byte unchanged.
    repo_path: str | None = None
    base_ref: str | None = None
    # M-brownfield scoped-mount Slice 1: an OPTIONAL sub-path that scopes the brownfield agent's
    # CONTEXT MAP + FOCUS to one package of the repo (NOT the git mount). When set on a brownfield
    # run it must name a tracked DIRECTORY in the repo (else 422). NULL / absent ⇒ whole repo; a
    # greenfield run (no ``repo_path``) ignores it (stored NULL). The picker that supplies it is FE
    # Slice 2 — here it is an optional API field only.
    subpath: str | None = None


class AskMessage(BaseModel):
    # One chat turn the client holds and re-sends each request (Mode A is stateless server-side).
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    messages: list[AskMessage]


class RepoInspectRequest(BaseModel):
    """``POST /api/repo/inspect`` body (M-brownfield Slice 1, D5): a candidate local repo path to
    discriminate before a brownfield launch. Slice 2's launch UI calls this to render the repo's
    branches inline; here it only needs to EXIST + return the discriminated result."""

    path: str


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
    """A human edit to a persistent-team node.

    For an **agent/completion** node: its ``prompt`` (the node's whole identity/behavior), its
    ``model``, and (P1.8c) optionally its ``capability`` — ``"thinker"`` (a direct LLM completion,
    like the PM) or ``"worker"`` (an engine-backed sandboxed run, like the Engineer).
    ``prompt``/``model`` are sent on every agent Save (the FE is dirty-aware but posts the full
    values) and are REQUIRED for an agent node. ``capability`` is OPTIONAL — omitted leaves
    ``kind``/``engine`` unchanged (back-compat with the prior ``{prompt, model}`` saves).

    For a **gate** node (M-rails C8): its editable ``config`` — ``gate_kind`` (``gate_approval`` /
    ``secret_leak_scan`` / …), ``title``, ``description`` — each optional, merged into the existing
    config so a partial edit preserves the rest. ``prompt``/``model``/``capability`` do not apply to
    a control primitive and are ignored.

    For a **terminal** node (M-endpoint-editable): ``terminal_kind`` (``ship`` / ``stop``) — the
    single source of truth for the endpoint disposition. When sent, it is written into
    ``config["terminal_kind"]`` AND synced onto ``role_name`` so a flipped endpoint is
    byte-identical to a freshly-dropped one of the same kind (trajectory ledger joins on
    ``role_name``). Omitted leaves config + role_name byte-unchanged. ``prompt``/``model`` are
    ignored for a terminal."""

    prompt: str | None = None
    model: str | None = None
    capability: Literal["thinker", "worker"] | None = None
    # M-rails C8: a gate's editable config. Only meaningful when the target node is a gate; the
    # dedicated FE gate-update fn sends these (never prompt/model), so both stay optional.
    gate_kind: str | None = None
    title: str | None = None
    description: str | None = None
    # M-endpoint-editable: a terminal's editable disposition. Only meaningful when the target is a
    # terminal; the dedicated FE terminal-update fn sends this alone.
    terminal_kind: Literal["ship", "stop"] | None = None
    # M-rails C9: the parameterized guardrail configs — ``forbidden_paths`` (globs) for
    # ``diff_touches_forbidden_paths``; ``output_file`` + ``output_schema`` for
    # ``output_schema_check``. Each merged into the gate's config only when sent (None ⇒ left
    # unchanged), so a secret_leak_scan / human save stays byte-identical. ``output_schema`` (not
    # ``schema``) avoids shadowing ``BaseModel.schema``; STORED under the config key ``schema``
    # (what :func:`output_schema_check` reads).
    forbidden_paths: list | None = None
    output_file: str | None = None
    output_schema: dict | None = None
    # M-tools C7.0: optional inline tools + skills. Additive — a request omitting them (None) leaves
    # the stored value unchanged (the same is-not-None guard the executor path uses), so existing
    # ``{prompt, model[, capability]}`` saves stay byte-for-byte back-compatible.
    tool_config: dict | None = None
    skills: list | None = None
    # M-unify U1: the capability toggle. The FE still drives ``kind`` via ``capability`` until U3,
    # so
    # a ``capability`` change WITHOUT an explicit ``edits_allowed`` SYNCS it to ``kind == 'agent'``;
    # an EXPLICIT value here always WINS (``model_fields_set`` distinguishes omitted from sent).
    edits_allowed: bool | None = None
    # M-memory: the per-node agent-remember toggle — a top-level bool in the node's EXISTING config
    # JSONB (no migration). Merged into config only when SENT (``model_fields_set``); omitted ⇒
    # config unchanged. The run gate ANDs it with ``edits_allowed`` (only an edits-on node can write
    # the sidecar), so the FE shows the control only for an edits-on agent node.
    memory_remember_enabled: bool | None = None


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
        # M-tools C7.0: the node's inline tools + skills (NULL on every node today). Additive — the
        # canvas ignores unknown keys, and the side panel round-trips these through the PATCH below.
        "tool_config": n.tool_config,
        "skills": n.skills,
        # M-unify U1: the ONE capability distinction — True ⇒ a worker (its file changes ship);
        # False ⇒ report-only (runs the loop, but only REPORT.md + the verdict leave the sandbox).
        "edits_allowed": n.edits_allowed,
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
    """Return the persisted, ordered engine events for a run (P0.3).

    M-ledger C5: each event additionally carries its ``invocation_id`` (the node-execution it
    belongs to) plus that invocation's ``node_id`` + ``iteration`` (LEFT-joined off
    ``agent_invocations`` — all three NULL for a legacy pre-0020 event with no ``invocation_id``).
    Existing ``seq``/``kind``/``payload``/``created_at`` unchanged."""
    with db.session_scope() as session:
        rows = session.execute(
            select(RunEvent, AgentInvocation)
            .outerjoin(AgentInvocation, RunEvent.invocation_id == AgentInvocation.id)
            .where(RunEvent.run_id == run_id)
            .order_by(RunEvent.seq)
        ).all()
        return {
            "run_id": run_id,
            "events": [
                {
                    "seq": ev.seq,
                    "kind": ev.kind,
                    "payload": ev.payload,
                    "created_at": ev.created_at.isoformat(),
                    "invocation_id": ev.invocation_id,
                    "node_id": str(inv.node_id) if inv is not None else None,
                    "iteration": inv.iteration if inv is not None else None,
                }
                for ev, inv in rows
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
        # M-brownfield: the brownfield target + the real branch the change landed on (all NULL for a
        # greenfield run) — so a later FE/banner can show "shipped to tvashtr/<run_id> in <repo>".
        "repo_path": run.repo_path,
        "base_ref": run.base_ref,
        "ship_branch": run.ship_branch,
        # scoped-mount Slice 1: the optional sub-path scope (NULL ⇒ whole repo). Surfaced parallel
        # to the sibling brownfield columns (the FE picker reads it in Slice 2).
        "subpath": run.subpath,
        "cost_total_usd": float(run.cost_total_usd) if run.cost_total_usd is not None else None,
        # A/B pairing (P1.5c §14.2): additive, NULL for an ordinary standalone run. Two runs
        # sharing ``pair_id`` are the A/B; ``pair_label`` is the config side. The §14.3
        # comparison view + the FE read these (existing keys/shapes unchanged).
        "pair_id": str(run.pair_id) if run.pair_id else None,
        "pair_label": run.pair_label,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
    }


@router.post("/api/repo/inspect")
def inspect_repo(body: RepoInspectRequest) -> dict:
    """M-brownfield Slice 1 (D5): discriminate a candidate local repo for a brownfield launch.
    Returns ``repo_inspect``'s **discriminated result** (``{is_git: True, current_branch, branches,
    tracked_file_count}`` or ``{is_git: False, error}``) with a 200 in BOTH cases — a non-repo is a
    renderable result the FE shows inline, NOT an exception.

    scoped-mount Slice 2: for a git repo the result ALSO carries ``subpaths`` — the top-level
    tracked package dirs (each ``{path, file_count}``) the launch panel's Scope picker offers.
    Added only on the FE-facing endpoint (``repo_inspect`` itself stays byte-identical for
    ``create_run``'s reuse); a non-git result is unchanged (no ``subpaths`` — nothing to scope)."""
    result = repo_inspect(body.path)
    if result.get("is_git"):
        result["subpaths"] = repo_subpaths(body.path)
    return result


def _require_owned_run(session, run_id: str, owner_id: uuid.UUID) -> Run:
    """Load the run by ``workflow_id`` and 404 unless it is owned by ``owner_id`` (M-accounts Slice
    B: blocks cross-account uuid-guessing). 404 (not 403) so existence isn't even probeable."""
    run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
    if run is None or run.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _missing_provider_credentials(owner_id: uuid.UUID, team_graph_id: str) -> list[str]:
    """The distinct providers across the team's node models that ``owner_id`` has NO credential for
    (M-accounts Slice B launch pre-flight). Empty ⇒ the owner can run every node; non-empty ⇒ refuse
    the launch (422). gate/terminal nodes carry no model and are skipped."""
    with db.session_scope() as session:
        models = session.execute(
            select(AgentNode.model).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
        ).scalars()
        needed = {provider_for_model(m) for m in models if m}
        if not needed:
            return []
        have = set(
            session.execute(
                select(ProviderCredential.provider).where(
                    ProviderCredential.owner_id == owner_id,
                    ProviderCredential.provider.in_(needed),
                )
            ).scalars()
        )
    return sorted(needed - have)


@router.post("/api/runs")
def create_run(
    body: CreateRunRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Build the requested team (default the 2-node team; ``review_loop`` the 3-node
    cyclic team), create the run row, and start ``run_team`` with an explicit workflow
    id == run_id, so ``DBOS.workflow_id`` keys every write.

    M-brownfield Slice 1: when ``repo_path`` is set, the run is a BROWNFIELD run — the path is
    validated (422 on a non-git path or an unknown ``base_ref``), ``base_ref`` defaults to the
    repo's current branch, and both are recorded on the Run row (the executor then cuts a worktree
    + ships to ``tvashtr/<run_id>``). When ``repo_path`` is None the create is byte-for-byte the
    prior greenfield path."""
    idea = resolve_run_idea(body.idea)

    # Validate the brownfield target FIRST (before any team graph is built), so a rejected launch
    # leaves no orphan team/run — mirroring the clone-on-launch validation discipline below.
    repo_path = body.repo_path
    base_ref = body.base_ref
    subpath = body.subpath
    if repo_path is not None:
        info = repo_inspect(repo_path)
        if not info["is_git"]:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "repo_path is not a git repository",
                    "path": repo_path,
                    "error": info.get("error"),
                },
            )
        if base_ref is not None and base_ref not in info["branches"]:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "base_ref is not a known branch in repo_path",
                    "base_ref": base_ref,
                    "branches": info["branches"],
                },
            )
        if base_ref is None:
            base_ref = info["current_branch"]
        # scoped-mount Slice 1: an optional sub-path scopes the agent's context map + focus. When
        # present it must name a real tracked DIRECTORY within the repo (else a clean 422, mirroring
        # the repo_path/base_ref validation). NULL/absent ⇒ whole repo (today's behavior).
        if subpath is not None and not subpath_is_tracked_dir(repo_path, subpath):
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "subpath is not a tracked directory in repo_path",
                    "subpath": subpath,
                },
            )
    else:
        # Greenfield (no repo to scope): ignore any supplied sub-path (store NULL).
        subpath = None
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
            source = session.get(TeamGraph, gid)
            # M-accounts Slice B: the source authored team must be OWNED by the current user — you
            # can't launch (or even probe) another account's team (404, not 400, on a foreign id).
            if source is None or source.owner_id != uuid.UUID(current_user.id):
                raise HTTPException(status_code=404, detail="unknown team_graph_id")
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

    # M-accounts Slice B launch pre-flight: the owner must have a provider key for EVERY distinct
    # provider the team's node models use, else refuse (422) BEFORE the workflow starts — mirroring
    # the brownfield validate-before-launch discipline (a keyless account can't run; the seeded
    # operator with imported keys passes). On the clone path this checks the clone (== the source's
    # models); a 422 leaves only a harmless non-library orphan clone, never a started run.
    missing = _missing_provider_credentials(uuid.UUID(current_user.id), team_graph_id)
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "you have no API key for: " + ", ".join(missing),
                "missing_providers": missing,
            },
        )

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
                # M-accounts Slice B: the run is OWNED by construction (the current user) — the
                # executor resolves THIS owner's keys; there is no owner-less run.
                owner_id=uuid.UUID(current_user.id),
                idea=idea,
                workflow_id=run_id,
                status="running",
                budget_cap_usd=cap,
                # M-brownfield: both None for a greenfield run ⇒ identical column defaults.
                repo_path=repo_path,
                base_ref=base_ref,
                # scoped-mount Slice 1: the optional sub-path scope (None for greenfield /
                # whole-repo brownfield ⇒ identical column default).
                subpath=subpath,
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
def create_ab_runs(
    body: ABRunRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
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

    owner_id = uuid.UUID(current_user.id)
    runs: list[dict] = []
    for label, team_shape in _AB_CONFIGS:
        team_graph_id = _TEAM_BUILDERS[team_shape]()
        # M-accounts Slice B: same launch pre-flight as a single run, per side — refuse before any
        # run starts if the owner lacks a provider key the config needs (422).
        missing = _missing_provider_credentials(owner_id, team_graph_id)
        if missing:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "you have no API key for: " + ", ".join(missing),
                    "missing_providers": missing,
                },
            )
        run_id = str(uuid.uuid4())
        with db.session_scope() as session:
            session.add(
                Run(
                    id=uuid.UUID(run_id),
                    team_graph_id=uuid.UUID(team_graph_id),
                    owner_id=owner_id,  # M-accounts Slice B: both A/B runs owned by the launcher.
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
def get_ab_comparison(
    pair_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
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
        # M-accounts Slice B: owner-scoped — 404 unless the pair exists AND every run in it belongs
        # to the current user (both A/B runs are owned by the launcher; no cross-account read).
        owner_id = uuid.UUID(current_user.id)
        if not runs or any(r.owner_id != owner_id for r in runs):
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
def get_run(run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """Return the DBOS workflow status, the run row, and the run's cost rows. M-accounts Slice B:
    owner-scoped — 404 unless the run belongs to the current user (no cross-account guessing)."""
    status = DBOS.get_workflow_status(run_id)
    workflow_status = status.status if status is not None else "NOT_FOUND"

    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        cost_rows = (
            session.execute(
                select(CostRecord).where(CostRecord.workflow_id == run_id).order_by(CostRecord.id)
            )
            .scalars()
            .all()
        )
        costs = [_cost_to_dict(r) for r in cost_rows]
        run_dict = _run_to_dict(run)

    return {
        "run_id": run_id,
        "workflow_status": workflow_status,
        "run": run_dict,
        "costs": costs,
    }


def _cost_by_invocation(session, run_id: str) -> dict[int, dict]:
    """M-ledger C5: each invocation's linked cost, keyed by invocation id. ``cost_records.
    invocation_id`` links a spend to the node-execution that incurred it; summed defensively (<=1
    row per invocation today) + COALESCE-safe via the group aggregate. Absent from the map when no
    cost row links (gates, terminals, a zero-usage reviewer round). Each value is the ``cost``
    object the ``/graph`` + ``/trajectory`` contracts return."""
    rows = session.execute(
        select(
            CostRecord.invocation_id,
            func.sum(CostRecord.prompt_tokens),
            func.sum(CostRecord.completion_tokens),
            func.sum(CostRecord.total_tokens),
            func.sum(CostRecord.cost_usd),
        )
        .where(CostRecord.workflow_id == run_id, CostRecord.invocation_id.isnot(None))
        .group_by(CostRecord.invocation_id)
    ).all()
    return {
        inv_id: {
            "prompt_tokens": int(pt),
            "completion_tokens": int(ct),
            "total_tokens": int(tt),
            "cost_usd": float(cost),
        }
        for inv_id, pt, ct, tt, cost in rows
    }


@router.get("/api/runs/{run_id}/trajectory")
def get_run_trajectory(
    run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """The one-row-per-node-execution ledger for a run (M-ledger C5) — a capture-only, owner-scoped
    read (404 unless the run belongs to the current user), NOT consumed by the frontend. Each row
    assembles the invocation join its node (``role_name`` + ``kind``) join its linked cost (the
    ``cost_records.invocation_id`` join) join its stored ``context_manifest``, ordered by
    ``started_at`` ASC — the executor's walk order."""
    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        cost_by_inv = _cost_by_invocation(session, run_id)
        rows = session.execute(
            select(AgentInvocation, AgentNode.role_name, AgentNode.kind)
            .join(AgentNode, AgentInvocation.node_id == AgentNode.id)
            .where(AgentInvocation.run_id == run_id)
            .order_by(AgentInvocation.started_at, AgentInvocation.id)
        ).all()
        return {
            "run": {
                "id": str(run.id),
                "idea": run.idea,
                "status": run.status,
                "cost_total_usd": (
                    float(run.cost_total_usd) if run.cost_total_usd is not None else None
                ),
            },
            "rows": [
                {
                    "invocation_id": inv.id,
                    "node_id": str(inv.node_id),
                    "role_name": role_name,
                    "kind": kind,
                    "iteration": inv.iteration,
                    "status": inv.status,
                    "outcome": inv.outcome,
                    "outcome_detail": inv.outcome_detail,
                    "context_manifest": inv.context_manifest,
                    "cost": cost_by_inv.get(inv.id),
                    "started_at": inv.started_at.isoformat(),
                    "ended_at": inv.ended_at.isoformat() if inv.ended_at else None,
                }
                for inv, role_name, kind in rows
            ],
        }


@router.get("/api/runs/{run_id}/diff")
def get_run_diff(run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The per-file change set of a run's reviewed work — the run-view "Changes" tab (M-changes). A
    read-only, owner-scoped git read (404 unless the run belongs to the current user, mirroring
    ``/trajectory``): a BROWNFIELD run diffs ``base_ref..tvashtr/<run_id>`` in the real repo; a
    GREENFIELD run reports the produced workspace files as additions. A run with nothing to diff yet
    -> an empty ``files`` list with 200 (not an error). Reads git + the existing ``Run`` row only —
    no mutation, no schema change."""
    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        repo_path = run.repo_path
        base_ref = run.base_ref
        ship_branch = run.ship_branch
    return compute_run_diff(
        run_id=run_id, repo_path=repo_path, base_ref=base_ref, ship_branch=ship_branch
    )


@router.get("/api/runs/{run_id}/memories")
def get_run_memories(
    run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """The durable memory facts this run TAUGHT (M-memory S2 distillation) — ``active`` +
    ``pending_review``, each with polarity/status/tier/content. Owner-scoped (404 unless the run
    belongs to the current user, mirroring ``/diff`` and ``/trajectory``). Backs the "run taught
    N things" view. Read-only — reads ``node_memories`` filtered to ``source_run_id == run_id``."""
    owner_id = uuid.UUID(current_user.id)
    with db.session_scope() as session:
        _require_owned_run(session, run_id, owner_id)  # 404 unless the run is the caller's
    return {"memories": memory_distill.list_run_memories(owner_id, run_id)}


@router.post("/api/runs/{run_id}/nodes/{node_id}/ask")
def ask_node(
    run_id: str,
    node_id: str,
    body: AskRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Mode A — "Ask the node": a stateless, owner-scoped chat about what ONE node did in a run.

    The client holds the chat history and sends it each turn (``body.messages``). The endpoint
    owner-scopes the run (404 unless it belongs to the current user, exactly like ``/diff``),
    requires the node to belong to the run's ``team_graph``, be an agent/completion node, and have
    >=1 recorded ``AgentInvocation`` (else a clean 4xx). It then assembles the node's recorded TRAIL
    into a SYSTEM message (``run_explain.build_system_prompt``) that pins the model to that record,
    and answers with the node's OWN model + the run-owner's BYOK key. The spend is metered with
    ``workflow_id=None`` — this meta-question is deliberately NOT attributed to the run's ledger. It
    never touches the executor/engines; it only READS the run's recorded rows + the gateway."""
    if not body.messages:
        raise HTTPException(status_code=422, detail="messages must be non-empty")
    if len(body.messages) > _ASK_MAX_MESSAGES:
        raise HTTPException(status_code=422, detail=f"too many messages (max {_ASK_MAX_MESSAGES})")

    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        try:
            node_uuid = uuid.UUID(node_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="node not found") from None
        node = session.execute(
            select(AgentNode).where(
                AgentNode.id == node_uuid,
                AgentNode.team_graph_id == run.team_graph_id,
            )
        ).scalar_one_or_none()
        if node is None:
            raise HTTPException(status_code=404, detail="node not found")
        if node.kind not in ("agent", "completion"):
            raise HTTPException(status_code=400, detail="only agent/completion nodes are askable")
        if not node.model:
            raise HTTPException(status_code=422, detail="node has no model configured")
        invocation_count = session.execute(
            select(func.count())
            .select_from(AgentInvocation)
            .where(
                AgentInvocation.run_id == run.workflow_id,
                AgentInvocation.node_id == node.id,
            )
        ).scalar_one()
        if invocation_count == 0:
            raise HTTPException(status_code=422, detail="node has not run yet (no recorded trail)")
        owner_id = run.owner_id
        model = node.model

    system_prompt = build_system_prompt(run_id=run_id, node_id=node_id)

    try:
        api_key = resolve_owner_api_key(owner_id, model)
    except NoCredentialError as exc:
        raise HTTPException(
            status_code=422, detail=f"no credential for provider {exc.provider!r}"
        ) from exc

    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": m.role, "content": m.content} for m in body.messages
    ]
    try:
        result = complete(CompletionRequest(model=model, messages=messages, api_key=api_key))
    except GatewayError as exc:
        raise HTTPException(status_code=502, detail="the model call failed") from exc

    # Meter the spend but do NOT attribute it to the run (``workflow_id=None``): asking about a run
    # is a meta-action, not part of the run's own cost. ``running_cost(run_id)`` stays unchanged.
    record_cost(
        result,
        workflow_id=None,
        idempotency_key=f"node-ask:{run_id}:{node_id}:{uuid.uuid4().hex}",
    )
    return {"answer": result.text}


@router.get("/api/runs/{run_id}/graph")
def get_run_graph(run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """Read-only team graph (nodes + edges) for a run — what the canvas draws. M-accounts Slice B:
    owner-scoped (404 unless the run belongs to the current user).

    Additive P1.5a fields (existing field names/shapes unchanged — the current
    frontend ignores unknown keys): each node carries its live ``status`` +
    ``iteration`` from its latest ``AgentInvocation`` (the backend now owns per-node
    truth; default ``"idle"``/``0`` when the executor has not reached it), and each
    edge carries its routing ``conditions``."""
    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))

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
        # M-ledger C5: the per-invocation cost (the cost_records.invocation_id join), keyed by
        # invocation id — attached to each invocation dict below (null when no cost row links).
        cost_by_inv = _cost_by_invocation(session, run_id)
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

        # M-tools C7.A (SHARED CONTRACT S1): run-scoped resolution warnings — tools/skills that
        # FAILED to resolve at run time and were SKIPPED (the run continued). Oldest-first; [] none.
        resolution_warnings = (
            session.execute(
                select(RunWarning)
                .where(RunWarning.run_id == run.id)
                .order_by(RunWarning.created_at, RunWarning.id)
            )
            .scalars()
            .all()
        )

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
                            # M-ledger C5 (additive): the stored context manifest (as-is; null for
                            # thinker/gate/terminal + pre-0019 rows) + the per-invocation cost from
                            # the cost_records.invocation_id join (null when no cost row links).
                            "context_manifest": inv.context_manifest,
                            "cost": cost_by_inv.get(inv.id),
                            "started_at": inv.started_at.isoformat(),
                            "ended_at": inv.ended_at.isoformat() if inv.ended_at else None,
                        }
                        for inv in invs_by_node.get(str(n.id), [])
                    ],
                }
                for n in nodes
            ],
            "edges": [_edge_to_dict(e) for e in edges],
            "resolution_warnings": [
                {"source_kind": w.source_kind, "name": w.name, "reason": w.reason}
                for w in resolution_warnings
            ],
        }


# ---- Provider credentials (M-accounts Slice B): the account's BYOK keys, encrypted at rest ----


class AddProviderRequest(BaseModel):
    """``POST /api/providers`` body: a provider slug (e.g. ``openrouter``) + the plaintext key. The
    server lower-cases/trims the slug, encrypts the key (Fernet), and upserts on ``(owner,
    provider)`` — adding the same provider again REPLACES the stored key. The secret is never
    returned."""

    provider: str
    api_key: str


def _provider_to_dict(cred: ProviderCredential) -> dict:
    """A provider credential as the dashboard shows it — ``provider · •••• last4`` — NEVER the
    secret (``secret_encrypted`` is decrypted only at run time, in the executor)."""
    return {
        "provider": cred.provider,
        "key_last4": cred.key_last4,
        "created_at": cred.created_at.isoformat(),
    }


@router.get("/api/providers")
def list_providers(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's configured providers (``provider`` + ``•••• last4`` + ``created_at``),
    oldest first. The encrypted secret is NEVER returned."""
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(ProviderCredential)
                .where(ProviderCredential.owner_id == uuid.UUID(current_user.id))
                .order_by(ProviderCredential.created_at, ProviderCredential.provider)
            )
            .scalars()
            .all()
        )
        return {"providers": [_provider_to_dict(r) for r in rows]}


@router.post("/api/providers")
def add_provider(
    body: AddProviderRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Add (or REPLACE) the current account's key for a provider. Lower-cases/trims the slug,
    encrypts the key, and upserts on ``(owner, provider)``. 422 on an empty provider/key. Returns
    ``{provider, key_last4}`` — never the secret."""
    provider = provider_for_model(body.provider)  # leading-slug + lower/trim — the canonical form
    api_key = body.api_key.strip()
    if not provider:
        raise HTTPException(status_code=422, detail="A provider is required.")
    if not api_key:
        raise HTTPException(status_code=422, detail="An API key is required.")
    owner_id = uuid.UUID(current_user.id)
    last4 = api_key[-4:]
    secret = encrypt_secret(api_key)
    with db.session_scope() as session:
        existing = session.execute(
            select(ProviderCredential).where(
                ProviderCredential.owner_id == owner_id,
                ProviderCredential.provider == provider,
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.secret_encrypted = secret
            existing.key_last4 = last4
        else:
            session.add(
                ProviderCredential(
                    owner_id=owner_id,
                    provider=provider,
                    secret_encrypted=secret,
                    key_last4=last4,
                )
            )
    return {"provider": provider, "key_last4": last4}


@router.delete("/api/providers/{provider}", status_code=204)
def delete_provider(
    provider: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    """Remove the current account's key for ``provider`` (204, idempotent — deleting an absent
    provider still 204s; a run needing it is then refused at the next launch)."""
    canonical = provider_for_model(provider)
    with db.session_scope() as session:
        cred = session.execute(
            select(ProviderCredential).where(
                ProviderCredential.owner_id == uuid.UUID(current_user.id),
                ProviderCredential.provider == canonical,
            )
        ).scalar_one_or_none()
        if cred is not None:
            session.delete(cred)
    return Response(status_code=204)


# ---- MCP secrets (M-tools C7.A): the account's ${NAME} store for MCP tool_config, encrypted ----


class AddSecretRequest(BaseModel):
    """``POST /api/secrets`` body: a ``${NAME}`` key (e.g. ``GITHUB_TOKEN``) + its plaintext value.
    The server encrypts the value (Fernet) and upserts on ``(owner, name)`` — adding the same name
    again REPLACES the stored value. The value is NEVER returned by any endpoint."""

    name: str
    value: str


@router.get("/api/secrets")
def list_secrets(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The NAMES of the current account's MCP secrets (never the values), oldest first — feeds the
    account Secrets shelf and ToolsSection's pre-launch missing-secret check."""
    names = list_owner_mcp_secret_names(uuid.UUID(current_user.id))
    return {"secrets": [{"name": n} for n in names]}


@router.post("/api/secrets")
def add_secret(
    body: AddSecretRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Add (or REPLACE) an MCP ``${NAME}`` secret for the account. Encrypts it (Fernet)
    and upserts on ``(owner, name)``. 422 on an empty name/value. Returns ``{name}`` — never the
    value."""
    name = body.name.strip()
    value = body.value.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A secret name is required.")
    if not value:
        raise HTTPException(status_code=422, detail="A secret value is required.")
    set_owner_mcp_secret(uuid.UUID(current_user.id), name, value)
    return {"name": name}


@router.delete("/api/secrets/{name}", status_code=204)
def delete_secret(
    name: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    """Remove the current account's ``${name}`` secret (204, idempotent — deleting an absent name
    still 204s)."""
    delete_owner_mcp_secret(uuid.UUID(current_user.id), name)
    return Response(status_code=204)


# ---- Tool + Skill LIBRARY (M-tools C7.C): the account's reusable, referenceable items ----
# UNLIKE a secret, a library item's content IS stored + returned (it is editable, not a credential);
# a node references it by id INSIDE its own tool_config/skills, resolved + merged at run time.


class ToolLibraryBody(BaseModel):
    """``POST``/``PATCH`` body for a library tool: a ``name`` (the ``mcpServers`` key) + a
    ``server_config`` object (the single server's config — ``{command,args,env}`` stdio or
    ``{url,headers,type}`` http/sse). Upserts on ``(owner, name)``."""

    name: str
    server_config: dict


class SkillLibraryBody(BaseModel):
    """``POST``/``PATCH`` body for a library skill: a ``name`` (display label) + a ``source`` object
    (one C7.B skill source — inline/repo/project_rules). A ``library``-typed source is REJECTED — a
    library item's source never nests another reference."""

    name: str
    source: dict


_LIBRARY_SKILL_SOURCE_TYPES = {"inline", "repo", "project_rules"}


def _tool_library_to_dict(item: dict) -> dict:
    return {
        "id": str(item["id"]),
        "name": item["name"],
        "server_config": item["server_config"],
        "created_at": item["created_at"].isoformat(),
    }


def _skill_library_to_dict(item: dict) -> dict:
    return {
        "id": str(item["id"]),
        "name": item["name"],
        "source": item["source"],
        "created_at": item["created_at"].isoformat(),
    }


@router.get("/api/tool-library")
def list_tool_library(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's library tools (``{id, name, server_config, created_at}``), oldest
    first."""
    items = list_owner_tools(uuid.UUID(current_user.id))
    return {"tools": [_tool_library_to_dict(t) for t in items]}


@router.post("/api/tool-library")
def add_tool_library(
    body: ToolLibraryBody, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Add (or REPLACE — upsert on ``(owner, name)``) a library tool. 422 on an empty name or an
    empty/non-object ``server_config``. Returns ``{id, name}``."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A tool name is required.")
    if not isinstance(body.server_config, dict) or not body.server_config:
        raise HTTPException(status_code=422, detail="A server config object is required.")
    item_id = create_owner_tool(uuid.UUID(current_user.id), name, body.server_config)
    return {"id": str(item_id), "name": name}


@router.patch("/api/tool-library/{item_id}")
def edit_tool_library(
    item_id: str,
    body: ToolLibraryBody,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Update the owner's library tool by id. 422 as POST; 404 if not the owner's. Returns
    ``{id, name}``. Editing an item propagates LIVE to every referencing node's next run."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A tool name is required.")
    if not isinstance(body.server_config, dict) or not body.server_config:
        raise HTTPException(status_code=422, detail="A server config object is required.")
    if not update_owner_tool(uuid.UUID(current_user.id), item_id, name, body.server_config):
        raise HTTPException(status_code=404, detail="tool not found in your library")
    return {"id": item_id, "name": name}


@router.delete("/api/tool-library/{item_id}", status_code=204)
def remove_tool_library(
    item_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    """Remove the owner's tool by id (204, idempotent + owner-scoped). A node still holding a
    dangling reference to it simply skips + warns on its next run."""
    delete_owner_tool(uuid.UUID(current_user.id), item_id)
    return Response(status_code=204)


@router.get("/api/skill-library")
def list_skill_library(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's library skills (``{id, name, source, created_at}``), oldest first."""
    items = list_owner_skills(uuid.UUID(current_user.id))
    return {"skills": [_skill_library_to_dict(s) for s in items]}


@router.post("/api/skill-library")
def add_skill_library(
    body: SkillLibraryBody, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Add (or REPLACE) a library skill. 422 on an empty name or a source whose ``type`` is not one
    of inline/repo/project_rules (a ``library`` source is rejected — no nesting). Returns
    ``{id, name}``."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A skill name is required.")
    stype = body.source.get("type") if isinstance(body.source, dict) else None
    if stype not in _LIBRARY_SKILL_SOURCE_TYPES:
        raise HTTPException(
            status_code=422, detail="A skill source must be inline, repo, or project_rules."
        )
    item_id = create_owner_skill(uuid.UUID(current_user.id), name, body.source)
    return {"id": str(item_id), "name": name}


@router.patch("/api/skill-library/{item_id}")
def edit_skill_library(
    item_id: str,
    body: SkillLibraryBody,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Update the owner's library skill by id. 422 as POST; 404 if not the owner's."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="A skill name is required.")
    stype = body.source.get("type") if isinstance(body.source, dict) else None
    if stype not in _LIBRARY_SKILL_SOURCE_TYPES:
        raise HTTPException(
            status_code=422, detail="A skill source must be inline, repo, or project_rules."
        )
    if not update_owner_skill(uuid.UUID(current_user.id), item_id, name, body.source):
        raise HTTPException(status_code=404, detail="skill not found in your library")
    return {"id": item_id, "name": name}


@router.delete("/api/skill-library/{item_id}", status_code=204)
def remove_skill_library(
    item_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    """Remove the owner's library skill by id (204, idempotent + owner-scoped)."""
    delete_owner_skill(uuid.UUID(current_user.id), item_id)
    return Response(status_code=204)


# ---- Agentic memory (M-memory S1): the owner-scoped memory store behind /api/memories ----


class CreateMemoryRequest(BaseModel):
    """``POST /api/memories`` body. ``content`` (required) is the fact. The TIER is encoded by which
    of ``repo_key`` / ``node_id`` are set (account = neither, repo = repo_key only, node = both); a
    ``node_id`` without a ``repo_key`` is rejected 422. ``node_id`` is a plain uuid string (the
    authored origin node's id)."""

    content: str
    repo_key: str | None = None
    node_id: str | None = None
    pinned: bool = False
    # The directive force (M-memory S1b). Optional; defaults to the neutral 'context'. One of
    # require/prefer/allow/context/avoid/forbid — an invalid value is rejected 422.
    polarity: str = "context"


class UpdateMemoryRequest(BaseModel):
    """``PATCH /api/memories/{id}`` body — edit ``content`` (RE-embeds on change), ``pinned``,
    and/or ``polarity`` (a polarity-only edit does NOT re-embed). All optional; an omitted field is
    left unchanged."""

    content: str | None = None
    pinned: bool | None = None
    polarity: str | None = None


@router.post("/api/memories")
def create_memory_endpoint(
    body: CreateMemoryRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Create an owner-scoped memory: validate the tier, embed ``content`` (a real ``vector(1536)``
    via the gateway) and store the row. 422 on empty content / the invalid tier (node_id without
    repo_key) / a malformed node_id; 502 if the embedding provider call fails."""
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="content is required")
    node_uuid: uuid.UUID | None = None
    if body.node_id is not None:
        try:
            node_uuid = uuid.UUID(body.node_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="node_id must be a uuid") from None
    try:
        return memory.create_memory(
            uuid.UUID(current_user.id),
            content=content,
            repo_key=body.repo_key,
            node_id=node_uuid,
            pinned=body.pinned,
            polarity=body.polarity,
        )
    except (memory.InvalidTierError, memory.InvalidPolarityError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except GatewayError as exc:
        raise HTTPException(status_code=502, detail="the embedding call failed") from exc


@router.get("/api/memories")
def list_memories_endpoint(
    current_user: Annotated[UserOut, Depends(get_current_user)],
    repo_key: str | None = None,
    node_id: str | None = None,
    include_superseded: bool = False,
    status: str | None = None,
) -> dict:
    """List the owner's memories (oldest first), optionally filtered by ``repo_key`` and/or
    ``node_id``. Excludes non-active rows unless ``include_superseded=true``. M-memory S4: an
    explicit ``status`` (e.g. ``pending_review`` / ``rejected``) returns exactly that status — the
    surface the review UI fetches the quarantined + tombstoned rows through. Owner-scoped."""
    node_uuid: uuid.UUID | None = None
    if node_id is not None:
        try:
            node_uuid = uuid.UUID(node_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="node_id must be a uuid") from None
    rows = memory.list_memories(
        uuid.UUID(current_user.id),
        repo_key=repo_key,
        node_id=node_uuid,
        include_superseded=include_superseded,
        status=status,
    )
    return {"memories": rows}


@router.patch("/api/memories/{memory_id}")
def update_memory_endpoint(
    memory_id: str,
    body: UpdateMemoryRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Edit the owner's memory — ``content`` (RE-embeds on a real change) and/or ``pinned``. 422 on
    blank content; 404 if not the owner's; 502 if a re-embed's provider call fails."""
    if body.content is not None and not body.content.strip():
        raise HTTPException(status_code=422, detail="content cannot be blank")
    content = body.content.strip() if body.content is not None else None
    try:
        row = memory.update_memory(
            uuid.UUID(current_user.id),
            memory_id,
            content=content,
            pinned=body.pinned,
            polarity=body.polarity,
        )
    except memory.InvalidPolarityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except GatewayError as exc:
        raise HTTPException(status_code=502, detail="the embedding call failed") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return row


@router.delete("/api/memories/{memory_id}", status_code=204)
def delete_memory_endpoint(
    memory_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    """Hard-delete the owner's memory (204, idempotent + owner-scoped — deleting an absent/foreign
    id still 204s but never touches another owner's row)."""
    memory.delete_memory(uuid.UUID(current_user.id), memory_id)
    return Response(status_code=204)


@router.post("/api/memories/{memory_id}/pin")
def pin_memory_endpoint(
    memory_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Pin the owner's memory (hot — always injected later). 404 if not the owner's."""
    row = memory.set_pinned(uuid.UUID(current_user.id), memory_id, True)
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return row


@router.post("/api/memories/{memory_id}/unpin")
def unpin_memory_endpoint(
    memory_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Unpin the owner's memory. 404 if not the owner's."""
    row = memory.set_pinned(uuid.UUID(current_user.id), memory_id, False)
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return row


@router.post("/api/memories/{memory_id}/promote")
def promote_memory_endpoint(
    memory_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """M-memory S4: promote a ``pending_review``/``rejected`` memory to ``active`` VIA Consolidate
    (dedup / supersede-the-contradicted-active / activate — never a blind flip). 404 if not the
    owner's or not in a promotable state."""
    row = memory_review.promote(uuid.UUID(current_user.id), memory_id)
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return row


@router.post("/api/memories/{memory_id}/reject")
def reject_memory_endpoint(
    memory_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """M-memory S4: reject a ``pending_review``/``active`` memory
    — a TOMBSTONE (``status='rejected'``
    + ``invalid_at``), NOT a delete: it suppresses re-proposal of the same same-sign fact.
    404 if not
    the owner's or not in a rejectable state."""
    row = memory_review.reject(uuid.UUID(current_user.id), memory_id)
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")
    return row


class ReviewModeRequest(BaseModel):
    """``PATCH /api/memory/review-mode`` body — the per-owner review-before-persist toggle."""

    review_mode: bool


@router.get("/api/memory/review-mode")
def get_memory_review_mode(
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """The current account's memory review-mode flag (M-memory S4/S5a). ON routes every otherwise-
    ``active`` memory write to ``pending_review`` until the owner promotes it. Owner-scoped; reads
    ``users.memory_review_mode``. Singular ``/api/memory/`` path — never collides with the
    ``/api/memories/{id}`` store."""
    with db.session_scope() as session:
        user = session.get(User, uuid.UUID(current_user.id))
        if user is None:  # a now-deleted user (get_current_user already 401s first)
            raise HTTPException(status_code=401, detail="Not authenticated")
        return {"review_mode": user.memory_review_mode}


@router.patch("/api/memory/review-mode")
def set_memory_review_mode(
    body: ReviewModeRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Set the current account's memory review-mode flag — writes ``users.memory_review_mode`` for
    the owner (the ``session_scope`` commit on block exit persists it). Owner-scoped."""
    with db.session_scope() as session:
        user = session.get(User, uuid.UUID(current_user.id))
        if user is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user.memory_review_mode = body.review_mode
    return {"review_mode": body.review_mode}


def _run_summary(run: Run) -> dict:
    """A run as the dashboard's 'previous runs' list shows it (no costs/graph — loaded on open)."""
    return {
        "run_id": str(run.id),
        "idea": run.idea,
        "status": run.status,
        "created_at": run.created_at.isoformat(),
        "repo_path": run.repo_path,
    }


@router.get("/api/runs")
def list_runs(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's runs as summaries (newest first) — the dashboard's 'previous runs'.
    Owner-scoped: only ``runs.owner_id == current_user`` rows; A-B / snapshot runs the user launched
    are theirs too (all created with their owner_id)."""
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(Run)
                .where(Run.owner_id == uuid.UUID(current_user.id))
                .order_by(Run.created_at.desc())
            )
            .scalars()
            .all()
        )
        return {"runs": [_run_summary(r) for r in rows]}


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


def _require_library_team(session, team_id: str, owner_id: uuid.UUID) -> TeamGraph:
    """Resolve a library ``TeamGraph`` by id within ``session`` or raise: 400 on a malformed id, 404
    if the id is unknown, not a library team, OR not owned by ``owner_id`` (M-accounts Slice B) — so
    a run-snapshot clone / A-B graph / smoke graph (``is_library = false``) AND another account's
    library team are never readable, editable, or deletable via the team API. This is the single
    owner-scope chokepoint every team-edit endpoint hangs off."""
    try:
        tid = uuid.UUID(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid team id") from exc
    graph = session.execute(select(TeamGraph).where(TeamGraph.id == tid)).scalar_one_or_none()
    if graph is None or not graph.is_library or graph.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="library team not found")
    return graph


@router.get("/api/templates")
def get_templates() -> dict:
    """The curated starter templates the New-team picker offers (``{template, name, description}``);
    the FE renders the picker from this, never a hardcoded list."""
    return {"templates": list_templates()}


@router.get("/api/teams")
def get_teams(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The CURRENT account's library teams as summaries (id / name / created_at / node_count),
    oldest first (M-accounts Slice B: per-owner). Seeds one team if THIS account's library is empty
    so a fresh account still lands ≥1 team (the §13 S2 anti-dead-zone posture, per-owner). Library
    teams ONLY + owner-scoped: run-snapshot clones / A-B / smoke graphs and other accounts' teams
    never appear."""
    owner_id = uuid.UUID(current_user.id)
    seed_library_if_empty(owner_id)
    return {"teams": list_library_teams(owner_id)}


@router.post("/api/teams")
def create_team(
    body: CreateTeamRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Create a new library team OWNED by the current account — from a starter template
    (drop-and-edit), or, when ``template == "blank"`` (P1.8d), from the minimal valid skeleton (root
    thinker → Ship) the user wires up from scratch. 400 on an unknown ``template`` key. Returns the
    new team's summary; the FE then loads its graph + makes it current."""
    owner_id = uuid.UUID(current_user.id)
    if body.template == "blank":
        return get_team_summary(create_blank_team(body.name, owner_id))
    try:
        team_graph_id = create_team_from_template(body.template, body.name, owner_id)
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
def get_team_graph(
    team_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """A library team's nodes + edges in the canvas's node/edge shape and INCLUDING each node's
    editable ``prompt`` — but with NO run state (the authored team is not running). 400 on a
    malformed id; 404 if the id is not a library team. Shares the node/edge serialization with
    ``GET /api/runs/{run_id}/graph`` (``_node_base_dict`` / ``_edge_to_dict``).

    M2: each node also carries a ``last_run`` brief — the latest invocation of any CLONE of that
    authored node, across all the team's runs (or ``None`` if it never ran). This is the AUTHORING
    endpoint ONLY; the run-view endpoint ``get_run_graph`` is unchanged."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
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
def update_team_node(
    team_id: str,
    node_id: str,
    body: UpdateTeamNodeRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Persist an edited library-team node. For an agent/completion node: its ``prompt`` + ``model``
    and (P1.8c) optionally its ``capability`` (``"thinker"`` -> ``kind=completion``/``engine=null``;
    ``"worker"`` -> ``kind=agent``/``engine=openhands``). For a **gate** node (M-rails C8): its
    editable ``config`` (``gate_kind``/``title``/``description``, merged into the existing config).
    For a **terminal** node (M-endpoint-editable): its ``terminal_kind`` (``ship``/``stop``),
    written into ``config`` AND synced onto ``role_name``. Validates the node belongs to
    ``team_id`` AND that ``team_id`` is a library team. 400 on a malformed id; 404 if the team is
    not a library team or the node is not one of its nodes; 409 if ``capability="worker"`` is
    asked of the ROOT node (the first node scopes the work — it must stay a thinker, the one
    executor invariant); 422 if an agent node's ``prompt``/``model`` is missing. Returns the
    updated node."""
    try:
        nid = uuid.UUID(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid node id") from exc
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
        node = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one_or_none()
        if node is None or node.team_graph_id != graph.id:
            raise HTTPException(status_code=404, detail="node not found in the team")
        if node.kind == "terminal":
            # M-endpoint-editable: a terminal's disposition is editable (ship ↔ stop). Merge into a
            # FRESH config dict so SQLAlchemy flags the JSONB column dirty (in-place mutation does
            # NOT persist). ``role_name`` is synced to ``terminal_kind`` so a flipped endpoint is
            # byte-identical to a freshly-dropped one (trajectory ledger joins on role_name).
            # Omitted ``terminal_kind`` leaves config + role_name byte-unchanged; never fall through
            # into the agent branch (which would 422 on missing prompt/model).
            if "terminal_kind" in body.model_fields_set and body.terminal_kind is not None:
                cfg = dict(node.config or {})
                cfg["terminal_kind"] = body.terminal_kind
                node.config = cfg
                node.role_name = body.terminal_kind
            session.flush()
            return _node_base_dict(node)
        if node.kind == "gate":
            # M-rails C8: a gate's config is editable (its gate_kind + human copy) — prompt/model/
            # capability/tools do not apply to a control primitive. Merge the provided fields into a
            # FRESH config dict (a new object so SQLAlchemy flags the JSONB column dirty) so a
            # partial edit preserves the rest.
            cfg = dict(node.config or {})
            if body.gate_kind is not None:
                cfg["gate_kind"] = body.gate_kind
            if body.title is not None:
                cfg["title"] = body.title
            if body.description is not None:
                cfg["description"] = body.description
            # M-rails C9: the parameterized guardrail configs (merged only when sent). The FE sends
            # ``output_schema``; it is stored under the config key ``schema`` the executor reads.
            if body.forbidden_paths is not None:
                cfg["forbidden_paths"] = body.forbidden_paths
            if body.output_file is not None:
                cfg["output_file"] = body.output_file
            if body.output_schema is not None:
                cfg["schema"] = body.output_schema
            node.config = cfg
            session.flush()
            return _node_base_dict(node)
        # ---- agent / completion: the prompt/model[/capability/tools] editor ----
        if body.prompt is None or body.model is None:
            raise HTTPException(
                status_code=422, detail="prompt and model are required for an agent node"
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
        # M-unify U1: the edits toggle. An EXPLICIT ``edits_allowed`` WINS (``model_fields_set``);
        # else a ``capability`` (kind) change SYNCS it to ``kind == 'agent'`` (the FE drives kind
        # via
        # capability until U3); neither ⇒ unchanged. Ordered AFTER the capability flip so the sync
        # reads the NEW kind.
        if "edits_allowed" in body.model_fields_set:
            node.edits_allowed = bool(body.edits_allowed)
        elif body.capability is not None:
            node.edits_allowed = node.kind == "agent"
        # M-tools C7.A (SHARED CONTRACT S2): persist tools + skills with CLEAR semantics —
        # ``model_fields_set`` distinguishes "field absent (omitted) -> leave unchanged" from "field
        # present-and-null -> set NULL (clear)". This is the ONLY change from the C7.0 scaffold's
        # is-not-None guard, and it's what lets the real editors clear a set config to NULL.
        if "tool_config" in body.model_fields_set:
            node.tool_config = body.tool_config
        if "skills" in body.model_fields_set:
            node.skills = body.skills
        # M-memory: the per-node agent-remember toggle lives in the EXISTING config JSONB. Merge it
        # into a FRESH config dict (a new object so SQLAlchemy flags the JSONB column dirty) ONLY
        # when SENT (``model_fields_set``) — preserving any existing config (e.g. ``model_config``).
        # Omitted ⇒ ``node.config`` byte-unchanged (the C7.A clear-semantics pattern).
        if "memory_remember_enabled" in body.model_fields_set:
            cfg = dict(node.config or {})
            cfg["memory_remember_enabled"] = bool(body.memory_remember_enabled)
            node.config = cfg
        session.flush()
        return _node_base_dict(node)


@router.delete("/api/teams/{team_id}")
def delete_team(team_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """Delete a library team AND tear down every one of its runs. FIRST stops any in-flight run (the
    shared ``cancel_run_core`` — ``DBOS.cancel_workflow`` + ``Run.status='cancelled'`` + close its
    pending tasks), THEN hard-deletes each run's run-scoped rows + the ``Run`` + its clone snapshot
    graph, THEN the library team (its nodes/edges cascade). 400 on a malformed id; 404 if the id is
    not the current account's library team (a run-snapshot clone / A-B graph / another account's
    team can't be deleted here). Owner-scoped: only this account's team + its own runs are touched.

    (Previously a no-op that left a ``Run`` executing on its immutable clone — a zombie run that
    kept spending under a deleted team. Deleting a team now stops + removes its runs, so nothing
    tied to a deleted team keeps running, spending, or existing.)"""
    owner_id = uuid.UUID(current_user.id)
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, owner_id)
        graph_id = graph.id
    delete_library_team_and_runs(graph_id)
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


def _build_node(
    graph_id: uuid.UUID, body: CreateNodeRequest, held_providers: set[str] | None = None
) -> AgentNode:
    """Construct (unpersisted) the ``AgentNode`` for a create-node request — map the canvas
    vocabulary (thinker/worker/gate/terminal + an optional role preset) onto the columns. A
    thinker -> ``completion``/no engine; a worker -> ``agent``/``openhands`` (the P1.8c capability
    pair). Raises 400 on a malformed request (a preset that contradicts ``node_kind``; a terminal
    with no ``terminal_kind``).

    M-accounts Slice C: when ``body.model`` is ABSENT, the model defaults to one whose provider the
    OWNER already holds (``account_default_model(held_providers)``) — falling back to today's
    hardcoded default ONLY when the account holds no mapped provider. An explicit ``body.model`` is
    always preserved. ``held_providers`` defaults ``None`` (treated as empty ⇒ legacy default) so a
    non-account caller keeps the prior behavior; the model stays mandatory (never blank)."""
    position = body.position or {}
    held = held_providers or set()
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
            model=body.model or account_default_model(held) or get_settings().default_model,
            engine=None,
            prompt=preset["prompt"] if preset else (body.prompt if body.prompt is not None else ""),
            position=position,
        )
    if body.node_kind == "worker":
        legacy_default = reviewer_model() if body.preset == "reviewer" else engineer_model()
        return AgentNode(
            team_graph_id=graph_id,
            role_name=preset["role_name"] if preset else "worker",
            kind="agent",
            model=body.model or account_default_model(held) or legacy_default,
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
def create_team_node(
    team_id: str,
    body: CreateNodeRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Add a node to a library team's canvas (P1.8d). 400 on a malformed id / request; 404 if
    ``team_id`` is not a library team (a run snapshot / A-B graph is never editable). Returns the
    created node in the canvas shape."""
    owner_id = uuid.UUID(current_user.id)
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, owner_id)
        # M-accounts Slice C: the owner's configured providers gate the account-aware create default
        # (used only when body.model is absent). Same table/owner-scope the dashboard reads.
        held_providers = set(
            session.execute(
                select(ProviderCredential.provider).where(ProviderCredential.owner_id == owner_id)
            ).scalars()
        )
        node = _build_node(graph.id, body, held_providers)
        session.add(node)
        session.flush()
        return _node_base_dict(node)


@router.delete("/api/teams/{team_id}/nodes/{node_id}")
def delete_team_node(
    team_id: str, node_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Delete a library-team node; its edges cascade (FK ``ondelete=CASCADE``). 400 on a malformed
    id; 404 if the team is not a library team or the node is not one of its nodes. Safe: runs use
    immutable clone snapshots, so deleting a library node never touches a past run's rows."""
    try:
        nid = uuid.UUID(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid node id") from exc
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
        node = session.execute(select(AgentNode).where(AgentNode.id == nid)).scalar_one_or_none()
        if node is None or node.team_graph_id != graph.id:
            raise HTTPException(status_code=404, detail="node not found in the team")
        session.delete(node)
    return {"node_id": node_id, "deleted": True}


@router.post("/api/teams/{team_id}/edges")
def create_team_edge(
    team_id: str,
    body: CreateEdgeRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
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
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
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
def delete_team_edge(
    team_id: str, edge_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Delete a library-team edge. 400 on a malformed id; 404 if the team is not a library team or
    the edge is not one of its edges."""
    try:
        eid = uuid.UUID(edge_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid edge id") from exc
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
        edge = session.execute(select(Edge).where(Edge.id == eid)).scalar_one_or_none()
        if edge is None or edge.team_graph_id != graph.id:
            raise HTTPException(status_code=404, detail="edge not found in the team")
        session.delete(edge)
    return {"edge_id": edge_id, "deleted": True}


@router.post("/api/teams/{team_id}/positions")
def update_team_positions(
    team_id: str,
    body: PositionsRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Persist canvas layout after a drag (P1.8d): a ``{node_id: {x, y}}`` batch. 400 on a malformed
    id; 404 if the team is not a library team. Off-team / malformed entries are ignored (layout is
    best-effort, never a hard error). Returns the ids actually updated."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
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
def validate_team(
    team_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """The holistic graph-validity verdict for a library team (P1.8d) — the SAME pure
    :func:`validate_graph` the ``create_run`` guard refuses an invalid launch with, so the canvas's
    Run-disabled UX never disagrees with the server. 400 on a malformed id; 404 if not a library
    team. Returns ``{errors, warnings, runnable}``."""
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, uuid.UUID(current_user.id))
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
def get_run_tasks(run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """Tasks-for-Human items for a run, oldest first (what the P1.1b panel draws). M-accounts Slice
    B: owner-scoped (404 unless the run belongs to the current user)."""
    with db.session_scope() as session:
        _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        rows = (
            session.execute(
                select(HumanTask).where(HumanTask.run_id == run_id).order_by(HumanTask.id)
            )
            .scalars()
            .all()
        )
        return {"run_id": run_id, "tasks": [_humantask_to_dict(t) for t in rows]}


@router.post("/api/runs/{run_id}/tasks/{task_id}/resolve")
def resolve_task(
    run_id: str,
    task_id: int,
    body: ResolveTaskRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Resolve a pending gate task by **signaling** the waiting workflow. M-accounts Slice B:
    owner-scoped (404 unless the run belongs to the current user).

    This endpoint is a pure signal: it validates the task is pending and calls
    ``DBOS.send``. The workflow's ``close_gate_step`` is the single writer that
    marks the ``HumanTask`` resolved, so the table can't disagree with the run.
    """
    with db.session_scope() as session:
        _require_owned_run(session, run_id, uuid.UUID(current_user.id))
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
def acknowledge_task(
    run_id: str, task_id: int, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Acknowledge (dismiss) a non-blocking, topic-less ``low_nudge`` task — the drawer's
    Low/nudges side (P1.5b, e.g. the 80%-of-cap ``budget_threshold`` nudge). M-accounts Slice B:
    owner-scoped (404 unless the run belongs to the current user).

    Unlike a gate task, **nothing waits** on a nudge, so this marks it resolved DIRECTLY
    (NO ``DBOS.send``). 404 if no such task for the run; 409 if the task is a gate (it is
    ``blocking`` OR carries a ``topic`` — those must go through ``/resolve``, which signals
    the workflow); 409 if already resolved."""
    with db.session_scope() as session:
        _require_owned_run(session, run_id, uuid.UUID(current_user.id))
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
def cancel_run(run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """Kill switch: cancel the run's workflow and mark the run ``cancelled``. M-accounts Slice B:
    owner-scoped (404 unless the run belongs to the current user).

    The stop logic is the SHARED ``cancel_run_core`` (also used by team deletion, so both stop a run
    the same way): ``DBOS.cancel_workflow`` flips the workflow to ``CANCELLED`` (recovery's
    PENDING-only scan never resurrects it, and its next step/recv boundary aborts); the workflow may
    run no further step to record the status, so ``Run.status`` is set ``cancelled`` directly,
    and the run's pending gate tasks are closed (``resolution="cancelled"``) so a dead run leaves
    nothing actionable. An **already-terminal** run is left untouched — cancelling a just-completed
    run can't flip a ``completed`` run's workflow to ``CANCELLED``.
    """
    with db.session_scope() as session:
        _require_owned_run(session, run_id, uuid.UUID(current_user.id))

    cancel_run_core(run_id)

    with db.session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one_or_none()
        run_status = run.status if run is not None else None

    workflow_status = DBOS.get_workflow_status(run_id)
    return {
        "run_id": run_id,
        "status": run_status,
        "workflow_status": workflow_status.status if workflow_status is not None else "NOT_FOUND",
    }

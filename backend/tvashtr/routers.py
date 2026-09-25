"""HTTP surface for the model gateway + document layer (P0.2).

Kept in its own router module so ``main.py`` stays focused on app/DBOS wiring.
GET endpoints return plain dicts (matching the P0.1 style) to avoid coupling the
API to ORM/gateway types.
"""

import logging
import os
import uuid
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal

from dbos import DBOS, SetWorkflowID
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, model_validator
from sqlalchemy import func, select, update

from tvashtr import db
from tvashtr.auth import UserOut, _store_installation, get_current_user
from tvashtr.config import get_settings
from tvashtr.control_plane import (
    github_app,
    github_targets,
    memory,
    memory_distill,
    memory_review,
    provider_models,
    run_views,
)
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane import toolkit
from tvashtr.control_plane.context_compiler import resolve_fallback_model, resolve_multimodal
from tvashtr.control_plane.credential_gate import (
    RUNNER_SUBSCRIPTIONS,
    desktop_routed_subscriptions,
    missing_providers_for_launch,
)
from tvashtr.control_plane.credentials import (
    NoCredentialError,
    encrypt_secret,
    held_provider_slugs,
    provider_for_model,
    resolve_owner_api_key,
    validate_provider_slug,
)
from tvashtr.control_plane.doc_writer import generate_doc
from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.mcp_secrets import delete_owner_mcp_secret
from tvashtr.control_plane.resolution_warnings import record_resolution_warning
from tvashtr.control_plane.run_diff import compute_run_diff
from tvashtr.control_plane.run_explain import build_system_prompt
from tvashtr.control_plane.team_run import run_team
from tvashtr.control_plane.teams import (
    ARCHITECT_PROMPT,
    ENGINEER_PROMPT,
    PM_PROMPT,
    REVIEWER_PROMPT,
    account_default_model,
    blank_template,
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
    list_team_runs,
    list_templates,
    rename_library_team,
    reviewer_model,
)
from tvashtr.control_plane.worktree import repo_inspect, repo_subpaths, subpath_is_tracked_dir
from tvashtr.control_plane.domains import (
    create_domain,
    create_document,
    delete_domain,
    delete_document,
    get_domain,
    list_domain_templates,
    list_domains,
    list_documents as list_domain_documents,
    update_domain,
)
from tvashtr.control_plane.domain_files import MAX_UPLOAD_BYTES
from tvashtr.control_plane.domain_ingest import ingest_domain, normalize_embedding_model
from tvashtr.control_plane.domain_ask import (
    DomainAskError,
    ask_domain,
    list_domain_messages,
    retrieve_domain,
)
from tvashtr.control_plane.domain_eval import (
    create_eval_case,
    delete_eval_case,
    latest_eval_run_for_owner,
    list_eval_cases,
    run_domain_eval,
)
from tvashtr.documents.service import (
    add_version,
    get_document_with_versions,
    list_documents,
    list_documents_for_run,
)
from tvashtr.gateway import CompletionRequest, GatewayError, complete, multimodal_supported
from tvashtr.metering import record_cost
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    Document,
    DocumentVersion,
    Edge,
    EngineSubscriptionStatus,
    GithubInstallation,
    HumanTask,
    ProviderCredential,
    Run,
    RunArtifact,
    RunEvent,
    RunWarning,
    TeamGraph,
    User,
)

logger = logging.getLogger("tvashtr.routers")

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
    # M-h1b (HOSTED mode): the ``owner/name`` of one of the account's OWN GitHub repos to run on.
    # The backend clones it server-side, runs, and opens a real PR. Hosted mode ONLY (422 else),
    # mutually exclusive with ``repo_path`` (the free-text path door is fenced off in hosted mode).
    # Omitted (every self-hosted / greenfield caller) ⇒ the create is byte-for-byte unchanged.
    github_repo: str | None = None
    # M-subs-desktop: the launch came from Tvashtr Desktop. Its Claude/Grok nodes may then run on
    # the owner's OWN Desktop with the owner's own CLI sign-in (a FRESH connected subscription
    # counts in place of an API key — see ``credential_gate``). False (every existing caller) ⇒ the
    # hosted pre-flight + run are byte-for-byte unchanged.
    desktop_target: bool = False
    # Revamp P8: the finished run this launch retries (one of the caller's; 422 otherwise). The
    # failed run then leaves Home's "Needs you".
    retry_of_run_id: str | None = None


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

    For a **domain_query** node (PolyRAG Phase 4a): optional ``domain_id`` (bound corpus; clear with
    null/empty via ``model_fields_set``) and ``prompt`` (the ``{idea}`` template). ``model`` /
    ``capability`` do not apply.

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
    # M-docs: per-node doc routing in the EXISTING config JSONB (no migration). ``writes_to`` is
    # ONE document name the node authors; ``reads_from`` is a LIST of names whose documents feed the
    # node's context. Merged into config only when SENT (``model_fields_set``); omitted ⇒ config
    # unchanged. Empty by default — a node with neither behaves exactly as today.
    writes_to: str | None = None
    reads_from: list[str] | None = None
    # Per-node capabilities (Session A): three more optional settings in the SAME config JSONB (no
    # migration). Merged only when SENT (``model_fields_set``); omitted ⇒ config unchanged, so
    # with none of them set is byte-identical to before this slice.
    #   * ``fallback_model`` — the auto-failover slug used ONCE on a PRIMARY-provider HARD failure.
    #   * ``multimodal`` — the per-node multimodal opt-in (bounded by the chosen model).
    # ``output_schema`` is REUSED from the guardrail block above: it is consumed by the GATE branch
    # (stored as ``schema``) and, for an agent/completion node, by the agent branch (stored as
    # ``output_schema``) — the two branches never both run, so one wire field serves both.
    # ``dict | None`` is what rejects a non-object schema with 422.
    fallback_model: str | None = None
    multimodal: bool | None = None
    # PolyRAG Phase 4a: domain_query bound corpus id — model_fields_set clear/set.
    domain_id: str | None = None  # domain_query — model_fields_set clear/set


class CreateTeamRequest(BaseModel):
    """Create a library team from a starter template (P1.8b team library): the ``template`` key
    (one of ``GET /api/templates``) + a user-chosen ``name``. The team is materialized from the
    code-resident builder and flipped to a library team — a drop-and-edit preset. P1.8d: the
    sentinel ``template == "blank"`` seeds the minimal valid skeleton (root thinker → Ship) instead
    of a catalog builder — a from-scratch starting point the user wires up."""

    template: str
    name: str


class CreateDomainRequest(BaseModel):
    template: str
    name: str


class UpdateDomainRequest(BaseModel):
    name: str | None = None
    config: dict | None = None


class DomainAskRequest(BaseModel):
    question: str


class DomainRetrieveRequest(BaseModel):
    query: str
    top_k: int | None = None


class DomainEvalCaseCreate(BaseModel):
    question: str
    expected_answer: str | None = None
    expected_citation_doc_ids: list[str] = []
    expected_keywords: list[str] = []
    ordinal: int = 0


class RenameTeamRequest(BaseModel):
    """Rename a library team: the new ``name``. Trimmed + required — enforced in
    ``rename_library_team`` (the core), so the rule holds for every caller, not just this endpoint;
    a blank/whitespace-only name comes back 422."""

    name: str


class CreateNodeRequest(BaseModel):
    """Add a node to a library team's canvas (P1.8d topology editing). ``node_kind`` is the canvas
    vocabulary the palette offers: ``thinker`` (a ``completion`` node) / ``worker`` (an ``agent``
    node, ``openhands`` engine) — the P1.8c capability pair — plus the control primitives ``gate``
    and ``terminal``, and PolyRAG ``domain_query`` (corpus-bound Q&A; no model/engine). ``preset``
    (optional, thinker/worker only) seeds a pre-filled-but-editable role node from the ``teams.py``
    prompt constants (PM / Architect / Engineer / Reviewer); without it a blank primitive is dropped
    (empty ``prompt``). ``terminal_kind`` is REQUIRED for a terminal (ship vs stop is a real choice);
    ``title``/``description`` configure a gate; ``domain_id``/``prompt`` configure a domain_query
    (default prompt ``{idea}``). ``position`` is the canvas drop point (defaults to the origin, then
    auto-layout/drag persists real coords)."""

    node_kind: Literal["thinker", "worker", "gate", "terminal", "domain_query"]
    preset: Literal["pm", "architect", "engineer", "reviewer"] | None = None
    prompt: str | None = None
    model: str | None = None
    position: dict | None = None
    title: str | None = None
    description: str | None = None
    terminal_kind: Literal["ship", "stop"] | None = None
    domain_id: str | None = None  # domain_query only


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
        # M-docs: the run-scoped document NAME (None for legacy / non-run documents) — the run-view
        # picker labels each document by it ("spec", "design", …).
        "name": doc.name,
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
def get_costs(
    current_user: Annotated[UserOut, Depends(get_current_user)], workflow_id: str | None = None
) -> dict:
    """Return the current account's cost rows — all of them, or just those for ``workflow_id``.
    Owner-scoped (revamp): only rows of the caller's own runs; ledger rows with no run (embeddings,
    the doc-writer spike) belong to no account and are never returned."""
    owned_runs = select(Run.workflow_id).where(Run.owner_id == uuid.UUID(current_user.id))
    with db.session_scope() as session:
        stmt = (
            select(CostRecord).where(CostRecord.workflow_id.in_(owned_runs)).order_by(CostRecord.id)
        )
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
        # M-h1b: the hosted-GitHub target (owner/name) + the opened PR url — both NULL for a local
        # brownfield or greenfield run. The RunBanner shows "Opened PR ->" when pr_url is set.
        "github_repo": run.github_repo,
        "pr_url": run.pr_url,
        "cost_total_usd": float(run.cost_total_usd) if run.cost_total_usd is not None else None,
        # A/B pairing (P1.5c §14.2): additive, NULL for an ordinary standalone run. Two runs
        # sharing ``pair_id`` are the A/B; ``pair_label`` is the config side. The §14.3
        # comparison view + the FE read these (existing keys/shapes unchanged).
        "pair_id": str(run.pair_id) if run.pair_id else None,
        "pair_label": run.pair_label,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
        # Revamp P3: status_group, target, pr_number, budget_cap_usd, desktop_target,
        # library_team_id, retry_of_run_id (additive; GET /api/runs/{id} adds the computed ones).
        **run_views.run_fields(run),
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
    # M-h1b: FENCE in hosted mode — /api/repo/inspect is the reconnaissance half of the free-text
    # path door (it leaks branch names + file counts for any server path), closed alongside the
    # create_run repo_path fence (§3). Self-hosted (the default) is byte-unchanged.
    if get_settings().hosted_mode:
        raise HTTPException(status_code=422, detail="repo inspection is disabled in hosted mode")
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


def _missing_provider_credentials(
    owner_id: uuid.UUID, team_graph_id: str
) -> tuple[list[str], list[str]]:
    """The launch pre-flight (M-accounts Slice B): the sorted distinct providers across the team's
    node models that ``owner_id`` has NO credential for, AND the sorted role names of the nodes that
    need them. Empty providers ⇒ the owner can run every node; non-empty ⇒ refuse the launch (422).
    gate/terminal nodes carry no model and are skipped. Reuses the ONE held-provider rule
    (``credentials.held_provider_slugs``), so "held" is defined in one place (M-runnable). The node
    node names let the refusal say WHICH nodes to fix instead of only which provider is missing."""
    with db.session_scope() as session:
        rows = session.execute(
            select(AgentNode.role_name, AgentNode.model).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id)
            )
        ).all()
    models = [m for _rn, m in rows if m]
    if not models:
        return [], []
    # M-subs-desktop: the ONE shared launch rule (hosted: only a BYOK key covers a provider) — the
    # same function the desktop pre-flight uses and the FE Run gate mirrors case-for-case.
    missing = missing_providers_for_launch(
        models, byok=held_provider_slugs(owner_id), fresh_subscriptions=set(), desktop_target=False
    )
    if not missing:
        return [], []
    nodes = sorted({rn for rn, m in rows if m and provider_for_model(m) in missing})
    return missing, nodes


def _desktop_launch_credentials(
    owner_id: uuid.UUID, team_graph_id: str
) -> tuple[list[str], list[str], list[str], set[str]]:
    """M-subs-desktop: the DESKTOP launch pre-flight — ``(missing_providers, missing_nodes,
    routed_subscriptions, fresh_subscriptions)``. A FRESH connected subscription (mirror connected
    AND the owner's Desktop runner polled recently, A3) covers its provider in place of an API key,
    and is preferred over a held key: its nodes run on the owner's Desktop."""
    with db.session_scope() as session:
        rows = session.execute(
            select(AgentNode.role_name, AgentNode.model).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id)
            )
        ).all()
    models = [m for _rn, m in rows if m]
    fresh = desktop_jobs.fresh_subscription_ids(owner_id)
    missing = missing_providers_for_launch(
        models, byok=held_provider_slugs(owner_id), fresh_subscriptions=fresh, desktop_target=True
    )
    nodes = sorted({rn for rn, m in rows if m and provider_for_model(m) in missing})
    routed = desktop_routed_subscriptions(models, fresh_subscriptions=fresh, desktop_target=True)
    return missing, nodes, routed, fresh


def _desktop_missing_detail(
    owner_id: uuid.UUID, providers: list[str], nodes: list[str]
) -> dict:
    """The 422 for a Desktop launch that still lacks a credential — says what would fix it."""
    stale = sorted(
        _MODEL_PROVIDER_TO_SUB[p]
        for p in providers
        if _MODEL_PROVIDER_TO_SUB.get(p) in RUNNER_SUBSCRIPTIONS
        and _MODEL_PROVIDER_TO_SUB[p] in _connected_subscription_ids(owner_id)
    )
    msg = "you have no API key for: " + ", ".join(providers) + (
        " — needed by " + ", ".join(nodes) if nodes else ""
    )
    if stale:
        msg += (
            ". Tvashtr Desktop hasn't checked in recently for your "
            + ", ".join(s.capitalize() for s in stale)
            + " subscription — make sure Tvashtr Desktop is open and signed in, then retry."
        )
    else:
        msg += ". Connect Claude or Grok in Tvashtr Desktop (Engines) or add an API key."
    return {
        "message": msg,
        "missing_providers": providers,
        "missing_nodes": nodes,
        "subscription_only": False,
        "desktop_target": True,
    }


_MODEL_PROVIDER_TO_SUB = {
    "anthropic": "claude",
    "xai": "grok",
    "grok": "grok",
    "openai": "codex",
}


def _connected_subscription_ids(owner_id: uuid.UUID) -> set[str]:
    """Engine providers the owner has a connected status-only subscription mirror for.

    Used only to choose clearer Fly preflight copy when BYOK is missing but a Desktop
    subscription would cover the same provider — never accepted as a Fly credential.
    """
    with db.session_scope() as session:
        rows = session.execute(
            select(EngineSubscriptionStatus.provider).where(
                EngineSubscriptionStatus.owner_id == owner_id,
                EngineSubscriptionStatus.connected.is_(True),
            )
        ).all()
        return {r[0] for r in rows}


def _missing_credentials_detail(
    providers: list[str], nodes: list[str], *, subscription_only: bool = False
) -> dict:
    """The 422 refusal payload for a launch the owner has no key for — names the missing PROVIDERS
    (the existing ``missing_providers`` contract) AND the offending NODES (M-runnable), with both in
    the human ``message`` the FE launch banner renders, so the user learns WHICH nodes to fix rather
    than only which provider is missing.

    When every missing BYOK provider is coverable by a connected subscription mirror, set
    ``subscription_only`` so the message points at API key or Desktop local run — never treat the
    mirror as a Fly credential.
    """
    if subscription_only:
        msg = (
            "Hosted runs need an API key for: "
            + ", ".join(providers)
            + (" — needed by " + ", ".join(nodes) if nodes else "")
            + ". Your subscription covers local Desktop runs — add a key or run locally on Desktop."
        )
    else:
        msg = "you have no API key for: " + ", ".join(providers) + (
            " — needed by " + ", ".join(nodes) if nodes else ""
        )
    return {
        "message": msg,
        "missing_providers": providers,
        "missing_nodes": nodes,
        "subscription_only": subscription_only,
    }


def _unservable_node_models(
    owner_id: uuid.UUID, team_graph_id: str, skip_providers: frozenset[str] = frozenset()
) -> tuple[list[str], list[str]]:
    """M-live: the sorted distinct node models the PROVIDER ITSELF no longer serves, AND the sorted
    role names of the nodes carrying them. The sibling of :func:`_missing_provider_credentials`.

    It runs AFTER the credential check, and the order is not cosmetic: without a key we cannot even
    ask a provider what it serves, so a keyless account must be told to add a key rather than that
    its model is dead. Gate/terminal nodes carry no model and are skipped, exactly as the
    credential check already does.

    FAILS OPEN throughout. ``provider_models`` answers ``None`` for anything short of a parsed list
    that positively lacks the id, and a key that cannot be resolved is skipped rather than treated
    as a failure — so a provider outage, a proxy, or an offline laptop can never turn into "you
    cannot launch anything". A model is refused only on a confident negative.
    """
    with db.session_scope() as session:
        rows = session.execute(
            select(AgentNode.role_name, AgentNode.model).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id)
            )
        ).all()
    models = {m for _rn, m in rows if m}
    if not models:
        return [], []

    unservable: set[str] = set()
    for model in models:
        if provider_for_model(model) in skip_providers:
            # M-subs-desktop: a node that runs on the owner's own CLI — the CLI decides its models.
            continue
        try:
            api_key = resolve_owner_api_key(owner_id, model)
        except NoCredentialError:
            continue  # the credential check owns this case; never double-report it
        if provider_models.is_definitely_unservable(model, api_key):
            unservable.add(model)
    if not unservable:
        return [], []
    nodes = sorted({rn for rn, m in rows if m in unservable})
    return sorted(unservable), nodes


def _unservable_models_detail(models: list[str], nodes: list[str]) -> dict:
    """The 422 refusal payload for a model its provider has retired.

    Deliberately the SAME contract as :func:`_missing_credentials_detail` — ``message`` plus
    ``missing_nodes`` — so the FE launch banner and any node highlighting keep working untouched;
    ``unservable_models`` is the only new field. ``missing_providers`` stays present and empty
    because nothing is missing a key: the shape must not change under the FE's feet.
    """
    provider_phrase = ", ".join(sorted({provider_for_model(m) for m in models}))
    node_phrase = " — used by " + ", ".join(nodes) if nodes else ""
    return {
        "message": (
            ", ".join(models)
            + f" is no longer served by {provider_phrase}"
            + node_phrase
            + ". Pick a current model on those nodes."
        ),
        "missing_providers": [],
        "missing_nodes": nodes,
        "unservable_models": models,
    }


# M-h3: the statuses that HOLD a sandbox. ``awaiting_human`` counts — M-h2b suspends the microVM at
# a gate (so it stops billing CPU/RAM), but the machine still exists: a run parked at a gate has not
# given its slot back. The terminals (completed/failed/rejected/cancelled/over_budget) have no
# machine and must never consume capacity.
_IN_FLIGHT_STATUSES = ("pending", "running", "awaiting_human")


def _enforce_run_ceilings(owner_id: uuid.UUID, launching: int = 1) -> None:
    """Refuse (429) a launch that would breach one of the three M-h3 HOSTED run ceilings.

    A hosted run is BYOK for the LLM — the owner's own key pays for tokens — so what the OPERATOR
    pays for is a Fly microVM per in-flight run. These three caps bound that: the owner's own
    concurrency, the fleet-wide concurrency, and the owner's rolling-24h launch rate.

    ``launching`` is how many runs THIS request creates — 1 for POST /api/runs, 2 for the
    POST /api/ab-runs pair — so an A/B launch cannot slip a second sandbox past a cap that had room
    for only one. Checked most-specific first (the owner's concurrency, then the fleet, then their
    rate) so the message names the limit the caller can actually act on.

    A no-op unless ``hosted_mode``: self-hosted runs on the operator's OWN machine, so there is
    nothing to bound and the create path stays byte-identical to the pre-M-h3 build.
    """
    settings = get_settings()
    if not settings.hosted_mode:
        return

    since = datetime.now(UTC) - timedelta(hours=24)
    with db.session_scope() as session:
        owner_in_flight = session.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner_id, Run.status.in_(_IN_FLIGHT_STATUSES))
        ).scalar_one()
        fleet_in_flight = session.execute(
            select(func.count()).select_from(Run).where(Run.status.in_(_IN_FLIGHT_STATUSES))
        ).scalar_one()
        launched_today = session.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner_id, Run.created_at >= since)
        ).scalar_one()

    if owner_in_flight + launching > settings.hosted_max_concurrent_runs_per_owner:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "owner_concurrency_limit",
                "message": (
                    f"you already have {owner_in_flight} run(s) in flight "
                    f"(limit {settings.hosted_max_concurrent_runs_per_owner}) — "
                    "wait for one to finish, or cancel it"
                ),
            },
        )
    if fleet_in_flight + launching > settings.hosted_max_concurrent_runs_global:
        # Deliberately does NOT echo the fleet count or the fleet cap: that is operator capacity
        # information, not something an account should be able to probe from a launch button.
        raise HTTPException(
            status_code=429,
            detail={
                "code": "global_concurrency_limit",
                "message": (
                    "the service is at capacity right now — please try again in a few minutes"
                ),
            },
        )
    if launched_today + launching > settings.hosted_max_runs_per_owner_per_day:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "owner_daily_limit",
                "message": (
                    f"you have started {launched_today} run(s) in the last 24h "
                    f"(limit {settings.hosted_max_runs_per_owner_per_day}) — try again later"
                ),
            },
        )


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
    prior greenfield path.

    M-h3: the hosted RUN CEILINGS are checked FIRST — before the idea resolves, before any target
    validation, and long before a Run row or a team clone exists. A launch refused for capacity
    should cost nothing and leave nothing behind. (An out-of-range ``budget_cap_usd`` is refused
    before them, like any other malformed body.)"""
    budget_problem = run_views.budget_problem(body.budget_cap_usd)
    if budget_problem:
        raise HTTPException(status_code=422, detail=budget_problem)
    _enforce_run_ceilings(uuid.UUID(current_user.id))
    retry_of = None
    if body.retry_of_run_id is not None:
        retry_of, retry_problem = run_views.retry_problem(
            uuid.UUID(current_user.id), body.retry_of_run_id
        )
        if retry_problem:
            raise HTTPException(status_code=422, detail=retry_problem)
    idea = resolve_run_idea(body.idea)

    # Validate the brownfield target FIRST (before any team graph is built), so a rejected launch
    # leaves no orphan team/run — mirroring the clone-on-launch validation discipline below.
    settings = get_settings()
    hosted = settings.hosted_mode
    repo_path = body.repo_path
    base_ref = body.base_ref
    subpath = body.subpath
    github_repo = body.github_repo

    # M-h1b — the two mutually-exclusive brownfield source postures. Hosted mode FENCES the
    # free-text server-path door (§3): with a delivery chute to GitHub now present, a free
    # ``repo_path`` would let any account courier the server's private files out via the ship. The
    # GitHub dropdown is the only hosted brownfield source; ``repo_path`` stays self-hosted-only.
    if repo_path is not None and github_repo is not None:
        raise HTTPException(status_code=422, detail="provide github_repo or repo_path, not both")
    if github_repo is not None and not hosted:
        raise HTTPException(status_code=422, detail="github_repo is hosted mode only")
    if hosted and repo_path is not None:
        raise HTTPException(status_code=422, detail="repo_path is not accepted in hosted mode")

    if github_repo is not None:
        # Hosted GitHub run: AUTHORISE the repo against THIS owner's installation(s) — a user can
        # POST any full_name, so this is an authz check, not a convenience — and resolve base_ref
        # from its default_branch (no branch picker). ``repo_path`` stays NULL: the durable
        # ``clone_github_repo_step`` sets it before ``load_graph_step``, so the run then looks
        # like a local brownfield run (the walk is never forked).
        owner_id = uuid.UUID(current_user.id)
        with db.session_scope() as session:
            installation_ids = [
                row.installation_id
                for row in session.execute(
                    select(GithubInstallation).where(GithubInstallation.owner_id == owner_id)
                ).scalars()
            ]
        # The HTTP calls run AFTER the session closes — never hold a session across network I/O.
        match = github_app.find_repo_in_installations(installation_ids, github_repo)
        if match is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "github_repo is not in your installations",
                    "github_repo": github_repo,
                },
            )
        # Revamp P6: honour the chosen base branch and scope (checked against the repo itself);
        # an absent base_ref is the repo's default branch, an absent subpath the whole repo.
        default_branch = match[1].get("default_branch") or "main"
        base_ref = (base_ref or "").strip() or default_branch
        subpath = (subpath or "").strip().strip("/") or None
        try:
            target_problem = github_targets.target_problem(
                match[0],
                github_repo,
                base_ref=base_ref,
                default_branch=default_branch,
                subpath=subpath,
            )
        except github_app.GithubAppError as exc:
            raise HTTPException(
                status_code=502, detail="Couldn't reach GitHub. Try again in a moment."
            ) from exc
        if target_problem:
            raise HTTPException(status_code=422, detail=target_problem)
    elif repo_path is not None:
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
    library_team_id = None  # revamp P11: the library team this run was launched from
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
            library_team_id = gid if source.is_library else None
            nodes, edges = graph_dicts(session, gid)
        verdict = validate_graph(nodes, edges)
        if not verdict["runnable"]:
            raise HTTPException(
                status_code=422,
                detail={"message": "team graph is not runnable", "errors": verdict["errors"]},
            )
        team_graph_id = clone_team_graph(body.team_graph_id)
    elif body.team_shape == "review_loop":
        # M-runnable scope: the team_shape / empty-body path builds an EPHEMERAL team from a shape
        # string — a legacy/harness path (the product launches AUTHORED teams via team_graph_id, the
        # clone path above). It keeps the legacy default; only the persisted authoring paths
        # (create_team_from_template / create_blank_team / create_team_node) are account-aware.
        team_graph_id = build_review_loop_team()
    else:
        team_graph_id = build_two_node_team()

    # M-accounts Slice B launch pre-flight: the owner must have a provider key for EVERY distinct
    # provider the team's node models use, else refuse (422) BEFORE the workflow starts — mirroring
    # the brownfield validate-before-launch discipline (a keyless account can't run; the seeded
    # operator with imported keys passes). On the clone path this checks the clone (== the source's
    # models); a 422 leaves only a harmless non-library orphan clone, never a started run.
    desktop_routed: list[str] = []
    if body.desktop_target:
        # M-subs-desktop: a Desktop launch — a FRESH connected Claude/Grok subscription covers its
        # provider (and its nodes then run on the owner's own Desktop via the owner's own CLI).
        missing, missing_nodes, desktop_routed, _fresh = _desktop_launch_credentials(
            uuid.UUID(current_user.id), team_graph_id
        )
        if missing:
            raise HTTPException(
                status_code=422,
                detail=_desktop_missing_detail(
                    uuid.UUID(current_user.id), missing, missing_nodes
                ),
            )
    else:
        missing, missing_nodes = _missing_provider_credentials(
            uuid.UUID(current_user.id), team_graph_id
        )
        if missing:
            subs = _connected_subscription_ids(uuid.UUID(current_user.id))
            subscription_only = all(_MODEL_PROVIDER_TO_SUB.get(p) in subs for p in missing)
            raise HTTPException(
                status_code=422,
                detail=_missing_credentials_detail(
                    missing, missing_nodes, subscription_only=subscription_only
                ),
            )

    # M-live: and the model must still EXIST. A slug its provider retired used to sail through
    # here and die mid-run with an opaque error (NVIDIA's 410 on meta/llama-3.3-70b-instruct).
    # Strictly after the credential check — see _unservable_node_models. (M-subs-desktop: providers
    # whose nodes run on the owner's own CLI are not probed — the CLI decides its own models.)
    dead_models, dead_nodes = _unservable_node_models(
        uuid.UUID(current_user.id),
        team_graph_id,
        frozenset(p for p, sub in _MODEL_PROVIDER_TO_SUB.items() if sub in desktop_routed),
    )
    if dead_models:
        raise HTTPException(
            status_code=422,
            detail=_unservable_models_detail(dead_models, dead_nodes),
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
                # M-h1b: the hosted-GitHub target (None for self-hosted/greenfield). repo_path stays
                # NULL here — the durable clone step sets it before load_graph_step.
                github_repo=github_repo,
                # scoped-mount Slice 1: the optional sub-path scope (None for greenfield /
                # whole-repo brownfield ⇒ identical column default).
                subpath=subpath,
                # M-subs-desktop: the launch-time routing (hosted ⇒ False / None, the defaults).
                desktop_target=body.desktop_target,
                desktop_subscriptions=desktop_routed if body.desktop_target else None,
                library_team_id=library_team_id,
                retry_of_run_id=retry_of,
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


# FE product surface removed (feat/ux-polish-remove-ab); keep endpoints for deploy/API compat.
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
    standard ``run_team`` workflows.

    M-h3: a pair is TWO sandboxes, so the hosted run ceilings are checked once, up front, for BOTH
    sides (``launching=2``). Checking per-side inside the loop would let a pair start side A and
    then 429 on side B, stranding half a comparison — and would let an A/B launch slip a second
    machine past a cap that had room for one."""
    _enforce_run_ceilings(uuid.UUID(current_user.id), launching=2)
    idea = resolve_run_idea(body.idea)
    # Same cap-resolution as a single run (P1.2 DP-A), applied identically to both sides.
    cap = body.budget_cap_usd
    if cap is None:
        cap = get_settings().default_run_budget_usd
    pair_id = uuid.uuid4()

    owner_id = uuid.UUID(current_user.id)
    runs: list[dict] = []
    for label, team_shape in _AB_CONFIGS:
        # M-runnable scope: the A/B instrument builds EPHEMERAL teams from a fixed shape (§14), a
        # launch-time path — it keeps the legacy default, like create_run's team_shape branch (only
        # the persisted authoring paths are account-aware this milestone).
        team_graph_id = _TEAM_BUILDERS[team_shape]()
        # M-accounts Slice B: same launch pre-flight as a single run, per side — refuse before any
        # run starts if the owner lacks a provider key the config needs (422).
        missing, missing_nodes = _missing_provider_credentials(owner_id, team_graph_id)
        if missing:
            subs = _connected_subscription_ids(owner_id)
            subscription_only = all(_MODEL_PROVIDER_TO_SUB.get(p) in subs for p in missing)
            raise HTTPException(
                status_code=422,
                detail=_missing_credentials_detail(
                    missing, missing_nodes, subscription_only=subscription_only
                ),
            )
        # M-live: the same servability pre-flight per side, so the A/B instrument is not a hole
        # through which a retired model still reaches a real run.
        dead_models, dead_nodes = _unservable_node_models(owner_id, team_graph_id)
        if dead_models:
            raise HTTPException(
                status_code=422,
                detail=_unservable_models_detail(dead_models, dead_nodes),
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
        # Revamp P3: team, live spent_usd, awaiting, failure.
        run_dict.update(run_views.run_extras(session, [run])[run.id])

    return {
        "run_id": run_id,
        "workflow_status": workflow_status,
        "run": run_dict,
        "costs": costs,
    }


@router.get("/api/runs/{run_id}/documents")
def get_run_documents(
    run_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """M-docs: every document THIS run produced (metadata only, oldest first) — the list backing
    the run-view document PICKER. Owner-scoped (404 unless the run belongs to the current user), the
    same guard as :func:`get_run`. Each item is a ``_document_meta`` dict; the FE opens any one by
    id via the existing ``GET /api/documents/{id}`` + the shared TipTap editor. An empty list for a
    run that produced no run-scoped documents (e.g. a pre-0028 run)."""
    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        run_uuid = run.id
    documents = [_document_meta(d) for d in list_documents_for_run(run_uuid)]
    return {"run_id": run_id, "documents": documents}


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
    no mutation.

    M-wsgc S1 adds ONE branch, for greenfield only: if ``ship_step`` durably snapshotted this run's
    diff into ``run_artifacts``, return that stored dict VERBATIM. It is the same
    ``compute_run_diff`` result, captured at ship time while the workspace still existed — which is
    the whole reason the workspace reaper is now allowed to reclaim that directory. Without this the
    tab would silently degrade to ``[]`` the moment the GC ran.

    Everything else is byte-identical to before. A greenfield run with NO snapshot (mid-flight, or
    one that never shipped) falls through to the live workspace read — and its workspace is
    correspondingly still spared. A BROWNFIELD run never reaches the branch at all: its deliverable
    is the ``tvashtr/<run_id>`` branch in the user's real repo, which can move after the run, so it
    must always be diffed live rather than frozen at ship time.

    The snapshot READ lives here rather than in ``run_diff``, which is deliberately kept pure
    ``subprocess`` + ``pathlib`` (openhands-free AND DBOS-free, so it stays importable anywhere
    and unit-testable against a temp repo). This router already holds a session; that module must
    not."""
    with db.session_scope() as session:
        run = _require_owned_run(session, run_id, uuid.UUID(current_user.id))
        repo_path = run.repo_path
        base_ref = run.base_ref
        ship_branch = run.ship_branch
        snapshot = (
            session.execute(
                select(RunArtifact.files).where(RunArtifact.run_id == run.id)
            ).scalar_one_or_none()
            if repo_path is None
            else None
        )
    if snapshot is not None:
        return snapshot
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
        # Per-node capabilities (Session A): this is the ONE per-node model call the HOST makes, so
        # it is where the node's authored capability config is honored. Read inside the session with
        # the rest of the node's fields.
        node_config = node.config
        node_role = node.role_name

    fallback_model = resolve_fallback_model(node_config)
    multimodal = resolve_multimodal(node_config)

    system_prompt = build_system_prompt(run_id=run_id, node_id=node_id)

    try:
        api_key = resolve_owner_api_key(owner_id, model)
    except NoCredentialError as exc:
        raise HTTPException(
            status_code=422, detail=f"no credential for provider {exc.provider!r}"
        ) from exc

    # The fallback's provider may differ from the primary's, so its key is resolved SEPARATELY. An
    # owner with no key for the fallback's provider simply gets no failover (the primary still
    # answers) — a missing fallback credential must never break a call the primary could serve.
    fallback_api_key: str | None = None
    if fallback_model:
        try:
            fallback_api_key = resolve_owner_api_key(owner_id, fallback_model)
        except NoCredentialError:
            fallback_model = None

    # The multimodal opt-in is BOUNDED BY THE MODEL: a node that asks for it on a text-only slug is
    # told (an advisory RunWarning in the run inspector) instead of the flag silently doing nothing.
    # Threading image CONTENT PARTS into the sandboxed agent loop is a documented follow-on — that
    # call is made inside the container, behind the frozen EngineAdapter contract.
    if multimodal and not multimodal_supported(model):
        record_resolution_warning(
            run_id,
            "multimodal",
            node_role,
            f"model {model!r} does not accept image input — the multimodal flag has no effect",
        )

    messages = [{"role": "system", "content": system_prompt}] + [
        {"role": m.role, "content": m.content} for m in body.messages
    ]
    try:
        result = complete(
            CompletionRequest(
                model=model,
                messages=messages,
                api_key=api_key,
                fallback_model=fallback_model,
                fallback_api_key=fallback_api_key,
                multimodal=multimodal,
            )
        )
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
    secret (``secret_encrypted`` is decrypted only at run time, in the executor). ``updated_at``
    (revamp) is when the CURRENT key was saved — a replace keeps ``created_at``."""
    return {
        "provider": cred.provider,
        "key_last4": cred.key_last4,
        "created_at": cred.created_at.isoformat(),
        "updated_at": cred.updated_at.isoformat(),
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
    encrypts the key, and upserts on ``(owner, provider)``. 422 on an empty provider/key, and
    (revamp) on a slug that is not a model prefix once canonicalized. Returns
    ``{provider, key_last4, created_at, updated_at, replaced}`` — never the secret."""
    provider = provider_for_model(body.provider)  # leading-slug + lower/trim — the canonical form
    api_key = body.api_key.strip()
    if not provider:
        raise HTTPException(status_code=422, detail="A provider is required.")
    try:
        provider = validate_provider_slug(provider)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
            row = existing
        else:
            row = ProviderCredential(
                owner_id=owner_id,
                provider=provider,
                secret_encrypted=secret,
                key_last4=last4,
            )
            session.add(row)
        session.flush()
        session.refresh(row)  # the server-side created_at / updated_at of the saved row
        return {**_provider_to_dict(row), "replaced": existing is not None}


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


# ---- Engine subscription statuses (status-only Desktop mirror; NEVER store secrets) ----


_SUBSCRIPTION_PROVIDERS = ("claude", "grok", "codex")
# Revamp (Engines): the states Tvashtr Desktop reports (``desktop/electron/harness``). "checking" is
# a UI-only transient and is never stored.
_SUBSCRIPTION_STATES = frozenset(
    {"disconnected", "needs_install", "needs_login", "api_key", "connected", "error"}
)
_SECRET_KEYS = frozenset(
    {"api_key", "token", "cookies", "cookie", "secret", "authorization", "password"}
)


class UpsertSubscriptionRequest(BaseModel):
    connected: bool
    state: str | None = None
    account_hint: str | None = None
    source: str | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_secrets(cls, data: Any) -> Any:
        if isinstance(data, dict):
            bad = _SECRET_KEYS.intersection({str(k).lower() for k in data})
            if bad:
                raise ValueError(f"subscription status must not include secrets: {sorted(bad)}")
        return data


def _subscription_to_dict(
    provider: str, row: EngineSubscriptionStatus | None, runner_fresh: bool = False
) -> dict:
    """``runner_fresh`` (M-subs-desktop A3): this subscription counts for a Desktop launch RIGHT
    NOW — connected, runnable by Tvashtr Desktop, and the owner's Desktop runner polled recently.
    The FE Run gate reads exactly this, so it agrees with the server pre-flight."""
    if row is None:
        return {
            "provider": provider,
            "connected": False,
            "state": "disconnected",
            "account_hint": None,
            "source": None,
            "checked_at": None,
            "runner_fresh": False,
        }
    return {
        "provider": row.provider,
        "connected": bool(row.connected),
        "state": row.state,
        "account_hint": row.account_hint,
        "source": row.source,
        "checked_at": row.checked_at.isoformat() if row.checked_at else None,
        "runner_fresh": bool(
            runner_fresh and row.connected and row.provider in RUNNER_SUBSCRIPTIONS
        ),
    }


@router.get("/api/engines/subscriptions")
def list_engine_subscriptions(
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    with db.session_scope() as session:
        rows = {
            r.provider: r
            for r in session.execute(
                select(EngineSubscriptionStatus).where(
                    EngineSubscriptionStatus.owner_id == owner_id
                )
            )
            .scalars()
            .all()
        }
        # Revamp (Engines): the Desktop check-in itself, independent of any subscription, so the
        # web can say "Tvashtr Desktop is open on your computer · checked in <t>".
        runner = desktop_jobs.runner_status(owner_id)
        fresh = runner["fresh"]
        return {
            "subscriptions": [
                _subscription_to_dict(p, rows.get(p), fresh) for p in _SUBSCRIPTION_PROVIDERS
            ],
            "runner": runner,
        }


@router.put("/api/engines/subscriptions/{provider}")
def upsert_engine_subscription(
    provider: str,
    body: UpsertSubscriptionRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    canonical = provider.strip().lower()
    if canonical not in _SUBSCRIPTION_PROVIDERS:
        raise HTTPException(status_code=404, detail="unknown subscription provider")
    state = (body.state or ("connected" if body.connected else "disconnected")).strip()
    if state not in _SUBSCRIPTION_STATES:
        raise HTTPException(
            status_code=422,
            detail="state must be one of: " + ", ".join(sorted(_SUBSCRIPTION_STATES)),
        )
    if body.source is not None and body.source not in ("harness", "oauth"):
        raise HTTPException(status_code=422, detail="source must be harness or oauth")
    owner_id = uuid.UUID(current_user.id)
    now = datetime.now(timezone.utc)
    with db.session_scope() as session:
        row = session.execute(
            select(EngineSubscriptionStatus).where(
                EngineSubscriptionStatus.owner_id == owner_id,
                EngineSubscriptionStatus.provider == canonical,
            )
        ).scalar_one_or_none()
        if row is None:
            row = EngineSubscriptionStatus(owner_id=owner_id, provider=canonical)
            session.add(row)
        row.connected = body.connected
        row.state = state
        row.account_hint = body.account_hint
        row.source = body.source
        row.checked_at = now
        session.flush()
        return _subscription_to_dict(canonical, row, desktop_jobs.runner_fresh(owner_id))


@router.delete("/api/engines/subscriptions/{provider}", status_code=204)
def delete_engine_subscription(
    provider: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> Response:
    canonical = provider.strip().lower()
    if canonical not in _SUBSCRIPTION_PROVIDERS:
        raise HTTPException(status_code=404, detail="unknown subscription provider")
    with db.session_scope() as session:
        row = session.execute(
            select(EngineSubscriptionStatus).where(
                EngineSubscriptionStatus.owner_id == uuid.UUID(current_user.id),
                EngineSubscriptionStatus.provider == canonical,
            )
        ).scalar_one_or_none()
        if row is not None:
            session.delete(row)
    return Response(status_code=204)


# ---- MCP secrets (M-tools C7.A): the account's ${NAME} store for MCP tool_config, encrypted ----


class AddSecretRequest(BaseModel):
    """``POST /api/secrets`` body: a ``${NAME}`` key (e.g. ``GITHUB_TOKEN``) + its plaintext value.
    The server encrypts the value (Fernet). CREATE-ONLY since the revamp: a taken name is a 409 and
    replacing is ``PUT /api/secrets/{name}``. The value is NEVER returned by any endpoint."""

    name: str
    value: str


@router.get("/api/secrets")
def list_secrets(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's MCP secrets (never the values), oldest first:
    ``secrets[]`` = stored rows ``{name, created_at, updated_at, used_by_tools}`` (``name`` is what
    ToolsSection treats as "present") and ``missing[]`` = names library tools reference that have
    no stored value ``{name, used_by_tools}``."""
    return toolkit.list_secrets(uuid.UUID(current_user.id))


@router.post("/api/secrets")
def add_secret(
    body: AddSecretRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Add an MCP ``${NAME}`` secret (create-only). 422 on the ``^[A-Z_][A-Z0-9_]{0,127}$`` name
    rule or an empty value; 409 "<NAME> already exists. Use Replace value on it instead."
    Returns ``{name, created_at, updated_at}`` — never the value."""
    try:
        return toolkit.create_secret(uuid.UUID(current_user.id), body.name, body.value)
    except toolkit.ToolkitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


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
    ``{url,headers,type}`` http/sse). ``POST`` is create-only (409 on a taken name)."""

    name: str
    server_config: dict


class SkillLibraryBody(BaseModel):
    """``POST``/``PATCH`` body for a library skill: a ``name`` (display label) + a ``source`` object
    (one C7.B skill source — inline/repo/project_rules). A ``library``-typed source is REJECTED — a
    library item's source never nests another reference."""

    name: str
    source: dict


class SkillLibraryPatchBody(BaseModel):
    """``PATCH /api/skill-library/{id}`` body (revamp): either field may be omitted."""

    name: str | None = None
    source: dict | None = None


class ToolLibraryPatchBody(BaseModel):
    """``PATCH /api/tool-library/{id}`` body (revamp): either field may be omitted."""

    name: str | None = None
    server_config: dict | None = None


@router.get("/api/tool-library")
def list_tool_library(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's library tools, oldest first: ``{id, name, server_config, created_at,
    updated_at, secret_refs, missing_secrets, status, used_by:{agent_count, team_count}}``."""
    return {"tools": toolkit.list_tools(uuid.UUID(current_user.id))}


@router.post("/api/tool-library")
def add_tool_library(
    body: ToolLibraryBody, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """CREATE-ONLY (revamp): 422 on the name rule or a config without exactly one of a command or
    an http(s) URL; 409 "You already have a tool named <name>." Returns the full item."""
    try:
        return toolkit.create_tool(uuid.UUID(current_user.id), body.name, body.server_config)
    except toolkit.ToolkitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.patch("/api/tool-library/{item_id}")
def edit_tool_library(
    item_id: str,
    body: ToolLibraryPatchBody,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Update the owner's library tool by id (partial body). 422 as POST (an unchanged legacy name
    is allowed), 409 on a name clash, 404 if not the owner's. A rename carries each agent's on/off
    switch. Returns the full item; edits propagate LIVE to every referencing node's next run."""
    try:
        return toolkit.update_tool(
            uuid.UUID(current_user.id), item_id, body.name, body.server_config
        )
    except toolkit.ToolkitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.delete("/api/tool-library/{item_id}")
def remove_tool_library(
    item_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Remove the owner's tool by id (idempotent + owner-scoped) and strip it from every agent that
    referenced it. Returns ``{removed_from_agents}`` (was a bare 204 before the revamp)."""
    return toolkit.delete_tool(uuid.UUID(current_user.id), item_id)


@router.get("/api/skill-library")
def list_skill_library(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The current account's library skills, oldest first: ``{id, name, source, created_at,
    updated_at, usage:{agents, teams}}``."""
    return {"skills": toolkit.list_skills(uuid.UUID(current_user.id))}


@router.post("/api/skill-library")
def add_skill_library(
    body: SkillLibraryBody,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    on_conflict: str = "error",
) -> dict:
    """CREATE-ONLY by default (revamp): 409 "You already have a skill called <name>."; pass
    ``?on_conflict=replace`` for the old upsert (the preset path). 422 on the kebab-case name rule
    or an invalid source (inline needs content; a mode must be always/trigger/agent and a trigger
    mode needs a word; a repo needs a GitHub URL; a ``library`` source is rejected — no nesting).
    Returns the full item."""
    try:
        return toolkit.create_skill(uuid.UUID(current_user.id), body.name, body.source, on_conflict)
    except toolkit.ToolkitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.patch("/api/skill-library/{item_id}")
def edit_skill_library(
    item_id: str,
    body: SkillLibraryPatchBody,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Update the owner's library skill by id (partial body). 422 as POST (an unchanged legacy
    name is allowed), 409 on a name clash (was a 500), 404 if not the owner's. Full item back."""
    try:
        return toolkit.update_skill(uuid.UUID(current_user.id), item_id, body.name, body.source)
    except toolkit.ToolkitError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


@router.delete("/api/skill-library/{item_id}")
def remove_skill_library(
    item_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Remove the owner's library skill by id (idempotent + owner-scoped) and strip its refs from
    every agent. Returns ``{removed_from_agents}`` (was a bare 204 before the revamp)."""
    return toolkit.delete_skill(uuid.UUID(current_user.id), item_id)


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


@router.get("/api/runs")
def list_runs(
    current_user: Annotated[UserOut, Depends(get_current_user)],
    status: str = "all",
    team_id: str | None = None,
    q: str | None = None,
    limit: Annotated[int, Query(ge=1, le=run_views.MAX_LIMIT)] = run_views.DEFAULT_LIMIT,
    cursor: str | None = None,
    include: str | None = None,
) -> dict:
    """The current account's runs, newest first, one page at a time (revamp P3 / G-6).
    Owner-scoped: only ``runs.owner_id == current_user`` rows. ``status`` is a group (``all``,
    ``active``, ``running``, ``needs_you``, ``completed``, ``failed``, ``stopped``); ``team_id``
    filters by library team; ``q`` matches the idea or the team name; ``include=progress`` adds the
    per-node progress chips. Each row keeps the old summary keys and adds team, target, PR, live
    spend, budget, awaiting and failure (see ``run_views``)."""
    team_uuid = None
    if team_id is not None:
        try:
            team_uuid = uuid.UUID(team_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="invalid team_id") from exc
    includes = {part.strip() for part in (include or "").split(",") if part.strip()}
    if includes - {"progress"}:
        raise HTTPException(status_code=422, detail="include accepts only: progress")
    try:
        return run_views.list_owner_runs(
            uuid.UUID(current_user.id),
            status=status,
            team_id=team_uuid,
            q=q,
            limit=limit,
            cursor=cursor,
            include_progress="progress" in includes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    """The curated starter templates the New-team picker offers (``{template, name, description,
    shape}``); the FE renders the picker from this, never a hardcoded list. ``blank`` is the Blank
    starting point in the same shape (not in the list — the FE keeps its own Blank card so it can
    still offer it when this call fails)."""
    return {"templates": list_templates(), "blank": blank_template()}


@router.get("/api/teams")
def get_teams(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """The CURRENT account's library teams as summaries (``_team_summary``), oldest first
    (M-accounts Slice B: per-owner). Library teams ONLY + owner-scoped: run-snapshot clones / A-B /
    smoke graphs and other accounts' teams never appear.

    Revamp (G-13): an account with no teams gets ``{"teams": []}`` — nothing is auto-seeded any
    more (Home's first-time view offers the templates, and deleting the last team must stay
    deleted)."""
    owner_id = uuid.UUID(current_user.id)
    return {"teams": list_library_teams(owner_id)}


@router.post("/api/teams")
def create_team(
    body: CreateTeamRequest, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """Create a new library team OWNED by the current account — from a starter template
    (drop-and-edit), or, when ``template == "blank"`` (P1.8d), from the minimal valid skeleton (root
    thinker → Ship) the user wires up from scratch. The name is trimmed; a blank one is 422 "A team
    name is required." (checked first); an unknown ``template`` key is 400. The template key is
    stored on the team (``template_key``). Returns the new team's summary; the FE then loads its
    graph + makes it current."""
    owner_id = uuid.UUID(current_user.id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="A team name is required.")
    if body.template == "blank":
        return get_team_summary(create_blank_team(name, owner_id))
    try:
        team_graph_id = create_team_from_template(body.template, name, owner_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="unknown template") from exc
    return get_team_summary(team_graph_id)


@router.get("/api/domain-templates")
def get_domain_templates(
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    return {"templates": list_domain_templates()}


@router.get("/api/domains")
def get_domains(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    return {"domains": list_domains(uuid.UUID(current_user.id))}


@router.post("/api/domains")
def post_domain(
    body: CreateDomainRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    try:
        return create_domain(owner_id, body.name, body.template)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail="unknown template") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _parse_domain_id(domain_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(domain_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid domain id") from exc


@router.get("/api/domains/{domain_id}")
def get_domain_endpoint(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    row = get_domain(uuid.UUID(current_user.id), _parse_domain_id(domain_id))
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return row


@router.patch("/api/domains/{domain_id}")
def patch_domain(
    domain_id: str,
    body: UpdateDomainRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    try:
        row = update_domain(
            uuid.UUID(current_user.id),
            _parse_domain_id(domain_id),
            name=body.name,
            config=body.config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return row


@router.delete("/api/domains/{domain_id}")
def delete_domain_endpoint(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    did = _parse_domain_id(domain_id)
    ok = delete_domain(uuid.UUID(current_user.id), did)
    if not ok:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"domain_id": str(did), "deleted": True}


def _parse_doc_id(document_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid document id") from exc


@router.get("/api/domains/{domain_id}/documents")
def get_domain_documents(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    rows = list_domain_documents(uuid.UUID(current_user.id), _parse_domain_id(domain_id))
    if rows is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"documents": rows}


async def _read_domain_upload_capped(file: UploadFile) -> bytes:
    """Read upload bytes with a hard cap — reject before buffering unbounded bodies."""
    cl = file.headers.get("content-length")
    if cl is not None:
        try:
            declared = int(cl)
        except ValueError:
            declared = None
        else:
            if declared > MAX_UPLOAD_BYTES:
                raise ValueError("file exceeds 10 MiB limit")
    buf = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_UPLOAD_BYTES:
            raise ValueError("file exceeds 10 MiB limit")
    return bytes(buf)


@router.post("/api/domains/{domain_id}/documents")
async def post_domain_document(
    domain_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    file: UploadFile = File(...),
) -> dict:
    name = file.filename or "upload.txt"
    try:
        raw = await _read_domain_upload_capped(file)
        return create_document(
            uuid.UUID(current_user.id), _parse_domain_id(domain_id), name, raw
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="domain not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/api/domains/{domain_id}/documents/{document_id}")
def delete_domain_document_endpoint(
    domain_id: str,
    document_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    ok = delete_document(
        uuid.UUID(current_user.id),
        _parse_domain_id(domain_id),
        _parse_doc_id(document_id),
    )
    if not ok:
        raise HTTPException(status_code=404, detail="document not found")
    return {"document_id": document_id, "deleted": True}


@router.post("/api/domains/{domain_id}/ingest")
def post_domain_ingest(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    row = get_domain(owner_id, did)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    model = normalize_embedding_model(
        str(
            (row.get("config") or {})
            .get("embedding", {})
            .get("model")
            or "text-embedding-3-small"
        )
    )
    provider = provider_for_model(model)
    if provider not in held_provider_slugs(owner_id):
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    f"you have no API key for: {provider} — needed to embed domain documents. "
                    "Add a key under Engines before ingesting."
                ),
                "missing_providers": [provider],
            },
        )
    handle = DBOS.start_workflow(ingest_domain, str(owner_id), str(did))
    return {
        "domain_id": str(did),
        "workflow_id": str(handle.workflow_id),
        "status": "indexing",
    }


@router.post("/api/domains/{domain_id}/ask")
def post_domain_ask(
    domain_id: str,
    body: DomainAskRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    # ownership probe first so foreign ids stay 404 even if ask would 422
    row = get_domain(owner_id, did)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    try:
        return ask_domain(owner_id, did, body.question)
    except DomainAskError as e:
        if e.code == "not_found":
            raise HTTPException(status_code=404, detail="domain not found") from e
        if e.code == "gateway":
            raise HTTPException(status_code=502, detail=e.detail) from e
        raise HTTPException(status_code=422, detail=e.detail) from e


@router.post("/api/domains/{domain_id}/retrieve")
def post_domain_retrieve(
    domain_id: str,
    body: DomainRetrieveRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    row = get_domain(owner_id, did)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    try:
        result = retrieve_domain(owner_id, did, body.query, top_k=body.top_k)
    except DomainAskError as e:
        if e.code == "not_found":
            raise HTTPException(status_code=404, detail="domain not found") from e
        if e.code == "gateway":
            raise HTTPException(status_code=502, detail=e.detail) from e
        raise HTTPException(status_code=422, detail=e.detail) from e
    return {
        "domain_id": str(did),
        "citations": result["citations"],
        "latency_ms": result.get("latency_ms"),
    }


@router.get("/api/domains/{domain_id}/messages")
def get_domain_messages(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    msgs = list_domain_messages(owner_id, did)
    if msgs is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"messages": msgs}


@router.get("/api/domains/{domain_id}/eval/cases")
def get_domain_eval_cases(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    rows = list_eval_cases(owner_id, did)
    if rows is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"cases": rows}


@router.post("/api/domains/{domain_id}/eval/cases")
def post_domain_eval_case(
    domain_id: str,
    body: DomainEvalCaseCreate,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    try:
        return create_eval_case(
            owner_id,
            did,
            question=body.question,
            expected_answer=body.expected_answer,
            expected_citation_doc_ids=body.expected_citation_doc_ids,
            expected_keywords=body.expected_keywords,
            ordinal=body.ordinal,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail="domain not found") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


def _parse_eval_case_id(case_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid case id") from exc


@router.delete("/api/domains/{domain_id}/eval/cases/{case_id}", status_code=204)
def delete_domain_eval_case_route(
    domain_id: str,
    case_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> Response:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    cid = _parse_eval_case_id(case_id)
    if get_domain(owner_id, did) is None:
        raise HTTPException(status_code=404, detail="domain not found")
    if not delete_eval_case(owner_id, did, cid):
        raise HTTPException(status_code=404, detail="case not found")
    return Response(status_code=204)


@router.get("/api/domains/{domain_id}/eval/runs/latest")
def get_domain_eval_latest(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    owned, run = latest_eval_run_for_owner(owner_id, did)
    if not owned:
        raise HTTPException(status_code=404, detail="domain not found")
    if run is None:
        raise HTTPException(status_code=404, detail="no eval runs yet")
    return run


@router.post("/api/domains/{domain_id}/eval")
def post_domain_eval(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    try:
        return run_domain_eval(owner_id, did)
    except LookupError as e:
        raise HTTPException(status_code=404, detail="domain not found") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e



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
        if node.kind == "domain_query":
            cfg = dict(node.config or {})
            if "domain_id" in body.model_fields_set:
                if body.domain_id is None or body.domain_id == "":
                    cfg["domain_id"] = None
                else:
                    try:
                        uuid.UUID(str(body.domain_id))
                    except ValueError as exc:
                        raise HTTPException(status_code=400, detail="invalid domain_id") from exc
                    cfg["domain_id"] = str(body.domain_id)
                node.config = cfg
            if "prompt" in body.model_fields_set and body.prompt is not None:
                node.prompt = body.prompt
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
        # M-docs: writes_to (one doc name) + reads_from (a list of names) live in the SAME config
        # JSONB — one fresh-dict merge, ``model_fields_set``-guarded (omitted ⇒ config unchanged,
        # preserving e.g. ``model_config``/``memory_remember_enabled``). The executor's resolvers
        # normalise blanks/None, so a cleared value is inert.
        if "writes_to" in body.model_fields_set or "reads_from" in body.model_fields_set:
            cfg = dict(node.config or {})
            if "writes_to" in body.model_fields_set:
                cfg["writes_to"] = body.writes_to
            if "reads_from" in body.model_fields_set:
                cfg["reads_from"] = body.reads_from
            node.config = cfg
        # Per-node capabilities (Session A): fallback_model / output_schema / multimodal ride the
        # SAME config JSONB by the SAME rule — one fresh-dict merge, ``model_fields_set``-guarded,
        # an omitted field leaves the stored value untouched (the byte-identical guard) while an
        # EXPLICIT null clears it. ``output_schema`` reaches this branch only for an agent or
        # completion node (a gate returned above), so it is stored under its own key and never
        # guardrail gate's ``schema``. The executor's resolvers normalise blank/malformed values, so
        # a cleared or wrong-typed value is inert at run time.
        _CAPABILITY_KEYS = ("fallback_model", "output_schema", "multimodal")
        if any(key in body.model_fields_set for key in _CAPABILITY_KEYS):
            cfg = dict(node.config or {})
            for key in _CAPABILITY_KEYS:
                if key in body.model_fields_set:
                    cfg[key] = getattr(body, key)
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


@router.patch("/api/teams/{team_id}")
def rename_team(
    team_id: str,
    body: RenameTeamRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """Rename a library team; returns the UPDATED SUMMARY (the same shape ``POST /api/teams``
    returns) so the dashboard can swap the row in place rather than guess at the new state.

    Owner-scoped exactly like ``DELETE /api/teams/{team_id}``: 400 on a malformed id; 404 if the id
    is not the CURRENT account's library team — a run-snapshot clone, an A/B graph, or another
    account's team are all indistinguishably "not found", so a foreign team is not probeable. 422 on
    a blank/whitespace-only name (raised by the core, so every caller is held to it).

    Migration-free: an UPDATE of an existing column."""
    owner_id = uuid.UUID(current_user.id)
    try:
        tid = uuid.UUID(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid team id") from exc
    try:
        summary = rename_library_team(tid, body.name, owner_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="A team name is required.") from exc
    if summary is None:
        raise HTTPException(status_code=404, detail="library team not found")
    return summary


@router.get("/api/teams/{team_id}/runs")
def get_team_runs(
    team_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    """This team's FULL run history, newest first — the dashboard's per-team drill-down. Each row is
    ``{run_id, status, idea, created_at, cost_total_usd}``; ``run_id`` is what the run view opens.

    The team summary's ``last_run`` is only the LATEST run; this is every one of them, read through
    the same clone→origin join (``DISTINCT``-collapsed, so a multi-node team does not report each
    run once per node). Owner-scoped like the DELETE: 400 on a malformed id, 404 if it is not the
    current account's library team. A team of yours that has never run is ``{"runs": []}`` with a
    200 — an empty state, not a missing one.

    Migration-free: a read."""
    owner_id = uuid.UUID(current_user.id)
    try:
        tid = uuid.UUID(team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid team id") from exc
    runs = list_team_runs(tid, owner_id)
    if runs is None:
        raise HTTPException(status_code=404, detail="library team not found")
    return {"runs": runs}


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
    OWNER already holds (``account_default_model(held_providers, capability)``) — falling back to
    today's hardcoded default ONLY when the account holds no mapped provider. M-seat passes the
    node's own SEAT, so a hand-added worker gets a model that can drive the agent loop rather than
    whichever slug its first held provider happened to declare. An explicit ``body.model`` is
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
            model=body.model
            or account_default_model(held, "thinker")
            or get_settings().default_model,
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
            model=body.model or account_default_model(held, "worker") or legacy_default,
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
    if body.node_kind == "domain_query":
        domain_id = body.domain_id
        if domain_id is not None:
            try:
                uuid.UUID(str(domain_id))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="invalid domain_id") from exc
        return AgentNode(
            team_graph_id=graph_id,
            role_name="domain_query",
            kind="domain_query",
            model=None,
            engine=None,
            prompt=body.prompt if body.prompt is not None else "{idea}",
            position=position,
            edits_allowed=False,
            config={"domain_id": str(domain_id) if domain_id else None},
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
    # M-runnable: the owner's held providers gate the account-aware create default (used only when
    # body.model is absent) — via the ONE held-provider rule (credentials.held_provider_slugs,
    # the same set the launch pre-flight consults), so there is not a second definition of "held".
    held_providers = held_provider_slugs(owner_id)
    with db.session_scope() as session:
        graph = _require_library_team(session, team_id, owner_id)
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


def _owner_installation_ids(session, owner_id: uuid.UUID) -> list[int]:
    """The installation ids owned by ``owner_id`` — the owner-scoping chokepoint for the repos read
    and its re-read after the backfill."""
    return [
        row.installation_id
        for row in session.execute(
            select(GithubInstallation).where(GithubInstallation.owner_id == owner_id)
        ).scalars()
    ]


def _backfill_github_installations() -> None:
    """Self-healing installation discovery from the APP side (M-legible item 4).

    Discovery otherwise runs ONLY in ``auth.github_callback``, which needs a GitHub USER
    token that is never stored — so an account that signed in before discovery, or whose
    callback discovery hit the tolerated error path, is stranded with ZERO installation rows
    and no product route can create one. ``GET /app/installations`` (App JWT, no user token)
    lists every installation; each is matched by its GitHub ``account.id`` to a
    ``users.github_user_id`` and recorded for THAT user via the same idempotent, owner-scoped
    rule the callback uses (``auth._store_installation``). An installation matching no user
    creates NO row — owner-scoping is absolute. The GitHub call runs BEFORE the DB session
    opens (never hold a session across network I/O)."""
    installations = github_app.list_app_installations()
    account_ids: list[int] = []
    for inst in installations:
        account = inst.get("account")
        if isinstance(account, dict) and account.get("id") is not None:
            account_ids.append(account["id"])
    if not account_ids:
        return
    with db.session_scope() as session:
        users_by_github_id = {
            user.github_user_id: user
            for user in session.execute(
                select(User).where(User.github_user_id.in_(account_ids))
            ).scalars()
        }
        for inst in installations:
            account = inst.get("account") or {}
            user = users_by_github_id.get(account.get("id"))
            if user is not None and inst.get("id") is not None:
                _store_installation(session, user.id, str(inst["id"]))


@router.get("/api/github/repos")
def list_github_repos(current_user: Annotated[UserOut, Depends(get_current_user)]) -> dict:
    """List the repositories the current account's GitHub App installation(s) can access (HOSTED
    mode). OWNER-SCOPED: reads ONLY ``github_installations`` rows WHERE ``owner_id`` == the current
    user, so account A can NEVER see account B's installations or repos. Its repos are
    fetched with a freshly-minted, in-memory-cached installation token — no token is ever stored,
    logged, or returned. Returns a whitelist of non-secret repo fields. One dead/stale installation
    id must not 500 the endpoint — log and continue so remaining installs still contribute.

    SELF-HEALING (M-legible): an account with ZERO installation rows — stranded because discovery
    only ever ran in the OAuth callback, which needs a user token that is never stored — triggers a
    one-shot APP-side backfill (:func:`_backfill_github_installations`) and re-reads. Only the
    zero-row path pays that extra GitHub call; a backfill failure logs and falls through to the
    honest empty response, never a 500."""
    owner_id = uuid.UUID(current_user.id)
    with db.session_scope() as session:
        installation_ids = _owner_installation_ids(session, owner_id)
    if not installation_ids:
        try:
            _backfill_github_installations()
        except Exception:
            logger.exception("github installation backfill failed; returning empty repo list")
        with db.session_scope() as session:
            installation_ids = _owner_installation_ids(session, owner_id)
    # The HTTP calls run AFTER the DB session closes — never hold a session across network I/O.
    repos: list[dict] = []
    for installation_id in installation_ids:
        try:
            repos.extend(github_app.list_installation_repositories(installation_id))
        except github_app.GithubAppError:
            logger.exception(
                "list_installation_repositories failed for installation_id=%s; skipping",
                installation_id,
            )
            continue
    return {"repos": repos, "installation_count": len(installation_ids)}


# M-subs-desktop: the Desktop runner's secret-free, owner-scoped endpoints (claim / snapshot /
# events / result) ride the same session-gated router as the rest of the product surface.
from tvashtr.desktop_runner_routes import router as _desktop_runner_router  # noqa: E402

router.include_router(_desktop_runner_router)

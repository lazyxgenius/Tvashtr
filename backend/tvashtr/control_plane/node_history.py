"""One authored agent's rounds across its team's runs (frontend revamp, B-NODES).

Backs ``GET /api/teams/{team_id}/nodes/{node_id}/runs`` — the drawer's Runs/Docs tabs and the focus
view's rounds rail. A run executes an immutable CLONE of the library team whose nodes carry
``cloned_from_node_id`` back to the authored node, so "this agent's rounds" are the invocations of
the clone(s) of that node — the same clone→origin join ``_latest_invocation_by_origin`` and
``teams.list_team_runs`` use. Read-only; no DBOS, no LLM.

Each round reports what the agent was given (documents with the version it read, remembered
lessons, skills), what it produced (a verdict, a document version, changed files), its cost and the
billing route (a Desktop subscription job vs an API key)."""

import uuid
from datetime import datetime

from sqlalchemy import func, or_, select

from tvashtr.control_plane.context_compiler import resolve_reads_from
from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.team_run import node_emits_outcome
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentInvocation,
    AgentNode,
    CostRecord,
    DesktopNodeJob,
    Document,
    DocumentVersion,
    Edge,
    Run,
    SkillLibraryItem,
    TeamGraph,
)

TERMINAL_RUN_STATUSES = ("completed", "failed", "rejected", "over_budget", "cancelled")
VERDICT_OUTCOMES = ("approved", "changes_requested")
DEFAULT_LIMIT = 20
MAX_LIMIT = 100
_ZERO_COST = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0.0}


class NodeHistoryNotFound(LookupError):
    """The team/node/run is not the caller's (or does not exist) — the route answers 404 with
    ``detail`` (the exception's message)."""


def require_team_node(session, team_id: str, node_id: str, owner_id: uuid.UUID) -> AgentNode:
    """The authored node ``node_id`` of the caller's library team ``team_id``, else
    :class:`NodeHistoryNotFound` — the same 404 rule as ``routers._require_library_team`` (a
    malformed id, another account's team, a run-snapshot clone are all "not found")."""
    try:
        tid, nid = uuid.UUID(str(team_id)), uuid.UUID(str(node_id))
    except ValueError as exc:
        raise NodeHistoryNotFound("library team not found") from exc
    graph = session.get(TeamGraph, tid)
    if graph is None or not graph.is_library or graph.owner_id != owner_id:
        raise NodeHistoryNotFound("library team not found")
    node = session.get(AgentNode, nid)
    if node is None or node.team_graph_id != graph.id:
        raise NodeHistoryNotFound("node not found in the team")
    return node


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _run_brief(run: Run) -> dict:
    return {
        "run_id": str(run.id),
        "idea": run.idea,
        "status": run.status,
        "created_at": run.created_at.isoformat(),
        "live": run.status not in TERMINAL_RUN_STATUSES,
    }


def node_run_history(
    team_id: str,
    node_id: str,
    owner_id: uuid.UUID,
    *,
    run_id: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict:
    """``{"runs": [...], "run": {...} | None}`` for one authored agent.

    ``runs`` — every run of the caller's where a clone of this node has at least one round, newest
    first (``limit``-capped): ``{run_id, idea, status, created_at, live, rounds_count,
    last_outcome, last_status, last_round_at}``. ``run`` — the selected run (``run_id``, else the
    newest in ``runs``) with its ``rounds`` newest first; ``None`` when the agent never ran. A
    ``run_id`` that is not one of the caller's runs containing this agent raises
    :class:`NodeHistoryNotFound`."""
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    with session_scope() as session:
        node = require_team_node(session, team_id, node_id, owner_id)
        rows = session.execute(
            select(
                Run,
                AgentNode.id,
                func.count(AgentInvocation.id),
                func.max(AgentInvocation.started_at),
            )
            .select_from(AgentNode)
            .join(Run, Run.team_graph_id == AgentNode.team_graph_id)
            .join(AgentInvocation, AgentInvocation.node_id == AgentNode.id)
            .where(AgentNode.cloned_from_node_id == node.id, Run.owner_id == owner_id)
            .group_by(Run.id, AgentNode.id)
            .order_by(Run.created_at.desc(), Run.id)
            .limit(limit)
        ).all()
        clone_ids = [clone_id for _run, clone_id, _count, _last in rows]
        latest = _latest_invocations(session, clone_ids)
        runs = []
        for run, clone_id, count, last_at in rows:
            inv = latest.get(clone_id)
            runs.append(
                {
                    **_run_brief(run),
                    "rounds_count": int(count),
                    "last_outcome": inv.outcome if inv else None,
                    "last_status": inv.status if inv else None,
                    "last_round_at": _iso(last_at),
                }
            )

        selected: dict | None = None
        if run_id is not None:
            selected = _run_detail(session, node, run_id, owner_id)
        elif rows:
            selected = _run_detail(session, node, str(rows[0][0].id), owner_id)
        return {"runs": runs, "run": selected}


def _latest_invocations(session, clone_ids: list[uuid.UUID]) -> dict[uuid.UUID, AgentInvocation]:
    """Each clone node's latest round (max iteration), one ``DISTINCT ON`` read."""
    if not clone_ids:
        return {}
    rows = (
        session.execute(
            select(AgentInvocation)
            .where(AgentInvocation.node_id.in_(clone_ids))
            .distinct(AgentInvocation.node_id)
            .order_by(AgentInvocation.node_id, AgentInvocation.iteration.desc())
        )
        .scalars()
        .all()
    )
    return {inv.node_id: inv for inv in rows}


def _run_detail(session, node: AgentNode, run_id: str, owner_id: uuid.UUID) -> dict:
    try:
        rid = uuid.UUID(str(run_id))
    except ValueError as exc:
        raise NodeHistoryNotFound("run not found for this agent") from exc
    run = session.get(Run, rid)
    clone = None
    if run is not None and run.owner_id == owner_id:
        clone = session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == run.team_graph_id,
                AgentNode.cloned_from_node_id == node.id,
            )
        ).scalar_one_or_none()
    if run is None or clone is None:
        raise NodeHistoryNotFound("run not found for this agent")

    edges = [
        {
            "source": str(e.source_node_id),
            "target": str(e.target_node_id),
            "edge_type": e.edge_type,
            "conditions": e.conditions,
        }
        for e in session.execute(select(Edge).where(Edge.team_graph_id == run.team_graph_id))
        .scalars()
        .all()
    ]
    is_entry = not any(e["target"] == str(clone.id) for e in edges)
    emits = node_emits_outcome(edges, str(clone.id))
    invocations = (
        session.execute(
            select(AgentInvocation)
            .where(AgentInvocation.node_id == clone.id, AgentInvocation.run_id == str(run.id))
            .order_by(AgentInvocation.iteration.desc())
        )
        .scalars()
        .all()
    )
    inv_ids = [inv.id for inv in invocations]
    costs = _cost_by_invocation(session, str(run.id), inv_ids)
    jobs = _desktop_jobs_by_invocation(session, str(run.id), inv_ids)
    docs = _run_documents(session, run)
    skills = _skills_given(session, clone.skills, owner_id)

    rounds = []
    for inv in invocations:
        cost, model_used = costs.get(inv.id, (None, None))
        job = jobs.get(inv.id)
        model = model_used or (job.model if job is not None else None) or clone.model
        if job is not None:
            runs_on = {"via": "subscription", "provider": job.provider}
        else:
            runs_on = {"via": "api_key", "provider": provider_for_model(model) if model else None}
        rounds.append(
            {
                "invocation_id": inv.id,
                "iteration": inv.iteration,
                "status": inv.status,
                "outcome": inv.outcome,
                "outcome_detail": inv.outcome_detail,
                "started_at": inv.started_at.isoformat(),
                "ended_at": _iso(inv.ended_at),
                "cost": cost,
                "model_used": model,
                "runs_on": runs_on,
                "given": {
                    "documents": _documents_given(inv, clone, run, docs, is_entry),
                    "memory": list((inv.context_manifest or {}).get("memory") or []),
                    "skills": skills,
                },
                "produced": _produced(inv, clone, run, docs, emits, is_entry, job),
            }
        )
    return {**_run_brief(run), "rounds": rounds}


def _cost_by_invocation(
    session, run_id: str, inv_ids: list[int]
) -> dict[int, tuple[dict, str | None]]:
    """Each round's summed cost (the ``/graph`` ``cost`` shape) + the model its latest cost row
    actually used (a fallback may have swapped it)."""
    if not inv_ids:
        return {}
    rows = session.execute(
        select(CostRecord)
        .where(CostRecord.workflow_id == run_id, CostRecord.invocation_id.in_(inv_ids))
        .order_by(CostRecord.created_at, CostRecord.id)
    ).scalars()
    out: dict[int, tuple[dict, str | None]] = {}
    for row in rows:
        cost, _model = out.get(row.invocation_id, (_ZERO_COST, None))
        cost = {
            "prompt_tokens": cost["prompt_tokens"] + row.prompt_tokens,
            "completion_tokens": cost["completion_tokens"] + row.completion_tokens,
            "total_tokens": cost["total_tokens"] + row.total_tokens,
            "cost_usd": cost["cost_usd"] + float(row.cost_usd),
        }
        out[row.invocation_id] = (cost, row.model_used)
    return out


def _desktop_jobs_by_invocation(session, run_id: str, inv_ids: list[int]) -> dict[int, object]:
    if not inv_ids:
        return {}
    rows = session.execute(
        select(DesktopNodeJob).where(
            DesktopNodeJob.run_id == run_id, DesktopNodeJob.invocation_id.in_(inv_ids)
        )
    ).scalars()
    return {job.invocation_id: job for job in rows}


def _run_documents(session, run: Run) -> list[dict]:
    """Every document of the run with its versions (no content): ``[{document_id, name,
    is_shared_spec, versions: [{version_no, created_at, idempotency_key}]}]``."""
    match = Document.run_id == run.id
    if run.pm_document_id is not None:  # a legacy spec may predate run-scoped documents
        match = or_(match, Document.id == run.pm_document_id)
    docs = session.execute(select(Document).where(match)).scalars().all()
    out = []
    for doc in docs:
        versions = session.execute(
            select(
                DocumentVersion.version_no,
                DocumentVersion.created_at,
                DocumentVersion.idempotency_key,
            )
            .where(DocumentVersion.document_id == doc.id)
            .order_by(DocumentVersion.version_no)
        ).all()
        is_spec = doc.id == run.pm_document_id
        out.append(
            {
                "document_id": str(doc.id),
                "name": doc.name or ("spec" if is_spec else doc.doc_type),
                "is_shared_spec": is_spec,
                "versions": [
                    {"version_no": v, "created_at": at, "idempotency_key": key}
                    for v, at, key in versions
                ],
            }
        )
    return out


def _version_at(doc: dict, at: datetime) -> int | None:
    """The version a round read: the latest version created at or before the round started."""
    seen = [v["version_no"] for v in doc["versions"] if v["created_at"] <= at]
    return max(seen) if seen else None


def _documents_given(
    inv: AgentInvocation, clone: AgentNode, run: Run, docs: list[dict], is_entry: bool
) -> list[dict]:
    """The documents a round read. Prefer what the executor recorded in the round's manifest
    (``context_manifest.documents``); for older rounds, reconstruct from the node's reads and the
    version that existed when the round started."""
    recorded = (inv.context_manifest or {}).get("documents")
    if isinstance(recorded, list):
        return recorded
    cfg = clone.config if isinstance(clone.config, dict) else {}
    names = resolve_reads_from(cfg)
    given = []
    if names:
        by_name = {d["name"]: d for d in docs if not d["is_shared_spec"]}
        spec = next((d for d in docs if d["is_shared_spec"]), None)
        for name in names:
            doc = by_name.get(name) or (spec if spec and spec["name"] == name else None)
            version = _version_at(doc, inv.started_at) if doc else None
            if doc is not None and version is not None:
                given.append(_doc_ref(doc, version))
        return given
    if cfg.get("reads_default") is False:
        return given
    spec = next((d for d in docs if d["is_shared_spec"]), None)
    if spec is not None:
        version = _version_at(spec, inv.started_at)
        # The entry's first round has no spec yet (it writes it) — nothing read.
        if version is not None and not (is_entry and inv.iteration == 1):
            given.append(_doc_ref(spec, version))
    return given


def _doc_ref(doc: dict, version_no: int) -> dict:
    return {
        "document_id": doc["document_id"],
        "name": doc["name"],
        "version_no": version_no,
        "is_shared_spec": doc["is_shared_spec"],
    }


def _produced(
    inv: AgentInvocation,
    clone: AgentNode,
    run: Run,
    docs: list[dict],
    emits: bool,
    is_entry: bool,
    job,
) -> dict | None:
    """What a finished round produced: the verdict (for an agent that routes on one), the document
    versions it wrote (matched by the executor's idempotency keys), and the files it changed when
    known (Desktop jobs record them; hosted workers list them in ``outcome_detail``). ``None`` while
    the round is still running."""
    if inv.status == "running":
        return None
    verdict = None
    if emits and inv.outcome in VERDICT_OUTCOMES:
        verdict = {
            "file": "REVIEW_VERDICT.json",
            "verdict": inv.outcome,
            "reasons": inv.outcome_detail,
        }
    rid, nid, n = str(run.id), str(clone.id), inv.iteration
    spec_keys = {f"{rid}:spec:{nid}:{n}"}
    if is_entry and n == 1:
        spec_keys.add(f"{rid}:pm-prd-v1")  # the entry's first round creates the spec (v1)
    written = []
    for doc in docs:
        for v in doc["versions"]:
            key = v["idempotency_key"] or ""
            own_doc_key = key.startswith(f"{rid}:doc:") and key.endswith(f":{nid}:{n}")
            if own_doc_key or (doc["is_shared_spec"] and key in spec_keys):
                written.append(_doc_ref(doc, v["version_no"]))
    files = list(job.files_changed) if job is not None and job.files_changed else None
    return {"verdict": verdict, "documents": written, "files": files}


def _skills_given(session, sources: list | None, owner_id: uuid.UUID) -> list[dict]:
    """The skills a run's clone carried (its immutable snapshot of the node's ``skills``), one row
    per source: ``{type, name, mode, triggers?}``. Library refs are labelled from the owner's
    library (live); repo sources by their filter or URL + ref."""
    out: list[dict] = []
    for source in sources or []:
        if not isinstance(source, dict):
            continue
        stype = source.get("type")
        if stype == "inline":
            out.append(
                {
                    "type": "inline",
                    "name": source.get("name"),
                    "mode": source.get("mode") or "always",
                    "triggers": list(source.get("triggers") or []),
                }
            )
        elif stype == "library":
            item = None
            try:
                item = session.execute(
                    select(SkillLibraryItem).where(
                        SkillLibraryItem.id == uuid.UUID(str(source.get("id"))),
                        SkillLibraryItem.owner_id == owner_id,
                    )
                ).scalar_one_or_none()
            except ValueError:
                item = None
            lib = item.source if item is not None and isinstance(item.source, dict) else {}
            out.append(
                {
                    "type": "library",
                    "id": source.get("id"),
                    "name": item.name if item is not None else None,
                    "mode": source.get("mode") or lib.get("mode") or "always",
                    "triggers": list(source.get("triggers") or lib.get("triggers") or []),
                }
            )
        elif stype == "repo":
            out.append(
                {
                    "type": "repo",
                    "name": source.get("filter") or source.get("url"),
                    "url": source.get("url"),
                    "ref": source.get("ref"),
                    "mode": source.get("mode"),
                    "triggers": list(source.get("triggers") or []),
                }
            )
        elif stype == "project_rules":
            out.append({"type": "project_rules", "name": "Repo rules files", "mode": None})
    return out

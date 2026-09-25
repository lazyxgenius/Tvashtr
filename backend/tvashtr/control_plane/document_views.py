"""Read models + the human live-edit path for run documents (revamp B-DOCS).

Everything here is owner-scoped by the caller's ``owner_id`` (a document belongs to the account
that owns its run — :func:`tvashtr.documents.service.owned_by`). It turns raw rows into what the
Focus view, the Documents drawer and the Document viewer show:

* each version's **author** (``{kind, node_id, role_name, label}`` — the AUTHORED node, so it
  matches the team canvas) and **change note** (stored since ``0041``; derived from
  ``idempotency_key`` for older rows);
* each run document's **writers** and **readers**, derived from the run's team snapshot (the clone
  the run executed) — who is configured to write it (``writes_to`` / the entry agent for the shared
  spec) and who gets it in context (``reads_from``, or the default spec);
* the human save with its two conflicts: ``stale_version`` (someone saved a newer version since the
  editor opened) and ``run_finished`` (edits can no longer reach the run's agents).
"""

import re
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select

from tvashtr.control_plane.context_compiler import resolve_reads_from, resolve_writes_to
from tvashtr.db import session_scope
from tvashtr.documents.service import (
    LatestVersionInfo,
    StaleVersionError,
    add_version,
    owned_by,
)
from tvashtr.models import AgentNode, Document, DocumentVersion, Edge, Run

# A run whose status is one of these is still walking; its agents re-read documents at their next
# step, so a human edit can still reach them. Every other status is terminal.
LIVE_RUN_STATUSES = frozenset({"pending", "running", "awaiting_human"})

HUMAN_EDIT_NOTE = "Edited while the run was live"
RUN_FINISHED_MESSAGE = "This run has finished — edits can’t reach its agents."

# Mirrors the frontend's seeded-role titles; any other role is humanized ("tech_writer" →
# "Tech writer"). A node's own ``config.title`` (the agent's display name) wins over both.
_ROLE_TITLES = {
    "pm": "Product manager",
    "architect": "Architect",
    "engineer": "Engineer",
    "reviewer": "Reviewer",
}
_AGENT_KINDS = ("completion", "agent")


class DocumentNotFound(Exception):
    """The document doesn't exist or belongs to another account (→ 404)."""


class RunFinished(Exception):
    """The document's run is no longer live (→ 409 ``run_finished``)."""


class StaleVersion(Exception):
    """The edit's base is not the newest version (→ 409 ``stale_version``)."""

    def __init__(self, latest_version_no: int, latest_author: dict | None) -> None:
        super().__init__("stale version")
        self.latest_version_no = latest_version_no
        self.latest_author = latest_author


def humanize_role(role_name: str) -> str:
    spaced = re.sub(r"[_-]+", " ", role_name).strip()
    return spaced[:1].upper() + spaced[1:] if spaced else role_name


def agent_label(role_name: str | None, config: dict | None) -> str:
    title = (config or {}).get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    if not role_name:
        return "Agent"
    return _ROLE_TITLES.get(role_name, humanize_role(role_name))


def derive_note(note: str | None, idempotency_key: str, created_by: str) -> str | None:
    """The version's change note: the stored one, else derived from the writer's idempotency key
    (rows written before ``0041``) — ``{run}:pm-prd-v1`` → "First draft",
    ``{run}:spec:{node}:{n}`` → "Revised in round {n}", ``{run}:doc:{name}:{node}:{n}`` →
    "Round {n}", a human edit → "Edited while the run was live". ``None`` when nothing fits."""
    if note:
        return note
    key = idempotency_key or ""
    if created_by == "human" or key.startswith("human-edit:"):
        return HUMAN_EDIT_NOTE
    if key.endswith(":pm-prd-v1"):
        return "First draft"
    parts = key.split(":")
    if len(parts) >= 4 and parts[1] == "spec" and parts[-1].isdigit():
        return f"Revised in round {parts[-1]}"
    if len(parts) >= 5 and parts[1] == "doc" and parts[-1].isdigit():
        return f"Round {parts[-1]}"
    return None


# ---- the run's team snapshot ------------------------------------------------------------------


@dataclass(frozen=True)
class _Node:
    clone_id: uuid.UUID
    origin_id: uuid.UUID
    role_name: str
    kind: str
    config: dict
    emits: bool

    def ref(self) -> dict:
        return {
            "node_id": str(self.origin_id),
            "clone_node_id": str(self.clone_id),
            "role_name": self.role_name,
            "label": agent_label(self.role_name, self.config),
        }

    def author(self) -> dict:
        return {
            "kind": "agent",
            "node_id": str(self.origin_id),
            "role_name": self.role_name,
            "label": agent_label(self.role_name, self.config),
        }


@dataclass
class _RunGraph:
    nodes: list[_Node]
    entry: _Node | None
    by_clone: dict[uuid.UUID, _Node] = field(default_factory=dict)
    by_origin: dict[uuid.UUID, _Node] = field(default_factory=dict)
    by_role: dict[str, _Node] = field(default_factory=dict)


def _load_graph(session, team_graph_id: uuid.UUID) -> _RunGraph:
    rows = (
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team_graph_id))
        .scalars()
        .all()
    )
    edges = session.execute(select(Edge).where(Edge.team_graph_id == team_graph_id)).scalars().all()
    emitting = {
        e.source_node_id
        for e in edges
        if e.edge_type != "escalation" and isinstance(e.conditions, dict) and "when" in e.conditions
    }
    targets = {e.target_node_id for e in edges}
    nodes = [
        _Node(
            clone_id=n.id,
            origin_id=n.cloned_from_node_id or n.id,
            role_name=n.role_name,
            kind=n.kind,
            config=dict(n.config or {}),
            emits=n.id in emitting,
        )
        for n in rows
    ]
    # The entry agent is the graph root (no incoming edge) — the executor's start-node rule.
    roots = sorted((n for n in nodes if n.clone_id not in targets), key=lambda n: str(n.clone_id))
    graph = _RunGraph(nodes=nodes, entry=roots[0] if roots else None)
    for n in nodes:
        graph.by_clone[n.clone_id] = n
        graph.by_origin.setdefault(n.origin_id, n)
        graph.by_role.setdefault(n.role_name, n)
    return graph


def _author(session, graph: _RunGraph, created_by: str, author_node_id: uuid.UUID | None) -> dict:
    """``{kind, node_id, role_name, label}`` for one version. ``node_id`` is the AUTHORED node."""
    if created_by == "human":
        return {"kind": "human", "node_id": None, "role_name": None, "label": "You"}
    if author_node_id is not None:
        node = graph.by_origin.get(author_node_id)
        if node is not None:
            return node.author()
        row = session.get(AgentNode, author_node_id)
        if row is not None:
            return {
                "kind": "agent",
                "node_id": str(author_node_id),
                "role_name": row.role_name,
                "label": agent_label(row.role_name, row.config),
            }
    token = created_by.split(":", 1)[1] if created_by.startswith("agent:") else ""
    node = None
    if token == "entry":
        node = graph.entry
    elif token:
        try:
            node = graph.by_clone.get(uuid.UUID(token))
        except ValueError:
            node = graph.by_role.get(token)
    if node is not None:
        return node.author()
    role = token if token and token != "entry" else None
    return {
        "kind": "agent",
        "node_id": str(author_node_id) if author_node_id else None,
        "role_name": role,
        "label": agent_label(role, None),
    }


def _version_dict(session, graph: _RunGraph, v: DocumentVersion) -> dict:
    return {
        "id": str(v.id),
        "document_id": str(v.document_id),
        "version_no": v.version_no,
        "content": v.content,
        "created_by": v.created_by,
        "created_at": v.created_at.isoformat(),
        "note": derive_note(v.note, v.idempotency_key, v.created_by),
        "author": _author(session, graph, v.created_by, v.author_node_id),
    }


def _document_run(session, doc: Document) -> Run | None:
    if doc.run_id is not None:
        return session.get(Run, doc.run_id)
    return (
        session.execute(select(Run).where(Run.pm_document_id == doc.id).order_by(Run.created_at))
        .scalars()
        .first()
    )


def _run_summary(run: Run) -> dict:
    return {
        "run_id": str(run.id),
        "idea": run.idea,
        "status": run.status,
        "created_at": run.created_at.isoformat(),
        "live": run.status in LIVE_RUN_STATUSES,
    }


def _document_meta(doc: Document) -> dict:
    # The same keys ``routers._document_meta`` returns (kept identical, additive fields follow).
    return {
        "id": str(doc.id),
        "title": doc.title,
        "doc_type": doc.doc_type,
        "name": doc.name,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }


def _reads(node: _Node, name: str | None, is_shared_spec: bool) -> bool:
    """Does ``node`` get this document in its context? A node with ``reads_from`` reads exactly
    those names; one without reads the shared spec unless ``reads_default`` is ``False``."""
    if node.kind not in _AGENT_KINDS:
        return False
    names = resolve_reads_from(node.config)
    if names:
        return name is not None and name in names
    return is_shared_spec and node.config.get("reads_default") is not False


def _writers(graph: _RunGraph, doc: Document, is_shared_spec: bool, authors: list) -> list[dict]:
    """Who writes this document: the entry agent for the shared spec, every non-emitting agent whose
    ``writes_to`` names it (an emitting agent's ``writes_to`` is ignored by the executor), plus any
    agent that actually wrote a version of it."""
    out: list[_Node] = []
    for n in graph.nodes:
        if n.kind not in _AGENT_KINDS:
            continue
        if is_shared_spec and n is graph.entry:
            out.append(n)
        elif n is not graph.entry and not n.emits and resolve_writes_to(n.config) == doc.name:
            out.append(n)
    for origin in authors:
        node = graph.by_origin.get(origin) if origin else None
        if node is not None and node not in out:
            out.append(node)
    return [n.ref() for n in out]


# ---- public entry points -----------------------------------------------------------------------


def run_documents(run_id: uuid.UUID) -> dict:
    """``GET /api/runs/{id}/documents`` for an ALREADY owner-checked run: the run summary + every
    document it produced (oldest first) with its latest version, writers and readers."""
    with session_scope() as session:
        run = session.get(Run, run_id)
        graph = _load_graph(session, run.team_graph_id)
        docs = (
            session.execute(
                select(Document).where(Document.run_id == run.id).order_by(Document.created_at)
            )
            .scalars()
            .all()
        )
        versions = (
            session.execute(
                select(DocumentVersion)
                .where(DocumentVersion.document_id.in_([d.id for d in docs]))
                .order_by(DocumentVersion.version_no)
            )
            .scalars()
            .all()
            if docs
            else []
        )
        by_doc: dict[uuid.UUID, list[DocumentVersion]] = {}
        for v in versions:
            by_doc.setdefault(v.document_id, []).append(v)
        items = []
        for doc in docs:
            chain = by_doc.get(doc.id, [])
            is_shared_spec = doc.id == run.pm_document_id
            latest = chain[-1] if chain else None
            authors = [_author(session, graph, v.created_by, v.author_node_id) for v in chain]
            item = _document_meta(doc)
            item.update(
                {
                    "is_shared_spec": is_shared_spec,
                    "version_count": len(chain),
                    "latest_version": None
                    if latest is None
                    else {
                        "version_no": latest.version_no,
                        "created_at": latest.created_at.isoformat(),
                        "author": authors[-1],
                        "note": derive_note(latest.note, latest.idempotency_key, latest.created_by),
                    },
                    "written_by": _writers(
                        graph,
                        doc,
                        is_shared_spec,
                        [
                            uuid.UUID(a["node_id"])
                            for a in authors
                            if a["kind"] == "agent" and a["node_id"]
                        ],
                    ),
                    "read_by": [
                        n.ref() for n in graph.nodes if _reads(n, doc.name, is_shared_spec)
                    ],
                }
            )
            items.append(item)
        return {"run_id": str(run.id), "run": _run_summary(run), "documents": items}


def owned_document(document_id: uuid.UUID, owner_id: uuid.UUID) -> dict | None:
    """``GET /api/documents/{id}``: the document + every version (with author and note), its run,
    whether it is the run's shared spec, and whether a human can save a version now (``editable`` —
    the run is live). ``None`` when the account doesn't own it."""
    with session_scope() as session:
        doc = session.execute(
            select(Document).where(Document.id == document_id, owned_by(owner_id))
        ).scalar_one_or_none()
        if doc is None:
            return None
        run = _document_run(session, doc)
        graph = _load_graph(session, run.team_graph_id)
        versions = (
            session.execute(
                select(DocumentVersion)
                .where(DocumentVersion.document_id == doc.id)
                .order_by(DocumentVersion.version_no)
            )
            .scalars()
            .all()
        )
        payload = _document_meta(doc)
        payload.update(
            {
                "run_id": str(run.id),
                "is_shared_spec": run.pm_document_id == doc.id,
                "editable": run.status in LIVE_RUN_STATUSES,
                "versions": [_version_dict(session, graph, v) for v in versions],
            }
        )
        return payload


def add_human_version(
    document_id: uuid.UUID,
    owner_id: uuid.UUID,
    content: str,
    *,
    base_version_no: int | None = None,
    note: str | None = None,
) -> dict:
    """Save a human edit as the document's next version and return the full version dict.

    Raises :class:`DocumentNotFound` (not owned), :class:`RunFinished` (the run is terminal — its
    agents will never read the edit) or :class:`StaleVersion` (``base_version_no`` is not the newest
    version: someone saved in between; nothing is written). ``note`` defaults to "Edited while the
    run was live"."""
    with session_scope() as session:
        doc = session.execute(
            select(Document).where(Document.id == document_id, owned_by(owner_id))
        ).scalar_one_or_none()
        if doc is None:
            raise DocumentNotFound
        run = _document_run(session, doc)
        if run.status not in LIVE_RUN_STATUSES:
            raise RunFinished
        team_graph_id = run.team_graph_id
    try:
        version = add_version(
            document_id,
            content,
            created_by="human",
            idempotency_key=f"human-edit:{document_id}:{uuid.uuid4().hex}",
            note=(note or "").strip() or HUMAN_EDIT_NOTE,
            expected_base=base_version_no,
        )
    except StaleVersionError as exc:
        raise _stale(exc.latest, team_graph_id) from None
    with session_scope() as session:
        graph = _load_graph(session, team_graph_id)
        return _version_dict(session, graph, session.get(DocumentVersion, version.id))


def _stale(latest: LatestVersionInfo | None, team_graph_id: uuid.UUID) -> StaleVersion:
    if latest is None:
        return StaleVersion(0, None)
    with session_scope() as session:
        graph = _load_graph(session, team_graph_id)
        author = _author(session, graph, latest.created_by, latest.author_node_id)
    return StaleVersion(latest.version_no, author)


def stale_message(exc: StaleVersion) -> str:
    """The save-conflict copy (DOCS-30)."""
    who = (exc.latest_author or {}).get("label")
    if not who or (exc.latest_author or {}).get("kind") == "human":
        return (
            f"A newer v{exc.latest_version_no} was saved while you were editing. "
            "Compare, then save again."
        )
    return f"{who} saved v{exc.latest_version_no} while you were editing. Compare, then save again."

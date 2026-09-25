"""The focus view's "Preview as the agent sees it" (frontend revamp, B-NODES).

Backs ``POST /api/teams/{team_id}/nodes/{node_id}/context-preview``: compile what an authored agent
would receive on its first round — with the drawer's UNSAVED draft applied — through the SAME pure
:func:`context_compiler.compile_context` the executor uses, so the parts, their order and their
token counts are the real ones. The idea and documents come from a run of the team (the one asked
for, else the latest); a team that never ran gets placeholders.

No LLM and no embedding calls: remembered lessons are the PINNED in-scope facts only (the
similarity-ranked rest needs an embedding and is added at run time — a note says so), and skills
are read from their stored sources (repo skills and repo rules are fetched at run time and are
listed without content)."""

import uuid

from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.context_compiler import (
    compile_context,
    estimate_tokens,
    resolve_context_budget,
    resolve_reads_from,
    resolve_remember_enabled,
)
from tvashtr.control_plane.credential_gate import subscription_for_model
from tvashtr.control_plane.memory_retrieval import retrieve_for_node
from tvashtr.control_plane.node_history import NodeHistoryNotFound, require_team_node
from tvashtr.control_plane.node_library import resolve_owner_skill_source
from tvashtr.control_plane.team_run import node_emits_outcome
from tvashtr.db import session_scope
from tvashtr.models import (
    AgentNode,
    Document,
    DocumentVersion,
    Edge,
    Run,
    SkillLibraryItem,
)

IDEA_PLACEHOLDER = "No run yet — the idea you type when you press Run goes here."
_SUBSCRIPTION_LABELS = {"claude": "Claude", "grok": "Grok", "codex": "Codex"}

_PART_LABELS = {
    "node_prompt": "Your instructions",
    "memory": "Remembered lessons",
    "idea": "The idea",
    "spec": "The latest spec",
    "read_documents": "Documents it reads",
    "revision": "Rework note",
    "grounding": "Repo map",
    "worker_protocol": "Worker protocol",
    "worker_focus": "Focus",
    "capability_note": "Report-only note",
    "remember_protocol": "How to record lessons",
}


class ContextPreviewError(ValueError):
    """A request the preview cannot serve (not an agent node) — the route answers 422."""


def _latest_team_run(session, team_graph_id: uuid.UUID, owner_id: uuid.UUID) -> Run | None:
    origin = select(AgentNode.id).where(AgentNode.team_graph_id == team_graph_id)
    clone_graphs = select(AgentNode.team_graph_id).where(AgentNode.cloned_from_node_id.in_(origin))
    return (
        session.execute(
            select(Run)
            .where(Run.owner_id == owner_id, Run.team_graph_id.in_(clone_graphs))
            .order_by(Run.created_at.desc(), Run.id)
            .limit(1)
        )
        .scalars()
        .first()
    )


def _owned_team_run(session, run_id: str, team_graph_id: uuid.UUID, owner_id: uuid.UUID) -> Run:
    try:
        rid = uuid.UUID(str(run_id))
    except ValueError as exc:
        raise NodeHistoryNotFound("run not found for this team") from exc
    run = session.get(Run, rid)
    if run is None or run.owner_id != owner_id:
        raise NodeHistoryNotFound("run not found for this team")
    origin = select(AgentNode.id).where(AgentNode.team_graph_id == team_graph_id)
    of_team = session.execute(
        select(AgentNode.id)
        .where(
            AgentNode.team_graph_id == run.team_graph_id, AgentNode.cloned_from_node_id.in_(origin)
        )
        .limit(1)
    ).first()
    if of_team is None:
        raise NodeHistoryNotFound("run not found for this team")
    return run


def _latest_version(session, match) -> DocumentVersion | None:
    return (
        session.execute(
            select(DocumentVersion)
            .join(Document, Document.id == DocumentVersion.document_id)
            .where(match)
            .order_by(DocumentVersion.version_no.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )


def _node_name(node: AgentNode) -> str:
    cfg = node.config if isinstance(node.config, dict) else {}
    title = cfg.get("title")
    return title if isinstance(title, str) and title.strip() else node.role_name


def preview_node_context(
    team_id: str, node_id: str, owner_id: uuid.UUID, draft: dict | None = None
) -> dict:
    """Compile the node's first-round context with ``draft`` overrides applied.

    ``draft`` keys (each optional; absent = the saved node): ``prompt``, ``edits_allowed``,
    ``reads_from``, ``reads_default``, ``skills``, ``memory_remember_enabled``, ``model``, plus
    ``run_id`` (whose idea + documents to use; default the team's latest run) and ``idea`` (a
    typed idea that overrides the run's)."""
    draft = dict(draft or {})
    settings = get_settings()
    notes: list[str] = []
    with session_scope() as session:
        node = require_team_node(session, team_id, node_id, owner_id)
        if node.kind not in ("agent", "completion"):
            raise ContextPreviewError("Only agents have a context preview.")
        cfg = dict(node.config) if isinstance(node.config, dict) else {}
        edges = [
            {
                "source": str(e.source_node_id),
                "target": str(e.target_node_id),
                "edge_type": e.edge_type,
                "conditions": e.conditions,
            }
            for e in session.execute(select(Edge).where(Edge.team_graph_id == node.team_graph_id))
            .scalars()
            .all()
        ]
        nid = str(node.id)
        is_entry = not any(e["target"] == nid for e in edges)
        emits = node_emits_outcome(edges, nid)
        reworked = any(
            e["target"] == nid
            and isinstance(e["conditions"], dict)
            and "loop_limit" in e["conditions"]
            for e in edges
        )
        entry_node = None
        if not is_entry:
            targets = {e["target"] for e in edges}
            entry_node = session.execute(
                select(AgentNode)
                .where(AgentNode.team_graph_id == node.team_graph_id, AgentNode.id.notin_(targets))
                .order_by(AgentNode.id)
                .limit(1)
            ).scalar_one_or_none()

        # ---- the draft over the saved node ----
        prompt = draft["prompt"] if draft.get("prompt") is not None else (node.prompt or "")
        model = draft["model"] if draft.get("model") is not None else (node.model or "")
        edits_allowed = (
            bool(draft["edits_allowed"])
            if draft.get("edits_allowed") is not None
            else node.edits_allowed
        )
        if "reads_from" in draft:
            cfg["reads_from"] = draft["reads_from"]
        if "reads_default" in draft:
            if draft["reads_default"] is None:
                cfg.pop("reads_default", None)
            else:
                cfg["reads_default"] = bool(draft["reads_default"])
        if draft.get("memory_remember_enabled") is not None:
            cfg["memory_remember_enabled"] = bool(draft["memory_remember_enabled"])
        skills = draft["skills"] if "skills" in draft else node.skills
        reads_from = resolve_reads_from(cfg)
        reads_default = cfg.get("reads_default") is not False
        remember = resolve_remember_enabled(cfg) and edits_allowed
        budget = resolve_context_budget(settings, cfg)

        # ---- the run the idea + documents come from ----
        if draft.get("run_id"):
            run = _owned_team_run(session, draft["run_id"], node.team_graph_id, owner_id)
        else:
            run = _latest_team_run(session, node.team_graph_id, owner_id)
        source_run = (
            {"run_id": str(run.id), "idea": run.idea, "created_at": run.created_at.isoformat()}
            if run is not None
            else None
        )
        typed_idea = draft.get("idea")
        idea_placeholder = False
        if isinstance(typed_idea, str) and typed_idea.strip():
            idea, idea_source = typed_idea, {"label": "The idea you typed"}
        elif run is not None:
            idea, idea_source = (
                run.idea,
                {"label": "Typed when you pressed Run", "run_id": str(run.id)},
            )
        else:
            idea, idea_source, idea_placeholder = IDEA_PLACEHOLDER, {"label": "No run yet"}, True

        spec: str | None = None
        spec_source: dict | None = None
        spec_placeholder = False
        read_documents: list[dict] = []
        read_sources: list[dict] = []
        if reads_from:
            for name in reads_from:
                version = (
                    _latest_version(session, (Document.run_id == run.id) & (Document.name == name))
                    if run is not None
                    else None
                )
                if version is None:
                    notes.append(f"“{name}” isn’t written yet in this run, so it’s skipped.")
                    continue
                read_documents.append({"name": name, "content": version.content})
                read_sources.append(
                    {
                        "document_id": str(version.document_id),
                        "name": name,
                        "version_no": version.version_no,
                    }
                )
        elif not reads_default:
            notes.append("It reads no documents: the default spec is turned off.")
        elif is_entry:
            notes.append(
                "It writes the shared spec, so its first round starts from the idea alone."
            )
        else:
            version = (
                _latest_version(session, Document.id == run.pm_document_id)
                if run is not None and run.pm_document_id is not None
                else None
            )
            if version is not None:
                spec = version.content
                spec_source = {
                    "document_id": str(version.document_id),
                    "name": "spec",
                    "version_no": version.version_no,
                    "label": f"Shared spec · v{version.version_no}",
                }
            else:
                writer = _node_name(entry_node) if entry_node is not None else "The first agent"
                spec = f"No spec yet — {writer} writes it on the first run."
                spec_source = {"label": "No spec yet"}
                spec_placeholder = True

        repo_key = (run.github_repo or run.repo_path) if run is not None else None
        brownfield = run is not None and bool(run.repo_path or run.github_repo)
        skill_rows = _preview_skills(session, skills, owner_id)

    # Pinned lessons only — the ranked rest needs an embedding (no model calls in a preview).
    memory = retrieve_for_node(owner_id, repo_key, node.id, "", embed_query=lambda _q: None)
    notes.append(
        "Pinned lessons are shown. At run time, other lessons that match the task are added too."
    )

    compiled = compile_context(
        node_prompt=prompt,
        idea=idea,
        spec=spec,
        iteration=1,
        reviewer_feedback=None,
        grounding=None,
        emits_outcome=emits,
        subpath=None,
        budget=budget,
        edits_allowed=edits_allowed,
        memory=memory or None,
        remember_enabled=remember,
        read_documents=read_documents or None,
    )
    sources = {
        "node_prompt": {"label": "Setup → Instructions"},
        "memory": {"label": f"Pinned lessons · {len(memory)}"},
        "idea": idea_source,
        "spec": spec_source,
        "read_documents": {
            "label": " · ".join(f"{d['name']} v{d['version_no']}" for d in read_sources),
            "documents": read_sources,
        },
        "capability_note": {"label": "Setup → File access: Read-only"},
        "remember_protocol": {"label": "Memory → Remember what it learns"},
    }
    placeholders = {"idea": idea_placeholder, "spec": spec_placeholder}
    parts = [
        {
            "key": part.name,
            "label": _PART_LABELS.get(part.name, part.name),
            "text": part.text.lstrip("\n"),
            "tokens": part.tokens,
            "source": sources.get(part.name),
            "placeholder": placeholders.get(part.name, False),
        }
        for part in compiled.parts
    ]

    if reworked or not is_entry:
        notes.append("On a rework round, the requested changes are added after the documents.")
    if brownfield or run is None:
        notes.append("Repo map is added at run time when working on a real folder.")
    if compiled.handle_used:
        notes.append("The spec is long, so the agent reads it from ./SPEC.md instead.")
    if any(s["fetched_at_run_time"] for s in skill_rows):
        notes.append("Repo skills and rules files are fetched when the team runs.")
    subscription = subscription_for_model(model) if model else None
    if subscription:
        label = _SUBSCRIPTION_LABELS.get(subscription, subscription.title())
        notes.append(
            f"On Tvashtr Desktop with your {label} subscription, skills are added to the "
            "instructions and tools aren’t used yet."
        )

    return {
        "source_run": source_run,
        "parts": parts,
        "skills": skill_rows,
        "skills_tokens": sum(s["tokens"] for s in skill_rows if s["mode"] == "always"),
        "total_tokens": compiled.total_tokens,
        "budget": compiled.budget,
        "over_budget": compiled.over_budget,
        "handle_used": compiled.handle_used,
        "notes": notes,
    }


def _skill_row(name, mode, triggers, content, source_type, fetched: bool, **extra) -> dict:
    return {
        "name": name,
        "mode": mode,
        "triggers": list(triggers or []),
        "delivery": "context",
        "content": content,
        "tokens": estimate_tokens(content) if content else 0,
        "source_type": source_type,
        "fetched_at_run_time": fetched,
        **extra,
    }


def _preview_skills(session, sources: list | None, owner_id: uuid.UUID) -> list[dict]:
    """One row per skill source, with its content when it is stored (inline, or a library item
    whose source is inline). A per-agent ``mode``/``triggers`` on a reference wins over the library
    item's own."""
    rows: list[dict] = []
    for source in sources or []:
        if not isinstance(source, dict):
            continue
        stype = source.get("type")
        if stype == "inline":
            rows.append(
                _skill_row(
                    source.get("name"),
                    source.get("mode") or "always",
                    source.get("triggers"),
                    source.get("content"),
                    "inline",
                    False,
                )
            )
        elif stype == "library":
            lib = resolve_owner_skill_source(owner_id, source.get("id"))
            if not isinstance(lib, dict):
                continue  # a dangling ref — skipped at run time too
            item_name = None
            try:
                item_name = session.execute(
                    select(SkillLibraryItem.name).where(
                        SkillLibraryItem.id == uuid.UUID(str(source.get("id")))
                    )
                ).scalar_one_or_none()
            except ValueError:
                item_name = None
            inline = lib.get("type") == "inline"
            rows.append(
                _skill_row(
                    item_name or lib.get("name") or lib.get("url"),
                    source.get("mode") or lib.get("mode") or ("always" if inline else None),
                    source.get("triggers") or lib.get("triggers"),
                    lib.get("content") if inline else None,
                    "library",
                    not inline,
                    id=source.get("id"),
                )
            )
        elif stype == "repo":
            rows.append(
                _skill_row(
                    source.get("filter") or source.get("url"),
                    source.get("mode"),
                    source.get("triggers"),
                    None,
                    "repo",
                    True,
                    url=source.get("url"),
                    ref=source.get("ref"),
                )
            )
        elif stype == "project_rules":
            rows.append(_skill_row("Repo rules files", None, None, None, "project_rules", True))
    return rows

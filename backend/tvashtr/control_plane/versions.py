"""M5 — team versions (ruling R3; contract ``docs/superpowers/plans/api/versions.md``).

The team as you edit it is a working copy, kept exactly as today. A version is an explicit
checkpoint: the team in the M4 file format (``snapshot``) and a full copy of its rows (``graph`` —
What changed and Restore read it). "Changes since vN" compares the working copy's rows with the
latest version's: nodes by id, routes by what they say, positions never.

Not a DBOS module: nothing here is a workflow or a step (the executor never imports it), so the DBOS
application version is unchanged."""

from __future__ import annotations

import difflib
import json
import uuid
from copy import deepcopy

from sqlalchemy import func, select

from tvashtr.control_plane import team_file
from tvashtr.control_plane.node_history import _run_number
from tvashtr.control_plane.node_templates import NODE_TEMPLATES
from tvashtr.control_plane.run_failure import node_label
from tvashtr.models import AgentNode, Edge, Run, TeamGraph, TeamVersion

NOTE_LIMIT = 200
_BUILTIN_PROMPTS = {t["role_name"]: (t["title"], t["prompt"]) for t in NODE_TEMPLATES}
# The node's config keys that have a field of their own in a change row; the rest are "Settings".
_OWN_KEYS = ("title", "description", "fallback_model")


# --------------------------------------------------------------------------------- the rows


def capture(session, team: TeamGraph) -> dict:
    """The team's content as plain JSON: its fields, every node by id (canvas order) and every
    edge. Positions ride along for Restore (a node that comes back goes where it was) but never
    count as a change."""
    nodes = (
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team.id)).scalars().all()
    )
    edges = session.execute(select(Edge).where(Edge.team_graph_id == team.id)).scalars().all()

    def where(n: AgentNode) -> tuple:
        pos = n.position if isinstance(n.position, dict) else {}
        return (pos.get("x", 0) or 0, pos.get("y", 0) or 0, str(n.id))

    return {
        "team": {
            "name": team.name,
            "budget_usd": float(team.budget_usd) if team.budget_usd is not None else None,
            "repo": team.repo,
        },
        "nodes": [
            {
                "id": str(n.id),
                "role_name": n.role_name,
                "kind": n.kind,
                "prompt": n.prompt,
                "model": n.model,
                "engine": n.engine,
                "position": deepcopy(n.position),
                "config": deepcopy(n.config),
                "tool_config": deepcopy(n.tool_config),
                "skills": deepcopy(n.skills),
                "edits_allowed": n.edits_allowed,
                "cloned_from_node_id": str(n.cloned_from_node_id)
                if n.cloned_from_node_id
                else None,
            }
            for n in sorted(nodes, key=where)
        ],
        "edges": [
            {
                "id": str(e.id),
                "source": str(e.source_node_id),
                "target": str(e.target_node_id),
                "edge_type": e.edge_type,
                "conditions": deepcopy(e.conditions),
            }
            for e in edges
        ],
    }


def _label(node: dict) -> str:
    cfg = node.get("config") if isinstance(node.get("config"), dict) else {}
    if node.get("kind") == "gate" and isinstance(cfg.get("title"), str) and cfg["title"].strip():
        return cfg["title"].strip()
    return node_label(node.get("role_name"), node.get("kind"), cfg)


def _route(edge: dict, names: dict) -> str:
    cond = edge.get("conditions") if isinstance(edge.get("conditions"), dict) else {}
    text = f"{names.get(edge['source'], '?')} → {names.get(edge['target'], '?')}"
    if cond.get("when"):
        text += f" · when {str(cond['when']).replace('_', ' ')}"
    if cond.get("loop_limit"):
        n = cond["loop_limit"]
        text += f" · up to {n} round" + ("" if n == 1 else "s")
    return text


def _edge_key(edge: dict) -> str:
    return json.dumps(
        [edge["source"], edge["target"], edge["edge_type"], edge.get("conditions") or {}],
        sort_keys=True,
    )


def _money(value) -> str | None:
    return None if value is None else f"${value:,.2f}"


def _text_lines(before: str | None, after: str | None, context: int = 1) -> tuple[list, int, int]:
    """The changed lines of a text with ``context`` unchanged lines around each change."""
    a, b = (before or "").splitlines(), (after or "").splitlines()
    lines: list[dict] = []
    removed = added = 0
    for group in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_grouped_opcodes(context):
        for tag, i1, i2, j1, j2 in group:
            if tag == "equal":
                lines += [{"op": "context", "text": t} for t in a[i1:i2]]
                continue
            if tag in ("replace", "delete"):
                lines += [{"op": "removed", "text": t} for t in a[i1:i2]]
                removed += i2 - i1
            if tag in ("replace", "insert"):
                lines += [{"op": "added", "text": t} for t in b[j1:j2]]
                added += j2 - j1
    return lines, removed, added


def _node_rows(before: dict, after: dict) -> list[dict]:
    """One row per changed field of one node (same id in both)."""
    label = _label(after)
    base = {"node_id": after["id"], "agent": label, "role": after.get("role_name")}
    rows: list[dict] = []

    def value(field: str, key: str, old, new) -> None:
        if old != new:
            rows.append(
                {
                    **base,
                    "key": f"node:{after['id']}:{key}",
                    "field": field,
                    "kind": "value",
                    "before": old,
                    "after": new,
                }
            )

    def changed(field: str, key: str) -> None:
        rows.append({**base, "key": f"node:{after['id']}:{key}", "field": field, "kind": "changed"})

    cfg_a = before.get("config") if isinstance(before.get("config"), dict) else {}
    cfg_b = after.get("config") if isinstance(after.get("config"), dict) else {}
    if (before.get("kind"), before.get("role_name")) != (after.get("kind"), after.get("role_name")):
        changed("Type", "type")
    value("Name", "title", cfg_a.get("title"), cfg_b.get("title"))
    if (before.get("prompt") or "") != (after.get("prompt") or ""):
        lines, removed, added = _text_lines(before.get("prompt"), after.get("prompt"))
        rows.append(
            {
                **base,
                "key": f"node:{after['id']}:prompt",
                "field": "Instructions",
                "kind": "text",
                "removed": removed,
                "added": added,
                "lines": lines,
            }
        )
    value("Model", "model", before.get("model"), after.get("model"))
    value(
        "Backup model", "fallback_model", cfg_a.get("fallback_model"), cfg_b.get("fallback_model")
    )
    if after.get("kind") in ("agent", "completion") and bool(before.get("edits_allowed")) != bool(
        after.get("edits_allowed")
    ):
        word = {True: "can edit", False: "read-only"}
        value(
            "File access",
            "edits_allowed",
            word[bool(before.get("edits_allowed"))],
            word[bool(after.get("edits_allowed"))],
        )
    if (before.get("skills") or None) != (after.get("skills") or None):
        changed("Skills", "skills")
    if (before.get("tool_config") or None) != (after.get("tool_config") or None):
        changed("Tools", "tool_config")
    value("Description", "description", cfg_a.get("description"), cfg_b.get("description"))
    rest_a = {k: v for k, v in cfg_a.items() if k not in _OWN_KEYS}
    rest_b = {k: v for k, v in cfg_b.items() if k not in _OWN_KEYS}
    if rest_a != rest_b or before.get("engine") != after.get("engine"):
        changed("Gate" if after.get("kind") == "gate" else "Settings", "config")
    return rows


def diff(before: dict, after: dict) -> list[dict]:
    """The change rows from ``before`` to ``after`` (two :func:`capture` results): team fields,
    then nodes in canvas order, then routes."""
    rows: list[dict] = []
    ta, tb = before.get("team") or {}, after.get("team") or {}
    for key, field, show in (
        ("name", "Team name", lambda v: v),
        ("budget_usd", "Budget", _money),
        ("repo", "Repo", lambda v: v),
    ):
        if ta.get(key) != tb.get(key):
            rows.append(
                {
                    "key": f"team:{key}",
                    "agent": None,
                    "field": field,
                    "kind": "value",
                    "before": show(ta.get(key)),
                    "after": show(tb.get(key)),
                }
            )
    old = {n["id"]: n for n in before.get("nodes") or []}
    new = {n["id"]: n for n in after.get("nodes") or []}
    for node in after.get("nodes") or []:
        if node["id"] in old:
            rows += _node_rows(old[node["id"]], node)
        else:
            rows.append(
                {
                    "key": f"node:{node['id']}",
                    "node_id": node["id"],
                    "agent": _label(node),
                    "role": node.get("role_name"),
                    "field": None,
                    "kind": "added",
                    "gate": node.get("kind") == "gate",
                }
            )
    for node in before.get("nodes") or []:
        if node["id"] not in new:
            rows.append(
                {
                    "key": f"node:{node['id']}",
                    "node_id": node["id"],
                    "agent": _label(node),
                    "role": node.get("role_name"),
                    "field": None,
                    "kind": "removed",
                    "gate": node.get("kind") == "gate",
                }
            )
    names = {n["id"]: _label(n) for n in (before.get("nodes") or []) + (after.get("nodes") or [])}
    left = [_edge_key(e) for e in before.get("edges") or []]
    right = [_edge_key(e) for e in after.get("edges") or []]
    by_key = {_edge_key(e): e for e in (before.get("edges") or []) + (after.get("edges") or [])}
    pending = list(left)
    added = []
    for key in right:
        if key in pending:
            pending.remove(key)
        else:
            added.append(key)
    for kind, keys in (("added", added), ("removed", pending)):
        for key in keys:
            rows.append(
                {
                    "key": f"route:{len(rows)}",
                    "agent": None,
                    "field": "Routes",
                    "kind": kind,
                    "text": _route(by_key[key], names),
                }
            )
    return rows


def unchanged(rows: list[dict]) -> list[str]:
    """The categories ``rows`` doesn't touch: "models, routes, gates and budget are the same"."""
    touched = set()
    for r in rows:
        if r.get("field") in ("Model", "Backup model"):
            touched.add("models")
        elif r.get("field") == "Routes":
            touched.add("routes")
        elif r.get("field") == "Budget":
            touched.add("budget")
        if r.get("field") == "Gate" or r.get("gate"):
            touched.add("gates")
    return [c for c in ("models", "routes", "gates", "budget") if c not in touched]


def _phrase(row: dict) -> str:
    """One row as a summary ("Reviewer: instructions changed")."""
    who, field, kind = row.get("agent"), row.get("field"), row["kind"]
    if field is None:
        what = f"the {who} gate" if row.get("gate") and "gate" not in who.lower() else f"the {who}"
        return f"Added {what}" if kind == "added" else f"Removed {what}"
    if field == "Routes":
        return f"{'Added' if kind == 'added' else 'Removed'} a route: {row['text']}"
    if field == "Team name":
        return f"Renamed the team to {row['after']}"
    if field in ("Budget", "Repo"):
        return f"{field} changed to {row['after']}" if row.get("after") else f"{field} cleared"
    if field == "Model":
        return (
            f"{who}: model changed to {row['after']}"
            if row.get("after")
            else f"{who}: model cleared"
        )
    if field == "Backup model":
        if not row.get("before"):
            return f"{who}: added a backup model"
        if not row.get("after"):
            return f"{who}: removed the backup model"
        return f"{who}: backup model changed to {row['after']}"
    if field == "File access":
        return f"{who}: file access changed to {row['after']}"
    if field == "Name":
        return f"Renamed {row['before'] or 'an agent'} to {row['after']}"
    return f"{who}: {field.lower()} changed"


def summary(rows: list[dict]) -> str:
    if not rows:
        return "No changes"
    if len(rows) == 1:
        return _phrase(rows[0])
    agents = {r.get("agent") for r in rows}
    fields = [r["field"].lower() for r in rows if r.get("field")]
    if len(agents) == 1 and None not in agents and len(fields) == len(rows):
        unique = list(dict.fromkeys(fields))
        joined = unique[0] if len(unique) == 1 else ", ".join(unique[:-1]) + " and " + unique[-1]
        return f"{rows[0]['agent']}: {joined} changed"
    more = len(rows) - 1
    return f"{_phrase(rows[0])} and {more} more change" + ("" if more == 1 else "s")


# ------------------------------------------------------------------------------- the versions


def _locked(session, team: TeamGraph) -> None:
    """Hold the team row while a number is chosen (two saves never take the same number)."""
    session.execute(select(TeamGraph.id).where(TeamGraph.id == team.id).with_for_update())


def latest(session, team: TeamGraph) -> TeamVersion | None:
    return session.execute(
        select(TeamVersion)
        .where(TeamVersion.team_graph_id == team.id)
        .order_by(TeamVersion.number.desc())
        .limit(1)
    ).scalar_one_or_none()


def _insert(
    session,
    team: TeamGraph,
    *,
    graph: dict,
    author_id: uuid.UUID | None,
    source: str,
    summary_text: str,
    note: str | None = None,
    restored_from: int | None = None,
) -> TeamVersion:
    top = session.execute(
        select(func.max(TeamVersion.number)).where(TeamVersion.team_graph_id == team.id)
    ).scalar()
    version = TeamVersion(
        team_graph_id=team.id,
        number=(top or 0) + 1,
        snapshot=team_file.export_team(session, team),
        graph=graph,
        summary=summary_text,
        note=note,
        author_id=author_id,
        source=source,
        restored_from=restored_from,
    )
    session.add(version)
    session.flush()
    return version


def ensure_first(session, team: TeamGraph, author_id: uuid.UUID | None) -> TeamVersion:
    """The team's latest version, making v1 = its current state when it has none."""
    found = latest(session, team)
    if found is not None:
        return found
    _locked(session, team)
    found = latest(session, team)
    if found is not None:
        return found
    first = "Imported from a team file" if team.template_key == "import" else "First version"
    return _insert(
        session,
        team,
        graph=capture(session, team),
        author_id=author_id or team.owner_id,
        source="first",
        summary_text=first,
    )


def pending(session, team: TeamGraph, author_id: uuid.UUID | None) -> tuple[TeamVersion, list]:
    """``(latest version, change rows since it)``."""
    top = ensure_first(session, team, author_id)
    return top, diff(top.graph, capture(session, team))


def save(
    session,
    team: TeamGraph,
    author_id: uuid.UUID | None,
    *,
    source: str = "save",
    note: str | None = None,
) -> TeamVersion | None:
    """Save the working copy as a new version; ``None`` when nothing changed."""
    ensure_first(session, team, author_id)
    _locked(session, team)
    top = latest(session, team)
    now = capture(session, team)
    rows = diff(top.graph, now)
    if not rows:
        return None
    return _insert(
        session,
        team,
        graph=now,
        author_id=author_id,
        source=source,
        summary_text=summary(rows),
        note=(note or "").strip()[:NOTE_LIMIT] or None,
    )


def for_run(session, team_id: uuid.UUID, author_id: uuid.UUID) -> tuple[int, bool]:
    """Starting a run: ``(the version it runs on, whether this launch saved it)`` — changes since
    the latest version are saved as a new one first, so every run has a version."""
    team = session.get(TeamGraph, team_id)
    saved = save(session, team, author_id, source="run")
    if saved is not None:
        return saved.number, True
    return latest(session, team).number, False


def restore_plan(session, team: TeamGraph, number: int, author_id) -> dict | None:
    """What Restore vN would do: ``None`` for a number the team doesn't have."""
    top, rows_since = pending(session, team, author_id)
    target = _version(session, team, number)
    if target is None:
        return None
    draft_saved_as = top.number + 1 if rows_since else None
    return {
        "number": number,
        "makes": top.number + (2 if rows_since else 1),
        "current": top.number,
        "draft_saved_as": draft_saved_as,
        "changes": diff(capture(session, team), target.graph),
    }


def restore(session, team: TeamGraph, number: int, author_id) -> dict | None:
    """Make the working copy equal to vN (nodes keep their ids: memory and history stay with
    them) and save it as a NEW version. The working copy's changes are saved first."""
    target = _version(session, team, number)
    if target is None:
        return None
    draft = save(session, team, author_id)
    _apply(session, team, target.graph)
    session.flush()
    session.expire_all()
    team = session.get(TeamGraph, team.id)
    _locked(session, team)
    version = _insert(
        session,
        team,
        graph=capture(session, team),
        author_id=author_id,
        source="restore",
        summary_text=f"Restored v{number}",
        restored_from=number,
    )
    return {
        "number": version.number,
        "restored_from": number,
        "draft_saved_as": draft.number if draft is not None else None,
    }


def _apply(session, team: TeamGraph, graph: dict) -> None:
    """Rows equal to ``graph``: removed nodes go, missing ones come back with their own id (where
    they were), the others take its content and keep their place; the edges are its edges."""
    t = graph.get("team") or {}
    team.name = t.get("name") or team.name
    team.budget_usd = t.get("budget_usd")
    team.repo = t.get("repo")
    wanted = {n["id"]: n for n in graph.get("nodes") or []}
    for edge in session.execute(select(Edge).where(Edge.team_graph_id == team.id)).scalars():
        session.delete(edge)
    session.flush()
    current = {
        str(n.id): n
        for n in session.execute(select(AgentNode).where(AgentNode.team_graph_id == team.id))
        .scalars()
        .all()
    }
    for node_id, node in current.items():
        if node_id not in wanted:
            session.delete(node)
    session.flush()
    for node_id, row in wanted.items():
        node = current.get(node_id)
        if node is None:
            node = AgentNode(
                id=uuid.UUID(node_id), team_graph_id=team.id, position=deepcopy(row["position"])
            )
            session.add(node)
        node.role_name = row["role_name"]
        node.kind = row["kind"]
        node.prompt = row["prompt"]
        node.model = row["model"]
        node.engine = row["engine"]
        node.config = deepcopy(row["config"])
        node.tool_config = deepcopy(row["tool_config"])
        node.skills = deepcopy(row["skills"])
        node.edits_allowed = row["edits_allowed"]
    session.flush()
    session.add_all(
        Edge(
            team_graph_id=team.id,
            source_node_id=uuid.UUID(e["source"]),
            target_node_id=uuid.UUID(e["target"]),
            edge_type=e["edge_type"],
            conditions=deepcopy(e["conditions"]),
        )
        for e in graph.get("edges") or []
    )


def _version(session, team: TeamGraph, number: int) -> TeamVersion | None:
    return session.execute(
        select(TeamVersion).where(
            TeamVersion.team_graph_id == team.id, TeamVersion.number == number
        )
    ).scalar_one_or_none()


# ------------------------------------------------------------------------------- the readers


def _who(version: TeamVersion, viewer: uuid.UUID) -> str:
    return "you" if version.author_id in (None, viewer) else "someone else"


def _runs_by_version(session, team: TeamGraph) -> dict[int, int]:
    return dict(
        session.execute(
            select(Run.team_version_number, func.count())
            .where(Run.library_team_id == team.id, Run.team_version_number.is_not(None))
            .group_by(Run.team_version_number)
        ).all()
    )


def _row(version: TeamVersion, viewer: uuid.UUID, runs: int) -> dict:
    return {
        "number": version.number,
        "created_at": version.created_at.isoformat(),
        "author": _who(version, viewer),
        "summary": version.summary,
        "note": version.note,
        "runs": runs,
        "source": version.source,
        "restored_from": version.restored_from,
    }


def listing(session, team: TeamGraph, viewer: uuid.UUID) -> dict:
    top, rows = pending(session, team, viewer)
    runs = _runs_by_version(session, team)
    versions = (
        session.execute(
            select(TeamVersion)
            .where(TeamVersion.team_graph_id == team.id)
            .order_by(TeamVersion.number.desc())
        )
        .scalars()
        .all()
    )
    return {
        "current": top.number,
        "saved_at": top.created_at.isoformat(),
        "changes": len(rows),
        "next": top.number + 1,
        "total": len(versions),
        "versions": [_row(v, viewer, runs.get(v.number, 0)) for v in versions],
    }


def detail(session, team: TeamGraph, number: int, viewer: uuid.UUID) -> dict | None:
    top = ensure_first(session, team, viewer)
    version = _version(session, team, number)
    if version is None:
        return None
    before = _version(session, team, number - 1) if number > 1 else None
    rows = diff(before.graph, version.graph) if before is not None else []
    runs = (
        session.execute(
            select(Run)
            .where(Run.library_team_id == team.id, Run.team_version_number == number)
            .order_by(Run.created_at.desc())
        )
        .scalars()
        .all()
    )
    return {
        **_row(version, viewer, len(runs)),
        "current": version.number == top.number,
        "compared_with": before.number if before is not None else None,
        "changes": rows,
        "same": unchanged(rows) if before is not None else [],
        "runs": [
            {
                "run_id": str(r.id),
                "number": _run_number(session, r),
                "idea": r.idea,
                "status": r.status,
            }
            for r in runs
        ],
    }


def instruction_history(session, team: TeamGraph, node_id: str, viewer: uuid.UUID) -> dict:
    """The versions in which this node's instructions changed, newest first."""
    ensure_first(session, team, viewer)
    versions = (
        session.execute(
            select(TeamVersion)
            .where(TeamVersion.team_graph_id == team.id)
            .order_by(TeamVersion.number)
        )
        .scalars()
        .all()
    )
    entries: list[dict] = []
    previous: str | None = None
    seen = False
    for version in versions:
        node = next((n for n in version.graph.get("nodes") or [] if n["id"] == node_id), None)
        if node is None:
            continue
        text = node.get("prompt") or ""
        if seen and text == previous:
            continue
        entry = {
            "number": version.number,
            "created_at": version.created_at.isoformat(),
            "author": _who(version, viewer),
            "current": False,
            "first": not seen,
            "text": text,
            "added": [],
            "removed": [],
        }
        if seen:
            for line in _text_lines(previous, text, context=0)[0]:
                entry[line["op"]].append(line["text"])
        else:
            title, prompt = _BUILTIN_PROMPTS.get(node.get("role_name"), (None, None))
            if prompt is not None and text == prompt:
                entry["from_builtin"] = title
        entries.append(entry)
        previous, seen = text, True
    last = versions[-1] if versions else None
    if (
        entries
        and last is not None
        and any(n["id"] == node_id for n in last.graph.get("nodes") or [])
    ):
        entries[-1]["current"] = True
    entries.reverse()
    return {"count": len(entries), "entries": entries}

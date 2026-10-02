"""M6 — my agents and recent tasks (ruling R4; contract
``docs/superpowers/plans/api/my-agents.md``).

A saved agent is one agent's setup, saved from its panel to use in any of the owner's teams. A
version holds the included parts — instructions, model (+ backup), skills and tools, file access,
and the agent's own memories only when asked — with secrets masked or left out (a sign-in, a key or
a secret value is never in a node's setup: a connector grant and a ``${NAME}`` are references; an
inline server whose settings hold a literal secret is left out). Using one writes its parts to the
node at once (R4: no confirm; Undo puts back what it returns); the node keeps its id, role, kind,
routes, documents, position and its own memories. ``config.based_on`` records which version it uses.

Not a DBOS module: nothing here is a workflow or a step, so the DBOS application version is
unchanged."""

from __future__ import annotations

import re
import uuid
from copy import deepcopy
from datetime import UTC, datetime

from sqlalchemy import func, select

from tvashtr.control_plane import team_file, tool_usage, versions
from tvashtr.control_plane.guardrails import mask_secrets
from tvashtr.control_plane.node_history import _run_number
from tvashtr.control_plane.run_failure import node_label
from tvashtr.control_plane.run_views import _like, status_group
from tvashtr.models import (
    AgentNode,
    Edge,
    NodeMemory,
    Run,
    SavedAgent,
    SavedAgentVersion,
    TeamGraph,
)

PARTS = ("instructions", "model", "skills_tools", "file_access", "memories")
NAME_MAX = 60
PURPOSE_MAX = 300
AGENT_KINDS = tool_usage.AGENT_KINDS
_REF = re.compile(r"^\$\{[A-Za-z_][A-Za-z0-9_]*\}$")


class MyAgentsError(Exception):
    """A refusal with its HTTP status and plain words."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _not_found(what: str = "agent") -> MyAgentsError:
    return MyAgentsError(404, f"{what} not found")


def _uuid(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


# --------------------------------------------------------------------------- what is saved


def _label(node: AgentNode) -> str:
    return node_label(node.role_name, node.kind, node.config)


def _safe_server(server) -> bool:
    """An inline server travels only when nothing in it is a literal secret: every env / header
    value is a ``${NAME}`` reference and masking changes nothing else in it."""
    if not isinstance(server, dict):
        return False
    for key in ("env", "headers"):
        values = server.get(key) or {}
        if not isinstance(values, dict):
            return False
        if any(not (isinstance(v, str) and _REF.match(v.strip())) for v in values.values()):
            return False
    rest = {k: v for k, v in server.items() if k not in ("env", "headers")}
    return team_file._masked(rest) == rest


def _clean_tool_config(tool_config) -> dict | None:
    config = deepcopy(tool_config) if isinstance(tool_config, dict) else {}
    servers = config.get("mcpServers")
    if isinstance(servers, dict):
        kept = {name: s for name, s in servers.items() if _safe_server(s)}
        if kept:
            config["mcpServers"] = kept
        else:
            config.pop("mcpServers")
    return config or None


def _clean_skills(skills) -> list | None:
    out = []
    for entry in skills if isinstance(skills, list) else []:
        if not isinstance(entry, dict):
            continue
        entry = deepcopy(entry)
        if entry.get("type") == "inline" and isinstance(entry.get("content"), str):
            entry["content"] = mask_secrets(entry["content"])
        if entry.get("type") == "repo":
            url = team_file._github_repo(entry.get("url"))
            if url is None:
                continue  # only a plain GitHub repo travels (never a URL with a sign-in in it)
            entry["url"] = url
        out.append(entry)
    return out or None


def _tool_names(session, owner_id, tool_config) -> dict:
    live = versions._live(session, owner_id)["tools"]
    names = {}
    for ref in versions._library(tool_config):
        tid = _uuid(ref)
        if tid in live:
            names[str(tid)] = live[tid]
    return names


def _parts(session, owner_id, node: AgentNode, include: list[str]) -> dict:
    cfg = node.config if isinstance(node.config, dict) else {}
    parts: dict = {
        "source": {
            "kind": node.kind,
            "role_name": node.role_name,
            "title": cfg.get("title"),
            "description": cfg.get("description"),
        }
    }
    if "instructions" in include:
        parts["prompt"] = mask_secrets(node.prompt or "")
    if "model" in include:
        parts["model"] = node.model
        parts["fallback_model"] = cfg.get("fallback_model")
    if "skills_tools" in include:
        parts["skills"] = _clean_skills(node.skills)
        parts["tool_config"] = _clean_tool_config(node.tool_config)
        parts["tool_names"] = _tool_names(session, owner_id, parts["tool_config"])
    if "file_access" in include:
        parts["edits_allowed"] = bool(node.edits_allowed)
    return parts


def _memories(session, owner_id, node: AgentNode) -> list[dict]:
    """The agent's OWN memories (node tier: never the repo's or the account's)."""
    rows = session.execute(
        select(NodeMemory).where(
            NodeMemory.owner_id == owner_id,
            NodeMemory.node_id == node.id,
            NodeMemory.repo_key.is_(None),
            NodeMemory.status == "active",
            NodeMemory.invalid_at.is_(None),
        )
    ).scalars()
    return [
        {
            "content": mask_secrets(m.content),
            "polarity": m.polarity,
            "pinned": bool(m.pinned),
            "embedding": [float(x) for x in m.embedding] if m.embedding is not None else None,
        }
        for m in rows
    ]


# ------------------------------------------------------------------------------ the rows


def _owned_agent(session, owner_id, agent_id, *, lock: bool = False) -> SavedAgent:
    aid = _uuid(agent_id)
    stmt = select(SavedAgent).where(SavedAgent.id == aid, SavedAgent.owner_id == owner_id)
    if lock:
        stmt = stmt.with_for_update()
    agent = session.execute(stmt).scalar_one_or_none() if aid else None
    if agent is None:
        raise _not_found()
    return agent


def _owned_node(session, owner_id, team_id, node_id) -> tuple[TeamGraph, AgentNode]:
    tid, nid = _uuid(team_id), _uuid(node_id)
    team = session.get(TeamGraph, tid) if tid else None
    if team is None or not team.is_library or team.owner_id != owner_id:
        raise _not_found("team")
    node = session.get(AgentNode, nid) if nid else None
    if node is None or node.team_graph_id != team.id:
        raise _not_found("node")
    return team, node


def _latest(session, agent: SavedAgent) -> SavedAgentVersion:
    return session.execute(
        select(SavedAgentVersion)
        .where(SavedAgentVersion.saved_agent_id == agent.id)
        .order_by(SavedAgentVersion.number.desc())
        .limit(1)
    ).scalar_one()


def _version(session, agent: SavedAgent, number: int | None) -> SavedAgentVersion:
    if number is None:
        return _latest(session, agent)
    found = session.execute(
        select(SavedAgentVersion).where(
            SavedAgentVersion.saved_agent_id == agent.id, SavedAgentVersion.number == number
        )
    ).scalar_one_or_none()
    if found is None:
        raise _not_found("version")
    return found


def _based_on(node: AgentNode) -> dict | None:
    cfg = node.config if isinstance(node.config, dict) else {}
    based = cfg.get("based_on")
    return based if isinstance(based, dict) else None


def _set_based_on(node: AgentNode, value: dict | None) -> None:
    cfg = dict(node.config) if isinstance(node.config, dict) else {}
    if value is None:
        cfg.pop("based_on", None)
    else:
        cfg["based_on"] = value
    node.config = cfg or None


def item(session, owner_id, agent: SavedAgent) -> dict:
    """The agent as ``GET /api/my-agents`` lists it."""
    all_versions = (
        session.execute(
            select(SavedAgentVersion)
            .where(SavedAgentVersion.saved_agent_id == agent.id)
            .order_by(SavedAgentVersion.number.desc())
        )
        .scalars()
        .all()
    )
    top = all_versions[0]
    parts = top.parts
    tools = len(versions._library(parts.get("tool_config"))) + len(
        (parts.get("tool_config") or {}).get("mcpServers") or {}
    )
    used: dict[uuid.UUID, dict] = {}
    for node, team in tool_usage.owner_agent_nodes(session, owner_id):
        based = _based_on(node)
        if not based or _uuid(based.get("id")) != agent.id:
            continue
        row = used.setdefault(
            team.id,
            {"team_id": str(team.id), "team_name": team.name, "version": None, "node_ids": []},
        )
        version = based.get("version")
        if isinstance(version, int) and (row["version"] is None or version < row["version"]):
            row["version"] = version
        row["node_ids"].append(str(node.id))
    used_in = list(used.values())
    return {
        "id": str(agent.id),
        "name": agent.name,
        "purpose": agent.purpose,
        "latest": top.number,
        "updated_at": agent.updated_at.isoformat(),
        "built_on": top.built_on,
        "model": parts.get("model"),
        "skills": len(parts.get("skills") or []),
        "tools": tools,
        "file_access": None
        if "edits_allowed" not in parts
        else ("can edit" if parts["edits_allowed"] else "read-only"),
        "versions": [
            {"number": v.number, "created_at": v.created_at.isoformat(), "included": v.included}
            for v in all_versions
        ],
        "used_in": used_in,
        "behind": [
            {"team_id": u["team_id"], "team_name": u["team_name"], "version": u["version"]}
            for u in used_in
            if isinstance(u["version"], int) and u["version"] < top.number
        ],
    }


def listing(session, owner_id) -> list[dict]:
    agents = (
        session.execute(
            select(SavedAgent)
            .where(SavedAgent.owner_id == owner_id)
            .order_by(SavedAgent.updated_at.desc(), SavedAgent.id)
        )
        .scalars()
        .all()
    )
    return [item(session, owner_id, a) for a in agents]


# ------------------------------------------------------------------------------ the writes


def _name(value: str) -> str:
    name = " ".join((value or "").split())
    if not name or len(name) > NAME_MAX:
        raise MyAgentsError(422, f"A name is 1 to {NAME_MAX} characters.")
    return name


def _by_name(session, owner_id, name: str) -> SavedAgent | None:
    return session.execute(
        select(SavedAgent)
        .where(SavedAgent.owner_id == owner_id, func.lower(SavedAgent.name) == name.lower())
        .with_for_update()
    ).scalar_one_or_none()


def save(
    session, owner_id, *, team_id, node_id, name: str, purpose: str, include: list[str]
) -> dict:
    """Save as my agent: a new name makes v1, a name the account has makes its next version. The
    node then carries ``based_on`` that version (not a change of the team)."""
    name = _name(name)
    include = [p for p in PARTS if p in set(include)]
    if not [p for p in include if p != "memories"]:
        raise MyAgentsError(422, "Include at least one part of the agent.")
    _team, node = _owned_node(session, owner_id, team_id, node_id)
    if node.kind not in AGENT_KINDS:
        raise _not_found("node")
    agent = _by_name(session, owner_id, name)
    created = agent is None
    now = datetime.now(UTC)
    if created:
        agent = SavedAgent(owner_id=owner_id, name=name, purpose=(purpose or "")[:PURPOSE_MAX])
        session.add(agent)
        session.flush()
        number = 1
    else:
        if purpose is not None:
            agent.purpose = purpose[:PURPOSE_MAX]
        agent.updated_at = now
        number = (
            session.execute(
                select(func.max(SavedAgentVersion.number)).where(
                    SavedAgentVersion.saved_agent_id == agent.id
                )
            ).scalar()
            or 0
        ) + 1
    session.add(
        SavedAgentVersion(
            saved_agent_id=agent.id,
            number=number,
            parts=_parts(session, owner_id, node, include),
            included=include,
            memories=_memories(session, owner_id, node) if "memories" in include else None,
            built_on=_label(node),
            author_id=owner_id,
        )
    )
    _set_based_on(node, {"id": str(agent.id), "name": agent.name, "version": number})
    session.flush()
    return {"agent": item(session, owner_id, agent), "version": number, "created": created}


def rename(session, owner_id, agent_id, *, name: str | None, purpose: str | None) -> dict:
    agent = _owned_agent(session, owner_id, agent_id, lock=True)
    if name is not None:
        name = _name(name)
        clash = _by_name(session, owner_id, name)
        if clash is not None and clash.id != agent.id:
            raise MyAgentsError(409, f"You already have an agent called {name}.")
        agent.name = name
    if purpose is not None:
        agent.purpose = purpose[:PURPOSE_MAX]
    agent.updated_at = datetime.now(UTC)
    session.flush()
    return item(session, owner_id, agent)


def delete(session, owner_id, agent_id) -> None:
    """Delete it and its versions. Never changes a team: its nodes keep their parts and
    ``based_on``."""
    session.delete(_owned_agent(session, owner_id, agent_id, lock=True))


def _entry_node_id(session, team_id) -> uuid.UUID | None:
    """The team's entry (the node no route leads into) — it writes the spec, so it stays read-only
    (the PATCH's rule, ``routers._team_root_node_id``)."""
    nodes = session.execute(
        select(AgentNode.id).where(AgentNode.team_graph_id == team_id)
    ).scalars()
    targets = set(
        session.execute(select(Edge.target_node_id).where(Edge.team_graph_id == team_id)).scalars()
    )
    roots = sorted((n for n in nodes if n not in targets), key=str)
    return roots[0] if roots else None


def _before(node: AgentNode) -> dict:
    cfg = node.config if isinstance(node.config, dict) else {}
    return {
        "prompt": node.prompt,
        "model": node.model,
        "fallback_model": cfg.get("fallback_model"),
        "skills": deepcopy(node.skills),
        "tool_config": deepcopy(node.tool_config),
        "edits_allowed": node.edits_allowed,
        "based_on": deepcopy(cfg.get("based_on")),
        "memory_ids": [],
    }


def _apply(session, owner_id, team: TeamGraph, node: AgentNode, agent, version) -> dict:
    """Write the version's parts to the node; return what was there (for Undo)."""
    if node.kind not in AGENT_KINDS:
        raise MyAgentsError(409, "Only an agent can use a saved agent.")
    before = _before(node)
    parts = version.parts
    if "prompt" in parts:
        node.prompt = parts["prompt"]
    if "model" in parts:
        node.model = parts["model"]
        cfg = dict(node.config) if isinstance(node.config, dict) else {}
        if parts.get("fallback_model"):
            cfg["fallback_model"] = parts["fallback_model"]
        else:
            cfg.pop("fallback_model", None)
        node.config = cfg or None
    if "tool_config" in parts or "skills" in parts:
        node.tool_config, node.skills = versions._reconcile(
            {
                "tool_config": parts.get("tool_config"),
                "skills": parts.get("skills"),
                "tool_names": parts.get("tool_names") or {},
            },
            versions._live(session, owner_id),
        )
    if "edits_allowed" in parts:
        entry = _entry_node_id(session, team.id) == node.id
        node.edits_allowed = False if entry else bool(parts["edits_allowed"])
    for memory in version.memories or []:
        row = NodeMemory(
            owner_id=owner_id,
            node_id=node.id,
            content=memory["content"],
            polarity=memory.get("polarity") or "context",
            pinned=bool(memory.get("pinned")),
            embedding=memory.get("embedding"),
            status="active",
        )
        session.add(row)
        session.flush()
        before["memory_ids"].append(str(row.id))
    _set_based_on(node, {"id": str(agent.id), "name": agent.name, "version": version.number})
    session.flush()
    return before


def use(session, owner_id, *, team_id, node_id, agent_id, number: int | None) -> dict:
    team, node = _owned_node(session, owner_id, team_id, node_id)
    agent = _owned_agent(session, owner_id, agent_id)
    version = _version(session, agent, number)
    before = _apply(session, owner_id, team, node, agent, version)
    return {
        "node_id": str(node.id),
        "before": before,
        "text": f"{_label(node)} now uses {agent.name} v{version.number}",
    }


def undo(session, owner_id, *, team_id, node_id, before: dict) -> str:
    """Put back what a use / update returned: the parts, ``based_on``, and remove the memories it
    copied."""
    _team, node = _owned_node(session, owner_id, team_id, node_id)
    if not isinstance(before, dict) or node.kind not in AGENT_KINDS:
        raise MyAgentsError(422, "Nothing to undo.")
    if isinstance(before.get("prompt"), str) and before["prompt"].strip():
        node.prompt = before["prompt"]
    if isinstance(before.get("model"), str) and before["model"]:
        node.model = before["model"]
    cfg = dict(node.config) if isinstance(node.config, dict) else {}
    if before.get("fallback_model"):
        cfg["fallback_model"] = before["fallback_model"]
    else:
        cfg.pop("fallback_model", None)
    node.config = cfg or None
    if "tool_config" in before:
        node.tool_config = (
            before["tool_config"] if isinstance(before["tool_config"], dict) else None
        )
    if "skills" in before:
        node.skills = before["skills"] if isinstance(before["skills"], list) else None
    if isinstance(before.get("edits_allowed"), bool):
        entry = _entry_node_id(session, node.team_graph_id) == node.id
        node.edits_allowed = False if entry else before["edits_allowed"]
    based = before.get("based_on")
    _set_based_on(node, based if isinstance(based, dict) else None)
    ids = [i for i in map(_uuid, before.get("memory_ids") or []) if i]
    for memory in session.execute(
        select(NodeMemory).where(
            NodeMemory.id.in_(ids), NodeMemory.owner_id == owner_id, NodeMemory.node_id == node.id
        )
    ).scalars():
        session.delete(memory)
    session.flush()
    return str(node.id)


def detach(session, owner_id, *, team_id, node_id) -> str:
    _team, node = _owned_node(session, owner_id, team_id, node_id)
    _set_based_on(node, None)
    session.flush()
    return str(node.id)


def update_team(session, owner_id, agent_id, team_id) -> dict:
    """Bring a team's agents based on an older version up to the latest."""
    agent = _owned_agent(session, owner_id, agent_id)
    tid = _uuid(team_id)
    team = session.get(TeamGraph, tid) if tid else None
    if team is None or not team.is_library or team.owner_id != owner_id:
        raise _not_found("team")
    top = _latest(session, agent)
    updated = []
    for node in (
        session.execute(
            select(AgentNode).where(
                AgentNode.team_graph_id == team.id, AgentNode.kind.in_(AGENT_KINDS)
            )
        )
        .scalars()
        .all()
    ):
        based = _based_on(node)
        if not based or _uuid(based.get("id")) != agent.id:
            continue
        if isinstance(based.get("version"), int) and based["version"] >= top.number:
            continue
        updated.append(
            {"node_id": str(node.id), "before": _apply(session, owner_id, team, node, agent, top)}
        )
    return {"updated": updated, "text": f"{team.name} now uses {agent.name} v{top.number}"}


def use_in_team(session, owner_id, agent_id, team_id) -> dict:
    """Add a new agent made from the latest version to a team (unconnected, right of the
    others)."""
    agent = _owned_agent(session, owner_id, agent_id)
    tid = _uuid(team_id)
    team = session.get(TeamGraph, tid) if tid else None
    if team is None or not team.is_library or team.owner_id != owner_id:
        raise _not_found("team")
    top = _latest(session, agent)
    source = top.parts.get("source") or {}
    xs = [
        (n.position or {}).get("x", 0) or 0
        for n in session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == team.id)
        ).scalars()
    ]
    kind = source.get("kind") if source.get("kind") in AGENT_KINDS else "agent"
    cfg = {
        k: v for k, v in (("title", agent.name), ("description", source.get("description"))) if v
    }
    node = AgentNode(
        team_graph_id=team.id,
        role_name=source.get("role_name") or "worker",
        kind=kind,
        engine="openhands" if kind == "agent" else None,
        prompt=top.parts.get("prompt") or "",
        model=top.parts.get("model"),
        position={"x": (max(xs) if xs else 0) + 260, "y": 0},
        config=cfg or None,
        edits_allowed=kind == "agent",
    )
    session.add(node)
    session.flush()
    _apply(session, owner_id, team, node, agent, top)
    return {"team_id": str(team.id), "node_id": str(node.id)}


# ---------------------------------------------------------------------------- recent tasks


def recent_tasks(session, owner_id, *, q: str | None, limit: int) -> list[dict]:
    """The owner's recent run tasks, newest first, one per task text (case and spaces ignored),
    only runs of their own library teams."""
    stmt = (
        select(Run, TeamGraph)
        .join(TeamGraph, Run.library_team_id == TeamGraph.id)
        .where(
            Run.owner_id == owner_id,
            TeamGraph.owner_id == owner_id,
            TeamGraph.is_library.is_(True),
        )
        .order_by(Run.created_at.desc(), Run.id)
    )
    if q and q.strip():
        stmt = stmt.where(Run.idea.ilike(_like(q.strip()), escape="\\"))
    seen: set[str] = set()
    out: list[dict] = []
    for run, team in session.execute(stmt.limit(500)).all():
        key = " ".join(run.idea.split()).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "task": run.idea,
                "team": {"id": str(team.id), "name": team.name},
                "status": run.status,
                "status_group": status_group(run.status),
                "run_id": str(run.id),
                "number": _run_number(session, run),
                "created_at": run.created_at.isoformat(),
            }
        )
        if len(out) >= limit:
            break
    return out

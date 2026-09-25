"""Which of an account's agents use each Toolkit item (revamp B-TOOLKIT, spec §4.2/§4.3).

A node references library items INSIDE its own JSONB (no join table):

* a library **tool** by id in ``agent_nodes.tool_config.tvashtr.library`` (a list of id strings),
  with a per-agent on/off switch keyed by the tool's NAME at
  ``tool_config.tvashtr.servers[<name>].enabled`` (default on). An inline
  ``tool_config.mcpServers[<name>]`` with the same name overrides the library tool at run time
  (``node_tools.build_mcp_config``: inline wins).
* a library **skill** by a ``{"type": "library", "id": …, "mode"?, "triggers"?}`` element in
  ``agent_nodes.skills`` (the optional ``mode``/``triggers`` are the per-agent load-mode override).

Only LIBRARY teams (``TeamGraph.is_library``) owned by the account count: run-snapshot clones are
``is_library = false`` and are never read or rewritten here (they are run history). Only
``agent``/``completion`` nodes can use tools and skills.

Mutations assign FRESH dicts/lists to the JSONB attributes so SQLAlchemy flags them dirty (an
in-place edit of a JSONB value is invisible to the unit of work).

Openhands-free at import (sqlalchemy + the app's own modules only).
"""

from __future__ import annotations

import copy
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.models import AgentNode, SkillLibraryItem, TeamGraph, ToolLibraryItem

AGENT_KINDS = ("agent", "completion")


# ---- reading the owner's candidate agents ------------------------------------------------------


def _order_key(row: tuple[AgentNode, TeamGraph]) -> tuple:
    """Teams oldest first, then agents left to right on the canvas (``position.x``)."""
    node, team = row
    pos = node.position if isinstance(node.position, dict) else {}
    x = pos.get("x")
    x = float(x) if isinstance(x, int | float) else 0.0
    return (team.created_at, str(team.id), x, node.created_at, str(node.id))


def owner_agent_nodes(session: Session, owner_id: uuid.UUID) -> list[tuple[AgentNode, TeamGraph]]:
    """Every agent/completion node of the owner's LIBRARY teams, with its team, in display order."""
    rows = session.execute(
        select(AgentNode, TeamGraph)
        .join(TeamGraph, AgentNode.team_graph_id == TeamGraph.id)
        .where(
            TeamGraph.owner_id == owner_id,
            TeamGraph.is_library.is_(True),
            AgentNode.kind.in_(AGENT_KINDS),
        )
    ).all()
    return sorted(((n, t) for n, t in rows), key=_order_key)


def node_title(node: AgentNode) -> str | None:
    """The agent's display name (``config.title``, set by the revamp's node PATCH), if any."""
    config = node.config if isinstance(node.config, dict) else {}
    title = config.get("title")
    return title if isinstance(title, str) and title.strip() else None


def usage_row(node: AgentNode, team: TeamGraph) -> dict:
    """One "used by" row: the agent and its team."""
    return {
        "node_id": str(node.id),
        "role_name": node.role_name,
        "title": node_title(node),
        "team_id": str(team.id),
        "team_name": team.name,
    }


def usage_counts(rows: list[dict]) -> tuple[int, int]:
    """``(agent_count, team_count)`` for a list of :func:`usage_row` dicts."""
    return len(rows), len({r["team_id"] for r in rows})


# ---- tool references ---------------------------------------------------------------------------


def _meta(tool_config: dict | None) -> dict:
    meta = tool_config.get("tvashtr") if isinstance(tool_config, dict) else None
    return meta if isinstance(meta, dict) else {}


def _library_ids(tool_config: dict | None) -> list:
    ids = _meta(tool_config).get("library")
    return ids if isinstance(ids, list) else []


def tool_referenced(tool_config: dict | None, tool_id: uuid.UUID) -> bool:
    """The node's ``tvashtr.library`` lists ``tool_id``."""
    return any(_as_uuid(v) == tool_id for v in _library_ids(tool_config))


def tool_overridden(tool_config: dict | None, name: str) -> bool:
    """An inline ``mcpServers[name]`` on the node replaces the library tool at run time."""
    inline = tool_config.get("mcpServers") if isinstance(tool_config, dict) else None
    return isinstance(inline, dict) and name in inline


def tool_switched_off(tool_config: dict | None, name: str) -> bool:
    """The node's per-agent switch ``tvashtr.servers[name].enabled`` is ``false``."""
    servers = _meta(tool_config).get("servers")
    entry = servers.get(name) if isinstance(servers, dict) else None
    return isinstance(entry, dict) and entry.get("enabled", True) is False


def tool_effective(tool_config: dict | None, tool_id: uuid.UUID, name: str) -> bool:
    """The node really gets the library tool on its next run: referenced, not switched off, and
    not replaced by an inline server of the same name."""
    return (
        tool_referenced(tool_config, tool_id)
        and not tool_switched_off(tool_config, name)
        and not tool_overridden(tool_config, name)
    )


def _tidy_tool_config(config: dict) -> dict | None:
    """Drop empty ``tvashtr.library`` / ``tvashtr.servers`` / ``tvashtr`` / whole-config shells so a
    node that no longer uses anything returns to NULL (byte-for-byte inert)."""
    meta = config.get("tvashtr")
    if isinstance(meta, dict):
        if meta.get("library") == []:
            meta.pop("library")
        if meta.get("servers") == {}:
            meta.pop("servers")
        if not meta:
            config.pop("tvashtr")
    return config or None


def with_tool_ref(tool_config: dict | None, tool_id: uuid.UUID, name: str) -> dict:
    """A fresh ``tool_config`` that references ``tool_id`` and has its switch ON (a stale
    ``servers[name]`` entry with ``enabled: false`` is removed; default = on)."""
    config = copy.deepcopy(tool_config) if isinstance(tool_config, dict) else {}
    meta = config.get("tvashtr") if isinstance(config.get("tvashtr"), dict) else {}
    ids = [v for v in _library_ids(config)]
    if not any(_as_uuid(v) == tool_id for v in ids):
        ids.append(str(tool_id))
    meta["library"] = ids
    servers = meta.get("servers")
    if isinstance(servers, dict) and tool_switched_off(config, name):
        servers = {k: v for k, v in servers.items() if k != name}
        meta["servers"] = servers
    config["tvashtr"] = meta
    return _tidy_tool_config(config) or {}


def without_tool_ref(tool_config: dict | None, tool_id: uuid.UUID, name: str) -> dict | None:
    """A fresh ``tool_config`` with every ref to ``tool_id`` and its ``servers[name]`` switch
    removed (``None`` when nothing is left)."""
    config = copy.deepcopy(tool_config) if isinstance(tool_config, dict) else {}
    meta = config.get("tvashtr")
    if isinstance(meta, dict):
        if isinstance(meta.get("library"), list):
            meta["library"] = [v for v in meta["library"] if _as_uuid(v) != tool_id]
        servers = meta.get("servers")
        if isinstance(servers, dict) and name in servers:
            meta["servers"] = {k: v for k, v in servers.items() if k != name}
    return _tidy_tool_config(config)


def with_renamed_switch(tool_config: dict | None, old: str, new: str) -> dict | None:
    """A fresh ``tool_config`` whose ``servers[old]`` switch moved to ``servers[new]`` (so an agent
    that switched the tool off keeps it off after a rename). ``None`` when there is nothing to
    move."""
    servers = _meta(tool_config).get("servers")
    if not isinstance(servers, dict) or old not in servers:
        return None
    config = copy.deepcopy(tool_config)
    moved = {k: v for k, v in config["tvashtr"]["servers"].items() if k != old}
    moved[new] = config["tvashtr"]["servers"][old]
    config["tvashtr"]["servers"] = moved
    return config


# ---- skill references --------------------------------------------------------------------------


def _is_skill_ref(entry: object, skill_id: uuid.UUID) -> bool:
    return (
        isinstance(entry, dict)
        and entry.get("type") == "library"
        and _as_uuid(entry.get("id")) == skill_id
    )


def skill_ref(skills: list | None, skill_id: uuid.UUID) -> dict | None:
    """The node's first ``{"type":"library","id":skill_id,…}`` entry, if any."""
    for entry in skills if isinstance(skills, list) else []:
        if _is_skill_ref(entry, skill_id):
            return entry
    return None


def skill_resolved_name(row_name: str, source: dict | None) -> str | None:
    """The name the resolver gives a library skill (an inline source is named by ``source.name``,
    falling back to the row name). ``None`` for a repo/project_rules source (named by its files)."""
    if isinstance(source, dict) and source.get("type") == "inline":
        name = source.get("name")
        return name if isinstance(name, str) and name else row_name
    return None


def skill_overridden(skills: list | None, skill_id: uuid.UUID, resolved_name: str | None) -> bool:
    """An inline skill of the same name wins the resolver's first-in-list de-dup: it sits before
    the library ref (or anywhere, when the ref is absent — a new ref is appended at the end)."""
    if not resolved_name or not isinstance(skills, list):
        return False
    stop = len(skills)
    for idx, entry in enumerate(skills):
        if _is_skill_ref(entry, skill_id):
            stop = idx
            break
    return any(
        isinstance(e, dict) and e.get("type") == "inline" and e.get("name") == resolved_name
        for e in skills[:stop]
    )


def with_skill_ref(skills: list | None, skill_id: uuid.UUID) -> list:
    """A fresh ``skills`` list that references ``skill_id`` (appended when absent; an existing ref
    keeps its per-agent ``mode``/``triggers`` override)."""
    out = copy.deepcopy(skills) if isinstance(skills, list) else []
    if skill_ref(out, skill_id) is None:
        out.append({"type": "library", "id": str(skill_id)})
    return out


def without_skill_ref(skills: list | None, skill_id: uuid.UUID) -> list | None:
    """A fresh ``skills`` list without any ref to ``skill_id`` (``None`` when nothing is left)."""
    out = [copy.deepcopy(e) for e in (skills or []) if not _is_skill_ref(e, skill_id)]
    return out or None


# ---- usage maps ----------------------------------------------------------------------------------


def tool_usage(session: Session, owner_id: uuid.UUID) -> dict[uuid.UUID, list[dict]]:
    """``{tool_id: [usage_row…]}`` — the agents that EFFECTIVELY use each of the owner's tools."""
    tools = session.execute(
        select(ToolLibraryItem.id, ToolLibraryItem.name).where(ToolLibraryItem.owner_id == owner_id)
    ).all()
    usage: dict[uuid.UUID, list[dict]] = {tid: [] for tid, _ in tools}
    if not tools:
        return usage
    for node, team in owner_agent_nodes(session, owner_id):
        if not isinstance(node.tool_config, dict):
            continue
        for tid, name in tools:
            if tool_effective(node.tool_config, tid, name):
                usage[tid].append(usage_row(node, team))
    return usage


def skill_usage(session: Session, owner_id: uuid.UUID) -> dict[uuid.UUID, list[dict]]:
    """``{skill_id: [usage_row…]}`` — the agents whose ``skills`` reference each owner skill."""
    ids = list(
        session.execute(
            select(SkillLibraryItem.id).where(SkillLibraryItem.owner_id == owner_id)
        ).scalars()
    )
    usage: dict[uuid.UUID, list[dict]] = {sid: [] for sid in ids}
    if not ids:
        return usage
    for node, team in owner_agent_nodes(session, owner_id):
        if not isinstance(node.skills, list):
            continue
        for sid in ids:
            if skill_ref(node.skills, sid) is not None:
                usage[sid].append(usage_row(node, team))
    return usage


# ---- mutations (same transaction as the caller's library write) ----------------------------------


def strip_tool_refs(session: Session, owner_id: uuid.UUID, tool_id: uuid.UUID, name: str) -> int:
    """Remove every ref to a library tool (and its ``servers[name]`` switch) from the owner's
    library-team agents — called when the tool is deleted, so no agent keeps a dangling id. Returns
    how many agents were EFFECTIVELY using it (the "N agents lose it" count)."""
    removed = 0
    for node, _team in owner_agent_nodes(session, owner_id):
        if not tool_referenced(node.tool_config, tool_id):
            continue
        if tool_effective(node.tool_config, tool_id, name):
            removed += 1
        node.tool_config = without_tool_ref(node.tool_config, tool_id, name)
    return removed


def carry_tool_switch(
    session: Session, owner_id: uuid.UUID, tool_id: uuid.UUID, old: str, new: str
) -> None:
    """On a rename, move each referencing agent's ``servers[old]`` switch to ``servers[new]`` so an
    agent that switched the tool off doesn't silently get it back. A node whose ``servers[old]``
    belongs to its own inline server of that name is left alone."""
    for node, _team in owner_agent_nodes(session, owner_id):
        if not tool_referenced(node.tool_config, tool_id) or tool_overridden(node.tool_config, old):
            continue
        moved = with_renamed_switch(node.tool_config, old, new)
        if moved is not None:
            node.tool_config = moved


def strip_skill_refs(session: Session, owner_id: uuid.UUID, skill_id: uuid.UUID) -> int:
    """Remove every ``{"type":"library","id":skill_id}`` ref from the owner's library-team agents
    (the skill is being deleted). Returns how many agents referenced it."""
    removed = 0
    for node, _team in owner_agent_nodes(session, owner_id):
        if skill_ref(node.skills, skill_id) is None:
            continue
        removed += 1
        node.skills = without_skill_ref(node.skills, skill_id)
    return removed


def _select_nodes(
    session: Session, owner_id: uuid.UUID, node_ids: list[str]
) -> tuple[list[tuple[AgentNode, TeamGraph]], set[uuid.UUID]]:
    """The owner's candidate agents plus the parsed wanted set; ``LookupError`` when a wanted id is
    not one of the owner's library-team agents (another account's node is indistinguishable from an
    absent one)."""
    rows = owner_agent_nodes(session, owner_id)
    known = {node.id for node, _ in rows}
    wanted: set[uuid.UUID] = set()
    for raw in node_ids:
        nid = _as_uuid(raw)
        if nid is None or nid not in known:
            raise LookupError(str(raw))
        wanted.add(nid)
    return rows, wanted


def _users_payload(users: list[dict], skipped: list[dict]) -> dict:
    agent_count, team_count = usage_counts(users)
    return {
        "agents": users,
        "agent_count": agent_count,
        "team_count": team_count,
        "skipped": skipped,
    }


def set_tool_agents(
    session: Session, owner_id: uuid.UUID, tool: ToolLibraryItem, node_ids: list[str]
) -> dict:
    """Make ``node_ids`` exactly the set of the owner's agents that use ``tool`` (``PUT
    /api/tool-library/{id}/agents``). A listed agent gets the ref and its switch on; an unlisted
    agent that uses it loses the ref and its switch (unchecking = removing, spec Q4). A listed
    agent with an inline server of the same name is skipped — the inline server would win."""
    rows, wanted = _select_nodes(session, owner_id, node_ids)
    skipped: list[dict] = []
    for node, _team in rows:
        if node.id in wanted:
            if tool_overridden(node.tool_config, tool.name):
                skipped.append(
                    {
                        "node_id": str(node.id),
                        "reason": f"an inline server named {tool.name} overrides it",
                    }
                )
                continue
            if not tool_effective(node.tool_config, tool.id, tool.name):
                node.tool_config = with_tool_ref(node.tool_config, tool.id, tool.name)
        elif tool_effective(node.tool_config, tool.id, tool.name):
            node.tool_config = without_tool_ref(node.tool_config, tool.id, tool.name)
    users = [
        usage_row(node, team)
        for node, team in rows
        if tool_effective(node.tool_config, tool.id, tool.name)
    ]
    return _users_payload(users, skipped)


def set_skill_agents(
    session: Session, owner_id: uuid.UUID, skill: SkillLibraryItem, node_ids: list[str]
) -> dict:
    """Make ``node_ids`` exactly the set of the owner's agents that reference ``skill`` (``PUT
    /api/skill-library/{id}/agents``). A kept ref keeps its per-agent load-mode override."""
    rows, wanted = _select_nodes(session, owner_id, node_ids)
    for node, _team in rows:
        has_ref = skill_ref(node.skills, skill.id) is not None
        if node.id in wanted and not has_ref:
            node.skills = with_skill_ref(node.skills, skill.id)
        elif node.id not in wanted and has_ref:
            node.skills = without_skill_ref(node.skills, skill.id)
    users = [
        usage_row(node, team) for node, team in rows if skill_ref(node.skills, skill.id) is not None
    ]
    return _users_payload(users, [])


# ---- the "Turn on for agents" candidate list -----------------------------------------------------


def list_agents(
    session: Session,
    owner_id: uuid.UUID,
    *,
    tool: ToolLibraryItem | None = None,
    skill: SkillLibraryItem | None = None,
) -> list[dict]:
    """The owner's library-team agents grouped by team (``GET /api/agents``). With ``tool`` (or
    ``skill``) each agent says whether it uses that item (``enabled``) and whether an inline item
    of the same name overrides it (``overridden``). A skill query also returns the agent's
    per-agent load-mode override (``mode``/``triggers``, ``None`` when it follows the skill)."""
    teams: dict[uuid.UUID, dict] = {}
    resolved_name = skill_resolved_name(skill.name, skill.source) if skill is not None else None
    for node, team in owner_agent_nodes(session, owner_id):
        group = teams.get(team.id)
        if group is None:
            group = {"team_id": str(team.id), "team_name": team.name, "agents": []}
            teams[team.id] = group
        agent = {
            "node_id": str(node.id),
            "role_name": node.role_name,
            "title": node_title(node),
            "kind": node.kind,
            "edits_allowed": bool(node.edits_allowed),
            "enabled": False,
            "overridden": False,
        }
        if tool is not None:
            agent["enabled"] = tool_effective(node.tool_config, tool.id, tool.name)
            agent["overridden"] = tool_overridden(node.tool_config, tool.name)
        elif skill is not None:
            ref = skill_ref(node.skills, skill.id)
            agent["enabled"] = ref is not None
            agent["overridden"] = skill_overridden(node.skills, skill.id, resolved_name)
            agent["mode"] = ref.get("mode") if ref else None
            agent["triggers"] = ref.get("triggers") if ref else None
        group["agents"].append(agent)
    return list(teams.values())

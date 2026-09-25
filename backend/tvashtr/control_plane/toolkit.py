"""Toolkit logic for the revamp (B-TOOLKIT): tool/skill/secret items with status and usage, name
rules, create-only writes, duplicate/import, the nav summary and the GitHub App status.

The HTTP layer (``routes/toolkit.py`` and the tool/skill/secret endpoints in ``routers.py``) stays
thin: every rule lives here and a violation raises :class:`ToolkitError`, which carries the HTTP
status and the user-facing ``detail`` the route turns into an ``HTTPException``.

Openhands-free at import (sqlalchemy + the app's own modules only).
"""

from __future__ import annotations

import copy
import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tvashtr.control_plane import node_library, tool_usage
from tvashtr.control_plane.node_library import _as_uuid
from tvashtr.control_plane.node_tools import _secret_refs
from tvashtr.db import session_scope
from tvashtr.models import McpSecret, NodeMemory, SkillLibraryItem, ToolLibraryItem

TOOL_NOT_FOUND = "tool not found in your library"
SKILL_NOT_FOUND = "skill not found in your library"


class ToolkitError(Exception):
    """A rule violation with the HTTP status + ``detail`` (a user-facing string, or a dict for the
    multi-item endpoints) the route returns verbatim."""

    def __init__(self, status_code: int, detail: str | dict) -> None:
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


# ---- tool status (secrets + connection shape) ----------------------------------------------------


def server_config_error(server_config: object) -> str | None:
    """Why a server config can't connect, or ``None`` when it is well-formed: exactly one of a
    non-empty ``command`` string or an http(s) ``url``; ``args`` a list of strings; ``env`` and
    ``headers`` objects."""
    if not isinstance(server_config, dict):
        return "Add a command or a URL."
    command = server_config.get("command")
    url = server_config.get("url")
    has_command = isinstance(command, str) and bool(command.strip())
    has_url = isinstance(url, str) and bool(url.strip())
    if has_command and has_url:
        return "Use a command or a URL, not both."
    if not has_command and not has_url:
        return "Add a command or a URL."
    if has_url and not url.strip().lower().startswith(("http://", "https://")):
        return "Use an http:// or https:// URL."
    args = server_config.get("args")
    if args is not None and (
        not isinstance(args, list) or not all(isinstance(a, str) for a in args)
    ):
        return "Arguments must be a list of strings."
    for block, label in (("env", "Environment"), ("headers", "Headers")):
        value = server_config.get(block)
        if value is not None and not isinstance(value, dict):
            return f"{label} must be an object of names and values."
    return None


def secret_refs(server_config: object) -> list[str]:
    """Every ``${NAME}`` a server resolves at run time (only ``env``/``headers`` values — the same
    rule as ``node_tools``), sorted."""
    return sorted(_secret_refs(server_config)) if isinstance(server_config, dict) else []


def tool_status(server_config: object, secret_names: set[str]) -> dict:
    """``{secret_refs, missing_secrets, status}`` for one tool: ``needs_attention`` when a
    referenced secret has no stored value or the config can't connect (no command or URL)."""
    refs = secret_refs(server_config)
    missing = [n for n in refs if n not in secret_names]
    ok = not missing and server_config_error(server_config) is None
    return {
        "secret_refs": refs,
        "missing_secrets": missing,
        "status": "ready" if ok else "needs_attention",
    }


def owner_secret_names(session: Session, owner_id: uuid.UUID) -> set[str]:
    return set(
        session.execute(select(McpSecret.name).where(McpSecret.owner_id == owner_id)).scalars()
    )


def missing_secrets(tools: list[ToolLibraryItem], secret_names: set[str]) -> dict[str, list[dict]]:
    """``{NAME: [{id, name}…]}`` — every ``${NAME}`` referenced by a library tool that has no
    stored value, with the tools that reference it (tool name order)."""
    missing: dict[str, list[dict]] = {}
    for tool in sorted(tools, key=lambda t: t.name):
        for ref in secret_refs(tool.server_config):
            if ref not in secret_names:
                missing.setdefault(ref, []).append({"id": str(tool.id), "name": tool.name})
    return dict(sorted(missing.items()))


# ---- lookups -------------------------------------------------------------------------------------


def get_owner_tool_row(session: Session, owner_id: uuid.UUID, tool_id: object) -> ToolLibraryItem:
    """The owner's tool row, or a 404 :class:`ToolkitError` (unparseable / absent / foreign)."""
    rid = _as_uuid(tool_id)
    row = (
        session.execute(
            select(ToolLibraryItem).where(
                ToolLibraryItem.id == rid, ToolLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if rid is not None
        else None
    )
    if row is None:
        raise ToolkitError(404, TOOL_NOT_FOUND)
    return row


def get_owner_skill_row(
    session: Session, owner_id: uuid.UUID, skill_id: object
) -> SkillLibraryItem:
    """The owner's skill row, or a 404 :class:`ToolkitError`."""
    rid = _as_uuid(skill_id)
    row = (
        session.execute(
            select(SkillLibraryItem).where(
                SkillLibraryItem.id == rid, SkillLibraryItem.owner_id == owner_id
            )
        ).scalar_one_or_none()
        if rid is not None
        else None
    )
    if row is None:
        raise ToolkitError(404, SKILL_NOT_FOUND)
    return row


# ---- tools ---------------------------------------------------------------------------------------

TOOL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
TOOL_NAME_RULE = "Use lowercase letters, numbers, - and _, like my-server."
TOOL_IMPORT_CONFLICTS = ("error", "replace", "rename")


def tool_name_taken(name: str) -> str:
    return f"You already have a tool named {name}."


def check_tool_name(name: str) -> str:
    """The trimmed name, or a 422 :class:`ToolkitError` when it breaks the rule (agents see this
    name as the MCP server key)."""
    name = (name or "").strip()
    if not name:
        raise ToolkitError(422, "A tool name is required.")
    if not TOOL_NAME_RE.match(name):
        raise ToolkitError(422, TOOL_NAME_RULE)
    return name


def check_server_config(server_config: object) -> dict:
    """The config, or a 422 :class:`ToolkitError` with the reason it can't connect."""
    reason = server_config_error(server_config)
    if reason is not None:
        raise ToolkitError(422, reason)
    return server_config  # type: ignore[return-value]


def tool_item(row: ToolLibraryItem, secret_names: set[str], users: list[dict]) -> dict:
    """One tool as every tool endpoint returns it (the legacy ``{id, name, server_config,
    created_at}`` plus status and usage)."""
    agent_count, team_count = tool_usage.usage_counts(users)
    return {
        "id": str(row.id),
        "name": row.name,
        "server_config": row.server_config,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        **tool_status(row.server_config, secret_names),
        "used_by": {"agent_count": agent_count, "team_count": team_count},
    }


def _owner_tools(session: Session, owner_id: uuid.UUID) -> list[ToolLibraryItem]:
    return list(
        session.execute(
            select(ToolLibraryItem)
            .where(ToolLibraryItem.owner_id == owner_id)
            .order_by(ToolLibraryItem.created_at, ToolLibraryItem.name)
        ).scalars()
    )


def list_tools(owner_id: uuid.UUID) -> list[dict]:
    """The owner's tools, oldest first (the legacy order; the UI sorts by name)."""
    with session_scope() as session:
        names = owner_secret_names(session, owner_id)
        usage = tool_usage.tool_usage(session, owner_id)
        return [tool_item(t, names, usage.get(t.id, [])) for t in _owner_tools(session, owner_id)]


def get_tool(owner_id: uuid.UUID, tool_id: object, *, with_agents: bool = False) -> dict:
    """One tool (404 when not the owner's). ``with_agents`` adds ``used_by_agents`` — the rows
    behind ``used_by`` (``GET /api/tool-library/{id}``)."""
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        users = tool_usage.tool_usage(session, owner_id).get(row.id, [])
        item = tool_item(row, owner_secret_names(session, owner_id), users)
        if with_agents:
            item["used_by_agents"] = users
        return item


def create_tool(owner_id: uuid.UUID, name: str, server_config: object) -> dict:
    """Create-only ``POST /api/tool-library``: 422 on the name rule or a config that can't connect,
    409 when the name is taken. Returns the full item."""
    name = check_tool_name(name)
    config = check_server_config(server_config)
    try:
        tool_id = node_library.create_owner_tool(owner_id, name, config, on_conflict="error")
    except node_library.ToolNameTaken:
        raise ToolkitError(409, tool_name_taken(name)) from None
    return get_tool(owner_id, tool_id)


def update_tool(
    owner_id: uuid.UUID, tool_id: object, name: str | None, server_config: object | None
) -> dict:
    """``PATCH /api/tool-library/{id}`` with a partial body. A new name follows the create rules
    (an unchanged legacy name is allowed); a clash is 409; a rename carries each agent's on/off
    switch. Returns the full item (``used_by.agent_count`` feeds "N agents use the new
    settings")."""
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        current_name, current_config, rid = row.name, row.server_config, row.id
    new_name = current_name
    if name is not None and name.strip() != current_name:
        new_name = check_tool_name(name)
    new_config = current_config if server_config is None else check_server_config(server_config)
    try:
        if not node_library.update_owner_tool(owner_id, rid, new_name, new_config):
            raise ToolkitError(404, TOOL_NOT_FOUND)
    except node_library.ToolNameTaken:
        raise ToolkitError(409, tool_name_taken(new_name)) from None
    return get_tool(owner_id, rid)


def delete_tool(owner_id: uuid.UUID, tool_id: object) -> dict:
    """Delete a tool and strip it from every agent (idempotent). ``{removed_from_agents}``."""
    return {"removed_from_agents": node_library.delete_owner_tool(owner_id, tool_id)}


def free_name(base: str, taken: set[str], suffix: str = "copy") -> str:
    """The first of ``<base>-<suffix>``, ``<base>-<suffix>-2``, … not in ``taken``."""
    candidate = f"{base}-{suffix}"
    n = 2
    while candidate in taken:
        candidate = f"{base}-{suffix}-{n}"
        n += 1
    return candidate


def duplicate_tool(owner_id: uuid.UUID, tool_id: object) -> dict:
    """``POST /api/tool-library/{id}/duplicate``: a copy named ``<name>-copy`` (then ``-copy-2``…)
    with the same config and no agents (refs are not copied)."""
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        taken = {t.name for t in _owner_tools(session, owner_id)}
        copy_row = ToolLibraryItem(
            owner_id=owner_id,
            name=free_name(row.name, taken),
            server_config=copy.deepcopy(row.server_config),
        )
        session.add(copy_row)
        session.flush()
        new_id = copy_row.id
    return get_tool(owner_id, new_id)


def _plural_names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def import_tools(owner_id: uuid.UUID, servers: object, on_conflict: str) -> dict:
    """``POST /api/tool-library/import`` — add N servers from a pasted mcp.json in ONE transaction.
    Every server passes the name rule and the connection check first (422 names the server). A
    name the account already has is a conflict: ``error`` writes nothing and 409s, ``replace``
    overwrites that tool's config (its agents keep it), ``rename`` adds it as ``<name>-2``…"""
    if on_conflict not in TOOL_IMPORT_CONFLICTS:
        raise ToolkitError(422, "on_conflict must be error, replace or rename.")
    if not isinstance(servers, dict) or not servers:
        raise ToolkitError(422, "Paste at least one server.")
    cleaned: list[tuple[str, dict]] = []
    for raw_name, config in servers.items():
        name = str(raw_name).strip()
        if not TOOL_NAME_RE.match(name):
            raise ToolkitError(
                422, {"code": "invalid_name", "server": raw_name, "message": TOOL_NAME_RULE}
            )
        reason = server_config_error(config)
        if reason is not None:
            raise ToolkitError(
                422, {"code": "invalid_server", "server": raw_name, "message": reason}
            )
        cleaned.append((name, copy.deepcopy(config)))
    with session_scope() as session:
        existing = {t.name: t for t in _owner_tools(session, owner_id)}
        conflicts = [name for name, _ in cleaned if name in existing]
        if conflicts and on_conflict == "error":
            noun = "a tool named" if len(conflicts) == 1 else "tools named"
            raise ToolkitError(
                409,
                {
                    "code": "name_taken",
                    "message": f"You already have {noun} {_plural_names(conflicts)}.",
                    "conflicts": conflicts,
                },
            )
        taken = set(existing)
        written: list[ToolLibraryItem] = []
        for name, config in cleaned:
            if name in existing and on_conflict == "replace":
                row = existing[name]
                row.server_config = config
            else:
                final = name
                if name in taken:
                    final = f"{name}-2"
                    n = 3
                    while final in taken:
                        final = f"{name}-{n}"
                        n += 1
                row = ToolLibraryItem(owner_id=owner_id, name=final, server_config=config)
                session.add(row)
                taken.add(final)
            written.append(row)
        session.flush()
        names = owner_secret_names(session, owner_id)
        usage = tool_usage.tool_usage(session, owner_id)
        added = [tool_item(r, names, usage.get(r.id, [])) for r in written]
    return {"added": added, "conflicts": conflicts}


def set_tool_agents(owner_id: uuid.UUID, tool_id: object, node_ids: object) -> dict:
    """``PUT /api/tool-library/{id}/agents``: turn the tool on for exactly ``node_ids`` across the
    owner's teams (404 for a tool or agent that isn't the owner's)."""
    if not isinstance(node_ids, list):
        raise ToolkitError(422, "node_ids must be a list.")
    with session_scope() as session:
        row = get_owner_tool_row(session, owner_id, tool_id)
        try:
            return tool_usage.set_tool_agents(session, owner_id, row, node_ids)
        except LookupError:
            raise ToolkitError(404, "Agent not found.") from None


# ---- GET /api/agents -----------------------------------------------------------------------------


def list_agents(
    owner_id: uuid.UUID, tool_id: str | None = None, skill_id: str | None = None
) -> dict:
    """``{teams:[{team_id, team_name, agents:[…]}]}`` — see :func:`tool_usage.list_agents`."""
    if tool_id and skill_id:
        raise ToolkitError(422, "Pass tool_id or skill_id, not both.")
    with session_scope() as session:
        tool = get_owner_tool_row(session, owner_id, tool_id) if tool_id else None
        skill = get_owner_skill_row(session, owner_id, skill_id) if skill_id else None
        return {"teams": tool_usage.list_agents(session, owner_id, tool=tool, skill=skill)}


# ---- GET /api/toolkit/summary --------------------------------------------------------------------


def memory_counts(session: Session, owner_id: uuid.UUID) -> dict:
    """``{inbox, active, archive}`` — the owner's memories by status (Archive = superseded +
    discarded)."""
    by_status = dict(
        session.execute(
            select(NodeMemory.status, func.count())
            .where(NodeMemory.owner_id == owner_id)
            .group_by(NodeMemory.status)
        ).all()
    )
    return {
        "inbox": int(by_status.get("pending_review", 0)),
        "active": int(by_status.get("active", 0)),
        "archive": int(by_status.get("superseded", 0)) + int(by_status.get("rejected", 0)),
    }


def summary(owner_id: uuid.UUID) -> dict:
    """The Toolkit nav badges in one read (``GET /api/toolkit/summary``)."""
    with session_scope() as session:
        tools = list(
            session.execute(
                select(ToolLibraryItem).where(ToolLibraryItem.owner_id == owner_id)
            ).scalars()
        )
        names = owner_secret_names(session, owner_id)
        attention = sum(
            1 for t in tools if tool_status(t.server_config, names)["status"] != "ready"
        )
        skills = session.execute(
            select(func.count())
            .select_from(SkillLibraryItem)
            .where(SkillLibraryItem.owner_id == owner_id)
        ).scalar_one()
        return {
            "tools": len(tools),
            "tools_needing_attention": attention,
            "skills": int(skills),
            "memory": memory_counts(session, owner_id),
            "secrets_missing": len(missing_secrets(tools, names)),
        }

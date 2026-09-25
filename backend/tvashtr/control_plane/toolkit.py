"""Toolkit logic for the revamp (B-TOOLKIT): tool/skill/secret items with status and usage, name
rules, create-only writes, duplicate/import, the nav summary and the GitHub App status.

The HTTP layer (``routes/toolkit.py`` and the tool/skill/secret endpoints in ``routers.py``) stays
thin: every rule lives here and a violation raises :class:`ToolkitError`, which carries the HTTP
status and the user-facing ``detail`` the route turns into an ``HTTPException``.

Openhands-free at import (sqlalchemy + the app's own modules only).
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tvashtr.control_plane import tool_usage
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

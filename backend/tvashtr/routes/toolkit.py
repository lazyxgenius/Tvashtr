"""Toolkit — tool/skill usage, turning tools and skills on for agents, imports, secrets extras.

Thin HTTP layer over :mod:`tvashtr.control_plane.toolkit` (the rules) and
:mod:`tvashtr.control_plane.tool_usage` (who uses what). Every route is owner-scoped: another
account's tool/skill/agent is a 404. This router is included BEFORE ``routers.py`` in ``main.py``,
so literal paths such as ``/api/tool-library/import`` are never shadowed by an ``{item_id}`` route.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import toolkit
from tvashtr.control_plane.toolkit import ToolkitError

router = APIRouter()


class AgentsBody(BaseModel):
    """``PUT …/agents``: the FULL set of agents that should use the item afterwards."""

    node_ids: list[str]


class ToolImportBody(BaseModel):
    """``POST /api/tool-library/import``: ``servers`` is the ``mcpServers`` object of a pasted
    mcp.json (``{name: server_config}``)."""

    servers: dict
    on_conflict: str = "error"


class SecretValueBody(BaseModel):
    """``PUT /api/secrets/{name}``: the new plaintext value (encrypted; never returned)."""

    value: str


CurrentUser = Annotated[UserOut, Depends(get_current_user)]


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


def _http(exc: ToolkitError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/api/toolkit/summary")
def toolkit_summary(current_user: CurrentUser) -> dict:
    """Counts for the Toolkit nav badges: ``{tools, tools_needing_attention, skills,
    memory:{inbox,active,archive}, secrets_missing}``."""
    return toolkit.summary(_owner(current_user))


@router.get("/api/agents")
def list_agents(
    current_user: CurrentUser, tool_id: str | None = None, skill_id: str | None = None
) -> dict:
    """The account's library-team agents grouped by team, each saying whether it uses
    ``tool_id`` / ``skill_id`` (``enabled``) and whether an inline item overrides it."""
    try:
        return toolkit.list_agents(_owner(current_user), tool_id=tool_id, skill_id=skill_id)
    except ToolkitError as exc:
        raise _http(exc) from None


# ---- secrets -------------------------------------------------------------------------------------


@router.put("/api/secrets/{name}")
def replace_secret(name: str, body: SecretValueBody, current_user: CurrentUser) -> dict:
    """Replace an existing secret's value → ``{name, created_at, updated_at}`` (404 when absent,
    422 on an empty value). The old value is gone; tools pick up the new one on their next run."""
    try:
        return toolkit.replace_secret(_owner(current_user), name, body.value)
    except ToolkitError as exc:
        raise _http(exc) from None


# ---- tools ---------------------------------------------------------------------------------------


@router.post("/api/tool-library/import")
def import_tools(body: ToolImportBody, current_user: CurrentUser) -> dict:
    """Add the servers of a pasted mcp.json in one transaction → ``{added:[item…], conflicts}``.
    ``on_conflict``: ``error`` (default; 409 and nothing written), ``replace`` or ``rename``."""
    try:
        return toolkit.import_tools(_owner(current_user), body.servers, body.on_conflict)
    except ToolkitError as exc:
        raise _http(exc) from None


@router.get("/api/tool-library/{tool_id}")
def get_tool(tool_id: str, current_user: CurrentUser) -> dict:
    """One tool (the list item) plus ``used_by_agents`` — who loses it if it is removed."""
    try:
        return toolkit.get_tool(_owner(current_user), tool_id, with_agents=True)
    except ToolkitError as exc:
        raise _http(exc) from None


@router.post("/api/tool-library/{tool_id}/duplicate", status_code=201)
def duplicate_tool(tool_id: str, current_user: CurrentUser) -> dict:
    """Copy a tool as ``<name>-copy`` (``-copy-2``… when taken); the copy has no agents."""
    try:
        return toolkit.duplicate_tool(_owner(current_user), tool_id)
    except ToolkitError as exc:
        raise _http(exc) from None


@router.put("/api/tool-library/{tool_id}/agents")
def set_tool_agents(tool_id: str, body: AgentsBody, current_user: CurrentUser) -> dict:
    """Turn the tool on for exactly ``node_ids`` (and off — ref removed — for every other agent)."""
    try:
        return toolkit.set_tool_agents(_owner(current_user), tool_id, body.node_ids)
    except ToolkitError as exc:
        raise _http(exc) from None

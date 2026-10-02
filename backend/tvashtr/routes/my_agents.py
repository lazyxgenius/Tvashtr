"""M6 — My agents and recent tasks (ruling R4; contract
``docs/superpowers/plans/api/my-agents.md``). Every route is owner-scoped: another account's agent,
team or node is a 404."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from tvashtr import db
from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import my_agents
from tvashtr.models import AgentNode

router = APIRouter()
CurrentUser = Annotated[UserOut, Depends(get_current_user)]
Part = Literal["instructions", "model", "skills_tools", "file_access", "memories"]


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


def _http(exc: my_agents.MyAgentsError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _node(session, node_id: str) -> dict:
    from tvashtr.routers import _node_base_dict  # routers mounts after this module

    return _node_base_dict(session.get(AgentNode, uuid.UUID(node_id)))


class SaveAgentRequest(BaseModel):
    team_id: str
    node_id: str
    name: str = Field(max_length=200)
    purpose: str | None = Field(default=None, max_length=my_agents.PURPOSE_MAX)  # absent: kept
    include: list[Part]


class RenameAgentRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    purpose: str | None = Field(default=None, max_length=my_agents.PURPOSE_MAX)


class UseAgentRequest(BaseModel):
    agent_id: str
    version: int | None = Field(default=None, ge=1, le=2**31 - 1)


class UndoAgentRequest(BaseModel):
    before: dict


class TeamRequest(BaseModel):
    team_id: str


@router.get("/api/my-agents")
def list_my_agents(current_user: CurrentUser) -> dict:
    with db.session_scope() as session:
        return {"agents": my_agents.listing(session, _owner(current_user))}


@router.post("/api/my-agents", status_code=201)
def save_my_agent(body: SaveAgentRequest, current_user: CurrentUser) -> dict:
    """Save as my agent (the agent's SAVED setup): a new name makes v1, a name you have makes its
    next version; the node is then based on it."""
    try:
        with db.session_scope() as session:
            return my_agents.save(
                session,
                _owner(current_user),
                team_id=body.team_id,
                node_id=body.node_id,
                name=body.name,
                purpose=body.purpose,
                include=list(body.include),
            )
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.patch("/api/my-agents/{agent_id}")
def rename_my_agent(agent_id: str, body: RenameAgentRequest, current_user: CurrentUser) -> dict:
    try:
        with db.session_scope() as session:
            return my_agents.rename(
                session, _owner(current_user), agent_id, name=body.name, purpose=body.purpose
            )
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.delete("/api/my-agents/{agent_id}", status_code=204)
def delete_my_agent(agent_id: str, current_user: CurrentUser) -> Response:
    """Delete it and its versions — never changes a team."""
    try:
        with db.session_scope() as session:
            my_agents.delete(session, _owner(current_user), agent_id)
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc
    return Response(status_code=204)


@router.post("/api/my-agents/{agent_id}/update-team")
def update_team_to_latest(agent_id: str, body: TeamRequest, current_user: CurrentUser) -> dict:
    try:
        with db.session_scope() as session:
            return my_agents.update_team(session, _owner(current_user), agent_id, body.team_id)
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.post("/api/my-agents/{agent_id}/use-in-team", status_code=201)
def use_my_agent_in_team(agent_id: str, body: TeamRequest, current_user: CurrentUser) -> dict:
    try:
        with db.session_scope() as session:
            return my_agents.use_in_team(session, _owner(current_user), agent_id, body.team_id)
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.post("/api/teams/{team_id}/nodes/{node_id}/use-agent")
def use_my_agent(
    team_id: str, node_id: str, body: UseAgentRequest, current_user: CurrentUser
) -> dict:
    """R4: use a saved agent — its parts are written at once; ``before`` is what Undo puts
    back."""
    try:
        with db.session_scope() as session:
            used = my_agents.use(
                session,
                _owner(current_user),
                team_id=team_id,
                node_id=node_id,
                agent_id=body.agent_id,
                number=body.version,
            )
            return {
                "node": _node(session, used["node_id"]),
                "before": used["before"],
                "text": used["text"],
            }
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.post("/api/teams/{team_id}/nodes/{node_id}/undo-agent")
def undo_my_agent(
    team_id: str, node_id: str, body: UndoAgentRequest, current_user: CurrentUser
) -> dict:
    try:
        with db.session_scope() as session:
            nid = my_agents.undo(
                session, _owner(current_user), team_id=team_id, node_id=node_id, before=body.before
            )
            return _node(session, nid)
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.post("/api/teams/{team_id}/nodes/{node_id}/detach-agent")
def detach_my_agent(team_id: str, node_id: str, current_user: CurrentUser) -> dict:
    try:
        with db.session_scope() as session:
            nid = my_agents.detach(session, _owner(current_user), team_id=team_id, node_id=node_id)
            return _node(session, nid)
    except my_agents.MyAgentsError as exc:
        raise _http(exc) from exc


@router.get("/api/recent-tasks")
def get_recent_tasks(
    current_user: CurrentUser,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 6,
) -> dict:
    """Home › Recent tasks: your recent run tasks, newest first, one per task."""
    with db.session_scope() as session:
        return {"tasks": my_agents.recent_tasks(session, _owner(current_user), q=q, limit=limit)}

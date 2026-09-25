"""Agent nodes — templates, context preview, per-agent run history."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane.context_preview import ContextPreviewError, preview_node_context
from tvashtr.control_plane.node_history import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    NodeHistoryNotFound,
    node_run_history,
)
from tvashtr.control_plane.node_templates import list_node_templates

router = APIRouter()


@router.get("/api/node-templates")
def get_node_templates() -> dict:
    """The four built-in agent templates (Product manager / Architect / Engineer / Reviewer) the
    drawer's Templates menu and the focus view's template dialog offer — each with its full
    ``prompt``, display ``title``/``description``, ``node_kind``, default ``edits_allowed`` and the
    ``verdict_labels`` its instructions emit. Code-resident; the same rows seed
    ``POST /api/teams/{id}/nodes {preset}``."""
    return {"templates": list_node_templates()}


@router.get("/api/teams/{team_id}/nodes/{node_id}/runs")
def get_node_runs(
    team_id: str,
    node_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    run_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
) -> dict:
    """This authored agent's rounds across the team's runs — the drawer's Runs/Docs tabs and the
    focus view's rounds rail. ``runs`` lists every run where it ran (newest first); ``run`` is the
    one asked for by ``run_id`` (default the newest) with its rounds (newest first): outcome, cost,
    billing route, what it was given and what it produced. 404 for another account's team/node, or
    a ``run_id`` this agent was not part of."""
    try:
        return node_run_history(
            team_id, node_id, uuid.UUID(current_user.id), run_id=run_id, limit=limit
        )
    except NodeHistoryNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class ContextPreviewRequest(BaseModel):
    """The drawer's unsaved draft (each field optional — absent means the saved value) plus which
    run's idea and documents to use (``run_id``; default the team's latest) or a typed ``idea``."""

    prompt: str | None = None
    model: str | None = None
    edits_allowed: bool | None = None
    reads_from: list[str] | None = None
    reads_default: bool | None = None
    skills: list | None = None
    memory_remember_enabled: bool | None = None
    run_id: str | None = None
    idea: str | None = None


@router.post("/api/teams/{team_id}/nodes/{node_id}/context-preview")
def post_context_preview(
    team_id: str,
    node_id: str,
    body: ContextPreviewRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    """The focus view's "Preview as the agent sees it": the agent's first-round context,
    compiled by the executor's own compiler with the draft applied — every part in order with its
    source and token count, the skills, the total against the budget, and notes on what is only
    added at run time. Makes no model or embedding calls. 404 for another account's
    team/node/run; 422 for a non-agent node."""
    draft = body.model_dump(exclude_unset=True)
    try:
        return preview_node_context(team_id, node_id, uuid.UUID(current_user.id), draft)
    except NodeHistoryNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ContextPreviewError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

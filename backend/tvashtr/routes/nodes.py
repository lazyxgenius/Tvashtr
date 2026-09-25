"""Agent nodes — templates, context preview, per-agent run history."""

from fastapi import APIRouter

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

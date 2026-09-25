"""The four built-in agent templates (frontend revamp, B-NODES).

One home for the per-agent starting points the canvas palette drops (``POST …/nodes {preset}``) and
the drawer's Templates menu offers (``GET /api/node-templates``). Moved out of
``routers._NODE_PRESETS`` so both read the same rows; the prompts themselves stay the byte-intact
``teams.py`` constants the builders seed.

Each template carries the display ``title`` / ``description`` a new node is seeded with
(``config.title`` / ``config.description``), its ``role_name`` (stable — memory distillation and
trajectories key on it), the canvas ``node_kind`` (``thinker`` = a ``completion`` node, ``worker`` =
an ``agent`` node), the default File access the UI applies with the template (``edits_allowed``),
the document it writes by default (``writes_to``) and the verdict labels its instructions emit.
Pure data — no DB, no DBOS."""

from tvashtr.control_plane.teams import (
    ARCHITECT_PROMPT,
    ENGINEER_PROMPT,
    PM_PROMPT,
    REVIEWER_PROMPT,
)

NODE_TEMPLATES: tuple[dict, ...] = (
    {
        "key": "pm",
        "title": "Product manager",
        "description": "Drafts the spec",
        "role_name": "pm",
        "node_kind": "thinker",
        "edits_allowed": False,
        "writes_to": None,
        "verdict_labels": [],
        "prompt": PM_PROMPT,
    },
    {
        "key": "architect",
        "title": "Architect",
        "description": "Adds the technical design",
        "role_name": "architect",
        "node_kind": "thinker",
        "edits_allowed": False,
        "writes_to": None,
        "verdict_labels": [],
        "prompt": ARCHITECT_PROMPT,
    },
    {
        "key": "engineer",
        "title": "Engineer",
        "description": "Writes & ships it",
        "role_name": "engineer",
        "node_kind": "worker",
        "edits_allowed": True,
        "writes_to": None,
        "verdict_labels": [],
        "prompt": ENGINEER_PROMPT,
    },
    {
        "key": "reviewer",
        "title": "Reviewer",
        "description": "Checks against the spec",
        "role_name": "reviewer",
        "node_kind": "worker",
        "edits_allowed": False,
        "writes_to": None,
        "verdict_labels": ["approved", "changes_requested"],
        "prompt": REVIEWER_PROMPT,
    },
)

NODE_TEMPLATES_BY_KEY: dict[str, dict] = {t["key"]: t for t in NODE_TEMPLATES}


def list_node_templates() -> list[dict]:
    """The templates in menu order, as fresh dicts (callers may not mutate the module rows)."""
    return [{**t, "verdict_labels": list(t["verdict_labels"])} for t in NODE_TEMPLATES]


def get_node_template(key: str) -> dict | None:
    """One template by key (``pm`` / ``architect`` / ``engineer`` / ``reviewer``), else ``None``."""
    return NODE_TEMPLATES_BY_KEY.get(key)

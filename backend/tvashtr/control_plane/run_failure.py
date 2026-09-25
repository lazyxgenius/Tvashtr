"""A readable reason for a failed run (revamp P9).

The executor used to mark a run ``failed`` and nothing else: the reason lived only in the failing
invocation's ``outcome_detail`` as raw engine text (``owner <uuid> has no credential for provider
'xai'``). Home's "Needs you" shows a failed run with one sentence a person can act on, so every fail
site now records ``runs.failure_code`` / ``failure_message`` / ``failed_node_id`` through
:func:`humanise`, and :func:`describe_run_failure` rebuilds the same shape at read time for rows
written before this existed (from the latest failed invocation, else a generic sentence).

Pure string work plus one read helper; openhands-free, so ``team_run`` may import it.
"""

import re

from tvashtr.control_plane.desktop_jobs import OFFLINE_ERROR, RUN_ENDED_ERROR

GENERIC_MESSAGE = "The run stopped with an error."

# The codes a fail site passes (the humaniser may refine ``agent_error`` into a more specific one).
AGENT_ERROR = "agent_error"
OVER_CONTEXT = "over_context"
NO_SPEC = "no_spec"
DOMAIN_QUERY = "domain_query"
GITHUB_DELIVERY = "github_delivery"
INVALID_GRAPH = "invalid_graph"
# Refinements the humaniser derives from the reason text.
MISSING_CREDENTIAL = "missing_credential"
DESKTOP_OFFLINE = "desktop_offline"
DESKTOP_RUN_ENDED = "desktop_run_ended"
UNKNOWN = "unknown"

# ``credentials.NoCredentialError``'s message: "owner <uuid> has no credential for provider 'xai'".
_NO_CREDENTIAL = re.compile(r"has no credential for provider '([^']+)'")
_GITHUB_PREFIX = "github delivery failed:"
_MAX_MESSAGE = 240

# Built-in role slugs → the label the UI shows. Anything else is humanised from the slug.
_ROLE_LABELS = {
    "pm": "PM",
    "architect": "Architect",
    "engineer": "Engineer",
    "reviewer": "Reviewer",
    "thinker": "Thinker",
    "worker": "Worker",
    "ship": "Ship",
    "stop": "Stop",
    "domain_query": "Domain",
}
_GATE_LABELS = {
    "prd_approval": "Approval",
    "ship_approval": "Ship approval",
    "review_escalation": "Escalation",
    "budget_approval": "Budget",
}


def node_label(role_name: str | None, kind: str | None = None, config: dict | None = None) -> str:
    """The short label a node shows as (a chip, "Engineer has no xai key", "paused at Approval").

    An agent's own ``config.title`` wins (the agent panel stores the display name there); a gate is
    named by its gate kind; a built-in role slug maps to its label; anything else is humanised."""
    cfg = config if isinstance(config, dict) else {}
    if kind == "gate":
        gate_kind = cfg.get("gate_kind")
        if gate_kind in _GATE_LABELS:
            return _GATE_LABELS[gate_kind]
        if isinstance(gate_kind, str) and gate_kind:
            return gate_kind.replace("_", " ").strip().capitalize()
        return "Approval"
    title = cfg.get("title")
    if kind in ("completion", "agent") and isinstance(title, str) and title.strip():
        return title.strip()
    slug = (role_name or "").strip()
    if slug in _ROLE_LABELS:
        return _ROLE_LABELS[slug]
    return slug.replace("_", " ").strip().capitalize() or (kind or "Node").capitalize()


def _first_line(text: str) -> str:
    line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
    if len(line) > _MAX_MESSAGE:
        line = line[: _MAX_MESSAGE - 1].rstrip() + "…"
    return line


def humanise(
    code: str | None,
    reason: str | None,
    *,
    role: str | None = None,
    desktop_target: bool = False,
) -> dict:
    """``{code, message, provider}`` for a failure: ``code`` is the fail site's code (refined when
    the reason text says more), ``message`` one readable sentence, ``provider`` the provider slug
    for a ``missing_credential`` failure (else ``None``)."""
    text = (reason or "").strip()
    where = "this computer" if desktop_target else "the website"
    who = role or "An agent"

    match = _NO_CREDENTIAL.search(text)
    if match:
        provider = match.group(1)
        return {
            "code": MISSING_CREDENTIAL,
            "message": f"{who} has no {provider} key on {where}",
            "provider": provider,
        }
    if text == OFFLINE_ERROR or text.startswith("Tvashtr Desktop went offline"):
        return {"code": DESKTOP_OFFLINE, "message": OFFLINE_ERROR, "provider": None}
    if text == RUN_ENDED_ERROR:
        return {"code": DESKTOP_RUN_ENDED, "message": RUN_ENDED_ERROR, "provider": None}
    if code == GITHUB_DELIVERY or text.startswith(_GITHUB_PREFIX):
        rest = text[len(_GITHUB_PREFIX) :].strip() if text.startswith(_GITHUB_PREFIX) else text
        detail = _first_line(rest)
        message = "Couldn't open the pull request" + (f": {detail}" if detail else ".")
        return {"code": GITHUB_DELIVERY, "message": message, "provider": None}
    if code == NO_SPEC:
        return {
            "code": NO_SPEC,
            "message": f"{who} finished without writing a spec",
            "provider": None,
        }
    if code == INVALID_GRAPH:
        message = (
            "The team's graph ended without reaching Ship or Stop"
            if not text or "no terminal" in text
            else f"The team's graph has a problem: {_first_line(text)}"
        )
        return {"code": INVALID_GRAPH, "message": message, "provider": None}
    if not text:
        return {"code": code or UNKNOWN, "message": GENERIC_MESSAGE, "provider": None}
    line = _first_line(text)
    if code == OVER_CONTEXT or text.startswith("context ") and "exceeds budget" in text:
        return {
            "code": OVER_CONTEXT,
            "message": f"{who} ran out of context: {line}",
            "provider": None,
        }
    message = line if role is None else f"{role}: {line}"
    return {"code": code or AGENT_ERROR, "message": message, "provider": None}


def describe_run_failure(
    *,
    status: str,
    failure_code: str | None,
    failure_message: str | None,
    failed_node_id: str | None,
    desktop_target: bool,
    fallback_reason: str | None = None,
    fallback_node_id: str | None = None,
    node_info: dict[str, dict] | None = None,
) -> dict | None:
    """The ``failure`` object a run carries on the API, or ``None`` unless the run ``failed``.

    ``node_info`` maps a (clone) node id to ``{"label", "origin_node_id"}``. A row written by the
    executor carries its stored code/message; an older row is described from the latest failed
    invocation's ``outcome_detail`` (``fallback_reason``), else the generic sentence."""
    if status != "failed":
        return None
    info = node_info or {}
    node_id = failed_node_id or fallback_node_id
    node = info.get(node_id) if node_id else None
    role = node["label"] if node else None
    derived = humanise(failure_code, fallback_reason, role=role, desktop_target=desktop_target)
    return {
        "code": failure_code or derived["code"],
        "message": failure_message or derived["message"],
        "node_id": node_id,
        "origin_node_id": node["origin_node_id"] if node else None,
        "node_role": role,
        "provider": derived["provider"],
        "target": "desktop" if desktop_target else "website",
    }

"""Where a domain is used — Query domain steps and agents with access — and tidying those uses
when the domain is deleted (``clear_references``).

A domain is *used* by
- a **step**: a ``domain_query`` node whose ``config.domain_id`` is the domain, and
- an **agent**: a thinker/worker node whose ``tool_config.tvashtr.domains`` gives it access —
  ``true`` (or the old ``{"enabled": …}`` object) means every domain (the legacy "all domains"
  switch), a list of ids means just those.

Only the owner's LIBRARY teams count (run-snapshot clones never do). The Domains list's usage line
(DM-12) reads ``uses`` = steps + agents and ``teams`` = distinct library teams.

The Use in teams tab (DM-92…97) reads :func:`usage_detail`, adds a step with :func:`insert_step` at
one of the :func:`step_places`, and gives agents access with :func:`set_domain_agents`.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import select

from tvashtr.control_plane.credential_gate import RUNNER_SUBSCRIPTIONS, subscription_for_model
from tvashtr.control_plane.tool_usage import _order_key, _select_nodes, owner_agent_nodes
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Domain, Edge, EngineSubscriptionStatus, TeamGraph

AGENT_KINDS = ("completion", "agent")

STEP_PLACE = "Pick where the step goes."
QUESTION_REQUIRED = "Write the question to ask."
# Canvas column spacing of the built-in teams (teams.py): a new step takes its next node's place
# and everything from there on moves one column right.
STEP_SPACING = 260


def agent_domain_scope(
    tool_config: object, domain_id: uuid.UUID | str
) -> Literal["all", "this"] | None:
    """How an agent's ``tool_config`` reaches ``domain_id``: ``"all"`` for the legacy
    every-domain switch, ``"this"`` when a list names it, else ``None``."""
    if not isinstance(tool_config, dict):
        return None
    meta = tool_config.get("tvashtr")
    if not isinstance(meta, dict):
        return None
    flag = meta.get("domains")
    if flag is True:
        return "all"
    if isinstance(flag, dict) and flag and flag.get("enabled", True) is not False:
        return "all"
    if isinstance(flag, list) and str(domain_id) in {str(x) for x in flag}:
        return "this"
    return None


def _step_domain(config: object) -> uuid.UUID | None:
    raw = config.get("domain_id") if isinstance(config, dict) else None
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        return None


def usage_counts(
    session, owner_id: uuid.UUID, domain_ids: list[uuid.UUID]
) -> dict[uuid.UUID, dict]:
    """``{domain_id: {uses, teams, steps, agents}}`` for each of ``domain_ids`` (zeros when
    unused), counted over the owner's library teams."""
    wanted = set(domain_ids)
    teams: dict[uuid.UUID, set[uuid.UUID]] = {d: set() for d in wanted}
    steps = dict.fromkeys(wanted, 0)
    agents = dict.fromkeys(wanted, 0)
    if wanted:
        rows = session.execute(
            select(
                AgentNode.team_graph_id,
                AgentNode.kind,
                AgentNode.config,
                AgentNode.tool_config,
            )
            .join(TeamGraph, TeamGraph.id == AgentNode.team_graph_id)
            .where(TeamGraph.owner_id == owner_id, TeamGraph.is_library.is_(True))
        ).all()
        for team_id, kind, config, tool_config in rows:
            if kind == "domain_query":
                did = _step_domain(config)
                if did in wanted:
                    steps[did] += 1
                    teams[did].add(team_id)
            elif kind in AGENT_KINDS:
                for did in wanted:
                    if agent_domain_scope(tool_config, did):
                        agents[did] += 1
                        teams[did].add(team_id)
    return {
        d: {
            "uses": steps[d] + agents[d],
            "teams": len(teams[d]),
            "steps": steps[d],
            "agents": agents[d],
        }
        for d in wanted
    }


def clear_references(session, owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict:
    """Before a domain is deleted (DM-15, OQ-14): its Query domain steps lose their domain
    (``config.domain_id`` → null, so validity asks for another before the team runs) and agents'
    ``tvashtr.domains`` lists drop it. A legacy ``true`` switch is left as it is. Only the owner's
    library teams are tidied — a past run's snapshot keeps what it ran with.

    Returns ``{"steps_cleared": n, "agents_cleared": m}``."""
    steps = agents = 0
    nodes = (
        session.execute(
            select(AgentNode)
            .join(TeamGraph, TeamGraph.id == AgentNode.team_graph_id)
            .where(TeamGraph.owner_id == owner_id, TeamGraph.is_library.is_(True))
        )
        .scalars()
        .all()
    )
    for node in nodes:
        if node.kind == "domain_query":
            if _step_domain(node.config) == domain_id:
                # Fresh dicts so JSONB dirty-tracking sees the change.
                node.config = {**(node.config or {}), "domain_id": None}
                steps += 1
        elif node.kind in AGENT_KINDS and agent_domain_scope(node.tool_config, domain_id) == "this":
            tool_config = dict(node.tool_config or {})
            meta = dict(tool_config.get("tvashtr") or {})
            meta["domains"] = [x for x in meta.get("domains") or [] if str(x) != str(domain_id)]
            tool_config["tvashtr"] = meta
            node.tool_config = tool_config
            agents += 1
    session.flush()
    return {"steps_cleared": steps, "agents_cleared": agents}


# ---- Use in teams (DM-92…97) ----


def _owned(session, owner_id: uuid.UUID, domain_id: uuid.UUID) -> Domain | None:
    return session.execute(
        select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
    ).scalar_one_or_none()


def _agent_title(node: AgentNode) -> str:
    from tvashtr.control_plane.document_views import agent_label

    return agent_label(node.role_name, node.config if isinstance(node.config, dict) else None)


def _node_title(node: AgentNode) -> str:
    """A node's name on the canvas: an agent's title, a step's own title, else its kind."""
    if node.kind in AGENT_KINDS:
        return _agent_title(node)
    cfg = node.config if isinstance(node.config, dict) else {}
    title = cfg.get("title")
    if node.kind == "domain_query":
        return title.strip() if isinstance(title, str) and title.strip() else "Query domain"
    if node.kind == "gate":
        return "Approval"
    if node.kind == "terminal":
        return "Stop" if cfg.get("terminal_kind") == "stop" else "Ship"
    return node.role_name


def _connected_subscriptions(session, owner_id: uuid.UUID) -> set[str]:
    """The Desktop plans (Claude, Grok) the owner connected — their agents run on the Desktop
    runner, which gives them no Domains tools yet (DM-96, B-16)."""
    rows = session.execute(
        select(EngineSubscriptionStatus.provider).where(
            EngineSubscriptionStatus.owner_id == owner_id,
            EngineSubscriptionStatus.connected.is_(True),
        )
    ).scalars()
    return {p for p in rows if p in RUNNER_SUBSCRIPTIONS}


def _agent_row(node: AgentNode, team: TeamGraph, domain_id: uuid.UUID, subs: set[str]) -> dict:
    sub = subscription_for_model(node.model) if node.model else None
    return {
        "node_id": str(node.id),
        "team_id": str(team.id),
        "team_name": team.name,
        "role_name": node.role_name,
        "title": _agent_title(node),
        "model": node.model or None,
        "scope": agent_domain_scope(node.tool_config, domain_id),
        "subscription": sub if sub in subs else None,
    }


def domain_agents(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    """Every agent of the owner's library teams with ``scope`` for this domain (``"this"``,
    ``"all"`` for the legacy every-domain switch, or ``None``) — the Give access dialog's rows.
    ``None`` when the domain isn't the owner's."""
    with session_scope() as session:
        if _owned(session, owner_id, domain_id) is None:
            return None
        subs = _connected_subscriptions(session, owner_id)
        return [
            _agent_row(node, team, domain_id, subs)
            for node, team in owner_agent_nodes(session, owner_id)
        ]


def usage_detail(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    """``GET /api/domains/{id}/usage``: the Query domain steps that ask this domain and the agents
    that can search it, over the owner's library teams in canvas order (``None`` → 404)."""
    with session_scope() as session:
        if _owned(session, owner_id, domain_id) is None:
            return None
        rows = session.execute(
            select(AgentNode, TeamGraph)
            .join(TeamGraph, TeamGraph.id == AgentNode.team_graph_id)
            .where(
                TeamGraph.owner_id == owner_id,
                TeamGraph.is_library.is_(True),
                AgentNode.kind == "domain_query",
            )
        ).all()
        steps = [
            {
                "node_id": str(node.id),
                "team_id": str(team.id),
                "team_name": team.name,
                "title": _node_title(node),
                "pass_to_spec": bool((node.config or {}).get("pass_to_spec")),
            }
            for node, team in sorted(rows, key=_order_key)
            if _step_domain(node.config) == domain_id
        ]
        subs = _connected_subscriptions(session, owner_id)
        agents = [
            row
            for node, team in owner_agent_nodes(session, owner_id)
            if (row := _agent_row(node, team, domain_id, subs))["scope"]
        ]
        return {"steps": steps, "agents": agents}


def _team_graph(session, team_id: uuid.UUID) -> tuple[list[AgentNode], list[Edge]]:
    nodes = list(
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team_id)).scalars()
    )
    edges = list(session.execute(select(Edge).where(Edge.team_graph_id == team_id)).scalars())
    return nodes, edges


def _slot(node: AgentNode, edges: list[Edge]) -> Edge | None:
    """The edge a step would split when added after ``node`` (OQ-20): an agent with exactly one
    way out — one unconditional, non-escalation edge. A gate, a terminal, a verdict-emitting agent
    (a ``when`` branch or a rework loop) or a fan-out has no slot."""
    if node.kind not in AGENT_KINDS:
        return None
    outs = [e for e in edges if e.source_node_id == node.id and e.edge_type != "escalation"]
    if len(outs) != 1 or outs[0].conditions:
        return None
    return outs[0]


def step_places(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    """``GET /api/domains/{id}/step-places``: the Add step dialog's teams (oldest first), each with
    its main path (``path`` — the agents and steps from the start to Ship) and the places a step can
    go: "After <agent>" for each agent on that path with one way out (OQ-20)."""
    from tvashtr.control_plane.graph_validity import team_shape

    with session_scope() as session:
        if _owned(session, owner_id, domain_id) is None:
            return None
        teams = session.execute(
            select(TeamGraph)
            .where(TeamGraph.owner_id == owner_id, TeamGraph.is_library.is_(True))
            .order_by(TeamGraph.created_at, TeamGraph.id)
        ).scalars()
        out = []
        for team in teams:
            nodes, edges = _team_graph(session, team.id)
            by_id = {str(n.id): n for n in nodes}
            shape = team_shape(
                [
                    {"id": str(n.id), "kind": n.kind, "role_name": n.role_name, "config": n.config}
                    for n in nodes
                ],
                [
                    {
                        "id": str(e.id),
                        "source_node_id": str(e.source_node_id),
                        "target_node_id": str(e.target_node_id),
                        "edge_type": e.edge_type,
                        "conditions": e.conditions,
                    }
                    for e in edges
                ],
            )
            on_path = [by_id[s["id"]] for s in shape["nodes"] if s["id"] in by_id]
            places = []
            for node in on_path:
                slot = _slot(node, edges)
                if slot is None:
                    continue
                nxt = next((n for n in nodes if n.id == slot.target_node_id), None)
                places.append(
                    {
                        "after_node_id": str(node.id),
                        "after": _node_title(node),
                        "next": _node_title(nxt) if nxt is not None else None,
                    }
                )
            out.append(
                {
                    "team_id": str(team.id),
                    "name": team.name,
                    "path": [
                        _node_title(n) for n in on_path if n.kind in (*AGENT_KINDS, "domain_query")
                    ],
                    "places": places,
                }
            )
        return {"teams": out}


def step_title(domain_name: str) -> str:
    """ "Look up <name>" with the first letter lower-cased unless the first word is an acronym
    ("Look up support docs", "Look up Q3 filings", DM-101)."""
    name = domain_name.strip()
    first = name.split(" ", 1)[0]
    acronym = len(first) > 1 and (first[1].isupper() or first[1].isdigit())
    return f"Look up {name if acronym else name[:1].lower() + name[1:]}"


def _x(node: AgentNode) -> float | None:
    x = (node.position or {}).get("x") if isinstance(node.position, dict) else None
    return float(x) if isinstance(x, int | float) else None


def insert_step(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    team_id: uuid.UUID,
    after_node_id: uuid.UUID,
    prompt: str,
    pass_to_spec: bool,
) -> dict:
    """``POST /api/domains/{id}/steps`` (DM-94/95): a Query domain node asking this domain, placed
    after ``after_node_id`` — the agent's single way out ``after → next`` becomes ``after → step →
    next``. The step takes ``next``'s place on the canvas and the nodes from there on move one
    column right. ``LookupError`` (``"domain"``/``"team"``/``"node"``) → 404; ``ValueError``
    → 422."""
    question = (prompt or "").strip()
    if not question:
        raise ValueError(QUESTION_REQUIRED)
    with session_scope() as session:
        domain = _owned(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain")
        team = session.get(TeamGraph, team_id)
        if team is None or not team.is_library or team.owner_id != owner_id:
            raise LookupError("team")
        nodes, edges = _team_graph(session, team.id)
        after = next((n for n in nodes if n.id == after_node_id), None)
        if after is None:
            raise LookupError("node")
        slot = _slot(after, edges)
        if slot is None:
            raise ValueError(STEP_PLACE)
        nxt = next(n for n in nodes if n.id == slot.target_node_id)
        next_x = _x(nxt)
        position = dict(nxt.position) if isinstance(nxt.position, dict) else {}
        if next_x is not None:
            for n in nodes:
                x = _x(n)
                if x is not None and x >= next_x:
                    n.position = {**n.position, "x": x + STEP_SPACING}
        step = AgentNode(
            team_graph_id=team.id,
            role_name="domain_query",
            kind="domain_query",
            model=None,
            engine=None,
            prompt=question,
            position=position,
            edits_allowed=False,
            config={
                "domain_id": str(domain.id),
                "title": step_title(domain.name),
                "pass_to_spec": bool(pass_to_spec),
                "on_no_answer": "continue",
            },
        )
        session.add(step)
        session.flush()
        slot.target_node_id = step.id
        session.add(
            Edge(
                team_graph_id=team.id,
                source_node_id=step.id,
                target_node_id=nxt.id,
                edge_type="work",
                conditions=None,
            )
        )
        session.flush()
        return {
            "node_id": str(step.id),
            "team_id": str(team.id),
            "title": step.config["title"],
            "after": {"node_id": str(after.id), "title": _node_title(after)},
            "connected_to": {"node_id": str(nxt.id), "title": _node_title(nxt)},
        }


def _with_domains(tool_config: object, value: list[str]) -> dict:
    """A fresh ``tool_config`` whose ``tvashtr.domains`` is ``value`` (fresh dicts, so JSONB
    dirty-tracking sees the change)."""
    config = dict(tool_config) if isinstance(tool_config, dict) else {}
    meta = dict(config.get("tvashtr") or {}) if isinstance(config.get("tvashtr"), dict) else {}
    meta["domains"] = value
    config["tvashtr"] = meta
    return config


def set_domain_agents(
    owner_id: uuid.UUID, domain_id: uuid.UUID, node_ids: list[str]
) -> list[dict] | None:
    """``PUT /api/domains/{id}/agents`` (DM-96/97): exactly ``node_ids`` can search this domain
    afterwards (full-set semantics, like a tool's agents). A listed agent gains the id in its
    ``tvashtr.domains`` list; an unlisted one loses it; an unlisted legacy every-domain agent keeps
    every OTHER domain as an explicit list. Returns the agents that can search it (``None`` → 404;
    ``LookupError`` for an agent that isn't the owner's → 404)."""
    with session_scope() as session:
        if _owned(session, owner_id, domain_id) is None:
            return None
        rows, wanted = _select_nodes(session, owner_id, node_ids)
        did = str(domain_id)
        others: list[str] | None = None
        for node, _team in rows:
            scope = agent_domain_scope(node.tool_config, domain_id)
            if node.id in wanted and scope is None:
                meta = (node.tool_config or {}).get("tvashtr") if node.tool_config else None
                current = meta.get("domains") if isinstance(meta, dict) else None
                ids = [str(x) for x in current] if isinstance(current, list) else []
                node.tool_config = _with_domains(node.tool_config, [*ids, did])
            elif node.id not in wanted and scope == "this":
                meta = node.tool_config.get("tvashtr") or {}
                ids = [str(x) for x in meta.get("domains") or [] if str(x) != did]
                node.tool_config = _with_domains(node.tool_config, ids)
            elif node.id not in wanted and scope == "all":
                if others is None:
                    others = [
                        str(d)
                        for d in session.execute(
                            select(Domain.id)
                            .where(Domain.owner_id == owner_id, Domain.id != domain_id)
                            .order_by(Domain.created_at, Domain.id)
                        ).scalars()
                    ]
                node.tool_config = _with_domains(node.tool_config, list(others))
        session.flush()
        subs = _connected_subscriptions(session, owner_id)
        return [
            row for node, team in rows if (row := _agent_row(node, team, domain_id, subs))["scope"]
        ]

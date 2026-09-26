"""Where a domain is used — Query domain steps and agents with access — and tidying those uses
when the domain is deleted (``clear_references``).

A domain is *used* by
- a **step**: a ``domain_query`` node whose ``config.domain_id`` is the domain, and
- an **agent**: a thinker/worker node whose ``tool_config.tvashtr.domains`` gives it access —
  ``true`` (or the old ``{"enabled": …}`` object) means every domain (the legacy "all domains"
  switch), a list of ids means just those.

Only the owner's LIBRARY teams count (run-snapshot clones never do). The Domains list's usage line
(DM-12) reads ``uses`` = steps + agents and ``teams`` = distinct library teams.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import select

from tvashtr.models import AgentNode, TeamGraph

AGENT_KINDS = ("completion", "agent")


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

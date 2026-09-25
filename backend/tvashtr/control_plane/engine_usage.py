"""Engines — which of the owner's teams, agents and domains use each provider (read-only).

Feeds the Engines Overview ("Providers your teams use", "Can your teams run?"), the API keys page
("Used by", the suggested-keys banner), "See where it's used" and every remove/disconnect impact
dialog. Readiness itself is derived on the frontend with the parity-tested credential gate
(``credential_gate`` ⇔ ``lib/engines.missingProvidersForModels``), so this module only reports
facts and never re-implements the rule.

Scope, deliberately narrow:

* **Teams** are the owner's LIBRARY teams (``TeamGraph.is_library`` AND ``owner_id``) — never a
  run-snapshot clone, an A/B graph or another account's team. Their ``agent`` and ``completion``
  nodes are the ones that carry a model; a node with no model yet is listed (``model: null``) so the
  UI can say "needs a model", but it uses no provider.
* **Providers** come from :func:`credentials.provider_for_model` — the one canonical mapping the
  launch pre-flight and the key resolver use.
* **Fallback models** (``config.fallback_model``) spend keys too, but the launch gate ignores them,
  so they are reported apart (``fallback_*`` / ``fallback_teams``) and never mixed into the primary
  usage the verdicts read.
* **Domains** report their embedding model (normalized exactly as ingest does) and their generation
  model only when one is configured — the account-default fallback is resolved at ask time from the
  keys held then, so naming it here would go stale.
"""

import uuid

from sqlalchemy import select

from tvashtr.control_plane.context_compiler import resolve_fallback_model
from tvashtr.control_plane.credentials import provider_for_model
from tvashtr.control_plane.domain_embedding import normalize_embedding_model
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Domain, TeamGraph

MODEL_NODE_KINDS: tuple[str, ...] = ("agent", "completion")


def _clean(value: object) -> str | None:
    """A non-blank string, trimmed; anything else is ``None``."""
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _node_usage(node: AgentNode) -> dict:
    config = node.config or {}
    model = _clean(node.model)
    fallback = resolve_fallback_model(config)
    return {
        "node_id": str(node.id),
        "role_name": node.role_name,
        "title": _clean(config.get("title")),
        "kind": node.kind,
        "model": model,
        "provider": provider_for_model(model) if model else None,
        "fallback_model": fallback,
        "fallback_provider": provider_for_model(fallback) if fallback else None,
    }


def _domain_usage(domain: Domain) -> dict:
    config = domain.config or {}
    embedding = config.get("embedding") if isinstance(config.get("embedding"), dict) else {}
    generation = config.get("generation") if isinstance(config.get("generation"), dict) else {}
    embedding_model = normalize_embedding_model(str(embedding.get("model") or ""))
    generation_model = _clean(generation.get("model"))
    return {
        "domain_id": str(domain.id),
        "name": domain.name,
        "embedding_model": embedding_model,
        "embedding_provider": provider_for_model(embedding_model),
        "generation_model": generation_model,
        "generation_provider": provider_for_model(generation_model) if generation_model else None,
    }


def _add_use(uses: dict[str, dict], provider: str, team: dict, node: dict) -> None:
    """Record one node's use of ``provider`` in this team's per-provider entry (roles distinct, in
    node order; every node id kept)."""
    entry = uses.setdefault(
        provider,
        {"team_id": team["team_id"], "name": team["name"], "roles": [], "node_ids": []},
    )
    if node["role_name"] not in entry["roles"]:
        entry["roles"].append(node["role_name"])
    entry["node_ids"].append(node["node_id"])


def _by_provider(teams: list[dict], domains: list[dict]) -> dict[str, dict]:
    by: dict[str, dict] = {}

    def bucket(provider: str) -> dict:
        return by.setdefault(provider, {"teams": [], "fallback_teams": [], "domains": []})

    for team in teams:
        primary: dict[str, dict] = {}
        fallback: dict[str, dict] = {}
        for node in team["nodes"]:
            if node["provider"]:
                _add_use(primary, node["provider"], team, node)
            if node["fallback_provider"]:
                _add_use(fallback, node["fallback_provider"], team, node)
        for provider, entry in primary.items():
            bucket(provider)["teams"].append(entry)
        for provider, entry in fallback.items():
            bucket(provider)["fallback_teams"].append(entry)
    for domain in domains:
        bucket(domain["embedding_provider"])["domains"].append(
            {"domain_id": domain["domain_id"], "name": domain["name"], "use": "embedding"}
        )
        if domain["generation_provider"]:
            bucket(domain["generation_provider"])["domains"].append(
                {"domain_id": domain["domain_id"], "name": domain["name"], "use": "generation"}
            )
    return {provider: by[provider] for provider in sorted(by)}


def engine_usage(owner_id: uuid.UUID) -> dict:
    """``{teams, domains, by_provider}`` for ONE owner (see the module docstring for the scope).

    Teams and domains are ordered ``(created_at, id)`` like their own lists; nodes within a team
    likewise; ``by_provider`` keys are sorted. Read-only."""
    with session_scope() as session:
        graphs = (
            session.execute(
                select(TeamGraph)
                .where(TeamGraph.is_library.is_(True), TeamGraph.owner_id == owner_id)
                .order_by(TeamGraph.created_at, TeamGraph.id)
            )
            .scalars()
            .all()
        )
        nodes_by_team: dict[uuid.UUID, list[dict]] = {g.id: [] for g in graphs}
        if graphs:
            nodes = (
                session.execute(
                    select(AgentNode)
                    .where(
                        AgentNode.team_graph_id.in_(list(nodes_by_team)),
                        AgentNode.kind.in_(MODEL_NODE_KINDS),
                    )
                    .order_by(AgentNode.created_at, AgentNode.id)
                )
                .scalars()
                .all()
            )
            for node in nodes:
                nodes_by_team[node.team_graph_id].append(_node_usage(node))
        teams = [
            {"team_id": str(g.id), "name": g.name, "nodes": nodes_by_team[g.id]} for g in graphs
        ]
        domains = [
            _domain_usage(d)
            for d in session.execute(
                select(Domain)
                .where(Domain.owner_id == owner_id)
                .order_by(Domain.created_at, Domain.id)
            )
            .scalars()
            .all()
        ]
    return {"teams": teams, "domains": domains, "by_provider": _by_provider(teams, domains)}

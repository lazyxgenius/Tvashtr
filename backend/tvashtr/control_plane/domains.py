"""PolyRAG Domains — Phase 1 config + CRUD helpers (no ingest/ask)."""

from __future__ import annotations

import uuid
from copy import deepcopy

from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.models import Domain


_SECRET_KEYS = frozenset(
    {"api_key", "token", "cookies", "cookie", "secret", "authorization", "password"}
)
_V1_CONFIG_KEYS = frozenset({"chunking", "embedding", "retrieval", "generation"})


def _reject_secret_keys(obj: object, *, path: str = "config") -> None:
    """Recursively reject denylisted secret-bearing keys (case-insensitive)."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            key_str = str(key)
            if key_str.lower() in _SECRET_KEYS:
                raise ValueError(
                    f"domain config must not include secrets: {key_str!r} at {path}"
                )
            _reject_secret_keys(value, path=f"{path}.{key_str}")
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            _reject_secret_keys(item, path=f"{path}[{i}]")


def validate_domain_config(config: dict) -> None:
    """Enforce Phase 1 v1 shape + secret denylist. Raises ValueError → API 422."""
    if not isinstance(config, dict):
        raise ValueError("domain config must be an object")
    keys = set(config.keys())
    missing = _V1_CONFIG_KEYS - keys
    if missing:
        raise ValueError(f"domain config missing required keys: {sorted(missing)}")
    extra = keys - _V1_CONFIG_KEYS
    if extra:
        raise ValueError(f"domain config has unknown top-level keys: {sorted(extra)}")
    for section in _V1_CONFIG_KEYS:
        if not isinstance(config[section], dict):
            raise ValueError(f"domain config.{section} must be an object")
    _reject_secret_keys(config)


DOMAIN_TEMPLATE_KEYS: tuple[str, ...] = (
    "financial",
    "legal",
    "scientific",
    "support",
    "blank",
)

_TEMPLATE_META: dict[str, dict[str, str]] = {
    "financial": {
        "name": "Financial",
        "description": "Filings, metrics, and investor docs — mid-size chunks.",
    },
    "legal": {
        "name": "Legal",
        "description": "Contracts and policies — smaller chunks for precise cites.",
    },
    "scientific": {
        "name": "Scientific",
        "description": "Papers and methods — larger chunks for continuity.",
    },
    "support": {
        "name": "Support",
        "description": "Help center and product docs — concise retrieval chunks.",
    },
    "blank": {
        "name": "Blank",
        "description": "Start from default config and tune everything yourself.",
    },
}


def default_config_for_template(template: str) -> dict:
    base = {
        "chunking": {"strategy": "fixed", "size": 800, "overlap": 100},
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 8, "mode": "dense"},
        "generation": {"model": None},
    }
    if template == "legal":
        base["chunking"] = {"strategy": "fixed", "size": 500, "overlap": 80}
    elif template == "scientific":
        base["chunking"] = {"strategy": "fixed", "size": 1000, "overlap": 150}
    elif template == "financial":
        base["chunking"] = {"strategy": "fixed", "size": 700, "overlap": 100}
    elif template == "support":
        base["chunking"] = {"strategy": "fixed", "size": 600, "overlap": 100}
    elif template == "blank":
        pass
    else:
        raise KeyError(template)
    return deepcopy(base)


def list_domain_templates() -> list[dict]:
    return [
        {
            "template": key,
            "name": _TEMPLATE_META[key]["name"],
            "description": _TEMPLATE_META[key]["description"],
        }
        for key in DOMAIN_TEMPLATE_KEYS
    ]


def domain_to_dict(domain: Domain) -> dict:
    return {
        "domain_id": str(domain.id),
        "name": domain.name,
        "template": domain.template,
        "config": domain.config or {},
        "status": domain.status,
        "doc_count": 0,  # Phase 2 wires real counts
        "created_at": domain.created_at.isoformat(),
        "updated_at": domain.updated_at.isoformat(),
    }


def list_domains(owner_id: uuid.UUID) -> list[dict]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(Domain)
                .where(Domain.owner_id == owner_id)
                .order_by(Domain.created_at, Domain.id)
            )
            .scalars()
            .all()
        )
        return [domain_to_dict(r) for r in rows]


def create_domain(owner_id: uuid.UUID, name: str, template: str) -> dict:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("a domain name is required")
    if template not in DOMAIN_TEMPLATE_KEYS:
        raise KeyError(template)
    cfg = default_config_for_template(template)
    with session_scope() as session:
        row = Domain(
            owner_id=owner_id,
            name=cleaned,
            template=template,
            config=cfg,
            status="empty",
        )
        session.add(row)
        session.flush()
        return domain_to_dict(row)


def get_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        return None if row is None else domain_to_dict(row)


def update_domain(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    name: str | None = None,
    config: dict | None = None,
) -> dict | None:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        if name is not None:
            cleaned = name.strip()
            if not cleaned:
                raise ValueError("a domain name is required")
            row.name = cleaned
        if config is not None:
            validate_domain_config(config)
            # Fresh dict so JSONB dirty-tracking works (same pattern as gate config patches).
            row.config = dict(config)
        session.flush()
        return domain_to_dict(row)


def delete_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)
        session.flush()
        return True

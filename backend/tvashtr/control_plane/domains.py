"""PolyRAG Domains — Phase 1 config + CRUD helpers; Phase 2 document helpers."""

from __future__ import annotations

import uuid
from copy import deepcopy

from sqlalchemy import func, select

from tvashtr.control_plane import domain_files as domain_files_cp
from tvashtr.control_plane.domain_embedding import (
    is_allowed_embedding_model,
    normalize_embedding_model,
)
from tvashtr.db import session_scope
from tvashtr.models import Domain, DomainDocument


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

    embedding = config["embedding"]
    emb_extra = set(embedding) - {"model"}
    if emb_extra:
        raise ValueError(
            f"domain config.embedding has unknown keys: {sorted(emb_extra)}"
        )
    if "model" not in embedding:
        raise ValueError("domain config.embedding.model is required")
    if embedding["model"] is not None and not isinstance(embedding["model"], str):
        raise ValueError("domain config.embedding.model must be a string")
    emb_model = normalize_embedding_model(str(embedding.get("model") or ""))
    if not is_allowed_embedding_model(emb_model):
        raise ValueError(
            "domain config.embedding.model must be a 1536-dim allowlisted slug "
            f"(got {emb_model!r}); see EMBEDDING_PRESETS / OpenAI or "
            "openrouter/openai/text-embedding-3-small"
        )

    retrieval = config["retrieval"]
    mode = retrieval.get("mode")
    if mode is not None and str(mode).strip() != "":
        if str(mode).strip().lower() not in {"dense", "lexical", "hybrid"}:
            raise ValueError(
                "domain config.retrieval.mode must be dense, lexical, or hybrid"
            )
    rerank = retrieval.get("rerank")
    if rerank is not None:
        if not isinstance(rerank, dict):
            raise ValueError("domain config.retrieval.rerank must be an object")
        extra = set(rerank) - {"enabled", "model", "top_n"}
        if extra:
            raise ValueError(
                f"domain config.retrieval.rerank has unknown keys: {sorted(extra)}"
            )
        if "enabled" in rerank and not isinstance(rerank["enabled"], bool):
            raise ValueError("domain config.retrieval.rerank.enabled must be a boolean")
        if "model" in rerank and rerank["model"] is not None and not isinstance(
            rerank["model"], str
        ):
            raise ValueError(
                "domain config.retrieval.rerank.model must be a string or null"
            )
        if "top_n" in rerank:
            try:
                n = int(rerank["top_n"])
            except (TypeError, ValueError) as e:
                raise ValueError(
                    "domain config.retrieval.rerank.top_n must be an integer >= 1"
                ) from e
            if n < 1:
                raise ValueError(
                    "domain config.retrieval.rerank.top_n must be an integer >= 1"
                )

    graph = retrieval.get("graph")
    if graph is not None:
        if not isinstance(graph, dict):
            raise ValueError("domain config.retrieval.graph must be an object")
        extra = set(graph) - {"enabled"}
        if extra:
            raise ValueError(
                f"domain config.retrieval.graph has unknown keys: {sorted(extra)}"
            )
        if "enabled" in graph and not isinstance(graph["enabled"], bool):
            raise ValueError("domain config.retrieval.graph.enabled must be a boolean")


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
        "retrieval": {
            "top_k": 8,
            "mode": "dense",
            "rerank": {"enabled": False, "model": None, "top_n": 20},
            "graph": {"enabled": False},
        },
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


INGEST_PENDING = "pending"
INGEST_INDEXING = "indexing"
INGEST_READY = "ready"
INGEST_ERROR = "error"


def compute_domain_status(ingest_statuses: list[str]) -> str:
    """Aggregate Domain.status from document ingest_status values.

    Rules (Phase 2):
    - 0 docs → ``empty``
    - any ``indexing`` or ``pending`` → ``indexing``
    - else any ``error`` → ``error``
    - else any ``ready`` → ``ready``
    - else → ``empty``
    """
    if not ingest_statuses:
        return "empty"
    if any(s in (INGEST_INDEXING, INGEST_PENDING) for s in ingest_statuses):
        return "indexing"
    if any(s == INGEST_ERROR for s in ingest_statuses):
        return "error"
    if any(s == INGEST_READY for s in ingest_statuses):
        return "ready"
    return "empty"


def _owned_domain(session, owner_id: uuid.UUID, domain_id: uuid.UUID) -> Domain | None:
    return session.execute(
        select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
    ).scalar_one_or_none()


def _doc_count(session, domain_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(DomainDocument)
            .where(DomainDocument.domain_id == domain_id)
        ).scalar_one()
    )


def _apply_domain_aggregates(session, domain: Domain) -> None:
    statuses = list(
        session.execute(
            select(DomainDocument.ingest_status).where(DomainDocument.domain_id == domain.id)
        ).scalars()
    )
    domain.status = compute_domain_status(statuses)


def document_to_dict(doc: DomainDocument) -> dict:
    return {
        "document_id": str(doc.id),
        "domain_id": str(doc.domain_id),
        "filename": doc.filename,
        "content_type": doc.content_type,
        "byte_size": doc.byte_size,
        "ingest_status": doc.ingest_status,
        "error_message": doc.error_message,
        "version": doc.version,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }


def domain_to_dict(domain: Domain, *, doc_count: int) -> dict:
    return {
        "domain_id": str(domain.id),
        "name": domain.name,
        "template": domain.template,
        "config": domain.config or {},
        "status": domain.status,
        "doc_count": doc_count,
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
        return [domain_to_dict(r, doc_count=_doc_count(session, r.id)) for r in rows]


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
        return domain_to_dict(row, doc_count=_doc_count(session, row.id))


def get_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        return None if row is None else domain_to_dict(row, doc_count=_doc_count(session, row.id))


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
        return domain_to_dict(row, doc_count=_doc_count(session, row.id))


def list_documents(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        rows = (
            session.execute(
                select(DomainDocument)
                .where(DomainDocument.domain_id == domain_id)
                .order_by(DomainDocument.created_at, DomainDocument.id)
            )
            .scalars()
            .all()
        )
        return [document_to_dict(r) for r in rows]


def create_document(
    owner_id: uuid.UUID, domain_id: uuid.UUID, filename: str, data: bytes
) -> dict:
    if len(data) > domain_files_cp.MAX_UPLOAD_BYTES:
        raise ValueError("file exceeds 10 MiB limit")
    ext = domain_files_cp.extension_of(filename)
    content_type = domain_files_cp.content_type_for_ext(ext)
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        doc = DomainDocument(
            domain_id=domain.id,
            filename=domain_files_cp.safe_filename(filename),
            content_type=content_type,
            storage_path="pending",
            byte_size=len(data),
            ingest_status=INGEST_PENDING,
        )
        session.add(doc)
        session.flush()
        rel = domain_files_cp.relative_storage_path(
            owner_id, domain.id, doc.id, doc.filename
        )
        domain_files_cp.save_bytes(rel, data)
        doc.storage_path = rel
        _apply_domain_aggregates(session, domain)
        session.flush()
        return document_to_dict(doc)


def delete_document(
    owner_id: uuid.UUID, domain_id: uuid.UUID, document_id: uuid.UUID
) -> bool:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return False
        doc = session.execute(
            select(DomainDocument).where(
                DomainDocument.id == document_id,
                DomainDocument.domain_id == domain_id,
            )
        ).scalar_one_or_none()
        if doc is None:
            return False
        rel = doc.storage_path
        session.delete(doc)  # cascades chunks via FK
        session.flush()
        _apply_domain_aggregates(session, domain)
        session.flush()
    domain_files_cp.delete_stored(rel)
    return True


def delete_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)  # cascades domain_documents / domain_chunks
        session.flush()
    domain_files_cp.delete_domain_tree(owner_id, domain_id)
    return True

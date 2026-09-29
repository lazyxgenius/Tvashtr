"""PolyRAG Domains — Phase 1 config + CRUD helpers; Phase 2 document helpers."""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from tvashtr.control_plane import domain_files as domain_files_cp
from tvashtr.control_plane.domain_embedding import (
    expected_dim,
    is_allowed_embedding_model,
    normalize_embedding_model,
    same_embedding_weights,
)
from tvashtr.db import session_scope
from tvashtr.models import Domain, DomainChunk, DomainDocument

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
                raise ValueError(f"domain config must not include secrets: {key_str!r} at {path}")
            _reject_secret_keys(value, path=f"{path}.{key_str}")
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            _reject_secret_keys(item, path=f"{path}[{i}]")


# The Settings tab's own copy for its numbers (DM-83, DM-85).
PIECE_SIZE_RANGE = "Use a number from 100 to 4,000."
OVERLAP_SMALLER = "Overlap must be smaller than the piece size."
PASSAGES_RANGE = "Use a number from 1 to 30."
LOOK_WIDER_POOL = "Look wider needs at least as many passages as it keeps."


def _whole(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _check_numbers(config: dict) -> None:
    """Piece size 100–4,000, overlap 0…size−1, passages 1–30, and a Look-wider pool at least as
    big as what it keeps. Keys a config leaves out are not checked (older configs)."""
    chunking, retrieval = config["chunking"], config["retrieval"]
    size = chunking.get("size", 800)
    if "size" in chunking and not (_whole(size) and 100 <= size <= 4000):
        raise ValueError(PIECE_SIZE_RANGE)
    if "overlap" in chunking:
        overlap = chunking["overlap"]
        if not _whole(overlap) or overlap < 0:
            raise ValueError(f"Use a number from 0 to {size - 1:,}.")
        if overlap >= size:
            raise ValueError(OVERLAP_SMALLER)
    top_k = retrieval.get("top_k", 8)
    if "top_k" in retrieval and not (_whole(top_k) and 1 <= top_k <= 30):
        raise ValueError(PASSAGES_RANGE)
    rerank = retrieval.get("rerank")
    if isinstance(rerank, dict) and rerank.get("enabled") is True:
        top_n = rerank.get("top_n", 20)
        if _whole(top_n) and top_n < top_k:
            raise ValueError(LOOK_WIDER_POOL)


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
        raise ValueError(f"domain config.embedding has unknown keys: {sorted(emb_extra)}")
    if "model" not in embedding:
        raise ValueError("domain config.embedding.model is required")
    if embedding["model"] is not None and not isinstance(embedding["model"], str):
        raise ValueError("domain config.embedding.model must be a string")
    emb_model = normalize_embedding_model(str(embedding.get("model") or ""))
    if not is_allowed_embedding_model(emb_model):
        raise ValueError(
            "domain config.embedding.model must be an allowlisted slug "
            f"(got {emb_model!r}); see EMBEDDING_PRESETS / "
            "openai|openrouter 1536, gemini/gemini-embedding-001 (768), "
            "or huggingface/BAAI/bge-small-en-v1.5 (384)"
        )

    _check_numbers(config)
    retrieval = config["retrieval"]
    mode = retrieval.get("mode")
    if mode is not None and str(mode).strip() != "":
        if str(mode).strip().lower() not in {"dense", "lexical", "hybrid"}:
            raise ValueError("domain config.retrieval.mode must be dense, lexical, or hybrid")
    rerank = retrieval.get("rerank")
    if rerank is not None:
        if not isinstance(rerank, dict):
            raise ValueError("domain config.retrieval.rerank must be an object")
        extra = set(rerank) - {"enabled", "model", "top_n"}
        if extra:
            raise ValueError(f"domain config.retrieval.rerank has unknown keys: {sorted(extra)}")
        if "enabled" in rerank and not isinstance(rerank["enabled"], bool):
            raise ValueError("domain config.retrieval.rerank.enabled must be a boolean")
        if (
            "model" in rerank
            and rerank["model"] is not None
            and not isinstance(rerank["model"], str)
        ):
            raise ValueError("domain config.retrieval.rerank.model must be a string or null")
        if "top_n" in rerank:
            try:
                n = int(rerank["top_n"])
            except (TypeError, ValueError) as e:
                raise ValueError(
                    "domain config.retrieval.rerank.top_n must be an integer >= 1"
                ) from e
            if n < 1:
                raise ValueError("domain config.retrieval.rerank.top_n must be an integer >= 1")

    graph = retrieval.get("graph")
    if graph is not None:
        if not isinstance(graph, dict):
            raise ValueError("domain config.retrieval.graph must be an object")
        extra = set(graph) - {"enabled"}
        if extra:
            raise ValueError(f"domain config.retrieval.graph has unknown keys: {sorted(extra)}")
        if "enabled" in graph and not isinstance(graph["enabled"], bool):
            raise ValueError("domain config.retrieval.graph.enabled must be a boolean")


# Served in the design's order (Dm-NewDialog, Dm-ListEmpty): support, legal, financial,
# scientific, blank.
DOMAIN_TEMPLATE_KEYS: tuple[str, ...] = (
    "support",
    "legal",
    "financial",
    "scientific",
    "blank",
)

# ``description`` is the New domain dialog's line under the name; ``short`` is the empty page's
# template card line (Dm-ListEmpty).
_TEMPLATE_META: dict[str, dict[str, str]] = {
    "support": {
        "name": "Support",
        "description": "Help center and product docs",
        "short": "Help center and product docs",
    },
    "legal": {
        "name": "Legal",
        "description": "Contracts and policies · precise sources",
        "short": "Contracts and policies",
    },
    "financial": {
        "name": "Financial",
        "description": "Filings, metrics, investor docs",
        "short": "Filings and investor docs",
    },
    "scientific": {
        "name": "Scientific",
        "description": "Papers and methods · more context",
        "short": "Papers and methods",
    },
    "blank": {
        "name": "Blank",
        "description": "Start from defaults and tune it yourself",
        "short": "Start from defaults",
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
    """The starting points, in design order, with the piece size and overlap each one seeds."""
    out = []
    for key in DOMAIN_TEMPLATE_KEYS:
        chunking = default_config_for_template(key)["chunking"]
        out.append(
            {
                "template": key,
                "name": _TEMPLATE_META[key]["name"],
                "description": _TEMPLATE_META[key]["description"],
                "short": _TEMPLATE_META[key]["short"],
                "piece_size": chunking["size"],
                "overlap": chunking["overlap"],
            }
        )
    return out


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


MAX_DOMAIN_NAME = 120
NAME_REQUIRED = "Give this domain a name."
NAME_TOO_LONG = "Use 120 characters or fewer."
UNKNOWN_READING_MODEL = "Pick a reading model from the list."


class DomainNameTaken(ValueError):
    """The owner already has a domain with this name (case-insensitive) → API 409."""

    def __init__(self, name: str) -> None:
        super().__init__(f"You already have a domain named “{name}”.")
        self.name = name


def clean_domain_name(
    session, owner_id: uuid.UUID, name: str | None, *, exclude_id: uuid.UUID | None = None
) -> str:
    """The name rule (DM-14, DM-22): trimmed, 1–120 characters, unique per owner ignoring case.

    Raises ``ValueError`` (→ 422) for an empty or long name and ``DomainNameTaken`` (→ 409) for a
    clash. Only new names are checked, so domains that already share a name keep working.
    """
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError(NAME_REQUIRED)
    if len(cleaned) > MAX_DOMAIN_NAME:
        raise ValueError(NAME_TOO_LONG)
    q = select(Domain.id).where(
        Domain.owner_id == owner_id, func.lower(Domain.name) == cleaned.lower()
    )
    if exclude_id is not None:
        q = q.where(Domain.id != exclude_id)
    if session.execute(q.limit(1)).first() is not None:
        raise DomainNameTaken(cleaned)
    return cleaned


def create_domain(
    owner_id: uuid.UUID,
    name: str,
    template: str,
    *,
    embedding_model: str | None = None,
    name_rule: bool = False,
) -> dict:
    """A new, empty domain. ``embedding_model`` (optional) is the reading model picked in the New
    domain dialog; it must be one of the allowlisted slugs. ``name_rule`` applies the account's
    name rule (``clean_domain_name``) — the HTTP create sets it; internal callers keep the old
    trim-only behaviour."""
    if not (name or "").strip():
        raise ValueError(NAME_REQUIRED)
    if template not in DOMAIN_TEMPLATE_KEYS:
        raise KeyError(template)
    cfg = default_config_for_template(template)
    if embedding_model is not None and embedding_model.strip():
        slug = normalize_embedding_model(embedding_model.strip())
        if not is_allowed_embedding_model(slug):
            raise ValueError(UNKNOWN_READING_MODEL)
        cfg["embedding"] = {"model": slug}
    with session_scope() as session:
        cleaned = clean_domain_name(session, owner_id, name) if name_rule else name.strip()
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


def copy_name(session, owner_id: uuid.UUID, base: str) -> str:
    """The first free "<name> copy", "<name> copy 2", … under the name rule (DM-16); a long name
    is cut so the copy stays within 120 characters."""
    for n in range(1, 1000):
        suffix = " copy" if n == 1 else f" copy {n}"
        stem = base.strip()[: MAX_DOMAIN_NAME - len(suffix)].rstrip()
        try:
            return clean_domain_name(session, owner_id, f"{stem}{suffix}")
        except DomainNameTaken:
            continue
    raise DomainNameTaken(f"{base.strip()} copy")


def duplicate_domain(
    owner_id: uuid.UUID, domain_id: uuid.UUID, name: str | None = None
) -> dict | None:
    """Duplicate settings (DM-16): a new, empty domain with the same starting point and settings
    — no files. ``name`` follows the name rule; without one the copy is "<name> copy" (then
    "copy 2", …). ``None`` when the domain isn't the owner's."""
    with session_scope() as session:
        src = _owned_domain(session, owner_id, domain_id)
        if src is None:
            return None
        cleaned = (
            clean_domain_name(session, owner_id, name)
            if name is not None
            else copy_name(session, owner_id, src.name)
        )
        row = Domain(
            owner_id=owner_id,
            name=cleaned,
            template=src.template,
            config=deepcopy(src.config or {}),
            status="empty",
        )
        session.add(row)
        session.flush()
        return domain_to_dict(row, doc_count=0)


def get_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict | None:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        return None if row is None else domain_to_dict(row, doc_count=_doc_count(session, row.id))


# Why a waiting file waits, kept on the file while it waits and is read (a file's
# ``error_message`` only shows as a problem when reading fails). The model marks start with
# "embedding model"; the first is the pre-revamp wording, kept.
READ_DIM_CHANGED = "embedding model dimension changed — re-ingest required"
READ_MODEL_CHANGED = "embedding model changed — re-read required"
# A re-read asked to run the tests when it's done (DM-90): the workflow reading the file runs them.
READ_TESTS_AFTER = "re-read: run tests after"
# A file left "indexing" this long with no progress (a crashed process) may be claimed again.
READ_STALE_AFTER = timedelta(minutes=10)


def is_model_mark(message: str | None) -> bool:
    return (message or "").startswith("embedding model")


def keeps_mark(message: str | None) -> bool:
    """Whether a waiting file's message is a re-read mark to keep while the file is read."""
    return is_model_mark(message) or message == READ_TESTS_AFTER


def reread_version(session, domain_id: uuid.UUID) -> int:
    """The version a re-read gives its files. Every file of one re-read shares it, so the files
    at the domain's highest version are the latest re-read (``rereading`` in the detail). A re-read
    asked for while one is still running joins it."""
    rows = session.execute(
        select(DomainDocument.version, DomainDocument.ingest_status).where(
            DomainDocument.domain_id == domain_id
        )
    ).all()
    top = max((v for v, _ in rows), default=1)
    running = top > 1 and any(
        v == top and st in (INGEST_PENDING, INGEST_INDEXING) for v, st in rows
    )
    return top if running else top + 1


def model_rereading(domain_id: uuid.UUID) -> bool:
    """Whether the domain is re-reading every file for a new reading model — the old vectors are
    gone, so asking pauses until it's done (DM-88)."""
    with session_scope() as session:
        return (
            session.execute(
                select(DomainDocument.id)
                .where(
                    DomainDocument.domain_id == domain_id,
                    DomainDocument.ingest_status.in_((INGEST_PENDING, INGEST_INDEXING)),
                    DomainDocument.error_message.startswith("embedding model"),
                    # A pre-revamp mark on a file never read (version 1) is a first read.
                    DomainDocument.version > 1,
                )
                .limit(1)
            ).first()
            is not None
        )


def _reread_for_model_change(session, domain: Domain, message: str) -> None:
    """A new reading model's vectors can't be compared with the old ones: clear them and put
    every file back to waiting as one re-read (the caller starts reading)."""
    session.execute(
        update(DomainChunk).where(DomainChunk.domain_id == domain.id).values(embedding=None)
    )
    version = reread_version(session, domain.id)
    docs = (
        session.execute(select(DomainDocument).where(DomainDocument.domain_id == domain.id))
        .scalars()
        .all()
    )
    live = datetime.now(UTC) - READ_STALE_AFTER
    for doc in docs:
        # A file being read right now stays with its reader (a second reader would break
        # one-file-at-a-time, OQ-24): it is marked, and that read puts it back to waiting when it
        # finds its pieces lost their vectors (``domain_read.finish_document_step``).
        if not (doc.ingest_status == INGEST_INDEXING and doc.updated_at >= live):
            doc.ingest_status = INGEST_PENDING
        doc.version = version
        doc.error_message = message
    _apply_domain_aggregates(session, domain)


def _pieces_of(config: dict | None) -> tuple[object, object]:
    chunking = (config or {}).get("chunking") or {}
    return chunking.get("size"), chunking.get("overlap")


def update_domain(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    name: str | None = None,
    config: dict | None = None,
    name_rule: bool = False,
    template: str | None = None,
) -> dict | None:
    """Rename and/or replace the settings. ``name_rule`` applies the account's name rule to a new
    name (``clean_domain_name``, the domain itself excluded) — the HTTP PATCH sets it (DM-14).
    ``template`` is the Settings tab's starting point (DM-81); the route checks it's a known one.

    The answer adds ``reread``: ``required`` (reason ``reading_model``) when the new reading model
    has other weights — every file was put back to waiting and the caller starts reading (OQ-17);
    ``optional`` (reason ``pieces``) when the piece size or overlap changed — existing files keep
    their pieces until re-read (DM-90); else ``none``. A domain with no files needs none."""
    reread: dict = {"needed": "none", "reason": None}
    with session_scope() as session:
        if config is not None:
            # The reader's lock: a model change never interleaves with a batch being stored or a
            # file being finished (``domain_read``), so no file is left ready with stale vectors.
            from tvashtr.control_plane.domain_read import _lock

            _lock(session, domain_id)
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        if name is not None and name_rule:
            row.name = clean_domain_name(session, owner_id, name, exclude_id=row.id)
        elif name is not None:
            cleaned = name.strip()
            if not cleaned:
                raise ValueError("a domain name is required")
            row.name = cleaned
        if template is not None:
            row.template = template
        if config is not None:
            validate_domain_config(config)
            old_model = normalize_embedding_model(
                str(((row.config or {}).get("embedding") or {}).get("model") or "")
            )
            new_model = normalize_embedding_model(
                str((config.get("embedding") or {}).get("model") or "")
            )
            pieces_changed = _pieces_of(row.config) != _pieces_of(config)
            has_files = _doc_count(session, row.id) > 0
            # Fresh dict so JSONB dirty-tracking works (same pattern as gate config patches).
            row.config = dict(config)
            if not same_embedding_weights(old_model, new_model):
                try:
                    dim_changed = expected_dim(old_model) != expected_dim(new_model)
                except ValueError:
                    dim_changed = True  # an old model from before the catalogue
                _reread_for_model_change(
                    session, row, READ_DIM_CHANGED if dim_changed else READ_MODEL_CHANGED
                )
                if has_files:
                    reread = {"needed": "required", "reason": "reading_model"}
            elif pieces_changed and has_files:
                reread = {"needed": "optional", "reason": "pieces"}
        session.flush()
        return {**domain_to_dict(row, doc_count=_doc_count(session, row.id)), "reread": reread}


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


def create_document(owner_id: uuid.UUID, domain_id: uuid.UUID, filename: str, data: bytes) -> dict:
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
        rel = domain_files_cp.relative_storage_path(owner_id, domain.id, doc.id, doc.filename)
        domain_files_cp.save_bytes(rel, data)
        doc.storage_path = rel
        _apply_domain_aggregates(session, domain)
        session.flush()
        return document_to_dict(doc)


def delete_document(owner_id: uuid.UUID, domain_id: uuid.UUID, document_id: uuid.UUID) -> bool:
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

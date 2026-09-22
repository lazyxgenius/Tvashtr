"""PolyRAG Domains Phase 2 — DBOS ingest: extract → chunk → embed → pgvector."""

from __future__ import annotations

import uuid

from dbos import DBOS
from sqlalchemy import delete, select

from tvashtr.control_plane.credentials import NoCredentialError, resolve_owner_api_key
from tvashtr.control_plane.domain_chunking import chunk_text
from tvashtr.control_plane.domain_embedding import expected_dim, normalize_embedding_model
from tvashtr.control_plane.domain_files import absolute_path, extension_of, extract_text
from tvashtr.control_plane.domains import (
    INGEST_ERROR,
    INGEST_INDEXING,
    INGEST_PENDING,
    INGEST_READY,
    _apply_domain_aggregates,
    _owned_domain,
)
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingRequest, GatewayError, embed
from tvashtr.metering import record_embedding_cost
from tvashtr.models import DomainChunk, DomainDocument

# normalize_embedding_model re-exported for domain_ask / tests (canonical: domain_embedding).


@DBOS.step()
def mark_docs_indexing_step(owner_id: str, domain_id: str) -> list[str]:
    oid = uuid.UUID(owner_id)
    did = uuid.UUID(domain_id)
    with session_scope() as session:
        domain = _owned_domain(session, oid, did)
        if domain is None:
            return []
        rows = (
            session.execute(
                select(DomainDocument).where(
                    DomainDocument.domain_id == did,
                    DomainDocument.ingest_status.in_(
                        [INGEST_PENDING, INGEST_ERROR, INGEST_INDEXING]
                    ),
                )
            )
            .scalars()
            .all()
        )
        ids: list[str] = []
        for doc in rows:
            doc.ingest_status = INGEST_INDEXING
            doc.error_message = None
            ids.append(str(doc.id))
        _apply_domain_aggregates(session, domain)
        session.flush()
        return ids


@DBOS.step()
def ingest_one_document_step(owner_id: str, domain_id: str, document_id: str) -> dict:
    oid = uuid.UUID(owner_id)
    did = uuid.UUID(domain_id)
    doc_id = uuid.UUID(document_id)
    try:
        with session_scope() as session:
            domain = _owned_domain(session, oid, did)
            if domain is None:
                return {"document_id": document_id, "ok": False, "error": "domain not found"}
            doc = session.execute(
                select(DomainDocument).where(
                    DomainDocument.id == doc_id, DomainDocument.domain_id == did
                )
            ).scalar_one_or_none()
            if doc is None:
                return {"document_id": document_id, "ok": False, "error": "document not found"}
            cfg = domain.config or {}
            chunking = cfg.get("chunking") or {}
            size = int(chunking.get("size") or 800)
            overlap = int(chunking.get("overlap") or 100)
            emb_model = normalize_embedding_model(
                str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
            )
            rel = doc.storage_path
            filename = doc.filename

        ext = extension_of(filename)
        text = extract_text(absolute_path(rel), ext)
        pieces = chunk_text(text, size=size, overlap=overlap)
        api_key = resolve_owner_api_key(oid, emb_model)

        vectors: list[list[float]] = []
        wf = getattr(DBOS, "workflow_id", None) or "no-wf"
        if pieces:
            batch = 16
            for i in range(0, len(pieces), batch):
                sub = pieces[i : i + batch]
                result = embed(
                    EmbeddingRequest(model=emb_model, input=sub, api_key=api_key)
                )
                record_embedding_cost(
                    workflow_id=None,
                    idempotency_key=f"domain-ingest:{document_id}:{i}:{wf}",
                    model=result.model,
                    prompt_tokens=result.prompt_tokens,
                    total_tokens=result.total_tokens,
                    cost_usd=result.cost_usd,
                )
                vectors.extend(result.vectors)

        with session_scope() as session:
            domain = _owned_domain(session, oid, did)
            doc = session.execute(
                select(DomainDocument).where(DomainDocument.id == doc_id)
            ).scalar_one()
            session.execute(delete(DomainChunk).where(DomainChunk.document_id == doc_id))
            if not pieces:
                doc.ingest_status = INGEST_ERROR
                doc.error_message = "no extractable text"
            elif len(vectors) != len(pieces):
                doc.ingest_status = INGEST_ERROR
                doc.error_message = "embedding provider returned unexpected vector count"
            else:
                for ordinal, piece in enumerate(pieces):
                    vec = vectors[ordinal]
                    want = expected_dim(emb_model)
                    if len(vec) != want:
                        doc.ingest_status = INGEST_ERROR
                        doc.error_message = f"embedding dim {len(vec)} != {want}"
                        break
                    session.add(
                        DomainChunk(
                            domain_id=did,
                            document_id=doc_id,
                            ordinal=ordinal,
                            text=piece,
                            embedding=vec,
                            meta={"filename": filename},
                        )
                    )
                else:
                    doc.ingest_status = INGEST_READY
                    doc.error_message = None
            if domain is not None:
                _apply_domain_aggregates(session, domain)
            session.flush()
        with session_scope() as session:
            doc2 = session.execute(
                select(DomainDocument).where(DomainDocument.id == doc_id)
            ).scalar_one()
            return {
                "document_id": document_id,
                "ok": doc2.ingest_status == INGEST_READY,
                "chunks": len(pieces),
                "status": doc2.ingest_status,
            }
    except (NoCredentialError, GatewayError, ValueError, OSError) as exc:
        with session_scope() as session:
            doc = session.execute(
                select(DomainDocument).where(DomainDocument.id == doc_id)
            ).scalar_one_or_none()
            if doc is not None:
                doc.ingest_status = INGEST_ERROR
                doc.error_message = str(exc)[:2000]
            domain = _owned_domain(session, oid, did)
            if domain is not None:
                _apply_domain_aggregates(session, domain)
            session.flush()
        return {"document_id": document_id, "ok": False, "error": str(exc)}


@DBOS.step()
def refresh_domain_status_step(owner_id: str, domain_id: str) -> str:
    oid = uuid.UUID(owner_id)
    did = uuid.UUID(domain_id)
    with session_scope() as session:
        domain = _owned_domain(session, oid, did)
        if domain is None:
            return "missing"
        _apply_domain_aggregates(session, domain)
        session.flush()
        return domain.status


@DBOS.workflow()
def ingest_domain(owner_id: str, domain_id: str) -> dict:
    """Durable ingest for pending/error/indexing documents on a domain."""
    wf = DBOS.workflow_id
    DBOS.logger.info(f"ingest_domain start wf={wf} domain={domain_id}")
    doc_ids = mark_docs_indexing_step(owner_id, domain_id)
    results = [ingest_one_document_step(owner_id, domain_id, doc_id) for doc_id in doc_ids]
    status = refresh_domain_status_step(owner_id, domain_id)
    DBOS.logger.info(f"ingest_domain done wf={wf} status={status}")
    return {"domain_id": domain_id, "status": status, "documents": results}

"""Domains (revamp round 2): the endpoints the redesigned Domains screens add.

The original ``/api/domains*`` endpoints stay in ``routers.py`` and change there in place,
additively; every NEW Domains endpoint goes here (the contract is
``docs/superpowers/plans/api/domains.md``). Logic lives in ``control_plane/domain_*`` modules.
Every route is owner-scoped: another account's domain answers 404 ``"domain not found"``.
"""

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import domain_read, domain_views
from tvashtr.control_plane.domain_files import absolute_path
from tvashtr.control_plane.domains import DomainNameTaken, _owned_domain, duplicate_domain
from tvashtr.db import session_scope
from tvashtr.models import DomainDocument

router = APIRouter()

FILE_GONE = "The original file isn’t available any more."


def _uuid(raw: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid {what} id") from exc


class RereadBody(BaseModel):
    """``POST …/reread``: the files to read again (all of them when omitted)."""

    document_ids: list[str] | None = None
    run_tests_after: bool = False


@router.post("/api/domains/{domain_id}/reread", status_code=202)
def post_domain_reread(
    domain_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    body: RereadBody | None = None,
) -> dict:
    """Read some files — or all of them — again (DM-50, DM-89): each goes back to waiting with its
    version bumped, then reading starts (one file at a time)."""
    did = _uuid(domain_id, "domain")
    body = body or RereadBody()
    ids = None
    if body.document_ids is not None:
        ids = [_uuid(d, "document") for d in body.document_ids]
    try:
        out = domain_read.start_reread(
            uuid.UUID(current_user.id), did, ids, run_tests_after=body.run_tests_after
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    except domain_read.RereadConflict as exc:
        raise HTTPException(status_code=409, detail="This domain is already re-reading.") from exc
    if out is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return out


@router.get("/api/domains/{domain_id}/documents/{document_id}/pieces")
def get_document_pieces(
    domain_id: str,
    document_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    """One file's pieces, in order, and how often recent answers cited it (DM-51)."""
    owner = uuid.UUID(current_user.id)
    did = _uuid(domain_id, "domain")
    doc_id = _uuid(document_id, "document")
    out = domain_views.document_pieces(owner, did, doc_id, q=q, offset=offset, limit=limit)
    if out is None:
        with session_scope() as session:
            owned = _owned_domain(session, owner, did) is not None
        raise HTTPException(
            status_code=404, detail="document not found" if owned else "domain not found"
        )
    return out


@router.get("/api/domains/{domain_id}/documents/{document_id}/file")
def get_document_file(
    domain_id: str,
    document_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> FileResponse:
    """The uploaded bytes as an attachment under the stored name (DM-52). The page links to this
    in the same window, so Desktop's proxy carries the session (D2)."""
    owner = uuid.UUID(current_user.id)
    did = _uuid(domain_id, "domain")
    doc_id = _uuid(document_id, "document")
    with session_scope() as session:
        if _owned_domain(session, owner, did) is None:
            raise HTTPException(status_code=404, detail="domain not found")
        doc = session.execute(
            select(DomainDocument).where(
                DomainDocument.id == doc_id, DomainDocument.domain_id == did
            )
        ).scalar_one_or_none()
        if doc is None:
            raise HTTPException(status_code=404, detail="document not found")
        rel, filename, content_type = doc.storage_path, doc.filename, doc.content_type
    try:
        path = absolute_path(rel)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=FILE_GONE) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail=FILE_GONE)
    return FileResponse(
        path,
        media_type=content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


class DuplicateBody(BaseModel):
    """``POST …/duplicate``: the copy's name (default "<name> copy", then "copy 2", …)."""

    name: str | None = None


@router.post("/api/domains/{domain_id}/duplicate", status_code=201)
def post_domain_duplicate(
    domain_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    body: DuplicateBody | None = None,
) -> dict:
    """Duplicate settings (DM-16): a new, empty domain with the same starting point and settings
    and no files, answered with its full summary."""
    owner = uuid.UUID(current_user.id)
    did = _uuid(domain_id, "domain")
    try:
        row = duplicate_domain(owner, did, (body or DuplicateBody()).name)
    except DomainNameTaken as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return domain_views.detail_summary(owner, uuid.UUID(row["domain_id"])) or row

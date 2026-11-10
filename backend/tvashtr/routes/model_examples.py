"""M2: a model's training examples, its drafts and Draft with a team. Logic lives in
``control_plane/model_examples*``. Every route is owner-scoped like Models 1's (another account's
model answers 404 ``"model not found"``); validation errors are 422 with the product's words."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from tvashtr.control_plane import model_examples, model_examples_launch, model_tests_run
from tvashtr.routes.models import _MAX_CSV_CHARS, CurrentUser, ImportBody, _answer, _owner, _uuid

router = APIRouter()


class ExampleBody(BaseModel):
    input: str | None = None
    answer: str | None = None


class DraftBody(BaseModel):
    input: str | None = None
    answer: str | None = None
    must_contain: list[str] | None = None


class KindBody(BaseModel):
    kind: str


class DraftIds(BaseModel):
    draft_ids: list[str] = []


class DraftingBody(BaseModel):
    domain_id: str | None = None
    team_id: str | None = None
    tests: int = 10
    training: int = 20


# ---- Training examples ----


@router.get("/api/models/{model_id}/training")
def get_training(
    model_id: str,
    current_user: CurrentUser,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples.list_training(_owner(current_user), mid, version))


@router.post("/api/models/{model_id}/training", status_code=201)
def post_example(model_id: str, body: ExampleBody, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples.add_example(_owner(current_user), mid, body.model_dump()))


@router.post("/api/models/{model_id}/training/import")
def post_training_import(model_id: str, body: ImportBody, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    if len(body.csv) > _MAX_CSV_CHARS:
        raise HTTPException(status_code=422, detail="That file is too big to import.")
    return _answer(
        lambda: model_examples.import_training(
            _owner(current_user), mid, filename=body.filename, text=body.csv, dry_run=body.dry_run
        )
    )


@router.get("/api/models/{model_id}/training/versions")
def get_training_versions(model_id: str, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples.list_training_versions(_owner(current_user), mid))


@router.post("/api/models/{model_id}/training/versions/{version}/restore")
def post_training_restore(model_id: str, version: int, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(
        lambda: model_examples.restore_training_version(_owner(current_user), mid, version)
    )


@router.get("/api/models/{model_id}/training/download")
def get_training_download(
    model_id: str, current_user: CurrentUser, format: str = "jsonl"
) -> Response:
    """The current training set as JSONL (chat messages) or CSV — never a test."""
    mid = _uuid(model_id, "model")
    name, content_type, body = _answer(
        lambda: model_examples.download(_owner(current_user), mid, format)
    )
    return Response(
        content=body,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.put("/api/models/{model_id}/training/{example_key}")
def put_example(
    model_id: str, example_key: str, body: ExampleBody, current_user: CurrentUser
) -> dict:
    mid, key = _uuid(model_id, "model"), _uuid(example_key, "example")
    return _answer(
        lambda: model_examples.edit_example(_owner(current_user), mid, key, body.model_dump())
    )


@router.delete("/api/models/{model_id}/training/{example_key}")
def delete_example(model_id: str, example_key: str, current_user: CurrentUser) -> dict:
    mid, key = _uuid(model_id, "model"), _uuid(example_key, "example")
    return _answer(lambda: model_examples.delete_example(_owner(current_user), mid, key))


# ---- Drafts ----


@router.get("/api/models/{model_id}/drafts")
def get_drafts(model_id: str, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples.list_drafts(_owner(current_user), mid))


@router.post("/api/models/{model_id}/drafts/accept")
def post_drafts_accept(model_id: str, body: DraftIds, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples.accept_drafts(_owner(current_user), mid, body.draft_ids))


@router.post("/api/models/{model_id}/drafts/reject")
def post_drafts_reject(model_id: str, body: DraftIds, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples.reject_drafts(_owner(current_user), mid, body.draft_ids))


@router.put("/api/models/{model_id}/drafts/{draft_id}")
def put_draft(model_id: str, draft_id: str, body: DraftBody, current_user: CurrentUser) -> dict:
    mid, did = _uuid(model_id, "model"), _uuid(draft_id, "draft")
    fields = body.model_dump(exclude_unset=True)
    return _answer(lambda: model_examples.edit_draft(_owner(current_user), mid, did, fields))


@router.post("/api/models/{model_id}/drafts/{draft_id}/kind")
def post_draft_kind(
    model_id: str, draft_id: str, body: KindBody, current_user: CurrentUser
) -> dict:
    mid, did = _uuid(model_id, "model"), _uuid(draft_id, "draft")
    return _answer(lambda: model_examples.set_draft_kind(_owner(current_user), mid, did, body.kind))


# ---- Draft with a team ----


@router.get("/api/models/{model_id}/drafting")
def get_drafting(model_id: str, current_user: CurrentUser) -> dict:
    """The dialog's Domains and teams (the Example builder is made the first time)."""
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_examples_launch.options(_owner(current_user), mid))


@router.post("/api/models/{model_id}/drafting/estimate")
def post_drafting_estimate(model_id: str, body: DraftingBody, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(
        lambda: model_examples_launch.estimate(_owner(current_user), mid, body.model_dump())
    )


@router.post("/api/models/{model_id}/drafting", status_code=202)
def post_drafting(model_id: str, body: DraftingBody, current_user: CurrentUser) -> dict:
    """Start drafting: an ordinary team run bound to this model and Domain."""
    mid = _uuid(model_id, "model")
    try:
        return _answer(
            lambda: model_examples_launch.start(_owner(current_user), mid, body.model_dump())
        )
    except model_tests_run.MissingProviders as exc:
        raise HTTPException(
            status_code=422,
            detail={"missing_providers": exc.providers, "message": str(exc)},
        ) from exc

"""Models 1: the Models area's endpoints. Logic lives in ``control_plane/model_tests*``. Every route
is owner-scoped: another account's model answers 404 ``"model not found"``. Validation errors are
422 with the product's words.
"""

import uuid
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import model_tests, model_tests_run

router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
# Room for 500 tests of ordinary length; a bigger upload is refused before it is parsed.
_MAX_CSV_CHARS = 20_000_000


def _uuid(raw: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid {what} id") from exc


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


def _answer(call: Callable[[], Any]) -> Any:
    """Run a control-plane call: not found is a 404, the product's words a 422."""
    try:
        return call()
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc.args[0])) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class NewModelBody(BaseModel):
    name: str | None = None
    job: str | None = None
    answer_kind: str | None = None
    choices: list[str] | None = None


class ModelPatch(BaseModel):
    """Only the fields sent change."""

    name: str | None = None
    job: str | None = None
    choices: list[str] | None = None


class CaseBody(BaseModel):
    input: str | None = None
    expected: str | None = None
    scoring: str | None = None
    must_contain: list[str] | None = None
    rubric: str | None = None
    judge_model: str | None = None


class ImportBody(BaseModel):
    filename: str = ""
    csv: str
    dry_run: bool = False


class ModelsBody(BaseModel):
    models: list[str] = []


@router.get("/api/models")
def get_models(current_user: CurrentUser) -> dict:
    """The caller's models, as the list's cards."""
    return {"models": model_tests.list_models(_owner(current_user))}


@router.post("/api/models", status_code=201)
def post_model(body: NewModelBody, current_user: CurrentUser) -> dict:
    return _answer(lambda: model_tests.create_model(_owner(current_user), **body.model_dump()))


@router.get("/api/models/{model_id}")
def get_model(model_id: str, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests.get_model(_owner(current_user), mid))


@router.patch("/api/models/{model_id}")
def patch_model(model_id: str, body: ModelPatch, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(
        lambda: model_tests.update_model(
            _owner(current_user), mid, **body.model_dump(exclude_unset=True)
        )
    )


@router.delete("/api/models/{model_id}", status_code=204)
def delete_model(model_id: str, current_user: CurrentUser) -> Response:
    mid = _uuid(model_id, "model")
    _answer(lambda: model_tests.delete_model(_owner(current_user), mid))
    return Response(status_code=204)


@router.get("/api/models/{model_id}/tests")
def get_tests(
    model_id: str,
    current_user: CurrentUser,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> dict:
    """A version's tests (the current one by default) and the Last run columns."""
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests.list_tests(_owner(current_user), mid, version))


@router.post("/api/models/{model_id}/tests", status_code=201)
def post_test(model_id: str, body: CaseBody, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests.add_test(_owner(current_user), mid, body.model_dump()))


@router.post("/api/models/{model_id}/tests/import")
def post_tests_import(model_id: str, body: ImportBody, current_user: CurrentUser) -> dict:
    """All or nothing. ``dry_run`` answers the preview; ``errors`` lists every bad row by line."""
    mid = _uuid(model_id, "model")
    if len(body.csv) > _MAX_CSV_CHARS:
        raise HTTPException(status_code=422, detail="That file is too big to import.")
    return _answer(
        lambda: model_tests.import_tests(
            _owner(current_user),
            mid,
            filename=body.filename,
            text=body.csv,
            dry_run=body.dry_run,
        )
    )


@router.put("/api/models/{model_id}/tests/{case_key}")
def put_test(model_id: str, case_key: str, body: CaseBody, current_user: CurrentUser) -> dict:
    mid, key = _uuid(model_id, "model"), _uuid(case_key, "test")
    return _answer(lambda: model_tests.edit_test(_owner(current_user), mid, key, body.model_dump()))


@router.delete("/api/models/{model_id}/tests/{case_key}")
def delete_test(model_id: str, case_key: str, current_user: CurrentUser) -> dict:
    mid, key = _uuid(model_id, "model"), _uuid(case_key, "test")
    return _answer(lambda: model_tests.delete_test(_owner(current_user), mid, key))


@router.get("/api/models/{model_id}/tests/{case_key}/results")
def get_test_results(model_id: str, case_key: str, current_user: CurrentUser) -> dict:
    """The drawer's Last run box."""
    mid, key = _uuid(model_id, "model"), _uuid(case_key, "test")
    return _answer(lambda: model_tests.case_results(_owner(current_user), mid, key))


@router.get("/api/models/{model_id}/versions")
def get_versions(model_id: str, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests.list_versions(_owner(current_user), mid))


@router.post("/api/models/{model_id}/versions/{version}/restore")
def post_version_restore(model_id: str, version: int, current_user: CurrentUser) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests.restore_version(_owner(current_user), mid, version))


@router.post("/api/models/{model_id}/estimate")
def post_estimate(model_id: str, body: ModelsBody, current_user: CurrentUser) -> dict:
    """What the current tests should cost on each model, before anything runs."""
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests_run.estimate(_owner(current_user), mid, body.models))


@router.post("/api/models/{model_id}/runs", status_code=202)
def post_runs(model_id: str, body: ModelsBody, current_user: CurrentUser) -> dict:
    """One run per model: answers at once with the running runs."""
    mid = _uuid(model_id, "model")
    try:
        runs = _answer(lambda: model_tests_run.start_runs(_owner(current_user), mid, body.models))
    except model_tests_run.MissingProviders as exc:
        raise HTTPException(
            status_code=422,
            detail={"missing_providers": exc.providers, "message": str(exc)},
        ) from exc
    return {"runs": runs}


@router.get("/api/models/{model_id}/runs")
def get_runs(
    model_id: str,
    current_user: CurrentUser,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> dict:
    mid = _uuid(model_id, "model")
    return _answer(lambda: model_tests_run.list_runs(_owner(current_user), mid, version))


@router.get("/api/models/{model_id}/runs/{run_id}")
def get_run(model_id: str, run_id: str, current_user: CurrentUser) -> dict:
    mid, rid = _uuid(model_id, "model"), _uuid(run_id, "run")
    return _answer(lambda: model_tests_run.get_run(_owner(current_user), mid, rid))


@router.post("/api/models/{model_id}/runs/{run_id}/stop")
def post_run_stop(model_id: str, run_id: str, current_user: CurrentUser) -> dict:
    mid, rid = _uuid(model_id, "model"), _uuid(run_id, "run")
    return _answer(lambda: model_tests_run.stop_run(_owner(current_user), mid, rid))


@router.get("/api/models/{model_id}/compare")
def get_compare(model_id: str, a: str, b: str, current_user: CurrentUser) -> dict:
    mid, run_a, run_b = _uuid(model_id, "model"), _uuid(a, "run"), _uuid(b, "run")
    return _answer(lambda: model_tests_run.compare(_owner(current_user), mid, run_a, run_b))

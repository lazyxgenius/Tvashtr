"""M-subs-desktop — the Tvashtr Desktop runner's endpoints.

Secret-free, session-authenticated (the same ``tv_session`` cookie the Desktop UI uses — a Tvashtr
session, never a vendor credential) and OWNER-SCOPED: a runner only ever claims, reads, feeds or
finishes its own owner's jobs; a foreign job id is a 404. Every body is closed (unknown fields are
refused) and any token/cookie/api-key-like key anywhere in it is a 422 — the same guard as the
subscription status mirror, widened for these richer bodies.

* ``POST /api/desktop-runner/claim``            — heartbeat + the owner's next job (or ``null``)
* ``GET  /api/desktop-runner/jobs/{id}/snapshot`` — the job's workspace as a gzipped tarball
* ``POST /api/desktop-runner/jobs/{id}/events``   — the CLI's output → the node's run log
* ``POST /api/desktop-runner/jobs/{id}/result``   — final text + outcome + a ``git diff --binary``
"""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import desktop_jobs

router = APIRouter()

_MAX_TEXT = 200_000
_MAX_PAYLOAD_VALUE = 20_000
_MAX_PATCH = 50 * 1024 * 1024


class _SecretFree(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def _reject_secret_keys(cls, data: Any) -> Any:
        bad = desktop_jobs.find_secret_keys(data)
        if bad:
            raise ValueError(f"runner bodies must not include secrets: {bad}")
        return data


class ClaimRequest(_SecretFree):
    providers: list[str] = Field(default_factory=list, max_length=8)


class RunnerEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seq: int = Field(ge=0, le=1_000_000)
    kind: Literal["action", "observation", "message", "error"]
    payload: dict[str, str | int | float | bool | None]

    @field_validator("payload")
    @classmethod
    def _cap_values(cls, v: dict) -> dict:
        return {
            str(k)[:64]: (val[:_MAX_PAYLOAD_VALUE] if isinstance(val, str) else val)
            for k, val in list(v.items())[:16]
        }


class EventsRequest(_SecretFree):
    events: list[RunnerEvent] = Field(default_factory=list, max_length=500)


class RunnerUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class ResultRequest(_SecretFree):
    status: Literal["completed", "failed"]
    final_text: str = Field(default="", max_length=_MAX_TEXT)
    patch: str = Field(default="", max_length=_MAX_PATCH)
    error: str | None = Field(default=None, max_length=4000)
    usage: RunnerUsage | None = None


CurrentUser = Annotated[UserOut, Depends(get_current_user)]


@router.post("/api/desktop-runner/claim")
def runner_claim(body: ClaimRequest, current_user: CurrentUser) -> dict:
    """Every poll is the runner heartbeat (A3 freshness); it also claims the owner's oldest queued
    job for a provider the runner offered and is not already running (one per provider)."""
    owner_id = uuid.UUID(current_user.id)
    desktop_jobs.heartbeat(owner_id, body.providers)
    return {"job": desktop_jobs.claim_next(owner_id, body.providers)}


@router.get("/api/desktop-runner/jobs/{job_id}/snapshot")
def runner_snapshot(job_id: str, current_user: CurrentUser) -> Response:
    try:
        data = desktop_jobs.build_snapshot(uuid.UUID(current_user.id), job_id)
    except desktop_jobs.JobNotFound as exc:
        raise HTTPException(status_code=404, detail="unknown job") from exc
    except desktop_jobs.JobConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except desktop_jobs.SnapshotTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return Response(content=data, media_type="application/gzip")


@router.post("/api/desktop-runner/jobs/{job_id}/events")
def runner_events(job_id: str, body: EventsRequest, current_user: CurrentUser) -> dict:
    try:
        return desktop_jobs.record_events(
            uuid.UUID(current_user.id), job_id, [e.model_dump() for e in body.events]
        )
    except desktop_jobs.JobNotFound as exc:
        raise HTTPException(status_code=404, detail="unknown job") from exc


@router.post("/api/desktop-runner/jobs/{job_id}/result")
def runner_result(job_id: str, body: ResultRequest, current_user: CurrentUser) -> dict:
    try:
        desktop_jobs.submit_result(
            uuid.UUID(current_user.id),
            job_id,
            status=body.status,
            final_text=body.final_text,
            patch=body.patch,
            error=body.error,
            usage=body.usage.model_dump() if body.usage is not None else None,
        )
    except desktop_jobs.JobNotFound as exc:
        raise HTTPException(status_code=404, detail="unknown job") from exc
    except desktop_jobs.JobConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}

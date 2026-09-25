"""Desktop local-folder runs — repo snapshot upload and the result bundle (revamp P10).

* ``POST /api/desktop/repo-snapshots`` — multipart ``bundle`` (a ``git bundle`` of the base branch),
  ``base_ref``, ``label`` → ``{snapshot_id, size_bytes, …}``. ``POST /api/runs`` then takes
  ``local_repo: {snapshot_id, label, base_ref, subpath}`` (with ``desktop_target: true``).
* ``GET /api/runs/{run_id}/ship-bundle`` — the finished run's ``tvashtr/<run_id>`` branch as a
  ``git bundle`` for Desktop to ``git fetch`` into the user's folder.

The logic is in :mod:`tvashtr.control_plane.local_repo`; errors carry ``detail = {code, message}``.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from starlette.datastructures import UploadFile

from tvashtr.auth import UserOut, get_current_user
from tvashtr.config import get_settings
from tvashtr.control_plane import local_repo
from tvashtr.control_plane.local_repo import LocalRepoError

router = APIRouter()

CurrentUser = Annotated[UserOut, Depends(get_current_user)]

# Room for the multipart envelope and the two text fields on top of the bundle itself.
_MULTIPART_SLACK = 64 * 1024
_CHUNK = 1024 * 1024


def _too_large(max_bytes: int) -> LocalRepoError:
    return LocalRepoError(
        413,
        "bundle_too_large",
        f"This folder's history is too big to send (over {max_bytes // (1024 * 1024)} MB).",
        max_bytes=max_bytes,
    )


async def _read_capped(upload: UploadFile, max_bytes: int) -> bytes:
    buf = bytearray()
    while chunk := await upload.read(_CHUNK):
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise _too_large(max_bytes)
    return bytes(buf)


def _text_field(form, name: str) -> str | None:
    value = form.get(name)
    return value if isinstance(value, str) else None


@router.post("/api/desktop/repo-snapshots", status_code=201)
async def upload_repo_snapshot(request: Request, current_user: CurrentUser) -> dict:
    """Store a ``git bundle`` of the user's base branch for a folder run.

    Parsed by hand (not ``File(...)`` parameters) so an oversized upload is refused from its
    ``Content-Length`` before the body is read at all; a body without one is capped while read."""
    max_bytes = get_settings().local_repo_bundle_max_bytes
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > max_bytes + _MULTIPART_SLACK:
        raise _too_large(max_bytes)
    try:
        form = await request.form(max_files=1, max_fields=8)
    except Exception as exc:  # noqa: BLE001 — a malformed multipart body is the caller's error
        raise LocalRepoError(
            422, "bundle_missing", "Send the folder's git bundle as multipart field bundle."
        ) from exc
    try:
        upload = form.get("bundle")
        if not isinstance(upload, UploadFile):
            raise LocalRepoError(
                422, "bundle_missing", "Send the folder's git bundle as multipart field bundle."
            )
        data = await _read_capped(upload, max_bytes)
        return local_repo.create_source_snapshot(
            uuid.UUID(current_user.id),
            data,
            label=_text_field(form, "label"),
            base_ref=_text_field(form, "base_ref"),
        )
    finally:
        await form.close()


@router.get("/api/runs/{run_id}/ship-bundle")
def get_ship_bundle(run_id: str, current_user: CurrentUser) -> Response:
    """The run's result bundle (only the owner's, only once Ship stored it). ``X-Tvashtr-Branch``
    names the branch inside it: ``git fetch <file> tvashtr/<id>:tvashtr/<id>``."""
    data, branch = local_repo.result_bundle(uuid.UUID(current_user.id), run_id)
    return Response(
        content=data,
        media_type=local_repo.BUNDLE_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="tvashtr-{run_id}.bundle"',
            "X-Tvashtr-Branch": branch,
        },
    )

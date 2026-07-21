"""Durable readback of a greenfield run's shipped result — the live gates' post-terminal source
of truth (Tvashtr-80).

WHY THIS EXISTS. Every live gate used to assert a run's ship by shelling out to
``git -C backend/.tvashtr_workspaces/<run_id> …`` once the run was over. Since M-wsgc S1
(persist-then-reap) that directory is not there any more. ``ship_step`` snapshots a greenfield
run's whole ``compute_run_diff`` result into ``run_artifacts`` while the workspace still exists,
and ``_run_end_teardown`` then calls ``workspace_reaper.delete_run_workspace``. That teardown rides
``run_team``'s ``finally``, which puts the reap strictly BEFORE the workflow reports SUCCESS::

    ship_step()          -> commit + tag in the workspace, and PERSIST the run_artifacts row
    finalize_run_step()  -> runs.status = 'completed'
    distill + ingest     -> (slow)
    run_team returns     -> `finally` -> delete_run_workspace()     <-- THE REAP
    workflow_status      -> SUCCESS                                  <-- only now

So a gate that waits for the DBOS workflow reads a deleted directory, and a gate that breaks its
poll on ``runs.status`` merely RACES the reap on the distill+ingest margin. Reading the workspace
after a run is over is simply not sound any more; these helpers read what survives instead.

WHAT SURVIVES, and what each old assertion becomes:

* ``runs.ship_tag`` / ``runs.ship_commit_sha`` — plain columns.
  ``git tag --list ship-<run_id>`` ("shipped once")  ->  :func:`shipped_once`.
* ``run_artifacts.files`` — the whole stored ``compute_run_diff`` dict
  ``{run_id, base_ref, ship_branch, files:[{path, status, additions, deletions, patch}], total}``.
  Greenfield-only, ONE row per run (``run_id`` is UNIQUE).
  ``git show <tag>:<file>`` ("the committed content")  ->  :func:`shipped_diff` + :func:`added_file`
* The count of ``run_artifacts`` rows  ->  :func:`artifact_row_count`, the durable stand-in for the
  crash checkers' ``git log --all --grep "Ship: <run_id>"`` count. That empirical count CANNOT
  survive the reap — the greenfield workspace was the only repo that ever held the commit and there
  is no remote — but the single-ship GUARANTEE it confirmed is ``idempotent_ship``'s
  ``ship-{run_id}`` tag-dedup, which is untouched. The unique row (an UPSERT on re-ship) witnesses
  the same fact durably.

Read straight off the ``RunArtifact`` row via ``session_scope()`` rather than through
``GET /api/runs/{id}/diff``: that endpoint is owner-scoped (404 for anyone else) and
``check_loop_crash.py`` / ``check_skeleton_crash.py`` talk to the backend over raw ``urllib`` with
no session cookie, so a direct database read is the ONE path that works uniformly for all five
gates.

Every function here is total — an unknown run, a non-UUID id, a run that never shipped, or a
malformed row all yield the empty-but-well-formed answer, so a gate fails its OWN assertion with a
readable message instead of exploding inside this helper.
"""

import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.models import RunArtifact


def _empty(run_id: str) -> dict:
    """The shape ``compute_run_diff`` returns for a run with nothing to diff."""
    return {"run_id": run_id, "base_ref": None, "ship_branch": None, "files": [], "total": 0}


def shipped_diff(run_id: str) -> dict:
    """The run's DURABLE shipped diff — the ``compute_run_diff`` dict ``ship_step`` persisted.

    Returns the empty shape (never raises) when the run has no ``run_artifacts`` row: it never
    shipped, it is brownfield/hosted (whose deliverable is the branch in the user's real repo, so
    it deliberately has no row), or its snapshot could not be written."""
    try:
        key = uuid.UUID(str(run_id))
    except (ValueError, AttributeError, TypeError):
        return _empty(run_id)
    with session_scope() as session:
        files = session.execute(
            select(RunArtifact.files).where(RunArtifact.run_id == key)
        ).scalar_one_or_none()
    if not isinstance(files, Mapping):
        return _empty(run_id)
    return dict(files)


def added_file(diff: Mapping[str, Any], path: str) -> str | None:
    """The content of an ADDED file, reconstructed from its stored patch — the durable equivalent
    of ``git show <ship_tag>:<path>``.

    ``None`` when the path is absent from the diff or its entry is not ``added``, so a gate can
    still FAIL on absence rather than silently comparing against an empty string. For a greenfield
    run every shipped file is ``added`` and its whole content is the patch's ``+`` hunk lines, so
    the reconstruction is exact — byte-exact assertions keep their teeth.

    ``+++ b/<path>`` is a HEADER line, not content, and is excluded; so is ``\\ No newline at end of
    file``, which git emits after the last hunk line."""
    for entry in diff.get("files") or []:
        if not isinstance(entry, Mapping) or entry.get("path") != path:
            continue
        if entry.get("status") != "added":
            return None
        body = [
            line[1:]
            for line in (entry.get("patch") or "").splitlines()
            if line.startswith("+") and not line.startswith("+++")
        ]
        return "\n".join(body)
    return None


def shipped_once(run: Mapping[str, Any], run_id: str) -> bool:
    """Did THIS run ship, exactly once? The durable form of ``git tag --list ship-<run_id>``.

    ``run`` is the ``run`` object out of ``GET /api/runs/{id}`` (or any mapping carrying the two
    columns). Both witnesses are required, and the tag must be THIS run's — a tag belonging to
    some other run must never read as a ship, which is the property the ``== [tag]`` list
    comparison used to carry. The single-ship guarantee itself is ``idempotent_ship``'s tag-dedup;
    these columns are written from its result."""
    return run.get("ship_tag") == f"ship-{run_id}" and bool(run.get("ship_commit_sha"))


def artifact_row_count(run_id: str) -> int:
    """How many ``run_artifacts`` rows this run has — the durable single-ship witness.

    Structurally 0 or 1 (``run_id`` is UNIQUE and ``ship_step`` UPSERTs, so a crash-resume re-ship
    cannot duplicate). Asserting ``== 1`` is what replaces the crash checkers' "exactly one
    ``Ship: <run_id>`` commit" git-log count, which the reap makes unanswerable."""
    try:
        key = uuid.UUID(str(run_id))
    except (ValueError, AttributeError, TypeError):
        return 0
    with session_scope() as session:
        return session.execute(
            select(func.count()).select_from(RunArtifact).where(RunArtifact.run_id == key)
        ).scalar_one()

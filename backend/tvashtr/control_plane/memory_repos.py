"""Memory read models for the Toolkit › Memory screens — the repo picker and the tab counts.

* :func:`list_memory_repos` backs ``GET /api/memory/repos``: every repo the owner's memories can be
  scoped to (the repo filter on Active, the "One repo" select in Add memory), keyed exactly as the
  memory writers key them (:func:`memory.repo_key_for_run` — GitHub ``owner/name`` for hosted runs).
* :func:`memory_counts` backs ``GET /api/memories/counts``: Inbox / Active / Archive counts for the
  tabs and the nav badge, without loading the lists.

Owner-scoped throughout; openhands-free.
"""

import logging
import uuid
from datetime import datetime

from sqlalchemy import func, select

from tvashtr.control_plane import github_app
from tvashtr.control_plane.memory import repo_label
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation, NodeMemory, Run

logger = logging.getLogger(__name__)

_CLONES_MARKER = "/.tvashtr_clones/"


def memory_counts(owner_id: uuid.UUID) -> dict:
    """``{"inbox", "active", "archive"}`` — pending_review / active / superseded + rejected rows."""
    with session_scope() as session:
        rows = session.execute(
            select(NodeMemory.status, func.count())
            .where(NodeMemory.owner_id == owner_id)
            .group_by(NodeMemory.status)
        ).all()
    by_status = {status: int(n) for status, n in rows}
    return {
        "inbox": by_status.get("pending_review", 0),
        "active": by_status.get("active", 0),
        "archive": by_status.get("superseded", 0) + by_status.get("rejected", 0),
    }


def _github_full_names(owner_id: uuid.UUID) -> list[str]:
    """The repos the owner's GitHub App installations can reach — best-effort (a dead installation
    or GitHub being down contributes nothing, never an error)."""
    with session_scope() as session:
        installation_ids = list(
            session.execute(
                select(GithubInstallation.installation_id).where(
                    GithubInstallation.owner_id == owner_id
                )
            ).scalars()
        )
    names: list[str] = []
    for installation_id in installation_ids:
        try:
            names.extend(
                r["full_name"]
                for r in github_app.list_installation_repositories(installation_id)
                if r.get("full_name")
            )
        except Exception:  # noqa: BLE001 — best-effort: the picker still lists known repos
            logger.warning("memory repos: installation %s unreachable", installation_id)
    return names


def list_memory_repos(owner_id: uuid.UUID, *, include_github: bool = False) -> list[dict]:
    """Every repo key the owner can scope a memory to, as ``{repo_key, label, memory_count,
    pending_count, last_run_at}``, sorted by label:

    * the distinct ``repo_key`` of the owner's active + pending memories (with their counts);
    * the repos of the owner's runs (``github_repo``, else a local ``repo_path``; per-run clone and
      Desktop snapshot directories are skipped), with the latest run time;
    * with ``include_github``, the full names the owner's GitHub App installations can reach (one
      GitHub call per installation — opt-in so the default read never touches the network)."""
    entries: dict[str, dict] = {}

    def entry(key: str) -> dict:
        return entries.setdefault(
            key,
            {
                "repo_key": key,
                "label": repo_label(key),
                "memory_count": 0,
                "pending_count": 0,
                "last_run_at": None,
            },
        )

    with session_scope() as session:
        rows = session.execute(
            select(NodeMemory.repo_key, NodeMemory.status, func.count())
            .where(
                NodeMemory.owner_id == owner_id,
                NodeMemory.repo_key.isnot(None),
                NodeMemory.status.in_(("active", "pending_review")),
            )
            .group_by(NodeMemory.repo_key, NodeMemory.status)
        ).all()
        for key, status, n in rows:
            e = entry(key)
            e["memory_count" if status == "active" else "pending_count"] += int(n)

        run_key = func.coalesce(Run.github_repo, Run.repo_path)
        runs = session.execute(
            select(run_key, func.max(Run.created_at))
            .where(
                Run.owner_id == owner_id,
                run_key.isnot(None),
                # a Desktop local-folder run's repo_path is a per-run directory, not a repo identity
                (Run.github_repo.isnot(None)) | (Run.local_snapshot_id.is_(None)),
            )
            .group_by(run_key)
        ).all()
        for key, last_run_at in runs:
            if _CLONES_MARKER in key:
                continue
            e = entry(key)
            if isinstance(last_run_at, datetime):
                e["last_run_at"] = last_run_at.isoformat()

    if include_github:
        for name in _github_full_names(owner_id):
            entry(name)

    return sorted(entries.values(), key=lambda e: ((e["label"] or "").lower(), e["repo_key"]))

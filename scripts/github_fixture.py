"""Shared GitHub-App test fixture: record an installation row for a local live gate.

Extracted from ``github_pr_e2e_check._seed_operator_installation`` (M-h1b) so the M-proof browser
harness can reuse it WITHOUT importing a private symbol across script modules — the exact smell
``PROJECTPLAN.md`` §15 already registers against ``routers.py`` importing the private
``auth._store_installation``. Behaviour is unchanged; the installation id is now an explicit
argument instead of a module global.

LOCAL FIXTURE ONLY. In the real product this row is written by the OAuth callback
(``auth.github_callback`` -> ``_store_installation``). A live gate has no browser OAuth dance, and
the seeded operator's ``github_user_id`` is NULL — so the callback-time backfill
(``routers._backfill_github_installations``), which matches installations to users by GitHub
*account id*, can never attach one to it and
``GET /api/github/repos`` would come back empty. Seeding the row directly is the established
work-around. Never point this at a deployed database.
"""

import uuid


def seed_operator_installation(owner_id: uuid.UUID, installation_id: int) -> str:
    """Own ``installation_id`` by ``owner_id``; return ``"created"`` or ``"re-owned"``.

    Re-owns an existing row (rather than failing on the unique ``installation_id``) so a gate is
    re-runnable across accounts on the same local database.
    """
    from sqlalchemy import select

    from tvashtr.db import session_scope
    from tvashtr.models import GithubInstallation

    with session_scope() as session:
        row = session.execute(
            select(GithubInstallation).where(GithubInstallation.installation_id == installation_id)
        ).scalar_one_or_none()
        if row is None:
            session.add(GithubInstallation(owner_id=owner_id, installation_id=installation_id))
            return "created"
        row.owner_id = owner_id
        return "re-owned"

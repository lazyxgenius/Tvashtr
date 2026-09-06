"""M-proof LOCAL-leg pre-flight: seed the operator + its GitHub installation, then report the facts
the browser harness is about to assert.

Runs BEFORE Playwright on the local leg only (``scripts/demo_proof.sh local``). It is deliberately
read-mostly and prints its findings so the transcript carries them:

* ``seed.main()`` — idempotent: ensure the operator account and import its ``.env`` provider keys
  (the same helper every live run-driving script uses via ``operator_session.login_operator``; the
  browser cannot reuse ``login_operator`` itself because that logs in an in-process ``TestClient``
  cookie jar, not a Playwright browser context — the spec posts the SAME credentials from the
  browser's own context so the ``tv_session`` cookie is the genuine signed one).
* the ``GithubInstallation`` row (``github_fixture.seed_operator_installation``) — the seeded
  operator's ``github_user_id`` is NULL, so the callback-time backfill can never reach it and the
  launch panel's repo picker would be empty. LOCAL FIXTURE ONLY.
* the account's held providers (names only, never a key) — so a §6 stop condition is visible here
  rather than forty browser steps later.
* the operator's non-terminal and rolling-24h run counts — ``make test`` fixture residue is a
  registered cause of a hosted-ceiling 429 that surfaces as a bare ``KeyError: 'run_id'``.

Never point this at a deployed database.
"""

import os
import re
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

_INSTALLATION_ID = int(os.environ.get("TVASHTR_PROOF_INSTALLATION_ID", "147133756"))
# Run statuses that still occupy a slot under the hosted concurrency ceiling.
_NON_TERMINAL = ("running", "awaiting_human", "pending")


def _load_dotenv() -> None:
    """Load the repo-root ``.env`` into ``os.environ`` without a shell ``source``.

    The ``x-api-key=`` line is not a valid shell identifier, so ``source`` based harnesses break on
    it (registered in §15); parse it here and skip any key that is not a valid env-var name. An
    already-set variable wins, so the Makefile's exports stay authoritative.
    """
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        os.environ.setdefault(key, val.strip())


def main() -> int:
    _load_dotenv()
    from github_fixture import seed_operator_installation
    from sqlalchemy import func, select

    from tvashtr import seed
    from tvashtr.db import session_scope
    from tvashtr.models import ProviderCredential, Run, User

    seed.main()  # idempotent: operator + .env provider-key import + owner backfill
    email = os.environ.get("TVASHTR_SEED_EMAIL", seed.DEFAULT_SEED_EMAIL).strip().lower()

    with session_scope() as session:
        owner_id = session.execute(select(User.id).where(User.email == email)).scalar_one_or_none()
    if owner_id is None:
        print(f"[demo-proof-seed] FATAL: seeded operator {email!r} not found after seed.main()")
        return 1

    action = seed_operator_installation(uuid.UUID(str(owner_id)), _INSTALLATION_ID)
    print(f"[demo-proof-seed] operator={email} installation={_INSTALLATION_ID} ({action})")

    with session_scope() as session:
        providers = sorted(
            session.execute(
                select(ProviderCredential.provider).where(ProviderCredential.owner_id == owner_id)
            )
            .scalars()
            .all()
        )
        non_terminal = session.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner_id, Run.status.in_(_NON_TERMINAL))
        ).scalar_one()
        since = datetime.now(UTC) - timedelta(hours=24)
        last_24h = session.execute(
            select(func.count())
            .select_from(Run)
            .where(Run.owner_id == owner_id, Run.created_at >= since)
        ).scalar_one()

    shown = ", ".join(providers) or "(none)"
    print(f"[demo-proof-seed] held providers ({len(providers)}): {shown}")
    print(
        f"[demo-proof-seed] owner runs: non-terminal={non_terminal} created-last-24h={last_24h} "
        "(hosted ceilings: per-owner concurrent + rolling-24h)"
    )
    if len(providers) < 2 or "nvidia_nim" not in providers:
        missing = "nvidia_nim" if "nvidia_nim" not in providers else "a second provider"
        print(
            f"NEEDS_HUMAN: the seeded operator holds {len(providers)} provider key(s) "
            f"({', '.join(providers) or 'none'}) — M-proof needs >=2 including nvidia_nim; "
            f"missing: {missing}. Add the key to .env and re-run `make seed`."
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

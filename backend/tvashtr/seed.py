"""Idempotent operator-account seed (M-accounts Slice A; ``make seed``).

Creates the operator's account from ``TVASHTR_SEED_EMAIL`` / ``TVASHTR_SEED_PASSWORD`` (dev
defaults) so the operator can log in immediately. Idempotent: a second run finds the account and is
a no-op. Kept OUT of migration ``0016`` on purpose — the account is DATA, not schema, so the
migration stays a pure additive schema change and the seed is independently re-runnable/testable.

DEV DEFAULTS ONLY — override both env vars for any real/shared deployment.
"""

import os

from sqlalchemy import select

from tvashtr.auth import _normalize_email, hash_password
from tvashtr.db import session_scope
from tvashtr.models import User

DEFAULT_SEED_EMAIL = "operator@tvashtr.local"
DEFAULT_SEED_PASSWORD = "tvashtr-dev"  # dev default; override TVASHTR_SEED_PASSWORD in real deploys


def main() -> None:
    """Create the operator account if absent (idempotent); print created / exists — no-op."""
    email = _normalize_email(os.environ.get("TVASHTR_SEED_EMAIL", DEFAULT_SEED_EMAIL))
    password = os.environ.get("TVASHTR_SEED_PASSWORD", DEFAULT_SEED_PASSWORD)
    with session_scope() as session:
        if session.scalar(select(User).where(User.email == email)) is not None:
            print(f"exists — no-op: {email} already has an account")
            return
        session.add(User(email=email, password_hash=hash_password(password)))
    print(f"created: operator account {email}")
    # Slice B extension point: import the operator's .env provider keys as THIS account's
    # provider_credentials here. The table does not exist yet — do NOT import keys in Slice A.


if __name__ == "__main__":
    main()

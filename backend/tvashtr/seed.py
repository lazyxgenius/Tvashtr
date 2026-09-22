"""Idempotent operator-account seed (``make seed``; M-accounts).

A single ``make seed`` (after ``make migrate``) does, idempotently:

1. **Ensure the operator account** from ``TVASHTR_SEED_EMAIL`` / ``TVASHTR_SEED_PASSWORD`` (dev
   defaults) so the operator can log in immediately (Slice A).
2. **Import the ``.env`` provider keys ONCE** into the operator's encrypted ``provider_credentials``
   (Slice B): each env var that is SET maps to a provider slug (unset ones skipped), upserting on
   ``(owner, provider)``. After this the operator can DELETE the provider keys from ``.env`` and
   every run still resolves from the DB — NOTHING reads ``.env`` provider keys at run time anymore.
3. **Backfill** existing ``owner_id``-NULL ``runs`` → the operator, and ``owner_id``-NULL
   ``is_library`` ``team_graphs`` → the operator (ephemeral non-library graphs stay NULL).

Running it twice is a no-op the second time: the account exists, the key upsert re-writes the same
values, and the backfill finds nothing NULL left. Kept OUT of the migrations on purpose — the
account + keys are DATA, not schema, so the migrations stay pure additive and the seed re-runnable.

DEV DEFAULTS ONLY — override the seed env vars for any real/shared deployment, and supply a real
``TVASHTR_SECRET_KEY`` (the Fernet key the imported secrets are encrypted under; must be STABLE).
"""

import os
import uuid

from sqlalchemy import select, update

from tvashtr.auth import _normalize_email, hash_password
from tvashtr.control_plane.credentials import encrypt_secret
from tvashtr.db import session_scope
from tvashtr.models import ProviderCredential, Run, TeamGraph, User

DEFAULT_SEED_EMAIL = "operator@tvashtr.local"
DEFAULT_SEED_PASSWORD = "tvashtr-dev"  # dev default; override TVASHTR_SEED_PASSWORD in real deploys

# Each provider's ``.env`` var name(s) (first set one wins) -> the canonical provider slug. Mirrors
# config's per-provider env names; the slug is exactly what ``provider_for_model`` derives, so an
# imported key resolves both the completion + agent paths.
#
# PUBLIC (M-live): it is the project's single declaration of "which ``.env`` var carries which
# provider's key", and the live agent smoke needs the same answer to gate on the key the CHOSEN
# agent model actually requires. Promoted rather than imported through the underscore, which is
# the fix §15 already asks for on the sibling ``routers.py``/``auth._store_installation`` case.
ENV_PROVIDER_MAP: tuple[tuple[tuple[str, ...], str], ...] = (
    (("OPENROUTER_API_KEY",), "openrouter"),
    (("OPENAI_API_KEY",), "openai"),
    (("GEMINI_API_KEY",), "gemini"),
    (("GROQ_CLOUD_API_KEY", "GROQ_API_KEY"), "groq"),
    (("NVIDIA_BUILD_API_KEY", "NVIDIA_NIM_API_KEY"), "nvidia_nim"),
    (("DEEPSEEK_API_KEY",), "deepseek"),
    (("HF_TOKEN", "HUGGINGFACE_API_KEY"), "huggingface"),
)


def _ensure_operator(email: str, password: str) -> tuple[uuid.UUID, bool]:
    """Get-or-create the operator account; return ``(operator_id, created)``."""
    with session_scope() as session:
        user = session.scalar(select(User).where(User.email == email))
        created = user is None
        if user is None:
            user = User(email=email, password_hash=hash_password(password))
            session.add(user)
            session.flush()
        return user.id, created


def import_env_provider_keys(operator_id: uuid.UUID) -> int:
    """Import each SET ``.env`` provider key into the operator's encrypted ``provider_credentials``
    (upsert on ``(owner, provider)``); skip unset ones. Returns how many providers were imported."""
    imported = 0
    with session_scope() as session:
        for env_names, provider in ENV_PROVIDER_MAP:
            key = next((v for n in env_names if (v := os.environ.get(n))), None)
            if not key:
                continue
            key = key.strip()
            existing = session.execute(
                select(ProviderCredential).where(
                    ProviderCredential.owner_id == operator_id,
                    ProviderCredential.provider == provider,
                )
            ).scalar_one_or_none()
            if existing is not None:
                existing.secret_encrypted = encrypt_secret(key)
                existing.key_last4 = key[-4:]
            else:
                session.add(
                    ProviderCredential(
                        owner_id=operator_id,
                        provider=provider,
                        secret_encrypted=encrypt_secret(key),
                        key_last4=key[-4:],
                    )
                )
            imported += 1
    return imported


def backfill_owner(operator_id: uuid.UUID) -> tuple[int, int]:
    """Backfill ``owner_id``-NULL ``runs`` and ``owner_id``-NULL ``is_library`` ``team_graphs`` to
    the operator. Returns ``(runs_backfilled, teams_backfilled)`` (both 0 on a re-run)."""
    with session_scope() as session:
        runs = session.execute(
            update(Run).where(Run.owner_id.is_(None)).values(owner_id=operator_id)
        )
        teams = session.execute(
            update(TeamGraph)
            .where(TeamGraph.owner_id.is_(None), TeamGraph.is_library.is_(True))
            .values(owner_id=operator_id)
        )
        return runs.rowcount, teams.rowcount


def main() -> None:
    """Ensure the operator, import the ``.env`` keys, backfill — idempotent; print a one-line
    summary."""
    email = _normalize_email(os.environ.get("TVASHTR_SEED_EMAIL", DEFAULT_SEED_EMAIL))
    password = os.environ.get("TVASHTR_SEED_PASSWORD", DEFAULT_SEED_PASSWORD)
    operator_id, created = _ensure_operator(email, password)
    imported = import_env_provider_keys(operator_id)
    runs_backfilled, teams_backfilled = backfill_owner(operator_id)
    status = "created" if created else "exists"
    print(
        f"seed: operator {email} ({status}); imported {imported} provider key(s); "
        f"backfilled {runs_backfilled} run(s) + {teams_backfilled} library team(s)"
    )


if __name__ == "__main__":
    main()

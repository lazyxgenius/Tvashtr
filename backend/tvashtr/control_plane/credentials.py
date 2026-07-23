"""Per-owner BYOK provider keys: symmetric encryption at rest + the run-time resolver.

M-accounts Slice B — the app becomes ``.env``-free for provider keys. Provider keys are stored
encrypted (Fernet) in ``provider_credentials`` and resolved per run-owner at run time, replacing the
global ``.env`` lookup on BOTH the completion (gateway) and agent (adapter) paths.

* ``encrypt_secret`` / ``decrypt_secret`` — Fernet round-trip under ``settings.secret_key`` (the
  STABLE ``TVASHTR_SECRET_KEY``). The plaintext key is decrypted ONLY here, at run time; it is never
  stored, logged, or returned by any endpoint.
* ``provider_for_model`` — the canonical ``model → provider`` mapping (the leading slug segment),
  the unifying key for the completion AND agent paths + the seed import.
* ``resolve_owner_api_key`` — resolve a run-owner's provider key for a model, from the encrypted DB,
  with NO ``.env`` fallback (raises ``NoCredentialError`` when the owner has no key for that
  provider).

Openhands-free at import (only cryptography + sqlalchemy + the app's own modules), so the executor
(``team_run.py``) can import it without breaching the import boundary.
"""

import uuid

from cryptography.fernet import Fernet
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import ProviderCredential


def _fernet() -> Fernet:
    """Build the Fernet cipher from the configured secret key, read at CALL time (not import) so the
    env-configured ``TVASHTR_SECRET_KEY`` is honored and tests can point at a different key. The key
    must be a 44-char urlsafe-base64 ``Fernet.generate_key()`` value (the dev default is; PROD
    overrides with its own)."""
    return Fernet(get_settings().secret_key.get_secret_value().encode("utf-8"))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a provider key into Fernet ciphertext (ASCII str) for ``provider_credentials``."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a stored Fernet ciphertext back to the plaintext provider key. Raises
    ``cryptography.fernet.InvalidToken`` if the ciphertext was produced under a DIFFERENT key (a
    rotated/mismatched ``TVASHTR_SECRET_KEY``) or is corrupt — never returns a wrong plaintext."""
    return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")


class NoCredentialError(Exception):
    """Raised when a run-owner has no ``provider_credentials`` row for a model's provider — there is
    NO ``.env`` fallback. Carries ``provider`` (and ``owner_id``) so callers can build a clear
    message: the launch pre-flight turns it into a 422 ``missing_providers`` refusal, and the
    executor's defense-in-depth resolution surfaces it as a clean run failure."""

    def __init__(self, owner_id: uuid.UUID, provider: str) -> None:
        self.owner_id = owner_id
        self.provider = provider
        super().__init__(f"owner {owner_id} has no credential for provider {provider!r}")


def provider_for_model(model: str) -> str:
    """The canonical provider slug for a model id: its leading ``provider/`` segment, lower-cased +
    trimmed (``openrouter/openai/gpt-4o-mini`` -> ``openrouter``; ``nvidia_nim/meta/llama-…`` ->
    ``nvidia_nim``; a bare ``gpt-4o-mini`` -> ``gpt-4o-mini``). The SAME mapping the gateway's
    litellm provider detection uses, so one stored key serves BOTH completion + agent paths, and is
    *more correct* than the pre-Slice-B agent catch-all that lumped ``openai/…`` into
    ``OPENROUTER_API_KEY``. Pure + unit-tested."""
    return model.split("/", 1)[0].strip().lower()


def held_provider_slugs(owner_id: uuid.UUID) -> set[str]:
    """The distinct provider slugs ``owner_id`` holds ANY BYOK credential for — the account's
    "what can this owner run" set. The SINGLE held-provider rule: the launch pre-flight
    (``routers._missing_provider_credentials``), the node-create default, AND the team-builder
    default all consult THIS, so there is one definition of "held", never two that can drift.
    Read-only; openhands-free at import (only sqlalchemy + the app's own modules)."""
    with session_scope() as session:
        return set(
            session.execute(
                select(ProviderCredential.provider).where(ProviderCredential.owner_id == owner_id)
            ).scalars()
        )


def resolve_owner_api_key(owner_id: uuid.UUID, model: str) -> str:
    """Resolve ``owner_id``'s plaintext provider key for ``model``, from the encrypted DB — the
    per-owner replacement for the global ``.env`` lookup on BOTH resolution paths.

    ``provider = provider_for_model(model)``; look up the ``(owner_id, provider)``
    ``provider_credentials`` row; decrypt and return the plaintext. Raises
    :class:`NoCredentialError` when the owner has no key for that provider — there is **no**
    ``.env`` fallback (a keyless owner is refused at launch). ``owner_id`` is always a real user id
    (every run is owned by construction). The plaintext is for immediate use; never stored."""
    provider = provider_for_model(model)
    with session_scope() as session:
        row = session.execute(
            select(ProviderCredential).where(
                ProviderCredential.owner_id == owner_id,
                ProviderCredential.provider == provider,
            )
        ).scalar_one_or_none()
    if row is None:
        raise NoCredentialError(owner_id, provider)
    return decrypt_secret(row.secret_encrypted)

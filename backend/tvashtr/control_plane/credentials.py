"""Per-owner BYOK provider keys: symmetric encryption at rest + the run-time resolver.

M-accounts Slice B — the app becomes ``.env``-free for provider keys. Provider keys are stored
encrypted (Fernet) in ``provider_credentials`` and resolved per run-owner at run time, replacing the
global ``.env`` lookup on BOTH the completion (gateway) and agent (adapter) paths.

* ``encrypt_secret`` / ``decrypt_secret`` — Fernet round-trip under ``settings.secret_key`` (the
  STABLE ``TVASHTR_SECRET_KEY``). The plaintext key is decrypted ONLY here, at run time; it is never
  stored, logged, or returned by any endpoint.
* the provider mapping + resolver land in the next commit.

Openhands-free at import (only cryptography + sqlalchemy + the app's own modules), so the executor
(``team_run.py``) can import it without breaching the import boundary.
"""

from cryptography.fernet import Fernet

from tvashtr.config import get_settings


def _fernet() -> Fernet:
    """Build the Fernet cipher from the configured secret key, read at CALL time (not import) so the
    env-configured ``TVASHTR_SECRET_KEY`` is honored and tests can point at a different key. The key
    must be a 44-char urlsafe-base64 ``Fernet.generate_key()`` value (the dev default is; PROD
    overrides with its own)."""
    return Fernet(get_settings().secret_key.encode("utf-8"))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a provider key into Fernet ciphertext (ASCII str) for ``provider_credentials``."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a stored Fernet ciphertext back to the plaintext provider key. Raises
    ``cryptography.fernet.InvalidToken`` if the ciphertext was produced under a DIFFERENT key (a
    rotated/mismatched ``TVASHTR_SECRET_KEY``) or is corrupt — never returns a wrong plaintext."""
    return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")

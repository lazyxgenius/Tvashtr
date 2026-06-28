"""Unit tests for the Fernet crypto helper (M-accounts Slice B).

Pure (no DB): a round-trip recovers the plaintext, ciphertext is not the plaintext + varies per call
(Fernet's random IV), and a wrong key cannot decrypt — so a rotated/mismatched ``TVASHTR_SECRET_KEY``
fails LOUD rather than returning a garbage plaintext that would auth as the wrong account.
"""

import pytest
from cryptography.fernet import Fernet, InvalidToken

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import decrypt_secret, encrypt_secret


def test_encrypt_decrypt_round_trip():
    plaintext = "sk-or-v1-deadbeefdeadbeefdeadbeef"
    token = encrypt_secret(plaintext)
    assert token != plaintext  # actually encrypted
    assert decrypt_secret(token) == plaintext


def test_ciphertext_is_nondeterministic_but_both_decrypt():
    """Fernet uses a random IV per call, so two encryptions of the same plaintext differ — yet both
    decrypt back. (A deterministic ciphertext would leak equality of keys across rows.)"""
    a = encrypt_secret("same-secret")
    b = encrypt_secret("same-secret")
    assert a != b
    assert decrypt_secret(a) == "same-secret"
    assert decrypt_secret(b) == "same-secret"


def test_wrong_key_cannot_decrypt(monkeypatch):
    """A ciphertext made under one key must NOT decrypt under another — it raises, never returns a
    wrong plaintext. This is what makes ``TVASHTR_SECRET_KEY`` rotation fail-closed."""
    token = encrypt_secret("top-secret-key")
    other_key = Fernet.generate_key().decode()
    # Point the helper at a different secret key (settings are cached → patch the cached instance).
    monkeypatch.setattr(get_settings(), "secret_key", other_key)
    with pytest.raises(InvalidToken):
        decrypt_secret(token)


def test_default_secret_key_is_a_valid_fernet_key():
    """The hardcoded dev default must be a usable Fernet key (so the offline suite + local dev work
    with no extra env)."""
    Fernet(get_settings().secret_key.encode("utf-8"))  # raises if malformed
